import * as React from 'react';
import { Modal } from '@/modal';
import { showToast } from '@/components/Toast';
import { machineUpdateAgentCli } from '@/sync/ops';
import type { AgentCliStatus, Machine } from '@/sync/storageTypes';
import { isAgentChoice, type AgentChoice } from '@/utils/agentChoice';
import { t } from '@/text';

export type MachineAgentCli = AgentCliStatus & { agent: AgentChoice };

/**
 * The agent CLIs installed on a machine, as its daemon reports them in `daemonState.agentClis`, with
 * the update action: one agent's CLI, or with no agent every one with a newer version. The daemon
 * reports an install as running before it answers, so the rows follow its state from then on;
 * `pending` covers the wait for that answer (the daemon may first look the versions up again).
 */
export function useMachineAgentClis(machine: Machine | null | undefined) {
    const machineId = machine?.id;
    const reported = machine?.daemonState?.agentClis;
    const clis = React.useMemo(
        () => (reported ?? []).filter((cli): cli is MachineAgentCli => isAgentChoice(cli.agent)),
        [reported],
    );
    const [pending, setPending] = React.useState<AgentChoice | 'all' | null>(null);

    const update = React.useCallback(async (agent?: AgentChoice) => {
        if (!machineId) return;
        setPending(agent ?? 'all');
        try {
            const { status } = await machineUpdateAgentCli(machineId, agent);
            if (status === 'busy') showToast(t('cliUpdate.busy'), { icon: null });
            if (status === 'up-to-date') showToast(t('cliUpdate.upToDate'));
            if (status === 'unsupported') Modal.alert(t('common.error'), t('cliUpdate.agentUnsupported'));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setPending(null);
        }
    }, [machineId]);

    return { clis, pending, update };
}
