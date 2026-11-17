import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isTerminalTmuxAvailable,
    listTerminalSessions,
    prepareTerminalTmuxServer,
    isTerminalId,
    terminalTmuxAttachArgs,
    terminalTmuxBinary,
    terminalTmuxEnvironment,
} from './terminalTmux';

const tmuxInstalled = spawnSync(terminalTmuxBinary(), ['-V']).status === 0;

describe('terminal ids as tmux session names', () => {
    it('accepts what the daemon generates', () => {
        expect(isTerminalId('term_mua05tz6_fr1sm4')).toBe(true);
    });

    it('rejects what tmux would read as target syntax', () => {
        expect(isTerminalId('term:0')).toBe(false);
        expect(isTerminalId('term name')).toBe(false);
        expect(isTerminalId('')).toBe(false);
    });
});

describe('the attach command', () => {
    it('creates the session when it is new and attaches when it is not', () => {
        const args = terminalTmuxAttachArgs({
            id: 'term_abc_123456',
            cwd: '/tmp/work',
            shell: '/bin/bash',
            args: ['--norc'],
            rows: 24,
            cols: 80,
        });

        expect(args).toContain('new-session');
        // -A is the whole trick: an id left over from before a restart attaches
        // to the shell still running under it instead of starting a new one.
        expect(args).toContain('-A');
        expect(args.slice(args.indexOf('-s'))).toEqual([
            '-s', 'term_abc_123456',
            '-x', '80',
            '-y', '24',
            '-c', '/tmp/work',
            '/bin/bash', '--norc',
        ]);
    });
});

describe('the tmux locale', () => {
    it('keeps a locale that already says UTF-8', () => {
        const env = terminalTmuxEnvironment({ LANG: 'zh_CN.UTF-8' });
        expect(env.LC_CTYPE).toBeUndefined();
    });

    it('supplies one when nothing does, which is how a daemon starts', () => {
        // tmux silently drops to a non-UTF-8 mode without this, and the shells
        // it runs are the ones that render CJK.
        const env = terminalTmuxEnvironment({ PATH: '/usr/bin' });
        expect(env.LC_CTYPE).toBe(process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8');
    });
});

describe.skipIf(!tmuxInstalled)('asking whether tmux is there', () => {
    it('does not go on saying no after one look, so installing it is enough', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'happy-probe-'));
        const previous = process.env.HAPPY_TERMINAL_TMUX_SOCKET;
        const restore = () => {
            if (previous === undefined) {
                delete process.env.HAPPY_TERMINAL_TMUX_SOCKET;
            } else {
                process.env.HAPPY_TERMINAL_TMUX_SOCKET = previous;
            }
        };

        try {
            // A socket path under a regular file: the probe cannot even write
            // its configuration there, which is what a machine without tmux
            // looks like from the inside.
            const blocked = join(dir, 'not-a-directory');
            writeFileSync(blocked, '');
            process.env.HAPPY_TERMINAL_TMUX_SOCKET = join(blocked, 'terminal.sock');

            expect(await isTerminalTmuxAvailable()).toBe(false);

            // Having said no once, it must not keep saying it. A daemon that
            // had already decided would go on running plain terminals after
            // tmux was installed, with nothing to say why.
            restore();
            expect(await isTerminalTmuxAvailable()).toBe(true);

            // And a yes is kept: asking again costs nothing.
            expect(await isTerminalTmuxAvailable()).toBe(true);
        } finally {
            restore();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});


describe.skipIf(!tmuxInstalled)('reading back what tmux holds', () => {
    let socketDir = '';
    let socket = '';
    const previousSocket = process.env.HAPPY_TERMINAL_TMUX_SOCKET;

    beforeAll(() => {
        // Resolved, because a macOS /tmp is a symlink and tmux reports the real
        // path — the listing would otherwise disagree with the directory made here.
        socketDir = realpathSync(mkdtempSync(join(tmpdir(), 'happy-tmux-list-')));
        socket = join(socketDir, 'terminal.sock');
        process.env.HAPPY_TERMINAL_TMUX_SOCKET = socket;
        prepareTerminalTmuxServer();
        // Startup files must not move the shell away from the directory under test.
        writeFileSync(join(socketDir, '.bashrc'), 'cd /\n');
    });

    afterAll(() => {
        spawnSync(terminalTmuxBinary(), ['-S', socket, 'kill-server']);
        rmSync(socketDir, { recursive: true, force: true });
        if (previousSocket === undefined) {
            delete process.env.HAPPY_TERMINAL_TMUX_SOCKET;
        } else {
            process.env.HAPPY_TERMINAL_TMUX_SOCKET = previousSocket;
        }
    });

    /** Runs one shell under tmux and reads the listing back. */
    async function listOne(id: string, cwd: string, title: string) {
        const prompt = 'happy-tmux-ready>';
        const args = terminalTmuxAttachArgs({ id, cwd, shell: '/bin/bash', args: ['--norc', '--noprofile'], rows: 24, cols: 80 });
        args.splice(args.indexOf('new-session') + 1, 0, '-d');
        expect(spawnSync(terminalTmuxBinary(), args, {
            env: { ...process.env, HOME: socketDir, PS1: prompt, PROMPT_COMMAND: '' },
        }).status).toBe(0);
        // Session creation can finish before the child changes directory and starts its shell.
        await expect.poll(() => spawnSync(terminalTmuxBinary(), [
            '-S', socket, 'capture-pane', '-p', '-t', id,
        ], { encoding: 'utf8', timeout: 1000 }).stdout, { timeout: 3000, interval: 50 }).toContain(prompt);
        expect(spawnSync(terminalTmuxBinary(), ['-S', socket, 'select-pane', '-t', id, '-T', title]).status).toBe(0);

        return (await listTerminalSessions()).find((entry) => entry.id === id);
    }

    it('reads a directory and a title that hold the field separator back exactly', async () => {
        // The separator is printable, so a path and a title are both free to
        // hold it. Reading each field on its own, keyed by an id that cannot,
        // is what keeps a `|` in either from shifting the line.
        const cwd = join(socketDir, 'a|b');
        mkdirSync(cwd, { recursive: true });

        const listed = await listOne('term_list_separator', cwd, 'title|with|pipes');

        expect(listed).toBeDefined();
        expect(listed!.cwd).toBe(cwd);
        expect(listed!.title).toBe('title|with|pipes');
        expect(listed!.rows).toBe(24);
        expect(listed!.cols).toBe(80);
    });

    it('keeps a terminal on the list however tmux renders the bytes in its path', async () => {
        // tmux rewrites the control bytes it considers unprintable, and what it
        // rewrites them to depends on the version — a literal backslash-037 from
        // 3.4, the byte itself on others. Whatever it does to the value, the
        // terminal has to stay on the list: a path holding one of those bytes is
        // still a shell that is running, and dropping it is the daemon losing a
        // terminal it was supposed to take back.
        const cwd = join(socketDir, 'a' + String.fromCharCode(31) + 'b');
        mkdirSync(cwd, { recursive: true });

        const listed = await listOne('term_list_control_byte', cwd, 'still here');

        expect(listed).toBeDefined();
        expect(listed!.cwd.startsWith(socketDir)).toBe(true);
        expect(listed!.rows).toBe(24);
        expect(listed!.cols).toBe(80);
        expect(listed!.title).toBe('still here');
    });
});
