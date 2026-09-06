import { describe, expect, it, vi } from 'vitest';
import { emitReadyIfIdle, formatCodexProcessExitMessage } from '../runCodex';

describe('formatCodexProcessExitMessage', () => {
    it('explains how to resolve an active writer conflict', () => {
        const message = formatCodexProcessExitMessage(new Error(
            "Codex 'thread/resume' request failed: thread session-123 already has an active writer (code -32600)",
        ));

        expect(message).toContain('Cannot resume this Codex session');
        expect(message).toContain('Exit the original Codex or Happy session, then try again.');
        expect(message).toContain("Codex error: Codex 'thread/resume' request failed");
        expect(message).not.toContain('Error: Codex');
    });

    it('preserves the existing message for other process failures', () => {
        expect(formatCodexProcessExitMessage('connection closed')).toBe(
            'Process exited unexpectedly: connection closed',
        );
    });
});

describe('emitReadyIfIdle', () => {
    it('emits ready and notification when queue is idle', () => {
        const sendReady = vi.fn();
        const notify = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
            notify,
        });

        expect(emitted).toBe(true);
        expect(sendReady).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('skips when a message is still pending', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: {},
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when queue still has items', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 2,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when shutdown is requested', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: true,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });
});
