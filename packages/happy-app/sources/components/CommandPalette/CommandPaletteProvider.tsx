import React, { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { OPEN_COMMAND_PALETTE_EVENT } from './events';
import { useModal } from '@/modal';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import { t } from '@/text';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';

function sessionIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/session\/([^/]+)/);
    if (!match || ['recent', 'history', 'claude'].includes(match[1])) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout, isAuthenticated } = useAuth();
    const commandSource = storage(useShallow((state) => ({
        sessions: state.sessions,
        sharedSessions: state.sharedSessions,
        machines: state.machines,
        drafts: state.drafts,
        dootaskConnected: !!state.dootaskProfile,
        experimentsEnabled: state.settings.experiments,
        developerEnabled: __DEV__ || state.localSettings.devModeEnabled,
    })));
    const commandState = useMemo(() => ({
        sessions: Object.values({ ...commandSource.sharedSessions, ...commandSource.sessions }),
        machines: Object.values(commandSource.machines).filter((machine) => machine.active),
        drafts: commandSource.drafts,
        dootaskConnected: commandSource.dootaskConnected,
        experimentsEnabled: commandSource.experimentsEnabled,
        developerEnabled: commandSource.developerEnabled,
    }), [commandSource]);
    const navigateToSession = useNavigateToSession();
    const { state: modalState, hideModal } = useModal();
    const currentModal = modalState.modals[modalState.modals.length - 1];
    const isCommandPaletteOpen = currentModal?.type === 'custom' && currentModal.component === CommandPalette;

    const commands = useMemo(() => buildCommandPaletteCommands({
        ...commandState,
        desktopPlatform: getDesktopPlatform(),
        currentSessionId: sessionIdFromPath(pathname),
        navigate: (path) => router.push(path as any),
        navigateToSession,
        logout: async () => {
            const confirmed = await Modal.confirm(
                t('settingsAccount.logout'),
                t('settingsAccount.logoutConfirm'),
                { confirmText: t('common.logout'), destructive: true },
            );
            if (confirmed) {
                try {
                    await logout();
                } catch {
                    Modal.alert(t('common.error'), t('errors.networkError'));
                }
            }
        },
    }), [commandState, logout, navigateToSession, pathname, router]);

    const searchCachedMessages = useCallback((query: string) => {
        const sessionIds = [...commandState.sessions]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => session.id);
        return sync.searchCachedMessages(query, sessionIds);
    }, [commandState.sessions]);

    const openCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web') return;

        if (isCommandPaletteOpen) {
            hideModal(currentModal.id);
            return;
        }

        Modal.show({
            component: CommandPalette,
            props: {
                commands,
                searchCachedMessages,
            }
        } as any);
    }, [commands, currentModal, hideModal, isCommandPaletteOpen, searchCachedMessages]);

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
        return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
    }, [openCommandPalette]);

    const closeTopModal = useCallback(() => {
        if (!currentModal) return;
        if (currentModal.type === 'confirm') {
            Modal.resolveConfirm(currentModal.id, false);
        } else if (currentModal.type === 'prompt') {
            Modal.resolvePrompt(currentModal.id, null);
        }
        hideModal(currentModal.id);
    }, [currentModal, hideModal]);

    const shortcutHandlers = useMemo(() => ({
        enabled: isAuthenticated,
        onSearch: openCommandPalette,
        onNewSession: () => router.push('/new'),
        onSettings: () => router.navigate('/settings'),
        onSessions: () => router.navigate('/'),
        onInbox: () => router.navigate('/(app)/inbox'),
        onDootask: () => router.navigate('/(app)/dootask'),
        onBack: () => window.history.back(),
        onForward: () => window.history.forward(),
        onEscape: currentModal && !isCommandPaletteOpen ? closeTopModal : undefined,
    }), [currentModal, closeTopModal, isAuthenticated, isCommandPaletteOpen, openCommandPalette, router]);

    useGlobalKeyboard(shortcutHandlers);

    return <>{children}</>;
}
