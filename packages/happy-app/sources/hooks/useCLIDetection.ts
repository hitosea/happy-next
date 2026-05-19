import { useState, useEffect } from 'react';
import { machineBash } from '@/sync/ops';

interface CLIAvailability {
    claude: boolean | null; // null = unknown/loading, true = installed, false = not installed
    codex: boolean | null;
    gemini: boolean | null;
    opencode: boolean | null;
    opencodeModels: string[]; // dynamically discovered models from `opencode models`
    isDetecting: boolean; // Explicit loading state
    timestamp: number; // When detection completed
    error?: string; // Detection error message (for debugging)
}

const CLI_DETECTION_COMMAND =
    'export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$HOME/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"; ' +
    '(command -v claude >/dev/null 2>&1 && echo "claude:true" || echo "claude:false") && ' +
    '(command -v codex >/dev/null 2>&1 && echo "codex:true" || echo "codex:false") && ' +
    '(command -v gemini >/dev/null 2>&1 && echo "gemini:true" || echo "gemini:false") && ' +
    '(command -v opencode >/dev/null 2>&1 && echo "opencode:true" || echo "opencode:false") && ' +
    '(command -v opencode >/dev/null 2>&1 && opencode models 2>/dev/null | sed "s/^/opencode-model:/" || true)';

function parseCLIOutput(stdout: string): CLIAvailability {
    const lines = stdout.trim().split('\n');
    const cliStatus: { claude?: boolean; codex?: boolean; gemini?: boolean; opencode?: boolean } = {};
    const opencodeModels: string[] = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('opencode-model:')) {
            const model = trimmed.slice('opencode-model:'.length).trim();
            if (model && /^[\w.:\/-]+$/.test(model) && model.length <= 100) opencodeModels.push(model);
            return;
        }
        const [cli, status] = trimmed.split(':');
        if (cli && status) {
            cliStatus[cli.trim() as 'claude' | 'codex' | 'gemini' | 'opencode'] = status.trim() === 'true';
        }
    });

    return {
        claude: cliStatus.claude ?? null,
        codex: cliStatus.codex ?? null,
        gemini: cliStatus.gemini ?? null,
        opencode: cliStatus.opencode ?? null,
        opencodeModels,
        isDetecting: false,
        timestamp: Date.now(),
    };
}

/**
 * Detects which CLI tools (claude, codex, gemini) are installed on a remote machine.
 *
 * NON-BLOCKING: Detection runs asynchronously in useEffect. UI shows all profiles
 * while detection is in progress, then updates when results arrive.
 *
 * Detection is automatic when machineId changes. Uses existing machineBash() RPC
 * to run `command -v` checks on the remote machine.
 *
 * CONSERVATIVE FALLBACK: If detection fails (network error, timeout, bash error),
 * sets all CLIs to null and timestamp to 0, hiding status from UI.
 * User discovers CLI availability when attempting to spawn.
 *
 * @param machineId - The machine to detect CLIs on (null = no detection)
 * @returns CLI availability status for claude, codex, and gemini
 *
 * @example
 * const cliAvailability = useCLIDetection(selectedMachineId);
 * if (cliAvailability.claude === false) {
 *     // Show "Claude CLI not detected" warning
 * }
 */
export function useCLIDetection(machineId: string | null): CLIAvailability {
    const [availability, setAvailability] = useState<CLIAvailability>({
        claude: null,
        codex: null,
        gemini: null,
        opencode: null,
        opencodeModels: [],
        isDetecting: false,
        timestamp: 0,
    });

    useEffect(() => {
        if (!machineId) {
            setAvailability({ claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [], isDetecting: false, timestamp: 0 });
            return;
        }

        let cancelled = false;

        const detectCLIs = async () => {
            // Set detecting flag (non-blocking - UI stays responsive)
            setAvailability(prev => ({ ...prev, isDetecting: true }));

            try {
                const result = await machineBash(machineId, CLI_DETECTION_COMMAND, '/');

                if (cancelled) return;

                if (result.success && result.exitCode === 0) {
                    setAvailability(parseCLIOutput(result.stdout));
                } else {
                    setAvailability({
                        claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [],
                        isDetecting: false, timestamp: 0,
                        error: `Detection failed: ${result.stderr || 'Unknown error'}`,
                    });
                }
            } catch (error) {
                if (cancelled) return;
                setAvailability({
                    claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [],
                    isDetecting: false, timestamp: 0,
                    error: error instanceof Error ? error.message : 'Detection error',
                });
            }
        };

        detectCLIs();

        // Cleanup: Cancel detection if component unmounts or machineId changes
        return () => {
            cancelled = true;
        };
    }, [machineId]);

    return availability;
}

/**
 * Detects CLI availability for multiple machines in parallel.
 * Only runs detection on online machines. Results are keyed by machineId.
 *
 * @param machineIds - Array of machine IDs to detect CLIs on (only online ones)
 * @returns Map of machineId → CLIAvailability
 */
export function useCLIDetectionBatch(machineIds: string[]): Record<string, CLIAvailability> {
    const [availabilityMap, setAvailabilityMap] = useState<Record<string, CLIAvailability>>({});

    // Stabilize the dependency — machineIds is a new array ref each render
    const machineIdsKey = machineIds.slice().sort().join(',');

    useEffect(() => {
        const ids = machineIdsKey ? machineIdsKey.split(',') : [];
        if (ids.length === 0) {
            setAvailabilityMap({});
            return;
        }

        let cancelled = false;

        // Mark all as detecting synchronously
        const detecting: Record<string, CLIAvailability> = {};
        for (const id of ids) {
            detecting[id] = { claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [], isDetecting: true, timestamp: 0 };
        }
        setAvailabilityMap(detecting);

        // Detect each machine independently (not awaiting Promise.all)
        for (const machineId of ids) {
            machineBash(machineId, CLI_DETECTION_COMMAND, '/').then(result => {
                if (cancelled) return;
                if (result.success && result.exitCode === 0) {
                    setAvailabilityMap(prev => ({ ...prev, [machineId]: parseCLIOutput(result.stdout) }));
                } else {
                    setAvailabilityMap(prev => ({
                        ...prev,
                        [machineId]: { claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [], isDetecting: false, timestamp: 0 },
                    }));
                }
            }).catch(() => {
                if (cancelled) return;
                setAvailabilityMap(prev => ({
                    ...prev,
                    [machineId]: { claude: null, codex: null, gemini: null, opencode: null, opencodeModels: [], isDetecting: false, timestamp: 0 },
                }));
            });
        }

        return () => { cancelled = true; };
    }, [machineIdsKey]);

    return availabilityMap;
}
