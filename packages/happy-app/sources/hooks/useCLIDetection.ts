import { useState, useEffect } from 'react';
import { AGENT_FLAVORS, buildCliDetectionScript, type AgentFlavor } from 'happy-wire';
import { machineBash } from '@/sync/ops';

/** null = unknown/loading, true = installed, false = not installed, per agent flavor. */
type CliStatus = Record<AgentFlavor, boolean | null>;

interface CLIAvailability extends CliStatus {
    isDetecting: boolean; // Explicit loading state
    timestamp: number; // When detection completed
    error?: string; // Detection error message (for debugging)
}

/** Every flavor unknown. Deriving this from the wire's flavor list keeps a new agent from
 *  needing six edits in this file. */
function unknownCliStatus(): CliStatus {
    return Object.fromEntries(AGENT_FLAVORS.map(flavor => [flavor, null])) as CliStatus;
}

const CLI_DETECTION_COMMAND = buildCliDetectionScript();

function parseCLIOutput(stdout: string): CLIAvailability {
    const cliStatus = unknownCliStatus();

    for (const line of stdout.trim().split('\n')) {
        const [cli, status] = line.split(':');
        if (cli && status && (AGENT_FLAVORS as readonly string[]).includes(cli.trim())) {
            cliStatus[cli.trim() as AgentFlavor] = status.trim() === 'true';
        }
    }

    return {
        ...cliStatus,
        isDetecting: false,
        timestamp: Date.now(),
    };
}

/**
 * Detects which CLI tools (claude, codex, gemini, qoder) are installed on a remote machine.
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
 * @returns CLI availability status for claude, codex, gemini, and qoder
 *
 * @example
 * const cliAvailability = useCLIDetection(selectedMachineId);
 * if (cliAvailability.claude === false) {
 *     // Show "Claude CLI not detected" warning
 * }
 */
export function useCLIDetection(machineId: string | null): CLIAvailability {
    const [availability, setAvailability] = useState<CLIAvailability>({
        ...unknownCliStatus(),
        isDetecting: false,
        timestamp: 0,
    });

    useEffect(() => {
        if (!machineId) {
            setAvailability({ ...unknownCliStatus(), isDetecting: false, timestamp: 0 });
            return;
        }

        let cancelled = false;

        const detectCLIs = async () => {
            // Set detecting flag (non-blocking - UI stays responsive)
            setAvailability(prev => ({ ...prev, isDetecting: true }));
            console.log('[useCLIDetection] Starting detection for machineId:', machineId);

            try {
                const result = await machineBash(machineId, CLI_DETECTION_COMMAND, '/');

                if (cancelled) return;
                console.log('[useCLIDetection] Result:', { success: result.success, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });

                if (result.success && result.exitCode === 0) {
                    setAvailability(parseCLIOutput(result.stdout));
                } else {
                    console.log('[useCLIDetection] Detection failed (success=false or exitCode!=0):', result);
                    setAvailability({
                        ...unknownCliStatus(),
                        isDetecting: false, timestamp: 0,
                        error: `Detection failed: ${result.stderr || 'Unknown error'}`,
                    });
                }
            } catch (error) {
                if (cancelled) return;
                console.log('[useCLIDetection] Network/RPC error:', error);
                setAvailability({
                    ...unknownCliStatus(),
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
            detecting[id] = { ...unknownCliStatus(), isDetecting: true, timestamp: 0 };
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
                        [machineId]: { ...unknownCliStatus(), isDetecting: false, timestamp: 0 },
                    }));
                }
            }).catch(() => {
                if (cancelled) return;
                setAvailabilityMap(prev => ({
                    ...prev,
                    [machineId]: { ...unknownCliStatus(), isDetecting: false, timestamp: 0 },
                }));
            });
        }

        return () => { cancelled = true; };
    }, [machineIdsKey]);

    return availabilityMap;
}
