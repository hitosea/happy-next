import type { Machine, Session, SessionDraft } from '@/sync/storageTypes';
import { desktopKeyboardShortcutLabel } from '@/desktop/desktopKeyboardShortcuts';
import type { DesktopPlatform } from '@/desktop/desktopWindowUtils';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Command } from './types';

type CommandPaletteCommandOptions = {
    sessions: Session[];
    machines: Machine[];
    drafts: Record<string, SessionDraft>;
    currentSessionId: string | null;
    dootaskConnected: boolean;
    experimentsEnabled: boolean;
    developerEnabled: boolean;
    desktopPlatform: DesktopPlatform | null;
    navigate: (path: string) => void;
    navigateToSession: (sessionId: string) => void;
    logout: () => Promise<void>;
};

const CATEGORY_ORDER = {
    quick: 0,
    current: 1,
    sessions: 2,
    machines: 3,
    navigation: 4,
    settings: 5,
    system: 99,
} as const;

function routeCommand(
    options: CommandPaletteCommandOptions,
    command: Omit<Command, 'action'> & { path: string },
): Command {
    const { path, ...rest } = command;
    return { ...rest, action: () => options.navigate(path) };
}

function sessionTitle(session: Session): string {
    return session.metadata?.name?.trim()
        || session.metadata?.summary?.text?.trim()
        || t('machine.untitledSession');
}

function sessionSubtitle(session: Session): string {
    const parts = [
        session.metadata?.path,
        session.metadata?.host,
        session.metadata?.flavor,
        session.metadata?.model,
    ].filter((value): value is string => !!value);
    return [...new Set(parts)].join(' • ');
}

function sessionBadge(session: Session, hasDraft: boolean): Pick<Command, 'badge' | 'badgeTone'> {
    if (session.thinking || session.awaitingResponseSince) {
        return { badge: t('commandPalette.statusRunning'), badgeTone: 'accent' };
    }
    if (hasDraft) {
        return { badge: t('commandPalette.statusDraft'), badgeTone: 'warning' };
    }
    if (session.presence === 'online') {
        return { badge: t('status.online'), badgeTone: 'success' };
    }
    return {};
}

function sessionKeywords(session: Session): string[] {
    const metadata = session.metadata;
    return [
        session.id,
        metadata?.path,
        metadata?.host,
        metadata?.machineId,
        metadata?.flavor,
        metadata?.model,
        metadata?.currentModelCode,
        metadata?.summary?.text,
        metadata?.worktreeBranchName,
        metadata?.worktreeBasePath,
        metadata?.workspacePath,
        metadata?.externalContext?.title,
        ...(metadata?.workspaceRepos?.flatMap((repo) => [
            repo.displayName,
            repo.path,
            repo.basePath,
            repo.branchName,
            repo.targetBranch,
        ]) ?? []),
    ].filter((value): value is string => !!value);
}

export function buildCommandPaletteCommands(options: CommandPaletteCommandOptions): Command[] {
    const commands: Command[] = [];
    const quickCategory = t('commandPalette.categoryQuickActions');
    const navigationCategory = t('commandPalette.categoryNavigation');
    const settingsCategory = t('settings.title');
    const shortcut = (action: Parameters<typeof desktopKeyboardShortcutLabel>[0]) => (
        options.desktopPlatform ? desktopKeyboardShortcutLabel(action, options.desktopPlatform) : undefined
    );

    commands.push(
        routeCommand(options, {
            id: 'new-session',
            title: t('newSession.title'),
            subtitle: t('sessionInfo.newSessionSubtitle'),
            icon: 'add-circle-outline',
            shortcut: shortcut('newSession'),
            category: quickCategory,
            categoryOrder: CATEGORY_ORDER.quick,
            priority: 1000,
            keywords: ['new chat', 'create session', 'conversation'],
            path: '/new',
        }),
        routeCommand(options, {
            id: 'sessions',
            title: t('tabs.sessions'),
            subtitle: t('commandPalette.sessionsSubtitle'),
            icon: 'chatbubbles-outline',
            shortcut: shortcut('sessions'),
            category: quickCategory,
            categoryOrder: CATEGORY_ORDER.quick,
            priority: 950,
            keywords: ['home', 'conversations', 'chats'],
            path: '/',
        }),
        routeCommand(options, {
            id: 'inbox',
            title: t('tabs.inbox'),
            subtitle: t('commandPalette.inboxSubtitle'),
            icon: 'mail-outline',
            shortcut: shortcut('inbox'),
            category: quickCategory,
            categoryOrder: CATEGORY_ORDER.quick,
            priority: 900,
            keywords: ['messages', 'notifications', 'friends'],
            path: '/(app)/inbox',
        }),
    );

    if (options.dootaskConnected) {
        commands.push(
            routeCommand(options, {
                id: 'dootask',
                title: t('tabs.dootask'),
                subtitle: t('commandPalette.dootaskSubtitle'),
                icon: 'checkbox-outline',
                shortcut: shortcut('dootask'),
                category: quickCategory,
                categoryOrder: CATEGORY_ORDER.quick,
                priority: 850,
                keywords: ['tasks', 'projects', 'todo'],
                path: '/(app)/dootask',
            }),
            routeCommand(options, {
                id: 'new-dootask-task',
                title: t('commandPalette.newDootaskTask'),
                icon: 'add-outline',
                category: quickCategory,
                categoryOrder: CATEGORY_ORDER.quick,
                priority: 700,
                keywords: ['create task', 'todo'],
                path: '/dootask/add-task',
            }),
            routeCommand(options, {
                id: 'new-dootask-project',
                title: t('commandPalette.newDootaskProject'),
                icon: 'folder-open-outline',
                category: quickCategory,
                categoryOrder: CATEGORY_ORDER.quick,
                priority: 650,
                keywords: ['create project', 'dootask'],
                path: '/dootask/add-project',
            }),
        );
    }

    const currentSession = options.currentSessionId
        ? options.sessions.find((session) => session.id === options.currentSessionId) ?? null
        : null;
    if (currentSession) {
        const id = encodeURIComponent(currentSession.id);
        const category = t('commandPalette.categoryCurrentSession');
        const contextCommands: Array<Omit<Command, 'action'> & { path: string }> = [
            { id: 'current-session-info', title: t('sessionInfo.title'), icon: 'information-circle-outline', path: `/session/${id}/info`, priority: 900 },
            { id: 'current-session-files', title: t('common.files'), icon: 'folder-outline', path: `/session/${id}/files`, priority: 850 },
            { id: 'current-session-status', title: t('commandPalette.gitStatus'), icon: 'git-branch-outline', path: `/session/${id}/status`, priority: 800 },
            { id: 'current-session-commits', title: t('commandPalette.commits'), icon: 'git-commit-outline', path: `/session/${id}/commits`, priority: 750 },
            { id: 'current-session-browser', title: t('commandPalette.browser'), icon: 'globe-outline', path: `/session/${id}/browser`, priority: 700 },
            { id: 'current-session-sharing', title: t('commandPalette.sharing'), icon: 'share-social-outline', path: `/session/${id}/sharing`, priority: 650 },
            { id: 'current-session-edit', title: t('commandPalette.editSession'), icon: 'create-outline', path: `/session/${id}/edit`, priority: 600 },
        ];
        commands.push(...contextCommands.map((command) => routeCommand(options, {
            ...command,
            category,
            categoryOrder: CATEGORY_ORDER.current,
            keywords: [sessionTitle(currentSession), currentSession.metadata?.path ?? ''],
        })));

        if (currentSession.metadata?.machineId) {
            commands.push(routeCommand(options, {
                id: 'current-session-machine',
                title: t('sessionInfo.viewMachine'),
                subtitle: t('sessionInfo.viewMachineSubtitle'),
                icon: 'desktop-outline',
                category,
                categoryOrder: CATEGORY_ORDER.current,
                priority: 550,
                path: `/machine/${encodeURIComponent(currentSession.metadata.machineId)}`,
            }));
        }
    }

    const sortedSessions = [...options.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    sortedSessions.forEach((session, index) => {
        const hasDraft = !!options.drafts[session.id];
        commands.push({
            id: `session-${session.id}`,
            sessionId: session.id,
            title: sessionTitle(session),
            subtitle: sessionSubtitle(session),
            icon: session.thinking || session.awaitingResponseSince ? 'sparkles-outline' : 'chatbubble-outline',
            category: t('commandPalette.categorySessions'),
            categoryOrder: CATEGORY_ORDER.sessions,
            priority: (session.thinking || session.awaitingResponseSince ? 500 : 0) + (hasDraft ? 250 : 0) + Math.max(0, 120 - index),
            showWhenIdle: index < 6 || session.thinking || !!session.awaitingResponseSince || hasDraft,
            keywords: [
                ...sessionKeywords(session),
                session.active ? 'active' : 'inactive archived',
                session.thinking || session.awaitingResponseSince ? 'running thinking processing' : '',
                hasDraft ? 'draft' : '',
                session.isShared ? 'shared' : '',
            ],
            ...sessionBadge(session, hasDraft),
            action: () => options.navigateToSession(session.id),
        });
    });

    const sortedMachines = [...options.machines].sort((a, b) => {
        const onlineDelta = Number(isMachineOnline(b)) - Number(isMachineOnline(a));
        return onlineDelta || b.activeAt - a.activeAt;
    });
    sortedMachines.forEach((machine, index) => {
        const online = isMachineOnline(machine);
        const title = machine.metadata?.displayName || machine.metadata?.host || machine.id;
        const subtitle = [machine.metadata?.host !== title ? machine.metadata?.host : null, machine.metadata?.platform]
            .filter(Boolean)
            .join(' • ');
        commands.push(routeCommand(options, {
            id: `machine-${machine.id}`,
            title,
            subtitle,
            icon: 'desktop-outline',
            category: t('settings.machines'),
            categoryOrder: CATEGORY_ORDER.machines,
            priority: (online ? 300 : 0) + Math.max(0, 60 - index),
            showWhenIdle: online && index < 3,
            badge: online ? t('status.online') : t('status.offline'),
            badgeTone: online ? 'success' : 'neutral',
            keywords: [machine.id, machine.metadata?.host ?? '', machine.metadata?.platform ?? '', machine.metadata?.username ?? ''],
            path: `/machine/${encodeURIComponent(machine.id)}`,
        }));
    });

    const navigationCommands: Array<Omit<Command, 'action'> & { path: string }> = [
        { id: 'session-recent', title: t('sessionHistory.title'), subtitle: t('settings.sessionHistorySubtitle'), icon: 'time-outline', path: '/session/recent', priority: 900 },
        { id: 'agent-history', title: t('agentHistory.title'), subtitle: t('settings.agentHistorySubtitle'), icon: 'albums-outline', path: '/session/history', priority: 850 },
        { id: 'orchestrator', title: t('settings.orchestratorRuns'), subtitle: t('settings.orchestratorRunsSubtitle'), icon: 'layers-outline', path: '/orchestrator', priority: 800 },
        { id: 'connect-device', title: t('commandPalette.connectDevice'), subtitle: t('settingsAccount.linkNewDeviceSubtitle'), icon: 'link-outline', path: '/terminal/connect', priority: 600 },
        { id: 'server', title: t('server.serverConfiguration'), icon: 'server-outline', path: '/server', priority: 550 },
        { id: 'changelog', title: t('settings.whatsNew'), subtitle: t('settings.whatsNewSubtitle'), icon: 'sparkles-outline', path: '/changelog', priority: 500 },
    ];
    if (!options.dootaskConnected) {
        navigationCommands.push({
            id: 'connect-dootask',
            title: t('settings.connectDootask'),
            icon: 'link-outline',
            path: '/settings/connect/dootask',
            priority: 450,
        });
    }
    commands.push(...navigationCommands.map((command) => routeCommand(options, {
        ...command,
        category: navigationCategory,
        categoryOrder: CATEGORY_ORDER.navigation,
        showWhenIdle: command.id === 'orchestrator',
    })));

    const settingsCommands: Array<Omit<Command, 'action'> & { path: string }> = [
        { id: 'settings', title: t('settings.title'), icon: 'settings-outline', shortcut: shortcut('settings'), path: '/settings', priority: 1000 },
        { id: 'settings-account', title: t('settings.account'), subtitle: t('settings.accountSubtitle'), icon: 'person-circle-outline', path: '/settings/account', priority: 900 },
        { id: 'settings-appearance', title: t('settings.appearance'), subtitle: t('settings.appearanceSubtitle'), icon: 'color-palette-outline', path: '/settings/appearance', priority: 850 },
        { id: 'settings-voice', title: t('settings.voiceAssistant'), subtitle: t('settings.voiceAssistantSubtitle'), icon: 'mic-outline', path: '/settings/voice', priority: 800 },
        { id: 'settings-notifications', title: t('settings.notifications'), subtitle: t('settings.notificationsSubtitle'), icon: 'notifications-outline', path: '/settings/notifications', priority: 750 },
        { id: 'settings-features', title: t('settings.featuresTitle'), subtitle: t('settings.featuresSubtitle'), icon: 'flask-outline', path: '/settings/features', priority: 700 },
        { id: 'settings-language', title: t('settingsLanguage.title'), icon: 'language-outline', path: '/settings/language', priority: 675 },
    ];
    if (options.experimentsEnabled) {
        settingsCommands.push({ id: 'settings-usage', title: t('settings.usage'), subtitle: t('settings.usageSubtitle'), icon: 'analytics-outline', path: '/settings/usage', priority: 600 });
    }
    commands.push(...settingsCommands.map((command) => routeCommand(options, {
        ...command,
        category: settingsCategory,
        categoryOrder: CATEGORY_ORDER.settings,
        showWhenIdle: command.id === 'settings',
    })));

    if (options.developerEnabled) {
        commands.push(routeCommand(options, {
            id: 'dev-menu',
            title: t('settings.developerTools'),
            icon: 'code-slash-outline',
            category: t('settings.developer'),
            categoryOrder: CATEGORY_ORDER.settings + 1,
            priority: 100,
            showWhenIdle: false,
            keywords: ['debug', 'development'],
            path: '/dev',
        }));
    }

    commands.push({
        id: 'sign-out',
        title: t('settingsAccount.logout'),
        subtitle: t('settingsAccount.logoutSubtitle'),
        icon: 'log-out-outline',
        category: t('commandPalette.categorySystem'),
        categoryOrder: CATEGORY_ORDER.system,
        priority: -100,
        showWhenIdle: false,
        dangerous: true,
        keywords: ['sign out', 'log out'],
        action: options.logout,
    });

    return commands;
}
