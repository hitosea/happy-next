import * as React from 'react';
import { AGENT_FLAVORS, type AgentFlavor } from 'happy-wire';
import { storage } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sessionLastViewedAt, sync } from '@/sync/sync';
import { machineForkQoderSession, sessionUpdateMetadataFields } from '@/sync/ops';
import { t } from '@/text';
import { resolveDuplicatedModelMode } from '@/utils/duplicateModelMode';
import { hasUnreadCompletionSince } from '@/utils/sessionAttention';

export type SessionState = 'disconnected' | 'syncing' | 'thinking' | 'awaiting' | 'waiting' | 'permission_required';

// How long the optimistic "processing…" indicator may linger without any real signal
// (thinking / agent message / delivery error / offline) before it lazily expires.
// How long the optimistic "awaiting response" marker stays believable on its
// own, absent any real signal from the CLI.
export const AWAITING_RESPONSE_MAX_MS = 120_000;

// Fun vibing messages to show when a session is thinking. Randomly pick one each time.
const vibingMessages = [
    "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing", 
    "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding", "Coalescing", 
    "Cogitating", "Computing", "Combobulating", "Concocting", "Conjuring", "Considering", 
    "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Deciphering", 
    "Deliberating", "Determining", "Discombobulating", "Divining", "Doing", "Effecting", 
    "Elucidating", "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting", "Wrangling", 
    "Forging", "Forming", "Frolicking", "Generating", "Germinating", "Hatching", 
    "Herding", "Honking", "Ideating", "Imagining", "Incubating", "Inferring", 
    "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering", 
    "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pontificating", 
    "Pondering", "Puttering", "Puzzling", "Reticulating", "Ruminating", "Scheming", 
    "Schlepping", "Shimmying", "Simmering", "Smooshing", "Spelunking", "Spinning", 
    "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering", "Transmuting", 
    "Unfurling", "Unravelling", "Vibing", "Wandering", "Whirring", "Wibbling", 
    "Wizarding", "Working"
];

export interface SessionStatus {
    state: SessionState;
    isConnected: boolean;
    statusText: string;
    shouldShowStatus: boolean;
    statusColor: string;
    statusDotColor: string;
    isPulsing?: boolean;
    hasUnreadCompletion?: boolean;
}

export function hasUnreadCompletion(session: Session): boolean {
    const localLastViewed = sessionLastViewedAt.get(session.id) ?? 0;
    return hasUnreadCompletionSince(session, localLastViewed);
}

/**
 * Get the current state of a session based on presence and thinking status.
 * Uses centralized session state from storage.ts
 */
export function useSessionStatus(session: Session): SessionStatus {
    const isOnline = session.presence === "online";
    const hasPermissions = (session.agentState?.requests && Object.keys(session.agentState.requests).length > 0 ? true : false);
    const isSyncing = session.messageSyncing === true;

    const vibingMessage = React.useMemo(() => {
        return vibingMessages[Math.floor(Math.random() * vibingMessages.length)].toLowerCase() + '…';
    }, [isOnline, hasPermissions, session.thinking]);

    if (!isOnline) {
        return {
            state: 'disconnected',
            isConnected: false,
            statusText: t('status.lastSeen', { time: formatLastSeen(session.activeAt, false) }),
            shouldShowStatus: true,
            statusColor: '#999',
            statusDotColor: '#999',
            hasUnreadCompletion: hasUnreadCompletion(session)
        };
    }

    if (isSyncing) {
        return {
            state: 'syncing',
            isConnected: true,
            statusText: 'syncing',
            shouldShowStatus: true,
            statusColor: '#FF9500',
            statusDotColor: '#FF9500',
            isPulsing: true
        };
    }

    // Check if permission is required
    if (hasPermissions) {
        return {
            state: 'permission_required',
            isConnected: true,
            statusText: t('status.permissionRequired'),
            shouldShowStatus: true,
            statusColor: '#FF9500',
            statusDotColor: '#FF9500',
            isPulsing: true
        };
    }

    if (session.thinking === true) {
        return {
            state: 'thinking',
            isConnected: true,
            statusText: vibingMessage,
            shouldShowStatus: true,
            statusColor: '#007AFF',
            statusDotColor: '#007AFF',
            isPulsing: true
        };
    }

    // Optimistic "processing…" shown right after sending, until a real signal arrives
    // or the marker lazily expires after AWAITING_RESPONSE_MAX_MS.
    if (session.awaitingResponseSince != null
        && Date.now() - session.awaitingResponseSince < AWAITING_RESPONSE_MAX_MS) {
        return {
            state: 'awaiting',
            isConnected: true,
            statusText: 'processing…',
            shouldShowStatus: true,
            statusColor: '#007AFF',
            statusDotColor: '#007AFF',
            isPulsing: true
        };
    }

    return {
        state: 'waiting',
        isConnected: true,
        statusText: t('status.online'),
        shouldShowStatus: false,
        statusColor: '#34C759',
        statusDotColor: '#34C759',
        hasUnreadCompletion: hasUnreadCompletion(session)
    };
}

/**
 * Extracts a display name from a session's metadata path.
 * Returns the last segment of the path, or 'unknown' if no path is available.
 */
export function getSessionName(session: Session): string {
    if (session.metadata?.summary) {
        return session.metadata.summary.text;
    } else if (session.metadata) {
        const segments = session.metadata.path.split('/').filter(Boolean);
        const lastSegment = segments.pop();
        if (!lastSegment) {
            return t('status.unknown');
        }
        return lastSegment;
    }
    return t('status.unknown');
}

/**
 * Generate a unique copy title by appending " (N)" suffix.
 * Checks existing session names to find the next available number.
 * e.g., "聊天" → "聊天 (2)", and if "聊天 (2)" exists → "聊天 (3)"
 */
export function generateCopyTitle(originalTitle: string): string {
    const baseTitle = originalTitle.replace(/ \(\d+\)$/, '');
    const existingNames = new Set(
        Object.values(storage.getState().sessions).map(s => getSessionName(s))
    );
    let n = 2;
    while (existingNames.has(`${baseTitle} (${n})`)) {
        n++;
    }
    return `${baseTitle} (${n})`;
}

/**
 * Generates a deterministic avatar ID from machine ID and path.
 * This ensures the same machine + path combination always gets the same avatar.
 */
export function getSessionAvatarId(session: Session): string {
    if (session.metadata?.machineId && session.metadata?.path) {
        // Combine machine ID and path for a unique, deterministic avatar
        return `${session.metadata.machineId}:${session.metadata.path}`;
    }
    // Fallback to session ID if metadata is missing
    return session.id;
}

/**
 * Formats a path relative to home directory if possible.
 * If the path starts with the home directory, replaces it with ~
 * Otherwise returns the full path.
 */
export function formatPathRelativeToHome(path: string, homeDir?: string): string {
    if (!homeDir) return path;
    
    // Normalize paths to handle trailing slashes
    const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
    const normalizedPath = path;
    
    // Check if path starts with home directory
    if (normalizedPath.startsWith(normalizedHome)) {
        // Replace home directory with ~
        const relativePath = normalizedPath.slice(normalizedHome.length);
        // Add ~ and ensure there's a / after it if needed
        if (relativePath.startsWith('/')) {
            return '~' + relativePath;
        } else if (relativePath === '') {
            return '~';
        } else {
            return '~/' + relativePath;
        }
    }
    
    return path;
}

/**
 * Returns the session path for the subtitle.
 */
export function getSessionSubtitle(session: Session): string {
    if (session.metadata) {
        return formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir);
    }
    return t('status.unknown');
}

/**
 * Checks if a session is currently online based on the active flag.
 * A session is considered online if the active flag is true.
 */
export function isSessionOnline(session: Session): boolean {
    return session.active;
}

/**
 * Checks if a session should be shown in the active sessions group.
 * Uses the active flag directly.
 */
export function isSessionActive(session: Session): boolean {
    return session.active;
}

/**
 * Formats OS platform string into a more readable format
 */
export function formatOSPlatform(platform?: string): string {
    if (!platform) return '';

    const osMap: Record<string, string> = {
        'darwin': 'macOS',
        'win32': 'Windows',
        'linux': 'Linux',
        'android': 'Android',
        'ios': 'iOS',
        'aix': 'AIX',
        'freebsd': 'FreeBSD',
        'openbsd': 'OpenBSD',
        'sunos': 'SunOS'
    };

    return osMap[platform.toLowerCase()] || platform;
}

/**
 * Formats the last seen time of a session into a human-readable relative time.
 * @param activeAt - Timestamp when the session was last active
 * @param isActive - Whether the session is currently active
 * @returns Formatted string like "Active now", "5 minutes ago", "2 hours ago", or a date
 */
export function formatLastSeen(activeAt: number, isActive: boolean = false): string {
    if (isActive) {
        return t('status.activeNow');
    }

    const now = Date.now();
    const diffMs = now - activeAt;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
        return t('time.justNow');
    } else if (diffMinutes < 60) {
        return t('time.minutesAgo', { count: diffMinutes });
    } else if (diffHours < 24) {
        return t('time.hoursAgo', { count: diffHours });
    } else if (diffDays < 7) {
        return t('sessionHistory.daysAgo', { count: diffDays });
    } else {
        // Format as date
        const date = new Date(activeAt);
        const options: Intl.DateTimeFormatOptions = {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        };
        return date.toLocaleDateString(undefined, options);
    }
}

/**
 * Copy externalContext and sessionIcon from an original session to a newly forked/duplicated session.
 * Tries storage first (caller may have already refreshed), then retries with refreshSessions.
 */
export async function copySessionMetadata(
    originalSession: Session,
    newSessionId: string,
): Promise<void> {
    const externalContext = originalSession.metadata?.externalContext;
    const sessionIcon = originalSession.metadata?.sessionIcon;
    if (!externalContext && !sessionIcon) return;

    const updates = {
        ...(externalContext ? { externalContext } : {}),
        ...(sessionIcon ? { sessionIcon } : {}),
    };

    // Try storage first (caller likely already called refreshSessions), then retry with refresh
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            await sync.refreshSessions();
        }
        const freshSession = storage.getState().sessions[newSessionId];
        if (freshSession?.metadata) {
            await sessionUpdateMetadataFields(
                newSessionId,
                freshSession.metadata,
                updates,
                freshSession.metadataVersion
            );
            return;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.warn('copySessionMetadata: new session not found after retries, sessionId:', newSessionId);
}

/**
 * Copy permissionMode, modelMode, and fastMode from an original session to a newly created session.
 * Uses a single queueSessionModeConfigUpdate call to avoid redundant patches and spurious RPCs.
 */
export function copySessionModeSettings(
    originalSession: Session,
    newSessionId: string,
): void {
    const flavor = originalSession.metadata?.flavor;
    const agentType: AgentFlavor = AGENT_FLAVORS.find(candidate => candidate === flavor) ?? 'claude';
    sync.queueSessionModeConfigUpdate({
        sessionId: newSessionId,
        agentType,
        permissionMode: originalSession.permissionMode || 'default',
        // A "default"/CLI session may be running a 1M ([1m]) model that a headless
        // --resume won't re-derive; pin it so the duplicate keeps 1M. See resolveDuplicatedModelMode.
        modelMode: resolveDuplicatedModelMode(originalSession.modelMode, originalSession.metadata?.model, agentType),
        fastMode: originalSession.fastMode ?? false,
        includeSessionEntry: true,
        includeLastUsed: false,
    });
}

/**
 * Fork a Qoder session so that a copy owns its own native conversation: resuming the same
 * id would leave both Happy sessions appending to one history.
 *
 * Returns the native session id to resume from, or an `error` for the caller to report in
 * its own words (`undefined` when the ids needed for a fork are missing).
 */
export async function forkQoderSessionForCopy(
    machineId: string,
    qoderSessionId: string | undefined,
    directory: string | undefined,
): Promise<{ newSessionId: string } | { error: string | undefined }> {
    if (!qoderSessionId || !directory) {
        return { error: undefined };
    }
    const forked = await machineForkQoderSession(machineId, qoderSessionId, directory);
    return forked.success && forked.newSessionId
        ? { newSessionId: forked.newSessionId }
        : { error: forked.error };
}
