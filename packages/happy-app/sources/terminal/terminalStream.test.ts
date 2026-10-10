import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalFrameBody, TerminalRelayedFrame } from 'happy-wire';

const onMessage = vi.fn();
const onReconnected = vi.fn();
const emitWithAck = vi.fn();
const machineRPC = vi.fn();
const decryptMachinePayload = vi.fn();

/**
 * A machine that can be taken offline mid-test. The real store is a Zustand
 * one; this is the two methods the stream uses, so a test can flip the flag the
 * way the server's machine-activity broadcast does.
 */
const machine = vi.hoisted(() => {
    const subscribers = new Set<() => void>();
    return {
        active: true,
        subscribe: (listener: () => void) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        setActive(active: boolean) {
            this.active = active;
            for (const listener of subscribers) {
                listener();
            }
        },
    };
});

vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({ machines: { 'machine-1': { active: machine.active } } }),
        subscribe: (listener: () => void) => machine.subscribe(listener),
    },
}));

vi.mock('@/sync/apiSocket', () => ({
    apiSocket: {
        onMessage: (...args: unknown[]) => onMessage(...args),
        onReconnected: (...args: unknown[]) => onReconnected(...args),
        emitWithAck: (...args: unknown[]) => emitWithAck(...args),
        machineRPC: (...args: unknown[]) => machineRPC(...args),
        decryptMachinePayload: (...args: unknown[]) => decryptMachinePayload(...args),
    },
}));

const { TerminalStream } = await import('./terminalStream');

const MACHINE_ID = 'machine-1';
const TERMINAL_ID = 'term-1';

interface Harness {
    stream: InstanceType<typeof TerminalStream>;
    frames: TerminalRelayedFrame[];
    viewports: Array<{ rows: number; cols: number; text: string }>;
    statuses: Array<{ attaching: boolean; error: string | null; offline: boolean }>;
    exits: Array<{ exitCode: number | null; signal: number | null }>;
    /** Delivers a frame to whatever handler the stream registered. */
    emit: (frame: TerminalRelayedFrame) => Promise<void>;
    /** Delivers a frame without waiting for it to be processed. */
    deliver: (frame: TerminalRelayedFrame) => void;
    /** Frame text as the mirror currently holds it. */
    screen: () => string;
    /** Lets queued microtasks (decrypt, write) settle. */
    settle: () => Promise<void>;
    /** The reconnect handler the stream registered. */
    reconnect: () => Promise<void>;
}

function textOf(viewport: { rows: number; cols: number; text: string }): string {
    return viewport.text;
}

function createHarness(): Harness {
    const frames: TerminalRelayedFrame[] = [];
    const viewports: Array<{ rows: number; cols: number; text: string }> = [];
    const statuses: Array<{ attaching: boolean; error: string | null; offline: boolean }> = [];
    const exits: Array<{ exitCode: number | null; signal: number | null }> = [];

    let frameHandler: ((frame: TerminalRelayedFrame) => void) | null = null;
    let reconnectHandler: (() => void) | null = null;
    onMessage.mockImplementation((event: string, handler: (frame: TerminalRelayedFrame) => void) => {
        if (event === 'terminal-frame') {
            frameHandler = handler;
        }
        return () => {
            frameHandler = null;
        };
    });
    onReconnected.mockImplementation((handler: () => void) => {
        reconnectHandler = handler;
        return () => {
            reconnectHandler = null;
        };
    });
    emitWithAck.mockResolvedValue({ ok: true });
    machineRPC.mockResolvedValue({ ok: true, revision: 1 });

    const stream = new TerminalStream({
        machineId: MACHINE_ID,
        terminalId: TERMINAL_ID,
        size: { rows: 6, cols: 20 },
        onViewport: (state) => {
            viewports.push({
                rows: state.rows,
                cols: state.cols,
                text: state.grid
                    .map((row) => row.map((cell) => cell.char).join('').trimEnd())
                    .join('\n'),
            });
        },
        onStatus: (status) => statuses.push(status),
        onTitle: () => {},
        onExit: (info) => exits.push(info),
    });

    return {
        stream,
        frames,
        viewports,
        statuses,
        exits,
        emit: async (frame) => {
            frames.push(frame);
            frameHandler?.(frame);
            await settle();
        },
        deliver: (frame) => {
            frames.push(frame);
            frameHandler?.(frame);
        },
        screen: () => textOf(viewports[viewports.length - 1] ?? { rows: 0, cols: 0, text: '' }),
        settle,
        reconnect: async () => {
            reconnectHandler?.();
            await settle();
        },
    };
}

/** Lets pending promises (decrypt, xterm's async write) run to completion. */
async function settle(): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function frame(revision: number, body: TerminalFrameBody, overrides: Partial<TerminalRelayedFrame> = {}): TerminalRelayedFrame {
    decryptMachinePayload.mockResolvedValueOnce(body);
    return {
        machineId: MACHINE_ID,
        terminalId: TERMINAL_ID,
        revision,
        payload: `payload-${revision}`,
        ...overrides,
    };
}

/** A frame whose decryption finishes only when the test says so. */
function deferredFrame(revision: number, body: TerminalFrameBody): { frame: TerminalRelayedFrame; decrypt: () => void } {
    let resolve: (value: TerminalFrameBody) => void = () => {};
    decryptMachinePayload.mockReturnValueOnce(new Promise<TerminalFrameBody>((done) => {
        resolve = done;
    }));
    return {
        frame: { machineId: MACHINE_ID, terminalId: TERMINAL_ID, revision, payload: `payload-${revision}` },
        decrypt: () => resolve(body),
    };
}

async function startAttached(harness: Harness): Promise<void> {
    harness.stream.start();
    await harness.settle();
}

beforeEach(() => {
    // `resetAllMocks` rather than `clearAllMocks`: the latter leaves queued
    // `mockResolvedValueOnce` values in place, so a test that does not consume
    // its queue feeds stale bodies to the next one.
    vi.resetAllMocks();
    machine.setActive(true);
});

describe('TerminalStream', () => {
    it('subscribes and attaches on start', async () => {
        const harness = createHarness();
        await startAttached(harness);

        expect(emitWithAck).toHaveBeenCalledWith('terminal-subscribe', {
            machineId: MACHINE_ID,
            terminalId: TERMINAL_ID,
        });
        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-attach', { terminalId: TERMINAL_ID });
        expect(harness.statuses.at(-1)).toEqual({ attaching: false, error: null, offline: false });

        harness.stream.dispose();
    });

    it('renders the screen a snapshot replays', async () => {
        const harness = createHarness();
        await startAttached(harness);

        await harness.emit(frame(1, { type: 'snapshot', ansi: 'hello', rows: 6, cols: 20 }));

        expect(harness.screen()).toContain('hello');
        harness.stream.dispose();
    });

    it('applies deltas that follow the snapshot', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: '', rows: 6, cols: 20 }));

        await harness.emit(frame(2, { type: 'output', data: 'after' }));

        expect(harness.screen()).toContain('after');
        harness.stream.dispose();
    });

    it('discards frames that raced the snapshot', async () => {
        const harness = createHarness();
        await startAttached(harness);

        // These land before the snapshot exists, so the snapshot already
        // contains them — applying them again would duplicate the text.
        await harness.emit(frame(1, { type: 'output', data: 'stale' }));
        await harness.emit(frame(2, { type: 'output', data: 'also-stale' }));
        await harness.emit(frame(3, { type: 'snapshot', ansi: 'fresh', rows: 6, cols: 20 }));
        await harness.emit(frame(4, { type: 'output', data: '-new' }));

        expect(harness.screen()).toContain('fresh-new');
        expect(harness.screen()).not.toContain('stale');
        harness.stream.dispose();
    });

    it('re-attaches when a revision goes missing', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: '', rows: 6, cols: 20 }));
        machineRPC.mockClear();

        // Revision 2 never arrived, so the mirror no longer matches the daemon.
        await harness.emit(frame(3, { type: 'output', data: 'orphan' }));

        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-attach', { terminalId: TERMINAL_ID });
        expect(harness.screen()).not.toContain('orphan');
        harness.stream.dispose();
    });

    it('accepts a snapshot that resets the sequence after a re-attach', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: 'one', rows: 6, cols: 20 }));

        // A re-attach supersedes everything before it; the new baseline is
        // whatever revision the new snapshot carries.
        await harness.emit(frame(9, { type: 'snapshot', ansi: 'rebuilt', rows: 6, cols: 20 }));
        await harness.emit(frame(10, { type: 'output', data: '-more' }));

        expect(harness.screen()).toContain('rebuilt-more');
        expect(harness.screen()).not.toContain('one');
        harness.stream.dispose();
    });

    it('ignores frames addressed to another terminal or machine', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: 'mine', rows: 6, cols: 20 }));

        await harness.emit(frame(2, { type: 'output', data: '-other' }, { terminalId: 'term-2' }));
        await harness.emit(frame(3, { type: 'output', data: '-elsewhere' }, { machineId: 'machine-2' }));

        expect(harness.screen()).toContain('mine');
        expect(harness.screen()).not.toContain('other');
        expect(harness.screen()).not.toContain('elsewhere');
        harness.stream.dispose();
    });

    it('does not ask the socket to decrypt a frame that is not ours', async () => {
        const harness = createHarness();
        await startAttached(harness);
        decryptMachinePayload.mockClear();

        await harness.emit(frame(1, { type: 'output', data: 'x' }, { terminalId: 'term-2' }));

        expect(decryptMachinePayload).not.toHaveBeenCalled();
        harness.stream.dispose();
    });

    it('drops a frame whose payload will not decrypt', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: 'kept', rows: 6, cols: 20 }));

        decryptMachinePayload.mockResolvedValueOnce(null);
        await harness.emit({
            machineId: MACHINE_ID,
            terminalId: TERMINAL_ID,
            revision: 2,
            payload: 'garbage',
        });

        // The screen must survive a bad payload rather than blanking out.
        expect(harness.screen()).toContain('kept');
        harness.stream.dispose();
    });

    it('reports an exit frame', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: '', rows: 6, cols: 20 }));

        await harness.emit(frame(2, { type: 'exit', exitCode: 3, signal: null }));

        expect(harness.exits).toEqual([{ exitCode: 3, signal: null }]);
        harness.stream.dispose();
    });

    it('sends input over RPC', async () => {
        const harness = createHarness();
        await startAttached(harness);
        machineRPC.mockClear();

        harness.stream.write('ls\n');
        await harness.settle();

        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-input', {
            terminalId: TERMINAL_ID,
            data: 'ls\n',
        });
        harness.stream.dispose();
    });

    it('resizes the pty when the view changes size', async () => {
        const harness = createHarness();
        await startAttached(harness);
        machineRPC.mockClear();

        harness.stream.resize({ rows: 40, cols: 120 });
        await harness.settle();

        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-resize', {
            terminalId: TERMINAL_ID,
            rows: 40,
            cols: 120,
        });
        harness.stream.dispose();
    });

    it('does not resize to the size it already has', async () => {
        const harness = createHarness();
        await startAttached(harness);
        machineRPC.mockClear();

        harness.stream.resize({ rows: 6, cols: 20 });
        await harness.settle();

        expect(machineRPC).not.toHaveBeenCalled();
        harness.stream.dispose();
    });

    it('re-attaches after the socket reconnects', async () => {
        const harness = createHarness();
        await startAttached(harness);
        machineRPC.mockClear();

        await harness.reconnect();

        // The server drops subscriptions with the socket, so the terminal has
        // to be claimed again from scratch.
        expect(emitWithAck).toHaveBeenCalledWith('terminal-subscribe', {
            machineId: MACHINE_ID,
            terminalId: TERMINAL_ID,
        });
        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-attach', { terminalId: TERMINAL_ID });
        harness.stream.dispose();
    });

    it('says the machine is away, and takes the screen back when it returns', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: 'from-the-old-daemon', rows: 6, cols: 20 }));
        emitWithAck.mockClear();
        machineRPC.mockClear();

        // The daemon going away leaves this socket alone — it is the server that
        // notices, and the machine's flag is how that reaches here.
        machine.setActive(false);
        expect(harness.statuses.at(-1)).toEqual({ attaching: false, error: null, offline: true });
        // Said, not lost: the shell is held by tmux and the next daemon finds it.
        expect(emitWithAck).not.toHaveBeenCalled();

        machine.setActive(true);
        await harness.settle();

        // What was on screen came from the daemon that left, so the screen is
        // rebuilt rather than resumed.
        expect(emitWithAck).toHaveBeenCalledWith('terminal-subscribe', {
            machineId: MACHINE_ID,
            terminalId: TERMINAL_ID,
        });
        expect(harness.statuses.at(-1)).toEqual({ attaching: false, error: null, offline: false });

        harness.stream.dispose();
    });

    it('releases the subscription on dispose', async () => {
        const harness = createHarness();
        await startAttached(harness);
        emitWithAck.mockClear();

        harness.stream.dispose();
        await harness.settle();

        expect(emitWithAck).toHaveBeenCalledWith('terminal-unsubscribe', {
            machineId: MACHINE_ID,
            terminalId: TERMINAL_ID,
        });
    });

    it('stops rendering frames after dispose', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: 'before', rows: 6, cols: 20 }));
        const countAfterDispose = harness.viewports.length;

        harness.stream.dispose();
        await harness.emit(frame(2, { type: 'output', data: '-after' }));

        expect(harness.viewports.length).toBe(countAfterDispose);
    });

    it('applies frames in arrival order when they decrypt out of order', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: '', rows: 6, cols: 20 }));
        machineRPC.mockClear();

        const keys = ['1', '2', '3', '4', '5', '6'].map((key, index) =>
            deferredFrame(index + 2, { type: 'output', data: key }),
        );
        for (const key of keys) {
            harness.deliver(key.frame);
        }
        // The last keystroke's echo decrypts first, the first one's last.
        for (const key of [...keys].reverse()) {
            key.decrypt();
        }
        await harness.settle();

        expect(harness.screen()).toContain('123456');
        // Nothing went missing, so nothing may be re-attached.
        expect(machineRPC).not.toHaveBeenCalledWith(MACHINE_ID, 'terminal-attach', expect.anything());
        harness.stream.dispose();
    });

    it('does not let an older snapshot that decrypts late overwrite a newer one', async () => {
        const harness = createHarness();
        await startAttached(harness);

        const older = deferredFrame(5, { type: 'snapshot', ansi: 'old', rows: 6, cols: 20 });
        const newer = deferredFrame(9, { type: 'snapshot', ansi: 'new', rows: 6, cols: 20 });
        harness.deliver(older.frame);
        harness.deliver(newer.frame);
        newer.decrypt();
        await harness.settle();
        older.decrypt();
        await harness.settle();

        expect(harness.screen()).toContain('new');
        expect(harness.screen()).not.toContain('old');
        harness.stream.dispose();
    });

    it('re-attaches once for a hole, however many frames follow it', async () => {
        const harness = createHarness();
        await startAttached(harness);
        await harness.emit(frame(1, { type: 'snapshot', ansi: '', rows: 6, cols: 20 }));
        machineRPC.mockClear();
        // Hold the re-attach open so every frame below lands while it runs.
        machineRPC.mockReturnValue(new Promise(() => {}));

        await harness.emit(frame(3, { type: 'output', data: 'a' }));
        await harness.emit(frame(4, { type: 'output', data: 'b' }));
        await harness.emit(frame(5, { type: 'output', data: 'c' }));

        // The resize that opens the re-attach, and nothing after it.
        expect(machineRPC).toHaveBeenCalledTimes(1);
        expect(machineRPC).toHaveBeenCalledWith(MACHINE_ID, 'terminal-resize', expect.anything());
        harness.stream.dispose();
    });

    it('sends keystrokes typed during a pending send as one batch, in order', async () => {
        const harness = createHarness();
        await startAttached(harness);
        machineRPC.mockClear();
        let landFirst: () => void = () => {};
        machineRPC.mockReturnValueOnce(new Promise<void>((done) => {
            landFirst = done;
        }));
        machineRPC.mockResolvedValue({ ok: true });

        harness.stream.write('1');
        harness.stream.write('2');
        harness.stream.write('3');
        harness.stream.write('4');
        await harness.settle();
        expect(machineRPC).toHaveBeenCalledTimes(1);

        landFirst();
        await harness.settle();

        expect(machineRPC.mock.calls.map((call) => (call[2] as { data: string }).data)).toEqual(['1', '234']);
        harness.stream.dispose();
    });

    it('surfaces a rejected subscription as an error', async () => {
        const harness = createHarness();
        emitWithAck.mockResolvedValue({ ok: false, error: 'Forbidden' });

        await startAttached(harness);

        expect(harness.statuses.at(-1)).toEqual({ attaching: false, error: 'Forbidden', offline: false });
        // Nothing may be attached when the relay refused the subscription.
        expect(machineRPC).not.toHaveBeenCalled();
        harness.stream.dispose();
    });
});
