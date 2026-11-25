import * as React from 'react';
import { useRouter } from 'expo-router';
import { useMachine } from '@/sync/storage';
import { getMachineUpdates, requestCliUpdateCheck } from '@/utils/cliUpdate';
import { isSharingSelection, type SessionListSelection } from '@/components/sessionListScope';


/**
 * The CLI and agent CLI updates of the machine picked in the session list, shown next to its "+"
 * (the sidebar's search row, the phone's header). Picking a machine also has its daemon look for
 * new versions when its last lookup is over 10 minutes old. Opening it goes to the CLI items on the
 * machine page.
 */
export function useSelectedMachineCliUpdate(selection: SessionListSelection) {
    const router = useRouter();
    const machineId = selection !== 'all' && !isSharingSelection(selection) ? selection : null;
    const machine = useMachine(machineId ?? '');
    const update = React.useMemo(() => getMachineUpdates(machineId ? machine : null), [machineId, machine]);

    React.useEffect(() => {
        if (machineId) requestCliUpdateCheck(machineId);
    }, [machineId]);

    const open = React.useCallback(() => {
        if (machineId) router.push(`/machine/${machineId}?focus=cli`);
    }, [router, machineId]);

    return { update, open };
}
