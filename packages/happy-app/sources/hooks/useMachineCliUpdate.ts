import * as React from 'react';
import { Modal } from '@/modal';
import { showToast } from '@/components/Toast';
import { prefetchCliUpdatePreflight, showCliUpdateModal } from '@/components/CliUpdateModal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { machineCheckCliUpdate } from '@/sync/ops';
import { storage } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { agentCliHasUpdate, getMachineCliUpdate } from '@/utils/cliUpdate';
import { compareVersions } from '@/utils/versionUtils';
import { t } from '@/text';

/**
 * A machine's CLI update as the app shows it (see utils/cliUpdate.ts), with its actions: the
 * "check" button, which has the daemon look the latest version up right now, the agent CLIs' too
 * (the answer lands in the machine's daemon state, which then offers the updates), and opening the
 * update dialog. The check says all is up to date only when the agent CLIs are as well.
 */
export function useMachineCliUpdate(machine: Machine | null | undefined) {
    const update = React.useMemo(() => getMachineCliUpdate(machine), [machine]);
    const machineId = machine?.id;
    const online = !!machine?.active;

    // With an update to offer, the dialog's preflight is asked for now so the dialog opens complete
    const offered = update.state === 'available' || update.state === 'failed';
    React.useEffect(() => {
        if (machineId && online && offered) prefetchCliUpdatePreflight(machineId);
    }, [machineId, online, offered]);

    const [checking, checkNow] = useHappyAction(React.useCallback(async () => {
        if (!machineId) return;
        const result = await machineCheckCliUpdate(machineId, 0);
        if (!result) {
            showToast(t('cliUpdate.checkUnsupported'), { icon: null });
            return;
        }
        if (!result.latestVersion) {
            Modal.alert(t('common.error'), t('cliUpdate.checkFailed'));
            return;
        }
        const running = storage.getState().machines[machineId]?.metadata?.happyCliVersion;
        if (running && compareVersions(result.latestVersion, running) <= 0 && !result.agentClis?.some(agentCliHasUpdate)) {
            showToast(t('cliUpdate.upToDate'));
        }
    }, [machineId]));

    const openDetails = React.useCallback(() => {
        if (machineId) showCliUpdateModal(machineId);
    }, [machineId]);

    return { update, checking, checkNow, openDetails };
}
