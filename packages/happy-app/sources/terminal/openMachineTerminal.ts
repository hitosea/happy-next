import type { Href } from 'expo-router';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { showToast } from '@/components/Toast';
import { isTauriDesktop } from '@/utils/tauri';
import { openDesktopTerminalWindow } from '@/desktop/desktopWindowUtils';
import { resolveTerminalDirectory, spawnTerminal } from './openTerminal';
import { openTerminalPopup } from './terminalPopupWindow';

/**
 * Opens a shell on a machine: in a session's directory when given one, else the machine's home.
 *
 * Shared by the session's long-press menu and details screen, and the machine's details screen and
 * sidebar menu, so all of them end up in the same place. `push` is the caller's router, kept out of
 * here so this stays a plain function.
 *
 * Where the app has windows of its own the terminal opens in one: the desktop app's terminal
 * window, or a popup in a desktop browser. Anywhere else, or when a browser refuses the popup,
 * it is a screen in the app.
 */
export function openMachineTerminal(input: {
    machineId: string;
    sessionPath?: string;
    push: (href: Href) => void;
}): void {
    const { machineId, sessionPath, push } = input;
    // The session's checkout is the directory someone wants a shell in; a session that has
    // not been given one yet still deserves a terminal, so fall back to the machine's home.
    const homeDir = storage.getState().machines[machineId]?.metadata?.homeDir;
    const cwd = resolveTerminalDirectory({ sessionPath, homeDir });
    // Before anything is awaited: a browser opens a window only from the click itself.
    const popup = openTerminalPopup();
    void (async () => {
        try {
            // A second shell rather than the one already in that directory:
            // asking for a terminal is asking for a prompt, and being handed
            // the shell that is already open — perhaps in a window that is
            // already showing it — reads as the command having done nothing.
            const terminal = await spawnTerminal({ machineId, cwd });
            // On the desktop the terminals get their own window — they are a
            // place you go and stay, not a page inside the session list. Any-
            // where without windows, the workspace is an ordinary screen.
            if (isTauriDesktop()) {
                await openDesktopTerminalWindow({ machineId, terminalId: terminal.id });
                return;
            }
            if (popup?.show({ machineId, terminalId: terminal.id })) {
                return;
            }
            push(`/terminals?machineId=${machineId}&terminalId=${terminal.id}`);
        } catch (error) {
            popup?.abandon();
            console.warn('Failed to open a terminal:', error);
            showToast(t('terminalSession.openFailed'));
        }
    })();
}
