import * as React from 'react';
import { getNewSessionSuggestions } from '@/components/autocomplete/suggestions';
import { machineDiscoverCapabilities } from '@/sync/ops';
import type { SessionCapabilities } from '@/sync/storageTypes';

/**
 * `/` and `$` autocomplete for the new-session input, where no session exists yet to report its
 * commands and skills. The daemon scans the chosen directory for the chosen agent instead.
 *
 * Capabilities are fetched whenever the machine, directory or agent changes, and the suggestion
 * handler awaits that in-flight fetch so a `/` typed right away still gets results. A failed fetch
 * (e.g. a daemon too old to have the RPC) yields no suggestions and is retried on the next query.
 */
export function useNewSessionAutocomplete(
    machineId: string | null | undefined,
    directory: string | null | undefined,
    agent: 'claude' | 'codex' | 'gemini' | 'qoder',
) {
    const fetchRef = React.useRef<{ key: string; promise: Promise<SessionCapabilities | null> } | null>(null);
    const key = machineId && directory ? `${machineId}\n${directory}\n${agent}` : null;

    const load = React.useCallback((): Promise<SessionCapabilities | null> => {
        if (!key || !machineId || !directory) {
            return Promise.resolve(null);
        }
        if (fetchRef.current?.key === key) {
            return fetchRef.current.promise;
        }
        const promise = machineDiscoverCapabilities(machineId, agent, directory).catch((error) => {
            console.warn('Failed to discover capabilities for new session:', error);
            if (fetchRef.current?.promise === promise) {
                fetchRef.current = null;
            }
            return null;
        });
        fetchRef.current = { key, promise };
        return promise;
    }, [key, machineId, directory, agent]);

    // Refetch on every change so commands/skills added on disk show up when the user revisits
    React.useEffect(() => {
        fetchRef.current = null;
        load();
    }, [load]);

    const suggestions = React.useCallback(async (query: string) => {
        const capabilities = await load();
        return capabilities ? getNewSessionSuggestions(capabilities, query) : [];
    }, [load]);

    const prefixes = React.useMemo(() => agent === 'codex' ? ['/', '$'] : ['/'], [agent]);

    return { prefixes, suggestions };
}
