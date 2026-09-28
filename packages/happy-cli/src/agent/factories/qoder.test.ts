import { describe, expect, it } from 'vitest';
import { buildQoderAcpArgs, qoderPermissionModeToCliFlag, resolveQoderCommand } from './qoder';
import {
    isQoderCnHost,
    qoderLoginHint,
    qoderNpmPackageForHost,
    QODER_CONFIG_DIR_VARS,
    QODER_NPM_PACKAGE,
    QODER_SDK_ISOLATION_VARS,
    isQoderAuthError,
    qoderSdkIsolationEnv,
} from '@/qoder/constants';
import { MODEL_MODE_DEFAULT } from 'happy-wire';

/**
 * These encode measurements, not guesses. They were taken against qoder-cli 1.1.62:
 *  - `--acp` composes with --model / --permission-mode / --yolo (all returned a
 *    valid ACP initialize response)
 *  - an inherited QODER_AGENT_SDK_ENTRYPOINT makes `qoder --acp` fail with
 *    `sdk_invalid_args` before it speaks the protocol; overriding it with '' is enough
 *  - unauthenticated spawn answers session/new with JSON-RPC -32000
 *    "Authentication required", and `qoder --list-models` says "Not logged in"
 */
describe('qoder spawn plan', () => {
    it('always starts from the ACP flag', () => {
        expect(buildQoderAcpArgs({})).toEqual(['--acp']);
        expect(buildQoderAcpArgs({ model: MODEL_MODE_DEFAULT })).toEqual(['--acp']);
    });

    it('unprefixes the wire mode id into the CLI tier value', () => {
        expect(buildQoderAcpArgs({ model: 'qoder-auto' })).toEqual(['--acp', '--model', 'auto']);
        expect(buildQoderAcpArgs({ model: 'qoder-qmodel_38max' })).toEqual(['--acp', '--model', 'qmodel_38max']);
    });

    it('translates ACP mode ids into the CLI flag vocabulary, which spells them differently', () => {
        // Measured: ACP says acceptEdits/dontAsk/yolo, the flag takes accept_edits/
        // dont_ask and has no yolo tier at all.
        expect(qoderPermissionModeToCliFlag('acceptEdits')).toBe('accept_edits');
        expect(qoderPermissionModeToCliFlag('dontAsk')).toBe('dont_ask');
        expect(qoderPermissionModeToCliFlag('yolo')).toBe('--yolo');
        expect(qoderPermissionModeToCliFlag('auto')).toBe('auto');
        expect(qoderPermissionModeToCliFlag(null)).toBeNull();
        expect(buildQoderAcpArgs({ permissionMode: 'acceptEdits' })).toEqual([
            '--acp', '--permission-mode', 'accept_edits',
        ]);
        // The '--yolo' return value is a sentinel: it goes in as its own flag, never as
        // a --permission-mode value.
        expect(buildQoderAcpArgs({ permissionMode: 'yolo' })).toEqual(['--acp', '--yolo']);
        // Happy's own yolo intent still wins over a named mode.
        expect(buildQoderAcpArgs({ permissionMode: 'acceptEdits', yolo: true })).toEqual([
            '--acp', '--yolo',
        ]);
    });

    it('prefers the distribution that matches the host, since the two sign in separately', () => {
        // No PATH entries at all -> fall back to the preferred candidate, so the error
        // text can still name what we tried to spawn.
        expect(resolveQoderCommand({ HOME: '/tmp/happy-no-qoder-home' } as NodeJS.ProcessEnv)).toBe('qoder');
        expect(resolveQoderCommand({ QODER_PRODUCT_ID: 'qoder-cn', HOME: '/tmp/happy-no-qoder-home' } as NodeJS.ProcessEnv)).toBe('qodercn');
        expect(resolveQoderCommand({ QODERCN_CONFIG_DIR: '/Users/x/.qoder-cn', HOME: '/tmp/happy-no-qoder-home' } as NodeJS.ProcessEnv)).toBe('qodercn');
        expect(resolveQoderCommand({ QODERCN_CLI: '1', HOME: '/home/coder' } as NodeJS.ProcessEnv)).toBe('/home/coder/.qoder-cn/entry/qodercn');
    });

    it('lets HAPPY_QODER_PATH win over both candidates', () => {
        expect(resolveQoderCommand({
            HAPPY_QODER_PATH: '/opt/custom-qoder',
            QODER_PRODUCT_ID: 'qoder-cn',
        } as NodeJS.ProcessEnv)).toBe('/opt/custom-qoder');
        // Whitespace must not become an empty command.
        expect(resolveQoderCommand({ HAPPY_QODER_PATH: '   ', HOME: '/tmp/happy-no-qoder-home' } as NodeJS.ProcessEnv)).toBe('qoder');
    });

    it('points each edition at its own install and login path', () => {
        expect(isQoderCnHost({ QODER_PRODUCT_ID: 'qoder-cn' } as NodeJS.ProcessEnv)).toBe(true);
        expect(isQoderCnHost({} as NodeJS.ProcessEnv)).toBe(false);
        expect(qoderNpmPackageForHost({} as NodeJS.ProcessEnv)).toBe('@qoder-ai/qodercli');
        expect(qoderNpmPackageForHost({ QODER_PRODUCT_ID: 'qoder-cn' } as NodeJS.ProcessEnv)).toBe('@qodercn-ai/qoderclicn');
        expect(qoderLoginHint('qodercn')).toContain('qodercn');
        expect(qoderLoginHint('qoder')).toContain('qodercli login');
    });
});

describe('qoder environment isolation', () => {
    it('neutralises an inherited Agent SDK launch context', () => {
        const env = qoderSdkIsolationEnv();
        for (const name of QODER_SDK_ISOLATION_VARS) {
            // Empty string, not deletion: AcpBackend merges `{...process.env, ...env}`,
            // which cannot remove a key. Qoder's check is on truthiness, so '' works.
            expect(env[name]).toBe('');
        }
    });

    it('never clears the vars Qoder uses to find its own credentials', () => {
        // Clearing these would move the CLI off its login state and turn a working
        // session into a spurious "Authentication required".
        const cleared = new Set<string>(QODER_SDK_ISOLATION_VARS);
        for (const name of QODER_CONFIG_DIR_VARS) {
            expect(cleared.has(name), `${name} must survive isolation`).toBe(false);
        }
    });

    it('recognises both auth failure phrasings', () => {
        expect(isQoderAuthError('Error handling request ... Authentication required: Authentication is required.')).toBe(true);
        expect(isQoderAuthError('Not logged in. Run `qodercli login` to authenticate.')).toBe(true);
        expect(isQoderAuthError(`npm error 404 ${QODER_NPM_PACKAGE}`)).toBe(false);
        expect(isQoderAuthError('')).toBe(false);
        expect(isQoderAuthError(null)).toBe(false);
    });
});
