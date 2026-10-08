import * as React from 'react';
import { pickLatestAssistantMessage } from '@/components/orchestrator/display';
import { machineGetClaudeSessionPreview, machineGetCodexSessionPreview, machineGetGeminiSessionPreview, type SessionPreviewMessage } from '@/sync/ops';

const LIVE_MESSAGE_POLL_INTERVAL_MS = 3000;
// Only the tail of the conversation is needed to find the latest assistant message.
const LIVE_MESSAGE_PREVIEW_LIMIT = 10;

type Provider = 'claude' | 'codex' | 'gemini' | 'qoder';

async function fetchPreviewMessages(machineId: string, provider: Provider, childSessionId: string): Promise<SessionPreviewMessage[]> {
    const options = { limit: LIVE_MESSAGE_PREVIEW_LIMIT };
    switch (provider) {
        case 'claude':
            // The project folder is resolved by the machine from the session id
            return (await machineGetClaudeSessionPreview(machineId, undefined, childSessionId, options)).messages;
        case 'codex':
            return (await machineGetCodexSessionPreview(machineId, childSessionId, options)).messages;
        case 'qoder':
            // Qoder does not expose a session-preview RPC yet.
            return [];
        case 'gemini':
            return (await machineGetGeminiSessionPreview(machineId, childSessionId, options)).messages;
    }
}

/**
 * What a running orchestrator task is saying right now.
 *
 * A delegated task runs as a plain provider CLI process, so its conversation never reaches the
 * server. It only exists in the provider's local session file on the machine that runs it. While
 * `enabled`, this reads the latest assistant message of that session through the machine's
 * session-preview RPC every few seconds; the caller enables it only for an expanded, running
 * execution, so nothing is fetched for collapsed or finished ones.
 *
 * Requests are chained rather than interval-based so a slow machine never gets overlapping calls.
 * Failures (machine offline, session file not written yet) are not surfaced: the last known
 * message stays and the next tick tries again.
 */
export function useOrchestratorLiveMessage(opts: {
    machineId: string;
    provider: Provider;
    childSessionId: string | null;
    enabled: boolean;
}): string | null {
    const { machineId, provider, childSessionId, enabled } = opts;
    const [message, setMessage] = React.useState<string | null>(null);

    React.useEffect(() => {
        setMessage(null);
        if (!enabled || !childSessionId) {
            return undefined;
        }
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const poll = async () => {
            try {
                const latest = pickLatestAssistantMessage(await fetchPreviewMessages(machineId, provider, childSessionId));
                if (active && latest) {
                    setMessage(latest);
                }
            } catch {
                // keep the last message and retry on the next tick
            }
            if (active) {
                timer = setTimeout(poll, LIVE_MESSAGE_POLL_INTERVAL_MS);
            }
        };
        void poll();

        return () => {
            active = false;
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [machineId, provider, childSessionId, enabled]);

    return message;
}
