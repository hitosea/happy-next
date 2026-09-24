import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

import { QoderPermissionHandler } from './permissionHandler';
import type { QoderPermissionMode } from 'happy-wire';

/** A tool that runs a command on the user's machine: the one that must never be silently allowed. */
const SHELL_TOOL = 'Bash';
/** An edit tool, which `acceptEdits`/`auto` are documented to auto-approve. */
const EDIT_TOOL = 'fs-edit';

describe('QoderPermissionHandler', () => {
    let agentState: any;
    let session: any;
    let pushClient: any;

    const handlerFor = (mode: QoderPermissionMode) => {
        const handler = new QoderPermissionHandler(session, pushClient);
        handler.setPermissionMode(mode);
        return handler;
    };

    beforeEach(() => {
        agentState = {};
        session = {
            sessionId: 'session-1',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn((updater: (state: any) => any) => {
                agentState = updater(agentState);
            }),
        };
        pushClient = { sendToAllDevices: vi.fn() };
    });

    it.each([
        // The CLI's own words for each mode, from `session/new` availableModes.
        ['default', SHELL_TOOL, false],
        ['dontAsk', SHELL_TOOL, false],
        ['acceptEdits', SHELL_TOOL, false],
        ['auto', SHELL_TOOL, false],
        ['acceptEdits', EDIT_TOOL, true],
        ['auto', EDIT_TOOL, true],
        ['yolo', SHELL_TOOL, true],
    ] as const)('mode %s with %s auto-approves: %s', async (mode, toolName, autoApproves) => {
        const handler = handlerFor(mode);

        if (!autoApproves) {
            // Asking means parking the call until the app answers; never resolving is the point.
            void handler.handleToolCall('call-1', toolName, {});
            expect(session.updateAgentState).toHaveBeenCalledTimes(1);
            expect(agentState.requests?.['call-1']).toMatchObject({ tool: toolName });
            return;
        }

        const result = await handler.handleToolCall('call-1', toolName, {});
        expect(result.decision).toBe(mode === 'yolo' ? 'approved_for_session' : 'approved');
        // Auto-approved calls stay out of AgentState so the tool card shows no permission footer.
        expect(agentState.requests?.['call-1']).toBeUndefined();
        expect(agentState.completedRequests?.['call-1']).toBeUndefined();
    });

    it('auto-approves Happy-owned tools whatever the mode is', async () => {
        const handler = handlerFor('default');

        // change_title by name, a vendor reasoning stream, and change_title smuggled through
        // the call id while the tool name says something else (the CLI does this).
        await expect(handler.handleToolCall('call-1', 'change_title', {})).resolves.toEqual({ decision: 'approved' });
        await expect(handler.handleToolCall('call-2', 'QoderReasoning', {})).resolves.toEqual({ decision: 'approved' });
        await expect(handler.handleToolCall('change_title-3', 'other', {})).resolves.toEqual({ decision: 'approved' });
    });
});
