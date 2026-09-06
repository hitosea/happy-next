import Constants from 'expo-constants';
import { apiSocket } from '@/sync/apiSocket';
import { AuthCredentials } from '@/auth/tokenStorage';
import { Encryption } from '@/sync/encryption/encryption';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { storage, getSession } from './storage';
import { SessionsBootstrapMachine } from './sessionsBootstrapMachine';
import {
    ApiEphemeralUpdateSchema,
    ApiMessage,
    ApiPendingMessage,
    ApiPendingMessageSchema,
    ApiPendingMessagesResponseSchema,
    ApiSendOrQueueResponseSchema,
    ApiUpdateContainerSchema
} from './apiTypes';
import type { ApiEphemeralActivityUpdate, ApiUpdateContainer } from './apiTypes';
import { Session, Machine, PendingMessage, SessionCapabilitiesSchema } from './storageTypes';
import { InvalidateSync } from '@/utils/sync';
import { ActivityUpdateAccumulator } from './reducer/activityUpdateAccumulator';
import { randomUUID, getRandomBytes } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { deletePushToken, registerPushToken } from './apiPush';
import { PushTokenRegistrationGate } from './pushTokenRegistrationGate';
import { acknowledgeDooPushTokenCleanup, registerDooPushIfSupported } from './doopush';
import {
    markExpoFallbackRegistered,
} from './expoPushMigrationState';
import { cleanupSupersededPushTokens } from './pushTokenCleanup';
import { getPushInstallationId } from './pushInstallationId';
import { Platform, AppState } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { NormalizedMessage, normalizeRawMessage, RawRecord, RawRecordSchema, ImageContent } from './typesRaw';
import { uploadChatImage } from './uploadChatImage';
import { LocalImage } from '@/components/ImagePreview';
import { applySettings, Settings, settingsDefaults, settingsParse, SUPPORTED_SCHEMA_VERSION } from './settings';
import { Profile, profileParse } from './profile';
import { loadPendingSettings, savePendingSettings, loadSessionLastViewedAt, saveSessionLastViewedAt, loadSessionsCache, saveSessionsCache } from './persistence';
import { initializeTracking, tracking } from '@/track';
import { parseToken } from '@/utils/parseToken';
import { getServerUrl, onServerUrlChanged } from './serverConfig';
import { log } from '@/log';
import { signContentPublicKey } from './directShareEncryption';
import { uploadContentPublicKey, fetchSharedSessions as apiFetchSharedSessions } from './apiSharing';
import { gitStatusSync } from './gitStatusSync';
import { projectManager } from './projectManager';
import { AsyncLock } from '@/utils/lock';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { Message, UserTextMessage } from './typesMessage';
import { EncryptionCache } from './encryption/encryptionCache';
import { systemPrompt, buildDootaskSystemPrompt } from './prompt/systemPrompt';
import { fetchArtifact, fetchArtifacts, createArtifact, updateArtifact } from './apiArtifacts';
import { DecryptedArtifact, Artifact, ArtifactCreateRequest, ArtifactUpdateRequest } from './artifactTypes';
import { ArtifactEncryption } from './encryption/artifactEncryption';
import { getFriendsList, getUserProfile } from './apiFriends';
import { fetchFeed } from './apiFeed';
import { FeedItem } from './feedTypes';
import { UserProfile } from './friendTypes';
import {
    createOpenClawMachine,
    updateOpenClawMachine,
    deleteOpenClawMachine,
    processNewOpenClawMachineEvent,
    processUpdateOpenClawMachineEvent,
} from '../openclaw/storage';
import { resolveModelSelectionForFlavor } from 'happy-wire';
import { getOrchestratorActivity, getOrchestratorActivityBatch } from './apiOrchestrator';
import { sessionUpdateMetadataFields } from './ops';
import { shouldInvalidateGitStatusOnActivityTransition } from './gitStatusRefreshPolicy';
import { kvGet, kvMutate } from './apiKv';
import {
    SESSION_MODE_CONFIG_KV_KEY,
    applySessionModeConfigPatches,
    createEmptySessionModeConfig,
    decodeSessionModeConfigValue,
    encodeSessionModeConfigValue,
    normalizeSessionModeConfig,
    type SessionModeAgentType,
    type SessionModeConfigPatch,
} from './sessionModeConfig';
import {
    SESSION_APPEARANCE_KV_KEY,
    applySessionAppearancePatches,
    createEmptySessionAppearance,
    decodeSessionAppearanceValue,
    encodeSessionAppearanceValue,
    normalizeSessionAppearance,
    type SessionAppearancePatch,
    type SessionMarkerColor,
} from './sessionAppearance';
import { messageRepository } from './messagesStore/messageRepository';
import {
    buildCoverageStatePatch,
    canServeCachedOlderPage,
    clampForwardMaxSeq,
    getCachedOlderPageUiHasMore,
    getKnownContiguousMaxSeq,
    getKnownContiguousMinSeq,
    isPageInsideKnownCoverage,
    mergeOldestLoadedSeq,
    resolveNewerCoveragePatch,
} from './messagesStore/common';
import type { MessagePage, SessionMessageCacheState, SessionMessageCacheStatePatch } from './messagesStore/types';
import {
    cachedMessageMatchesQuery,
    cachedMessageSnippet,
    extractCachedMessageText,
    normalizeCachedMessageSearchText,
    type CachedMessageSearchEntry,
    type CachedMessageSearchMatch,
} from './messagesStore/cachedMessageSearch';
import { emitDesktopMessages } from '@/desktop/desktopEvents';

type PermissionMode = NonNullable<Session['permissionMode']>;

type SessionMessageDispatchTask = {
    reason: string;
    generation: number;
    run: () => Promise<void> | void;
    resolve: () => void;
};

type PreparedNewMessageUpdate = {
    updateData: ApiUpdateContainer;
    lastMessage: NormalizedMessage | null;
    isTaskComplete: boolean;
    isTaskStarted: boolean;
};

type SendMessageResult = {
    success: boolean;
    error?: string;
    localId: string;
};

type SendOrQueueResult = (
    { success: true; mode: 'sent'; localId: string; }
    | { success: true; mode: 'queued'; localId: string; pendingId: string; }
    | { success: false; localId: string; error?: string; }
);

type PreparedOutgoingMessage = {
    localId: string;
    encryptedRawRecord: string;
    normalizedMessage: NormalizedMessage | null;
};

type SessionMessagesResponse = {
    messages?: ApiMessage[];
    hasMore?: boolean;
    oldestSeq?: number | null;
};

/**
 * Tracks when the user last viewed each session (in-memory only).
 * Used by useSessionStatus to decide if taskCompleted should show a blue dot:
 * blue dot shows only when taskCompleted > lastViewedAt.
 */
export const sessionLastViewedAt = loadSessionLastViewedAt();
const SESSIONS_CACHE_SAVE_DEBOUNCE_MS = 1_000;
const SESSIONS_CACHE_SAVE_MIN_INTERVAL_MS = 30_000;

function markSessionViewed(sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    // Use max(now, taskCompleted) to handle clock skew between CLI and app
    const taskCompleted = session?.agentState?.taskCompleted ?? 0;
    const now = Math.max(Date.now(), taskCompleted);

    // Instant local update (no network latency)
    sessionLastViewedAt.set(sessionId, now);
    saveSessionLastViewedAt(sessionLastViewedAt);

    // Sync to other devices via metadata (throttled to avoid feedback loops).
    // Skip for inactive sessions: the server-side metadata update triggers
    // Prisma @updatedAt which would re-sort the session to the top of the
    // inactive list. Local-only update is sufficient for blue dot dismissal.
    if (session?.metadata && session.active) {
        const existing = session.metadata.completionDismissedAt ?? 0;
        if (now - existing > 5000) {
            sessionUpdateMetadataFields(
                sessionId,
                session.metadata,
                { completionDismissedAt: now },
                session.metadataVersion
            ).catch(() => {
                // Silently ignore - local state already updated, will retry on next view
            });
        }
    }
}

class Sync {
    // Spawned agents (especially in spawn mode) can take noticeable time to connect.
    // Per-session pacing for all message-list updates to avoid autoscroll races across websocket and fetch paths.
    private static readonly MESSAGE_LIST_DISPATCH_INTERVAL_MS = 400;
    // First load for a session should stay bounded; older history is loaded on demand.
    private static readonly INITIAL_MESSAGES_LIMIT = 100;
    // Per-request timeout for message fetches. Without it a hung request (socket that never
    // settles) would stall the session's InvalidateSync forever — and invalidate() on a running
    // sync is a no-op, so reopen/retry could never recover it. With it, a stall throws → backoff
    // retries → self-heals.
    private static readonly MESSAGE_FETCH_TIMEOUT_MS = 60000;

    encryption!: Encryption;
    serverID!: string;
    anonID!: string;
    private credentials!: AuthCredentials;
    public encryptionCache = new EncryptionCache();
    private sessionsSync: InvalidateSync;
    private messagesSync = new Map<string, InvalidateSync>();
    // In-flight message fetch aborter per session — lets resetMessagesSync cancel a hung request
    // and lets each request enforce MESSAGE_FETCH_TIMEOUT_MS.
    private messagesFetchAbort = new Map<string, AbortController>();
    // Monotonic token guarding the "refreshing" flag clear: a stale InvalidateSync that unwinds
    // after a reset must not clear a flag that a fresh cycle already re-armed.
    private messagesFetchingToken = new Map<string, number>();
    // Monotonic per-session fetch generation. Bumped by resetMessagesSync; a fetchMessagesV3 run
    // re-checks it after every awaited boundary and bails before mutating sessionLastSeq / the
    // dedupe set / applying, so a stale run that's already past its fetch can't write over a fresh
    // one (stop()/abort only cancel work still inside the network call).
    private messagesFetchGeneration = new Map<string, number>();
    private pendingMessagesSync = new Map<string, InvalidateSync>();
    private sessionReceivedMessages = new Map<string, Set<string>>();
    private messageSyncTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    private sessionMessageUpdateQueues = new Map<string, ApiUpdateContainer[]>();
    private sessionMessageQueueRunning = new Set<string>();
    private sessionMessageDispatchQueues = new Map<string, SessionMessageDispatchTask[]>();
    private sessionMessageDispatchRunning = new Set<string>();
    private sessionMessageDispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private sessionMessageDispatchLastRunAt = new Map<string, number>();
    private sessionMessageDispatchGeneration = new Map<string, number>();
    private sessionDataKeys = new Map<string, Uint8Array>(); // Store session data encryption keys internally
    // Monotonic token guarding persistent message-cache writes. Bumped before any operation that
    // clears/invalidates a session cache so stale fetch/websocket handlers cannot enqueue writes
    // after the clear and resurrect obsolete messages on the next bootstrap.
    private messageCacheGeneration = new Map<string, number>();
    private messageCacheResetPromises = new Map<string, Promise<void>>();
    /** Memoized minimap user-message lists per session, keyed by a cache-state freshness signature,
     *  so refocusing a session doesn't re-decrypt its whole history. See getCachedUserMessagesForMinimap. */
    private minimapUserMessagesCache = new Map<string, { signature: string; messages: UserTextMessage[] }>();
    /** Decrypted local message text used by Command+K search. Invalidated whenever cached rows change. */
    private cachedMessageSearchIndex = new Map<string, { signature: string; entries: CachedMessageSearchEntry[] }>();
    /** Per-session last-known seq for v3 incremental fetch */
    private sessionLastSeq = new Map<string, number>();
    /** Callbacks to run before applying a sent message (keyed by localId).
     *  Ensures input is cleared before message appears, regardless of whether
     *  the HTTP response or WebSocket echo arrives first. */
    private pendingSendCallbacks = new Map<string, () => void>();
    /** Defer showing no_cli_connection so CLI cold-start has a chance to attach
     *  and clear via message-delivery-cleared before the user sees the badge. */
    private deliveryErrorTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Per-session lock to serialize fetchMessagesV3 and websocket message application */
    private sessionMessageLocks = new Map<string, AsyncLock>();
    private encryptedSessionDataKeys = new Map<string, string | null>();
    private machineDataKeys = new Map<string, Uint8Array>(); // Store machine data encryption keys internally
    private artifactDataKeys = new Map<string, Uint8Array>(); // Store artifact data encryption keys internally
    private settingsSync: InvalidateSync;
    private sessionModeConfigSync: InvalidateSync;
    private sessionAppearanceSync: InvalidateSync;
    private profileSync: InvalidateSync;
    private machinesSync: InvalidateSync;
    private pushTokenSync: InvalidateSync;
    private pushTokenRegistrationGate = new PushTokenRegistrationGate();
    private nativeUpdateSync: InvalidateSync;
    private artifactsSync: InvalidateSync;
    private friendsSync: InvalidateSync;
    private friendRequestsSync: InvalidateSync;
    private feedSync: InvalidateSync;
    private feedFullRefresh = false;
    private sharedSessionsSync: InvalidateSync;
    private openClawMachinesSync: InvalidateSync;
    private openClawMachineDataKeys = new Map<string, Uint8Array>(); // Store OpenClaw machine data encryption keys
    private activityAccumulator: ActivityUpdateAccumulator;
    private pendingSettings: Partial<Settings> = loadPendingSettings();
    private pendingSessionModePatches: SessionModeConfigPatch[] = [];
    private pendingSessionAppearancePatches: SessionAppearancePatch[] = [];

    // Track which session the user is currently viewing
    private viewingSessionId: string | null = null;

    private getMessageAccountKey(): string | null {
        if (!this.serverID) {
            return null;
        }
        // Keep the durable message-cache namespace stable for the authenticated account.  The
        // server URL is user-editable in self-hosted setups; including it here made a URL change
        // orphan all previous rows and prevented normal cache reuse/cleanup.
        return this.serverID;
    }

    private getLegacyMessageAccountKey(): string | null {
        if (!this.serverID) {
            return null;
        }
        return `${getServerUrl()}|${this.serverID}`;
    }

    // Generic locking mechanism
    private recalculationLockCount = 0;
    private lastRecalculationTime = 0;
    private lastSessionsCursorMs = 0;
    private sessionsBootstrapMachine = new SessionsBootstrapMachine();
    private sessionsCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSessionsCacheSaveAt = 0;

    constructor() {
        this.sessionsSync = new InvalidateSync(this.runSessionsSync);
        this.settingsSync = new InvalidateSync(this.syncSettings);
        this.sessionModeConfigSync = new InvalidateSync(this.syncSessionModeConfig);
        this.sessionAppearanceSync = new InvalidateSync(this.syncSessionAppearance);
        this.profileSync = new InvalidateSync(this.fetchProfile);
        this.machinesSync = new InvalidateSync(this.fetchMachines);
        this.nativeUpdateSync = new InvalidateSync(this.fetchNativeUpdate);
        this.artifactsSync = new InvalidateSync(this.fetchArtifactsList);
        this.friendsSync = new InvalidateSync(this.fetchFriends);
        this.friendRequestsSync = new InvalidateSync(this.fetchFriendRequests);
        this.feedSync = new InvalidateSync(this.fetchFeed);
        this.sharedSessionsSync = new InvalidateSync(this.fetchSharedSessions);
        this.openClawMachinesSync = new InvalidateSync(this.fetchOpenClawMachines);

        const registerPushToken = async () => {
            // Keep push token registration enabled in dev builds too:
            // Android contributors often validate notifications on dev clients.
            await this.pushTokenRegistrationGate.run(
                (signal, startMutation) => this.registerPushToken(signal, startMutation),
            );
        }
        this.pushTokenSync = new InvalidateSync(registerPushToken);
        this.activityAccumulator = new ActivityUpdateAccumulator(this.flushActivityUpdates.bind(this), 2000);

        // Refresh data when app becomes active
        AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'active') {
                log.log('📱 App became active');
                // Refresh lastViewedAt so blue dot won't flash for the session user is viewing
                if (this.viewingSessionId) {
                    markSessionViewed(this.viewingSessionId);
                }
                this.profileSync.invalidate();
                this.machinesSync.invalidate();
                this.openClawMachinesSync.invalidate();
                this.pushTokenSync.invalidate();
                this.sessionsSync.invalidate();
                this.sessionAppearanceSync.invalidate();
                this.nativeUpdateSync.invalidate();
                log.log('📱 App became active: Invalidating artifacts sync');
                this.artifactsSync.invalidate();
                this.friendsSync.invalidate();
                this.friendRequestsSync.invalidate();
                this.feedSync.invalidate();
                this.sharedSessionsSync.invalidate();
                gitStatusSync.invalidateForSessions([...Object.keys(storage.getState().sessions), ...Object.keys(storage.getState().sharedSessions)]);
                if (this.viewingSessionId) {
                    this.fetchOrchestratorActivity(this.viewingSessionId);
                }

                // DooTask token refresh (throttled to 1h)
                const dootaskProfile = storage.getState().dootaskProfile;
                if (dootaskProfile && this.credentials) {
                    const lastChecked = dootaskProfile.lastCheckedAt
                        ? new Date(dootaskProfile.lastCheckedAt).getTime()
                        : 0;
                    const now = Date.now();
                    const ONE_HOUR = 60 * 60 * 1000;
                    if (now - lastChecked >= ONE_HOUR) {
                        // Refresh token via DooTask API
                        fetch(`${dootaskProfile.serverUrl}/api/users/token/expire?refresh=1`, {
                            method: 'GET',
                            headers: { 'Content-Type': 'application/json', 'dootask-token': dootaskProfile.token },
                        }).then(res => res.json()).then((json: any) => {
                            if (json.ret !== 1) throw new Error('refresh failed');
                            const newToken: string | null = json.data?.token ?? null;
                            const updatedProfile = {
                                ...dootaskProfile,
                                lastCheckedAt: new Date().toISOString(),
                                tokenExpiredAt: json.data?.expired_at ?? null,
                                tokenRemainingSeconds: json.data?.remaining_seconds ?? null,
                                ...(newToken ? { token: newToken } : {}),
                            };
                            storage.getState().setDootaskProfile(updatedProfile);

                            // Sync new token to server if refreshed
                            if (newToken && this.credentials) {
                                fetch(`${getServerUrl()}/v1/connect/dootask`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${this.credentials.token}`,
                                    },
                                    body: JSON.stringify({
                                        serverUrl: updatedProfile.serverUrl,
                                        token: updatedProfile.token,
                                        userId: updatedProfile.userId,
                                        username: updatedProfile.username,
                                        avatar: updatedProfile.avatar,
                                    }),
                                }).catch(() => {});
                            }
                        }).catch(() => {
                            // No-op: keep existing data, retry on next foreground resume
                        });
                    }
                }
            } else {
                log.log(`📱 App state changed to: ${nextAppState}`);
            }
        });
    }

    async create(credentials: AuthCredentials, encryption: Encryption) {
        this.credentials = credentials;
        this.encryption = encryption;
        this.anonID = encryption.anonID;
        this.serverID = parseToken(credentials.token);
        await this.#init();

        // Await settings sync to have fresh settings
        await this.settingsSync.awaitQueue();
        await this.sessionModeConfigSync.awaitQueue();
        await this.sessionAppearanceSync.awaitQueue();

        // Await profile sync to have fresh profile
        await this.profileSync.awaitQueue();

        // Upload content public key for direct sharing (fire-and-forget)
        this.#uploadContentPublicKey().catch(() => {});
    }

    async restore(credentials: AuthCredentials, encryption: Encryption) {
        // NOTE: No awaiting anything here, we're restoring from a disk (ie app restarted)
        // Purchases sync is invalidated in #init() and will complete asynchronously
        this.credentials = credentials;
        this.encryption = encryption;
        this.anonID = encryption.anonID;
        this.serverID = parseToken(credentials.token);
        await this.#init();

        // Upload content public key for direct sharing (fire-and-forget)
        this.#uploadContentPublicKey().catch(() => {});
    }

    async #uploadContentPublicKey() {
        if (!this.credentials || !this.encryption) return;
        const seed = decodeBase64(this.credentials.secret, 'base64url');
        const publicKey = this.encryption.contentDataKey; // X25519 public key
        const sig = await signContentPublicKey(publicKey, seed);
        await uploadContentPublicKey(
            this.credentials,
            encodeBase64(publicKey, 'base64'),
            encodeBase64(sig, 'base64')
        );
    }

    async #init() {

        // Subscribe to updates
        this.subscribeToUpdates();

        // Sync initial PostHog opt-out state with stored settings
        if (tracking) {
            const currentSettings = storage.getState().settings;
            if (currentSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }

        // Invalidate sync
        log.log('🔄 #init: Invalidating all syncs');
        this.lastSessionsCursorMs = 0;
        this.sessionsBootstrapMachine.reset();
        const legacyMessageAccountKey = this.getLegacyMessageAccountKey();
        const messageAccountKey = this.getMessageAccountKey();
        if (legacyMessageAccountKey && messageAccountKey && legacyMessageAccountKey !== messageAccountKey) {
            void messageRepository.clearAccount(legacyMessageAccountKey).catch((error) => {
                console.warn('Failed to clear legacy URL-scoped message cache:', error);
            });
        }

        const cachedSessions = loadSessionsCache(this.serverID);
        if (cachedSessions) {
            storage.getState().applyCachedSessions(cachedSessions.sessions, cachedSessions.sharedSessions);
            await this.restoreSessionEncryptionFromCache(cachedSessions.sessionDataKeys);
            this.lastSessionsCursorMs = cachedSessions.lastSessionsCursorMs;
            if (this.lastSessionsCursorMs > 0) {
                this.sessionsBootstrapMachine.markReady();
            }
            log.log(`📥 #init: hydrated ${Object.keys(cachedSessions.sessions).length} sessions from cache, cursor=${this.lastSessionsCursorMs}`);
        }

        this.sessionsSync.invalidate();
        this.settingsSync.invalidate();
        this.sessionModeConfigSync.invalidate();
        this.sessionAppearanceSync.invalidate();
        this.profileSync.invalidate();
        this.machinesSync.invalidate();
        this.openClawMachinesSync.invalidate();
        this.pushTokenSync.invalidate();
        this.nativeUpdateSync.invalidate();
        this.friendsSync.invalidate();
        this.friendRequestsSync.invalidate();
        this.artifactsSync.invalidate();
        this.feedSync.invalidate();
        this.sharedSessionsSync.invalidate();
        log.log('🔄 #init: All syncs invalidated, including artifacts');

        // Wait for both sessions and machines to load, then mark as ready
        Promise.all([
            this.sessionsSync.awaitQueue(),
            this.machinesSync.awaitQueue()
        ]).then(() => {
            gitStatusSync.invalidateForSessions([...Object.keys(storage.getState().sessions), ...Object.keys(storage.getState().sharedSessions)]);
            storage.getState().applyReady();
            this.reconcileSessions().catch((error) => {
                console.warn('Failed to reconcile sessions after init:', error);
            });

            // Restore DooTask profile from server if not available locally
            if (!storage.getState().dootaskProfile && this.credentials) {
                const endpoint = getServerUrl();
                const token = this.credentials.token;
                fetch(`${endpoint}/v1/connect/dootask`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                }).then(res => {
                    if (!res.ok) return null;
                    return res.json();
                }).then(json => {
                    const profile = json?.profile;
                    log.log(`🔗 DooTask: Server restore: ${profile ? 'found' : 'null'}`);
                    if (profile && !storage.getState().dootaskProfile) {
                        storage.getState().setDootaskProfile({
                            serverUrl: profile.serverUrl,
                            token: profile.token,
                            userId: profile.userId,
                            username: profile.username,
                            avatar: profile.avatar,
                            tokenExpiredAt: null,
                            tokenRemainingSeconds: null,
                            lastCheckedAt: null,
                        });
                    }
                }).catch(() => {});
            }
        }).catch((error) => {
            console.error('Failed to load initial data:', error);
        });
    }

    private restoreSessionEncryptionFromCache = async (encryptedKeys: Record<string, string | null>) => {
        if (!this.encryption) return;

        this.encryptedSessionDataKeys = new Map(Object.entries(encryptedKeys));
        const sessionKeys = new Map<string, Uint8Array | null>();
        for (const [sessionId, encryptedKey] of Object.entries(encryptedKeys)) {
            if (!encryptedKey) {
                sessionKeys.set(sessionId, null);
                continue;
            }

            try {
                const decrypted = await this.encryption.decryptEncryptionKey(encryptedKey);
                if (decrypted) {
                    this.sessionDataKeys.set(sessionId, decrypted);
                    sessionKeys.set(sessionId, decrypted);
                }
            } catch (error) {
                console.warn(`Failed to restore cached session data key for ${sessionId}:`, error);
            }
        }

        await this.encryption.initializeSessions(sessionKeys);
    }

    private getMessageCacheGeneration = (sessionId: string): number => {
        return this.messageCacheGeneration.get(sessionId) ?? 0;
    }

    private bumpMessageCacheGeneration = (sessionId: string): number => {
        const next = this.getMessageCacheGeneration(sessionId) + 1;
        this.messageCacheGeneration.set(sessionId, next);
        // Any cache clear/invalidate must drop the memoized minimap list too.
        this.minimapUserMessagesCache.delete(sessionId);
        this.cachedMessageSearchIndex.delete(sessionId);
        return next;
    }

    private isMessageCacheGenerationCurrent = (sessionId: string, generation: number): boolean => {
        return this.getMessageCacheGeneration(sessionId) === generation;
    }

    // Drop a session's persisted message cache (rows + coverage state). This is public so archive
    // flows can release local storage after the server has confirmed the session is inactive.
    clearSessionMessageCache = async (sessionId: string): Promise<void> => {
        this.bumpMessageCacheGeneration(sessionId);
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) return;
        const resetPromise = messageRepository.clearSession(accountKey, sessionId).catch((error) => {
            console.warn(`Failed to clear local message cache for ${sessionId}:`, error);
        });
        this.messageCacheResetPromises.set(sessionId, resetPromise);
        try {
            await resetPromise;
        } finally {
            if (this.messageCacheResetPromises.get(sessionId) === resetPromise) {
                this.messageCacheResetPromises.delete(sessionId);
            }
        }
    }


    // Hard-reset a session's message sync. invalidate() on a *running* InvalidateSync is a no-op
    // (it only sets the double-flag), so if the current cycle is stuck awaiting a hung request it
    // can never recover — reopen/retry would do nothing. This aborts the in-flight request, stops
    // and drops the InvalidateSync so a fresh one is created on the next kick, and clears the
    // refreshing flag (bumping the token so the stale cycle's awaitQueue finally can't re-clear a
    // freshly re-armed flag).
    private resetMessagesSync = (sessionId: string) => {
        // Bump first: any in-flight fetchMessagesV3 that's already past its network call will see a
        // stale generation and bail before applying, even though stop()/abort can't unwind it.
        this.messagesFetchGeneration.set(sessionId, (this.messagesFetchGeneration.get(sessionId) ?? 0) + 1);
        // Drop the dedupe set: an aborted/stale run may have added message ids to it during decrypt
        // without ever applying them (its dispatch bails on the generation check). Clearing here
        // guarantees the fresh run re-decrypts and applies those messages instead of filtering them
        // out as "already seen". A reset is the only thing that makes a run bail, so this clear
        // always pairs with that bail — closing the stale-write/message-loss window.
        this.sessionReceivedMessages.delete(sessionId);
        const controller = this.messagesFetchAbort.get(sessionId);
        if (controller) {
            controller.abort();
            this.messagesFetchAbort.delete(sessionId);
        }
        const ex = this.messagesSync.get(sessionId);
        if (ex) {
            ex.stop();
            this.messagesSync.delete(sessionId);
        }
        this.messagesFetchingToken.set(sessionId, (this.messagesFetchingToken.get(sessionId) ?? 0) + 1);
        storage.getState().setSessionMessagesFetching(sessionId, false);
    }

    // Kick the per-session message sync. The underlying InvalidateSync wraps fetchMessagesV3 in
    // an infinite backoff, so a single fetch failure is followed by an automatic retry. When
    // surfaceIndicator is set (a user actually opened/focused the session), show the "refreshing"
    // indicator for the ENTIRE retry loop and clear it only once the whole cycle settles (a fetch
    // finally succeeded) — so a failed/slow load keeps reading as "refreshing" instead of flipping
    // back to "online" (or falling through to the 12s "refresh failed" state) while a background
    // retry is still running. The UI gates this behind a 3s delay, so fast catch-ups never flash.
    // Routine background kicks (per-batch ping, gap fill, message-syncing) pass surfaceIndicator
    // false so an active streaming session doesn't sit on a permanent spinner.
    private kickMessagesSync = (sessionId: string, surfaceIndicator: boolean = false) => {
        // A user open/retry forces a clean restart: tear down any stuck/in-flight cycle so we
        // don't just no-op invalidate() against a hung request that can never recover.
        if (surfaceIndicator) {
            this.resetMessagesSync(sessionId);
        }
        let ex = this.messagesSync.get(sessionId);
        if (!ex) {
            ex = new InvalidateSync(() => this.fetchMessagesV3(sessionId));
            this.messagesSync.set(sessionId, ex);
        }
        const alreadyFetching = !!storage.getState().sessionMessagesFetching[sessionId];
        ex.invalidate();
        if (surfaceIndicator && !alreadyFetching) {
            const token = (this.messagesFetchingToken.get(sessionId) ?? 0) + 1;
            this.messagesFetchingToken.set(sessionId, token);
            storage.getState().setSessionMessagesFetching(sessionId, true);
            ex.awaitQueue().finally(() => {
                if (this.messagesFetchingToken.get(sessionId) === token) {
                    storage.getState().setSessionMessagesFetching(sessionId, false);
                }
            });
        }
    }

    private invalidateVisibleSessionData = (sessionId: string, surfaceIndicator: boolean = false) => {
        this.kickMessagesSync(sessionId, surfaceIndicator);
        this.invalidatePendingMessagesSync(sessionId);
    }

    private ensureSessionEncryptionReady = async (sessionId: string): Promise<boolean> => {
        if (this.encryption?.getSessionEncryption(sessionId)) {
            return true;
        }

        // Restored disk cache contains decrypted session metadata but not the
        // encrypted data keys needed to rebuild in-memory session encryption.
        // Force a fresh bootstrap so direct deep-links can recover that state.
        this.lastSessionsCursorMs = 0;
        this.sessionsBootstrapMachine.reset();
        await this.sessionsSync.invalidateAndAwait();
        return !!this.encryption?.getSessionEncryption(sessionId);
    }

    onSessionVisible = (sessionId: string, userInitiated: boolean = false) => {
        // When user navigates into a session, decide between a full bootstrap and an
        // incremental catch-up. If the message list is already loaded in memory and we
        // still hold a seq cursor, keep the cursor so fetchMessagesV3 only fetches what
        // came after it (usually nothing — the websocket keeps the cursor current via the
        // contiguous-seq fast path) instead of re-downloading and re-decrypting the latest
        // 100 messages on every open. Gap detection and message-syncing reset the cursor on
        // their own paths, so the self-heal behavior for the cases that truly need a full
        // reload is preserved.
        if (userInitiated) {
            const existing = storage.getState().sessionMessages[sessionId];
            const canIncremental = !!existing?.isLoaded && this.sessionLastSeq.has(sessionId);
            if (!canIncremental) {
                this.sessionLastSeq.delete(sessionId);
            }
        }

        if (this.encryption?.getSessionEncryption(sessionId)) {
            this.invalidateVisibleSessionData(sessionId, userInitiated);
            if (userInitiated) {
                gitStatusSync.invalidate(sessionId);
            }
        } else {
            void this.ensureSessionEncryptionReady(sessionId)
                .then((ready) => {
                    if (ready) {
                        this.invalidateVisibleSessionData(sessionId, userInitiated);
                        if (userInitiated) {
                            gitStatusSync.invalidate(sessionId);
                        }
                    } else {
                        console.warn(`Session encryption still unavailable after sessions sync for ${sessionId}`);
                    }
                })
                .catch((error) => {
                    console.warn(`Failed to prepare session encryption for ${sessionId}:`, error);
                });
        }

        // Invalidate git status only on user-initiated navigation (not on every
        // websocket message batch) to avoid flooding the shell with git commands.
        if (userInitiated) {
            this.sessionModeConfigSync.invalidate();
            this.fetchOrchestratorActivity(sessionId);
        }

        // Track which session user is viewing
        if (userInitiated) {
            this.viewingSessionId = sessionId;
        }

        // Notify voice assistant about session visibility (only for user-initiated navigation)
        const session = storage.getState().sessions[sessionId];
        if (session) {
            if (userInitiated) {
                voiceHooks.onSessionFocus(sessionId, session.metadata || undefined);
            }
        }

        // Record view time for blue dot (taskCompleted) comparison
        if (userInitiated) {
            markSessionViewed(sessionId);
            // Trigger re-render so blue dot disappears on tablet sidebar
            const s = storage.getState().sessions[sessionId];
            if (s) {
                this.applySessions([{ ...s }]);
            }
        }
    }

    onSessionHidden = () => {
        this.viewingSessionId = null;
        voiceHooks.onSessionBlur();
    }

    private fetchOrchestratorActivity = (sessionId: string) => {
        if (!this.credentials) return;
        getOrchestratorActivity(this.credentials, sessionId)
            .then((data) => {
                storage.getState().setOrchestratorActivity(sessionId, data.activity, data.totalRunCount);
            })
            .catch(() => { /* ignore — badge is best-effort */ });
    }

    private fetchOrchestratorActivityBatch = () => {
        if (!this.credentials) return;
        getOrchestratorActivityBatch(this.credentials)
            .then((data) => {
                storage.getState().setOrchestratorActivityBatch(data.activity, data.totalRunCounts);
            })
            .catch(() => { /* ignore — badge is best-effort */ });
    }

    private invalidateMessagesSync = (sessionId: string) => {
        this.kickMessagesSync(sessionId);
    }

    private invalidatePendingMessagesSync = (sessionId: string) => {
        let ex = this.pendingMessagesSync.get(sessionId);
        if (!ex) {
            ex = new InvalidateSync(() => this.fetchPendingMessages(sessionId));
            this.pendingMessagesSync.set(sessionId, ex);
        }
        ex.invalidate();
    }


    private buildSystemPrompt(sessionId: string): string {
        const session = storage.getState().sessions[sessionId];
        const ctx = session?.metadata?.externalContext;
        if (ctx?.source === 'dootask' && ctx.resourceId) {
            return systemPrompt + '\n\n' + buildDootaskSystemPrompt(ctx.resourceId);
        }
        return systemPrompt;
    }

    private buildPendingPreview(rawContent: unknown): { previewText: string; imageCount: number } {
        const parsed = RawRecordSchema.safeParse(rawContent);
        if (!parsed.success) {
            return { previewText: '', imageCount: 0 };
        }

        const raw = parsed.data;
        if (raw.role !== 'user') {
            return { previewText: '', imageCount: 0 };
        }

        if (raw.meta?.displayText) {
            return { previewText: raw.meta.displayText, imageCount: 0 };
        }

        if (raw.content.type === 'text') {
            return { previewText: raw.content.text, imageCount: 0 };
        }

        if (raw.content.type === 'mixed') {
            return { previewText: raw.content.text, imageCount: raw.content.images.length };
        }

        return { previewText: '', imageCount: 0 };
    }

    private async decryptPendingMessage(sessionId: string, pending: ApiPendingMessage): Promise<PendingMessage | null> {
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            return null;
        }

        const content = await encryption.decryptRaw(pending.content.c);
        const preview = this.buildPendingPreview(content);
        return {
            id: pending.id,
            localId: pending.localId,
            content,
            previewText: preview.previewText,
            imageCount: preview.imageCount,
            sentBy: pending.sentBy ?? null,
            sentByName: pending.sentByName ?? null,
            trackCliDelivery: pending.trackCliDelivery,
            pinnedAt: pending.pinnedAt,
            pausedAt: pending.pausedAt,
            createdAt: pending.createdAt,
            updatedAt: pending.updatedAt,
        };
    }

    fetchPendingMessages = async (sessionId: string) => {
        if (!this.credentials) {
            return;
        }

        if (!this.encryption.getSessionEncryption(sessionId)) {
            throw new Error(`Session encryption not ready for ${sessionId}`);
        }

        const API_ENDPOINT = getServerUrl();
        const response = await fetch(
            `${API_ENDPOINT}/v3/sessions/${sessionId}/pending-messages`,
            {
                headers: {
                    'Authorization': `Bearer ${this.credentials.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // A 404 is permanent here (session gone / share revoked / no access):
        // throwing would make InvalidateSync's infinite backoff retry it forever.
        // Treat it as "no pending queue" — clear locally and settle the loop.
        if (response.status === 404) {
            storage.getState().applyPendingMessages(sessionId, []);
            return;
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch pending messages: ${response.status}`);
        }

        const data = ApiPendingMessagesResponseSchema.parse(await response.json());
        const decrypted = await Promise.all(data.messages.map((pending) => this.decryptPendingMessage(sessionId, pending)));
        storage.getState().applyPendingMessages(sessionId, decrypted.filter((item): item is PendingMessage => item !== null));
    }

    async pinPendingMessage(sessionId: string, pendingId: string): Promise<boolean> {
        if (!this.credentials) {
            return false;
        }

        try {
            const API_ENDPOINT = getServerUrl();
            const response = await fetch(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/pending-messages/${pendingId}/pin`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    storage.getState().removePendingMessage(sessionId, pendingId);
                    return true;
                }
                return false;
            }

            const body = await response.json();
            const pending = ApiPendingMessageSchema.safeParse(body?.message);
            if (!pending.success) {
                return false;
            }

            const decrypted = await this.decryptPendingMessage(sessionId, pending.data);
            if (decrypted) {
                storage.getState().upsertPendingMessage(sessionId, decrypted);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // Toggle the paused (draft) state of a pending message. A paused message
    // stays in the session but is excluded from auto-dispatch until resumed.
    async pausePendingMessage(sessionId: string, pendingId: string): Promise<boolean> {
        if (!this.credentials) {
            return false;
        }

        try {
            const API_ENDPOINT = getServerUrl();
            const response = await fetch(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/pending-messages/${pendingId}/pause`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    storage.getState().removePendingMessage(sessionId, pendingId);
                    return true;
                }
                return false;
            }

            const body = await response.json();
            const pending = ApiPendingMessageSchema.safeParse(body?.message);
            if (!pending.success) {
                return false;
            }

            const decrypted = await this.decryptPendingMessage(sessionId, pending.data);
            if (decrypted) {
                storage.getState().upsertPendingMessage(sessionId, decrypted);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // Replace the text of a queued message in place, preserving any attached
    // images and queue position. Rebuilds the user RawRecord from the existing
    // (decrypted) content, re-encrypts client-side, and PATCHes the ciphertext.
    async updatePendingMessageContent(sessionId: string, pendingId: string, newText: string): Promise<boolean> {
        if (!this.credentials) {
            return false;
        }

        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            return false;
        }

        const existing = storage.getState().sessionPendingMessages[sessionId]?.find((m) => m.id === pendingId);
        if (!existing) {
            return false;
        }

        const parsed = RawRecordSchema.safeParse(existing.content);
        if (!parsed.success || parsed.data.role !== 'user') {
            // Only plain user messages (text / text+images) are editable.
            return false;
        }
        const raw = parsed.data;

        const nextContent: RawRecord = {
            ...raw,
            content: { ...raw.content, text: newText },
            meta: raw.meta?.displayText !== undefined
                ? { ...raw.meta, displayText: newText }
                : raw.meta,
        };

        try {
            const encryptedRawRecord = await encryption.encryptRawRecord(nextContent);
            const API_ENDPOINT = getServerUrl();
            const response = await fetch(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/pending-messages/${pendingId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ content: encryptedRawRecord })
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    storage.getState().removePendingMessage(sessionId, pendingId);
                }
                return false;
            }

            const body = await response.json();
            const pending = ApiPendingMessageSchema.safeParse(body?.message);
            if (!pending.success) {
                return false;
            }

            const decrypted = await this.decryptPendingMessage(sessionId, pending.data);
            if (decrypted) {
                storage.getState().upsertPendingMessage(sessionId, decrypted);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    async deletePendingMessage(sessionId: string, pendingId: string): Promise<boolean> {
        if (!this.credentials) {
            return false;
        }

        try {
            const API_ENDPOINT = getServerUrl();
            const response = await fetch(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/pending-messages/${pendingId}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    storage.getState().removePendingMessage(sessionId, pendingId);
                    return true;
                }
                return false;
            }

            storage.getState().removePendingMessage(sessionId, pendingId);
            return true;
        } catch (error) {
            return false;
        }
    }



    private async prepareOutgoingMessage(
        sessionId: string,
        text: string,
        displayText?: string,
        images?: LocalImage[],
        existingLocalId?: string
    ): Promise<PreparedOutgoingMessage | { error: string; localId: string }> {
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            return { error: 'Session encryption not found', localId: '' };
        }

        const session = getSession(sessionId);
        if (!session) {
            return { error: 'Session not found', localId: '' };
        }

        const permissionMode = session.permissionMode || 'default';
        const flavor = session.metadata?.flavor;
        const modelMode = session.modelMode || 'default';
        const fastMode = session.fastMode ?? false;
        const localId = existingLocalId || randomUUID();

        let sentFrom: string;
        if (Platform.OS === 'web') {
            sentFrom = 'web';
        } else if (Platform.OS === 'android') {
            sentFrom = 'android';
        } else if (Platform.OS === 'ios') {
            sentFrom = isRunningOnMac() ? 'mac' : 'ios';
        } else {
            sentFrom = 'web';
        }

        const { model: resolvedModel, reasoningEffort } = resolveModelSelectionForFlavor(flavor, modelMode);
        const model = (resolvedModel && fastMode) ? `${resolvedModel}-fast` : resolvedModel;
        const fallbackModel: string | null = null;

        let messageContent: { type: 'text'; text: string } | { type: 'mixed'; text: string; images: ImageContent[] };
        if (images && images.length > 0) {
            const uploadedImages: ImageContent[] = [];
            const apiUrl = getServerUrl();
            const token = this.credentials.token;

            try {
                for (const img of images) {
                    const uploaded = await uploadChatImage(sessionId, img, token, apiUrl);
                    uploadedImages.push(uploaded);
                }
            } catch (error) {
                log.log(`[SEND_DEBUG][SYNC] image_upload_failed sid=${sessionId} localId=${localId} error=${error instanceof Error ? error.message : 'Unknown error'}`);
                return { error: 'Image upload failed', localId };
            }

            messageContent = {
                type: 'mixed',
                text,
                images: uploadedImages,
            };
        } else {
            messageContent = {
                type: 'text',
                text,
            };
        }

        const content: RawRecord = {
            role: 'user',
            content: messageContent,
            meta: {
                sentFrom,
                permissionMode: permissionMode || 'default',
                model,
                reasoningEffort,
                fallbackModel,
                appendSystemPrompt: this.buildSystemPrompt(sessionId),
                ...(displayText && { displayText })
            }
        };

        const encryptedRawRecord = await encryption.encryptRawRecord(content);
        const createdAt = Date.now();
        const normalizedMessage = normalizeRawMessage(localId, localId, createdAt, content);
        if (normalizedMessage) {
            const profile = storage.getState().profile;
            normalizedMessage.sentBy = this.serverID;
            normalizedMessage.sentByName = profile.firstName || null;
        }

        return {
            localId,
            encryptedRawRecord,
            normalizedMessage,
        };
    }

    async sendMessage(
        sessionId: string,
        text: string,
        displayText?: string,
        images?: LocalImage[],
        existingLocalId?: string,
        onBeforeApply?: () => void
    ): Promise<SendMessageResult> {
        const prepared = await this.prepareOutgoingMessage(sessionId, text, displayText, images, existingLocalId);
        if ('error' in prepared) {
            return { success: false, error: prepared.error, localId: prepared.localId };
        }

        const { localId, encryptedRawRecord, normalizedMessage } = prepared;
        const sendStartedAt = Date.now();
        log.log(`[SEND_DEBUG][SYNC] start sid=${sessionId} localId=${localId} textLen=${text.length} images=${images?.length || 0} existingLocalId=${existingLocalId ? 'yes' : 'no'}`);

        if (onBeforeApply) {
            this.pendingSendCallbacks.set(localId, onBeforeApply);
        }

        try {
            const API_ENDPOINT = getServerUrl();
            const response = await fetch(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{
                            content: encryptedRawRecord,
                            localId,
                            trackCliDelivery: true
                        }]
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                log.log(`[SEND_DEBUG][SYNC] fail sid=${sessionId} localId=${localId} via=v3-http status=${response.status} error=${errorText}`);
                this.pendingSendCallbacks.delete(localId);
                return { success: false, error: `Send failed: ${response.status}`, localId };
            }

            const pending = this.pendingSendCallbacks.get(localId);
            if (pending) {
                this.pendingSendCallbacks.delete(localId);
                pending();
            }

            if (normalizedMessage) {
                const msg = normalizedMessage;
                void this.enqueueSessionMessageDispatch(sessionId, 'sendMessage:local-ack', async () => {
                    this.applyMessages(sessionId, [msg]);
                });
            }

            try {
                const responseData = await response.json();
                const responseMessages = Array.isArray(responseData.messages) ? responseData.messages : [];
                if (responseMessages.length > 0) {
                    const apiMessages: ApiMessage[] = [];
                    for (const m of responseMessages) {
                        const responseLocalId = m.localId ?? null;
                        const responseContent = m.content;
                        const hasEncryptedContent = responseContent?.t === 'encrypted' && typeof responseContent.c === 'string';
                        // The legacy POST response usually returns message metadata only.  Only
                        // reuse the ciphertext we just sent for the server row that can be tied to
                        // this local send.  Never stamp that ciphertext onto unrelated rows in a
                        // multi-message response; those must be fetched from the server with their
                        // own encrypted payloads.
                        const canReuseOutgoingCiphertext = responseLocalId === localId
                            || (responseMessages.length === 1 && responseLocalId === null && !hasEncryptedContent);
                        const content = hasEncryptedContent
                            ? { t: 'encrypted' as const, c: responseContent.c }
                            : canReuseOutgoingCiphertext
                                ? { t: 'encrypted' as const, c: encryptedRawRecord }
                                : null;

                        if (!content) {
                            continue;
                        }

                        apiMessages.push({
                            id: m.id,
                            seq: m.seq,
                            localId: responseLocalId ?? (canReuseOutgoingCiphertext ? localId : null),
                            content,
                            createdAt: m.createdAt,
                            updatedAt: m.updatedAt,
                            sentBy: m.sentBy ?? this.serverID,
                            sentByName: m.sentByName ?? storage.getState().profile.firstName ?? null,
                            deliveryIssue: m.deliveryIssue ?? undefined,
                        });
                    }

                    if (apiMessages.length < responseMessages.length) {
                        this.invalidateMessagesSync(sessionId);
                    }

                    if (apiMessages.length > 0) {
                        const maxSeq = Math.max(...apiMessages.map((m) => m.seq));
                        const cachedState = await this.getCachedMessageState(sessionId);
                        const coveragePatch = buildCoverageStatePatch(cachedState, {
                            direction: 'newer',
                            messages: apiMessages,
                        });
                        const wrote = coveragePatch
                            ? await this.upsertMessagesInLocalCache(sessionId, apiMessages, { statePatch: coveragePatch })
                            : false;
                        if (!wrote) {
                            // Coverage refused or the write failed — don't bump the cursor past
                            // coverage that never persisted; the paced fetch catches up instead.
                            this.invalidateMessagesSync(sessionId);
                        }
                        const currentSeq = this.sessionLastSeq.get(sessionId) ?? 0;
                        if (wrote && maxSeq > currentSeq) {
                            this.sessionLastSeq.set(sessionId, maxSeq);
                        }
                        const serverNormalizedMessages = await this.decryptAndNormalizeMessages(sessionId, apiMessages, this.encryption.getSessionEncryption(sessionId)!);
                        if (serverNormalizedMessages.length > 0) {
                            void this.enqueueSessionMessageDispatch(sessionId, 'sendMessage:server-ack', async () => {
                                this.applyMessages(sessionId, serverNormalizedMessages);
                            });
                        }
                    }
                }
            } catch {
                // no-op
            }

            log.log(`[SEND_DEBUG][SYNC] success sid=${sessionId} localId=${localId} via=v3-http elapsedMs=${Date.now() - sendStartedAt}`);
            return { success: true, localId };
        } catch (error) {
            log.log(`[SEND_DEBUG][SYNC] fail sid=${sessionId} localId=${localId} via=v3-exception error=${error instanceof Error ? error.message : 'Unknown error'}`);
            this.pendingSendCallbacks.delete(localId);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error', localId };
        }
    }

    async sendOrQueueMessage(
        sessionId: string,
        text: string,
        displayText?: string,
        images?: LocalImage[],
        existingLocalId?: string,
        onBeforeApply?: () => void
    ): Promise<SendOrQueueResult> {
        const prepared = await this.prepareOutgoingMessage(sessionId, text, displayText, images, existingLocalId);
        if ('error' in prepared) {
            return { success: false, error: prepared.error, localId: prepared.localId };
        }

        const { localId, encryptedRawRecord, normalizedMessage } = prepared;
        if (!this.credentials) {
            return { success: false, localId, error: 'Not authenticated' };
        }
        if (onBeforeApply) {
            this.pendingSendCallbacks.set(localId, onBeforeApply);
        }

        try {
            const API_ENDPOINT = getServerUrl();
            const response = await this.hedgedSend(
                `${API_ENDPOINT}/v3/sessions/${sessionId}/send`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content: encryptedRawRecord,
                        localId,
                        trackCliDelivery: true
                    })
                }
            );

            if (!response.ok) {
                this.pendingSendCallbacks.delete(localId);
                return { success: false, localId, error: `Send failed: ${response.status}` };
            }

            const parsed = ApiSendOrQueueResponseSchema.safeParse(await response.json());
            if (!parsed.success) {
                this.pendingSendCallbacks.delete(localId);
                return { success: false, localId, error: 'Invalid send response' };
            }

            const responseData = parsed.data;
            if (responseData.mode === 'queued') {
                const pending = this.pendingSendCallbacks.get(localId);
                if (pending) {
                    this.pendingSendCallbacks.delete(localId);
                    pending();
                }

                const decryptedPending = await this.decryptPendingMessage(sessionId, responseData.pending);
                if (decryptedPending) {
                    storage.getState().upsertPendingMessage(sessionId, decryptedPending);
                }
                return { success: true, mode: 'queued', localId, pendingId: responseData.pending.id };
            }

            const pending = this.pendingSendCallbacks.get(localId);
            if (pending) {
                this.pendingSendCallbacks.delete(localId);
                pending();
            }

            // Optimistically mark the session as awaiting a response so the UI shows
            // "processing…" immediately, without waiting for the CLI thinking heartbeat.
            storage.getState().setAwaitingResponse(sessionId, Date.now());

            if (normalizedMessage) {
                const msg = normalizedMessage;
                void this.enqueueSessionMessageDispatch(sessionId, 'sendOrQueueMessage:sent-local-ack', async () => {
                    this.applyMessages(sessionId, [msg]);
                });
            }

            const apiMessage: ApiMessage = {
                id: responseData.message.id,
                seq: responseData.message.seq,
                localId: responseData.message.localId ?? localId,
                content: { t: 'encrypted', c: encryptedRawRecord },
                createdAt: responseData.message.createdAt,
                updatedAt: responseData.message.updatedAt,
                sentBy: responseData.message.sentBy ?? this.serverID,
                sentByName: responseData.message.sentByName ?? storage.getState().profile.firstName ?? null,
            };
            const cachedState = await this.getCachedMessageState(sessionId);
            const coveragePatch = buildCoverageStatePatch(cachedState, {
                direction: 'newer',
                messages: [apiMessage],
            });
            const wrote = coveragePatch
                ? await this.upsertMessagesInLocalCache(sessionId, [apiMessage], { statePatch: coveragePatch })
                : false;
            if (!wrote) {
                // Coverage refused or the write failed — don't bump the cursor past coverage
                // that never persisted; the paced fetch catches up instead.
                this.invalidateMessagesSync(sessionId);
            }
            const serverNormalizedMessages = await this.decryptAndNormalizeMessages(sessionId, [apiMessage], this.encryption.getSessionEncryption(sessionId)!);
            if (serverNormalizedMessages.length > 0) {
                void this.enqueueSessionMessageDispatch(sessionId, 'sendOrQueueMessage:sent-server-ack', async () => {
                    this.applyMessages(sessionId, serverNormalizedMessages);
                });
            }

            const currentSeq = this.sessionLastSeq.get(sessionId) ?? 0;
            if (wrote && responseData.message.seq > currentSeq) {
                this.sessionLastSeq.set(sessionId, responseData.message.seq);
            }

            return { success: true, mode: 'sent', localId };
        } catch (error) {
            this.pendingSendCallbacks.delete(localId);
            return { success: false, localId, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    /**
     * Sends a request with hedging to survive flaky networks. Fires the request,
     * and if it hasn't produced a response yet, fires additional concurrent
     * attempts on the schedule below WITHOUT cancelling earlier ones. All attempts
     * share the same body (and localId), so the server's localId de-duplication
     * guarantees at most one message is created even if several attempts succeed.
     *
     * The first attempt to receive any HTTP response wins; the remaining in-flight
     * attempts are aborted. If no attempt produces a response within the total
     * budget, all attempts are aborted and the call rejects (treated as a failed
     * send by the caller, which keeps the draft for retry).
     */
    private async hedgedSend(url: string, init: RequestInit): Promise<Response> {
        // Attempt start offsets (ms). First fires immediately, then earlier-then-
        // wider spacing to catch stalled connections fast without flooding a slow
        // but live link. Total budget = last offset + tail wait.
        const SCHEDULE_MS = [0, 4000, 12000, 22000];
        const TOTAL_TIMEOUT_MS = 28000;

        return await new Promise<Response>((resolve, reject) => {
            const controllers: AbortController[] = [];
            const timers: ReturnType<typeof setTimeout>[] = [];
            let settled = false;
            let inFlight = 0;
            let scheduledRemaining = SCHEDULE_MS.length;

            const clearTimers = () => {
                for (const t of timers) clearTimeout(t);
            };

            const overallTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                clearTimers();
                for (const c of controllers) c.abort();
                reject(new Error('Send timed out'));
            }, TOTAL_TIMEOUT_MS);
            timers.push(overallTimer);

            const launch = () => {
                scheduledRemaining--;
                const controller = new AbortController();
                controllers.push(controller);
                inFlight++;
                fetch(url, { ...init, signal: controller.signal })
                    .then((response) => {
                        if (settled) return;
                        settled = true;
                        clearTimers();
                        // Abort the other attempts; keep this one's stream readable.
                        for (const c of controllers) {
                            if (c !== controller) c.abort();
                        }
                        resolve(response);
                    })
                    .catch(() => {
                        if (settled) return;
                        inFlight--;
                        // All attempts have been launched and all failed.
                        if (inFlight === 0 && scheduledRemaining === 0) {
                            settled = true;
                            clearTimers();
                            reject(new Error('Send failed: network error'));
                        }
                    });
            };

            for (const delay of SCHEDULE_MS) {
                if (delay === 0) {
                    launch();
                } else {
                    timers.push(setTimeout(() => {
                        if (!settled) launch();
                    }, delay));
                }
            }
        });
    }

    async changePermissionMode(sessionId: string, mode: PermissionMode): Promise<boolean> {
        try {
            await apiSocket.sessionRPC<boolean, { mode: PermissionMode }>(
                sessionId,
                'permission-mode-changed',
                { mode }
            );
            return true;
        } catch (error) {
            log.log(`Failed to change permission mode for ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    applySettings = (delta: Partial<Settings>) => {
        storage.getState().applySettingsLocal(delta);

        // Save pending settings
        this.pendingSettings = { ...this.pendingSettings, ...delta };
        savePendingSettings(this.pendingSettings);

        // Sync PostHog opt-out state if it was changed
        if (tracking && 'analyticsOptOut' in delta) {
            const currentSettings = storage.getState().settings;
            if (currentSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }

        // Invalidate settings sync
        this.settingsSync.invalidate();
    }

    queueSessionModeConfigUpdate = (params: {
        sessionId?: string;
        permissionMode: PermissionMode;
        modelMode: string;
        fastMode?: boolean;
        agentType: SessionModeAgentType;
        includeSessionEntry: boolean;
        includeLastUsed: boolean;
        updatedAt?: number;
        applyLocalPatch?: boolean;
    }) => {
        const patch: SessionModeConfigPatch = {
            sessionId: params.sessionId,
            permissionMode: params.permissionMode,
            modelMode: params.modelMode || 'default',
            ...(typeof params.fastMode === 'boolean' ? { fastMode: params.fastMode } : {}),
            agentType: params.agentType,
            includeSessionEntry: params.includeSessionEntry,
            includeLastUsed: params.includeLastUsed,
            updatedAt: params.updatedAt ?? Date.now(),
        };

        if (params.applyLocalPatch !== false) {
            storage.getState().applySessionModeConfigPatchLocal(patch);
        }

        this.pendingSessionModePatches.push(patch);
        this.sessionModeConfigSync.invalidate();
    }

    queueSessionMarkerColorUpdate = (
        sessionId: string,
        color: SessionMarkerColor | null,
        updatedAt: number = Date.now(),
    ) => {
        const patch: SessionAppearancePatch = { sessionId, color, updatedAt };
        storage.getState().applySessionAppearancePatchLocal(patch);
        this.pendingSessionAppearancePatches.push(patch);
        this.sessionAppearanceSync.invalidate();
    }

    refreshProfile = async () => {
        await this.profileSync.invalidateAndAwait();
    }

    async assumeUsers(userIds: string[]): Promise<void> {
        if (!this.credentials || userIds.length === 0) return;
        
        const state = storage.getState();
        // Filter out users we already have in cache (including null for 404s)
        const missingIds = userIds.filter(id => !(id in state.users));
        
        if (missingIds.length === 0) return;
        
        log.log(`👤 Fetching ${missingIds.length} missing users...`);
        
        // Fetch missing users in parallel
        const results = await Promise.all(
            missingIds.map(async (id) => {
                try {
                    const profile = await getUserProfile(this.credentials!, id);
                    return { id, profile };  // profile is null if 404
                } catch (error) {
                    console.error(`Failed to fetch user ${id}:`, error);
                    return { id, profile: null };  // Treat errors as 404
                }
            })
        );
        
        // Convert to Record<string, UserProfile | null>
        const usersMap: Record<string, UserProfile | null> = {};
        results.forEach(({ id, profile }) => {
            usersMap[id] = profile;
        });
        
        storage.getState().applyUsers(usersMap);
        log.log(`👤 Applied ${results.length} users to cache (${results.filter(r => r.profile).length} found, ${results.filter(r => !r.profile).length} not found)`);
    }

    //
    // Private
    //

    private runSessionsSync = async () => {
        const plan = this.sessionsBootstrapMachine.planNext();
        if (plan === 'skip') {
            // A bootstrap is already in flight; pending incremental is now
            // armed and will run when bootstrap completes.
            return;
        }
        if (plan === 'bootstrap') {
            this.sessionsBootstrapMachine.beginBootstrap();
            try {
                await this.bootstrapSessions();
            } catch (e) {
                this.sessionsBootstrapMachine.failBootstrap();
                throw e;
            }
            const followUp = this.sessionsBootstrapMachine.completeBootstrap();
            if (followUp === 'incremental') {
                await this.fetchSessionsIncremental();
            }
            return;
        }
        // plan === 'incremental'
        await this.fetchSessionsIncremental();
    }

    private bootstrapSessions = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        const initialLimit = 150;
        // Bootstrap intentionally ignores lastSessionsCursorMs: it owns the
        // "I am the first full sync" semantics. Retries after a failure
        // re-run from scratch (storage merge is idempotent).
        const url = `${API_ENDPOINT}/v1/sessions`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch sessions: ${response.status}`);
        }

        const data = await response.json();
        const sessions = data.sessions as Array<{
            id: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            agentState: string | null;
            agentStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
            lastMessage: ApiMessage | null;
            isShared?: boolean;
        }>;

        if (sessions.length === 0) {
            // Empty account — still keep orchestrator activity fresh.
            this.fetchOrchestratorActivityBatch();
            this.scheduleSessionsCacheSave();
            log.log(`📥 bootstrapSessions: empty account`);
            return;
        }

        const decryptedSessions = await this.decryptSessionRows(sessions);
        let maxUpdatedAt = 0;
        for (const session of decryptedSessions) {
            if (session.updatedAt > maxUpdatedAt) {
                maxUpdatedAt = session.updatedAt;
            }
        }

        this.lastSessionsCursorMs = maxUpdatedAt;
        this.applySessions(decryptedSessions);

        // /v1/sessions intentionally keeps its first page ordered by createdAt desc
        // to avoid the list jitter introduced by updatedAt resorting (see 3af62d51).
        // If that page is full, it may omit old-created-but-recently-updated rows
        // that /session/recent's updatedAt-desc pagination would otherwise skip.
        // Backfill the updatedAt window covered by the first page before normal
        // older pagination starts.
        if (sessions.length >= initialLimit && decryptedSessions.length > 0) {
            await this.backfillInitialSessionUpdatedAtWindow(decryptedSessions, initialLimit);
        }

        this.fetchOrchestratorActivityBatch();
        log.log(`📥 bootstrapSessions completed - processed ${decryptedSessions.length} sessions, cursor=${maxUpdatedAt}`);
    }

    private fetchSessionsIncremental = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        const cursor = this.lastSessionsCursorMs;
        if (cursor <= 0) {
            // Defensive: incremental should never run without a cursor.
            // If it does (state machine bug), fall back to bootstrap path
            // rather than issuing an unfiltered request.
            log.log(`⚠️ fetchSessionsIncremental called with cursor=${cursor}; falling back to bootstrap`);
            await this.bootstrapSessions();
            return;
        }
        const url = `${API_ENDPOINT}/v1/sessions?since=${cursor}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch sessions: ${response.status}`);
        }

        const data = await response.json();
        const sessions = data.sessions as Array<{
            id: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            agentState: string | null;
            agentStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
            lastMessage: ApiMessage | null;
            isShared?: boolean;
        }>;
        const deletedSessionIds = Array.isArray(data.deletedSessionIds)
            ? data.deletedSessionIds as string[]
            : [];

        if (sessions.length === 0 && deletedSessionIds.length === 0) {
            this.fetchOrchestratorActivityBatch();
            log.log(`📥 fetchSessionsIncremental: no changes since cursor=${cursor}`);
            return;
        }

        const decryptedSessions = await this.decryptSessionRows(sessions);
        let maxUpdatedAt = cursor;
        for (const session of decryptedSessions) {
            if (session.updatedAt > maxUpdatedAt) {
                maxUpdatedAt = session.updatedAt;
            }
        }
        if (typeof data.cursor === 'number' && data.cursor > maxUpdatedAt) {
            maxUpdatedAt = data.cursor;
        }

        this.lastSessionsCursorMs = maxUpdatedAt;
        if (deletedSessionIds.length > 0) {
            this.applyDeletedSessions(deletedSessionIds);
        }
        if (decryptedSessions.length > 0) {
            this.applySessions(decryptedSessions);
        } else {
            this.scheduleSessionsCacheSave();
        }

        this.fetchOrchestratorActivityBatch();
        log.log(`📥 fetchSessionsIncremental completed - processed ${decryptedSessions.length} sessions, deleted ${deletedSessionIds.length}, cursor=${maxUpdatedAt}`);
    }

    private backfillInitialSessionUpdatedAtWindow = async (initialSessions: Session[], limit: number) => {
        const updatedAts = initialSessions.map(session => session.updatedAt);
        const maxUpdatedAt = Math.max(...updatedAts);
        const oldestUpdatedAt = Math.min(...updatedAts);
        let cursor: { updatedAt: number; id?: string } = { updatedAt: maxUpdatedAt + 1 };

        for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
            const page = await this.fetchOlderSessionsPage({
                beforeUpdatedAt: cursor.updatedAt,
                beforeId: cursor.id,
                limit,
            });
            if (page.length === 0) return;

            const last = page[page.length - 1];
            if (last.updatedAt < oldestUpdatedAt || page.length < limit) return;
            cursor = { updatedAt: last.updatedAt, id: last.id };
        }
    }

    private fetchSharedSessions = async () => {
        if (!this.credentials || !this.encryption) return;

        const sharedSessions = await apiFetchSharedSessions(this.credentials);
        log.log(`📥 fetchSharedSessions: received ${sharedSessions.length} shared sessions`);

        // Decrypt data keys and initialize session encryptions
        const sessionKeys = new Map<string, Uint8Array | null>();
        for (const ss of sharedSessions) {
            if (ss.encryptedDataKey) {
                try {
                    const decrypted = await this.encryption.decryptEncryptionKey(ss.encryptedDataKey);
                    if (decrypted) {
                        sessionKeys.set(ss.sessionId, decrypted);
                        this.sessionDataKeys.set(ss.sessionId, decrypted);
                        this.encryptedSessionDataKeys.set(ss.sessionId, ss.encryptedDataKey);
                    } else {
                        console.error(`Failed to decrypt data key for shared session ${ss.sessionId}`);
                    }
                } catch (error) {
                    console.error(`Error decrypting data key for shared session ${ss.sessionId}:`, error);
                }
            }
        }
        await this.encryption.initializeSessions(sessionKeys);

        // Decrypt metadata for each shared session
        const decryptedSessions: Session[] = [];
        for (const ss of sharedSessions) {
            const sessionEncryption = this.encryption.getSessionEncryption(ss.sessionId);
            if (!sessionEncryption) {
                console.error(`Session encryption not found for shared session ${ss.sessionId}`);
                continue;
            }

            const metadata = ss.metadata
                ? await sessionEncryption.decryptMetadata(ss.metadataVersion, ss.metadata)
                : null;

            const agentState = ss.agentState
                ? await sessionEncryption.decryptAgentState(ss.agentStateVersion, ss.agentState)
                : null;

            decryptedSessions.push({
                id: ss.sessionId,
                seq: ss.seq,
                createdAt: ss.createdAt,
                updatedAt: ss.updatedAt,
                active: ss.active,
                activeAt: ss.activeAt,
                metadata,
                metadataVersion: ss.metadataVersion,
                agentState,
                agentStateVersion: ss.agentStateVersion,
                thinking: false,
                thinkingAt: 0,
                presence: ss.active ? "online" : ss.activeAt,
                owner: ss.sharedBy.id,
                ownerProfile: {
                    id: ss.sharedBy.id,
                    username: ss.sharedBy.username ?? null,
                    firstName: ss.sharedBy.firstName ?? '',
                    lastName: ss.sharedBy.lastName,
                    avatar: ss.sharedBy.avatar,
                },
                accessLevel: ss.accessLevel,
            });
        }

        storage.getState().applySharedSessions(decryptedSessions);
        this.scheduleSessionsCacheSave();
        log.log(`📥 fetchSharedSessions completed - processed ${decryptedSessions.length} shared sessions`);
    }


    public fetchSessionCapabilities = async (sessionId: string) => {
        if (!this.credentials || !this.encryption) return null;

        const sessionEncryption = this.encryption.getSessionEncryption(sessionId);
        if (!sessionEncryption) {
            return null;
        }

        const response = await fetch(`${getServerUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/capabilities`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch session capabilities: ${response.status}`);
        }

        const data = await response.json();
        if (!data.capabilities?.payload) {
            return null;
        }

        const decrypted = await sessionEncryption.decryptRaw(data.capabilities.payload);
        const parsed = SessionCapabilitiesSchema.safeParse(decrypted);
        if (!parsed.success) {
            return null;
        }

        storage.getState().applySessionCapabilities(
            sessionId,
            parsed.data,
            data.capabilities.version,
            data.capabilities.updatedAt
        );
        return parsed.data;
    }

    public refreshMachines = async () => {
        return this.fetchMachines();
    }

    private decryptSessionRows = async (sessions: Array<{
        id: string;
        seq: number;
        metadata: string;
        metadataVersion: number;
        agentState: string | null;
        agentStateVersion: number;
        dataEncryptionKey: string | null;
        active: boolean;
        activeAt: number;
        createdAt: number;
        updatedAt: number;
        lastMessage?: ApiMessage | null;
        isShared?: boolean;
    }>): Promise<Session[]> => {
        const sessionKeys = new Map<string, Uint8Array | null>();
        for (const session of sessions) {
            if (session.dataEncryptionKey) {
                const decrypted = await this.encryption.decryptEncryptionKey(session.dataEncryptionKey);
                if (!decrypted) {
                    console.error(`Failed to decrypt data encryption key for session ${session.id}`);
                    continue;
                }
                sessionKeys.set(session.id, decrypted);
                this.sessionDataKeys.set(session.id, decrypted);
                this.encryptedSessionDataKeys.set(session.id, session.dataEncryptionKey);
            } else {
                sessionKeys.set(session.id, null);
                this.encryptedSessionDataKeys.set(session.id, null);
            }
        }
        await this.encryption.initializeSessions(sessionKeys);

        const decryptedSessions: Session[] = [];
        for (const session of sessions) {
            const sessionEncryption = this.encryption.getSessionEncryption(session.id);
            if (!sessionEncryption) {
                console.error(`Session encryption not found for ${session.id} - this should never happen`);
                continue;
            }

            const metadata = await sessionEncryption.decryptMetadata(session.metadataVersion, session.metadata);
            const agentState = await sessionEncryption.decryptAgentState(session.agentStateVersion, session.agentState);
            const existingSession = storage.getState().sessions[session.id];

            decryptedSessions.push({
                ...session,
                thinking: existingSession?.thinking ?? false,
                thinkingAt: existingSession?.thinkingAt ?? 0,
                metadata,
                agentState,
                presence: session.active ? 'online' : session.activeAt,
            });
        }

        return decryptedSessions;
    }

    public fetchOlderSessionsPage = async (params: { beforeUpdatedAt: number; beforeId?: string; limit?: number; persistToStore?: boolean }): Promise<Session[]> => {
        if (!this.credentials || !this.encryption) return [];

        const API_ENDPOINT = getServerUrl();
        const query = new URLSearchParams({
            beforeUpdatedAt: String(params.beforeUpdatedAt),
            limit: String(params.limit ?? 150),
        });
        if (params.beforeId) {
            query.set('beforeId', params.beforeId);
        }

        const response = await fetch(`${API_ENDPOINT}/v1/sessions?${query.toString()}`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch older sessions: ${response.status}`);
        }

        const data = await response.json();
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const decryptedSessions = await this.decryptSessionRows(sessions);
        const persist = params.persistToStore ?? true;
        if (decryptedSessions.length > 0 && persist) {
            this.applySessions(decryptedSessions);
        }
        return decryptedSessions;
    }

    public refreshSessions = async () => {
        await this.sessionsSync.invalidateAndAwait();
    }

    public refreshSessionsWithReconcile = async () => {
        await this.refreshSessions();
        await this.reconcileSessions();
    }

    public refreshFriends = () => {
        this.friendsSync.invalidate();
        this.friendRequestsSync.invalidate();
        this.feedSync.invalidate();
    }

    public refreshInbox = async () => {
        this.feedFullRefresh = true;
        await Promise.all([
            this.feedSync.invalidateAndAwait(),
            this.friendsSync.invalidateAndAwait(),
            this.friendRequestsSync.invalidateAndAwait(),
        ]);
    }

    public getCredentials() {
        return this.credentials;
    }

    public reconcileSessions = async () => {
        if (!this.credentials || !this.encryption) return;

        const state = storage.getState();
        const known: Record<string, number> = {};
        for (const session of Object.values(state.sessions)) {
            known[session.id] = session.updatedAt;
        }

        const response = await fetch(`${getServerUrl()}/v1/sessions/diff`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                since: this.lastSessionsCursorMs > 0 ? this.lastSessionsCursorMs : undefined,
                known
            })
        });

        // Older self-hosted servers may not have the diff endpoint yet. Keep
        // normal incremental sync working and simply skip the reconcile pass.
        if (response.status === 404) {
            log.log('📥 reconcileSessions skipped: server does not support /v1/sessions/diff');
            return;
        }

        if (!response.ok) {
            throw new Error(`Failed to diff sessions: ${response.status}`);
        }

        const data = await response.json();
        const sessions = Array.isArray(data.sessions) ? data.sessions as Array<{
            id: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            agentState: string | null;
            agentStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
            lastMessage: ApiMessage | null;
            isShared?: boolean;
        }> : [];
        const deletedSessionIds = Array.isArray(data.deletedSessionIds)
            ? data.deletedSessionIds as string[]
            : [];

        let maxCursor = this.lastSessionsCursorMs;
        if (typeof data.cursor === 'number' && data.cursor > maxCursor) {
            maxCursor = data.cursor;
        }
        for (const row of sessions) {
            if (row.updatedAt > maxCursor) maxCursor = row.updatedAt;
        }

        if (deletedSessionIds.length > 0) {
            this.applyDeletedSessions(deletedSessionIds);
        }
        if (sessions.length > 0) {
            const decryptedSessions = await this.decryptSessionRows(sessions);
            this.applySessions(decryptedSessions);
        }
        this.lastSessionsCursorMs = maxCursor;
        this.scheduleSessionsCacheSave();

        log.log(`📥 reconcileSessions completed - updated ${sessions.length}, deleted ${deletedSessionIds.length}, cursor=${maxCursor}`);
    }

    /**
     * Get the decrypted data encryption key for a session.
     * Returns null if the key hasn't been fetched/decrypted yet.
     */
    public getSessionDataKey(sessionId: string): Uint8Array | null {
        const key = this.sessionDataKeys.get(sessionId);
        if (!key) return null;
        return new Uint8Array(key);
    }

    // Artifact methods
    public fetchArtifactsList = async (): Promise<void> => {
        log.log('📦 fetchArtifactsList: Starting artifact sync');
        if (!this.credentials) {
            log.log('📦 fetchArtifactsList: No credentials, skipping');
            return;
        }

        try {
            log.log('📦 fetchArtifactsList: Fetching artifacts from server');
            const artifacts = await fetchArtifacts(this.credentials);
            log.log(`📦 fetchArtifactsList: Received ${artifacts.length} artifacts from server`);
            const decryptedArtifacts: DecryptedArtifact[] = [];

            for (const artifact of artifacts) {
                try {
                    // Decrypt the data encryption key
                    const decryptedKey = await this.encryption.decryptEncryptionKey(artifact.dataEncryptionKey);
                    if (!decryptedKey) {
                        console.error(`Failed to decrypt key for artifact ${artifact.id}`);
                        continue;
                    }

                    // Store the decrypted key in memory
                    this.artifactDataKeys.set(artifact.id, decryptedKey);

                    // Create artifact encryption instance
                    const artifactEncryption = new ArtifactEncryption(decryptedKey);

                    // Decrypt header
                    const header = await artifactEncryption.decryptHeader(artifact.header);
                    
                    decryptedArtifacts.push({
                        id: artifact.id,
                        title: header?.title || null,
                        sessions: header?.sessions,  // Include sessions from header
                        draft: header?.draft,        // Include draft flag from header
                        body: undefined, // Body not loaded in list
                        headerVersion: artifact.headerVersion,
                        bodyVersion: artifact.bodyVersion,
                        seq: artifact.seq,
                        createdAt: artifact.createdAt,
                        updatedAt: artifact.updatedAt,
                        isDecrypted: !!header,
                    });
                } catch (err) {
                    console.error(`Failed to decrypt artifact ${artifact.id}:`, err);
                    // Add with decryption failed flag
                    decryptedArtifacts.push({
                        id: artifact.id,
                        title: null,
                        body: undefined,
                        headerVersion: artifact.headerVersion,
                        seq: artifact.seq,
                        createdAt: artifact.createdAt,
                        updatedAt: artifact.updatedAt,
                        isDecrypted: false,
                    });
                }
            }

            log.log(`📦 fetchArtifactsList: Successfully decrypted ${decryptedArtifacts.length} artifacts`);
            storage.getState().applyArtifacts(decryptedArtifacts);
            log.log('📦 fetchArtifactsList: Artifacts applied to storage');
        } catch (error) {
            log.log(`📦 fetchArtifactsList: Error fetching artifacts: ${error}`);
            console.error('Failed to fetch artifacts:', error);
            throw error;
        }
    }

    public async fetchArtifactWithBody(artifactId: string): Promise<DecryptedArtifact | null> {
        if (!this.credentials) return null;

        try {
            const artifact = await fetchArtifact(this.credentials, artifactId);

            // Decrypt the data encryption key
            const decryptedKey = await this.encryption.decryptEncryptionKey(artifact.dataEncryptionKey);
            if (!decryptedKey) {
                console.error(`Failed to decrypt key for artifact ${artifactId}`);
                return null;
            }

            // Store the decrypted key in memory
            this.artifactDataKeys.set(artifact.id, decryptedKey);

            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(decryptedKey);

            // Decrypt header and body
            const header = await artifactEncryption.decryptHeader(artifact.header);
            const body = artifact.body ? await artifactEncryption.decryptBody(artifact.body) : null;

            return {
                id: artifact.id,
                title: header?.title || null,
                sessions: header?.sessions,  // Include sessions from header
                draft: header?.draft,        // Include draft flag from header
                body: body?.body || null,
                headerVersion: artifact.headerVersion,
                bodyVersion: artifact.bodyVersion,
                seq: artifact.seq,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt,
                isDecrypted: !!header,
            };
        } catch (error) {
            console.error(`Failed to fetch artifact ${artifactId}:`, error);
            return null;
        }
    }

    public async createArtifact(
        title: string | null, 
        body: string | null,
        sessions?: string[],
        draft?: boolean
    ): Promise<string> {
        if (!this.credentials) {
            throw new Error('Not authenticated');
        }

        try {
            // Generate unique artifact ID
            const artifactId = this.encryption.generateId();

            // Generate data encryption key
            const dataEncryptionKey = ArtifactEncryption.generateDataEncryptionKey();
            
            // Store the decrypted key in memory
            this.artifactDataKeys.set(artifactId, dataEncryptionKey);
            
            // Encrypt the data encryption key with user's key
            const encryptedKey = await this.encryption.encryptEncryptionKey(dataEncryptionKey);
            
            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);
            
            // Encrypt header and body
            const encryptedHeader = await artifactEncryption.encryptHeader({ title, sessions, draft });
            const encryptedBody = await artifactEncryption.encryptBody({ body });
            
            // Create the request
            const request: ArtifactCreateRequest = {
                id: artifactId,
                header: encryptedHeader,
                body: encryptedBody,
                dataEncryptionKey: encodeBase64(encryptedKey, 'base64'),
            };
            
            // Send to server
            const artifact = await createArtifact(this.credentials, request);
            
            // Add to local storage
            const decryptedArtifact: DecryptedArtifact = {
                id: artifact.id,
                title,
                sessions,
                draft,
                body,
                headerVersion: artifact.headerVersion,
                bodyVersion: artifact.bodyVersion,
                seq: artifact.seq,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt,
                isDecrypted: true,
            };
            
            storage.getState().addArtifact(decryptedArtifact);
            
            return artifactId;
        } catch (error) {
            console.error('Failed to create artifact:', error);
            throw error;
        }
    }

    public async updateArtifact(
        artifactId: string, 
        title: string | null, 
        body: string | null,
        sessions?: string[],
        draft?: boolean
    ): Promise<void> {
        if (!this.credentials) {
            throw new Error('Not authenticated');
        }

        try {
            // Get current artifact to get versions and encryption key
            const currentArtifact = storage.getState().artifacts[artifactId];
            if (!currentArtifact) {
                throw new Error('Artifact not found');
            }

            // Get the data encryption key from memory or fetch it
            let dataEncryptionKey = this.artifactDataKeys.get(artifactId);
            
            // Fetch full artifact if we don't have version info or encryption key
            let headerVersion = currentArtifact.headerVersion;
            let bodyVersion = currentArtifact.bodyVersion;
            
            if (headerVersion === undefined || bodyVersion === undefined || !dataEncryptionKey) {
                const fullArtifact = await fetchArtifact(this.credentials, artifactId);
                headerVersion = fullArtifact.headerVersion;
                bodyVersion = fullArtifact.bodyVersion;
                
                // Decrypt and store the data encryption key if we don't have it
                if (!dataEncryptionKey) {
                    const decryptedKey = await this.encryption.decryptEncryptionKey(fullArtifact.dataEncryptionKey);
                    if (!decryptedKey) {
                        throw new Error('Failed to decrypt encryption key');
                    }
                    this.artifactDataKeys.set(artifactId, decryptedKey);
                    dataEncryptionKey = decryptedKey;
                }
            }

            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

            // Prepare update request
            const updateRequest: ArtifactUpdateRequest = {};
            
            // Check if header needs updating (title, sessions, or draft changed)
            if (title !== currentArtifact.title || 
                JSON.stringify(sessions) !== JSON.stringify(currentArtifact.sessions) ||
                draft !== currentArtifact.draft) {
                const encryptedHeader = await artifactEncryption.encryptHeader({ 
                    title, 
                    sessions, 
                    draft 
                });
                updateRequest.header = encryptedHeader;
                updateRequest.expectedHeaderVersion = headerVersion;
            }

            // Only update body if it changed
            if (body !== currentArtifact.body) {
                const encryptedBody = await artifactEncryption.encryptBody({ body });
                updateRequest.body = encryptedBody;
                updateRequest.expectedBodyVersion = bodyVersion;
            }

            // Skip if no changes
            if (Object.keys(updateRequest).length === 0) {
                return;
            }

            // Send update to server
            const response = await updateArtifact(this.credentials, artifactId, updateRequest);
            
            if (!response.success) {
                // Handle version mismatch
                if (response.error === 'version-mismatch') {
                    throw new Error('Artifact was modified by another client. Please refresh and try again.');
                }
                throw new Error('Failed to update artifact');
            }

            // Update local storage
            const updatedArtifact: DecryptedArtifact = {
                ...currentArtifact,
                title,
                sessions,
                draft,
                body,
                headerVersion: response.headerVersion !== undefined ? response.headerVersion : headerVersion,
                bodyVersion: response.bodyVersion !== undefined ? response.bodyVersion : bodyVersion,
                updatedAt: Date.now(),
            };
            
            storage.getState().updateArtifact(updatedArtifact);
        } catch (error) {
            console.error('Failed to update artifact:', error);
            throw error;
        }
    }

    private fetchMachines = async () => {
        if (!this.credentials) return;

        console.log('📊 Sync: Fetching machines...');
        const API_ENDPOINT = getServerUrl();
        const response = await fetch(`${API_ENDPOINT}/v1/machines`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch machines: ${response.status}`);
            return;
        }

        const data = await response.json();
        console.log(`📊 Sync: Fetched ${Array.isArray(data) ? data.length : 0} machines from server`);
        const machines = data as Array<{
            id: string;
            metadata: string;
            metadataVersion: number;
            daemonState?: string | null;
            daemonStateVersion?: number;
            dataEncryptionKey?: string | null; // Add support for per-machine encryption keys
            seq: number;
            active: boolean;
            activeAt: number;  // Changed from lastActiveAt
            createdAt: number;
            updatedAt: number;
        }>;

        // First, collect and decrypt encryption keys for all machines
        const machineKeysMap = new Map<string, Uint8Array | null>();
        for (const machine of machines) {
            if (machine.dataEncryptionKey) {
                const decryptedKey = await this.encryption.decryptEncryptionKey(machine.dataEncryptionKey);
                if (!decryptedKey) {
                    console.error(`Failed to decrypt data encryption key for machine ${machine.id}`);
                    continue;
                }
                machineKeysMap.set(machine.id, decryptedKey);
                this.machineDataKeys.set(machine.id, decryptedKey);
            } else {
                machineKeysMap.set(machine.id, null);
            }
        }

        // Initialize machine encryptions
        await this.encryption.initializeMachines(machineKeysMap);

        // Process all machines first, then update state once
        const decryptedMachines: Machine[] = [];

        for (const machine of machines) {
            // Get machine-specific encryption (might exist from previous initialization)
            const machineEncryption = this.encryption.getMachineEncryption(machine.id);
            if (!machineEncryption) {
                console.error(`Machine encryption not found for ${machine.id} - this should never happen`);
                continue;
            }

            try {

                // Use machine-specific encryption (which handles fallback internally)
                const metadata = machine.metadata
                    ? await machineEncryption.decryptMetadata(machine.metadataVersion, machine.metadata)
                    : null;

                const daemonState = machine.daemonState
                    ? await machineEncryption.decryptDaemonState(machine.daemonStateVersion || 0, machine.daemonState)
                    : null;

                decryptedMachines.push({
                    id: machine.id,
                    seq: machine.seq,
                    createdAt: machine.createdAt,
                    updatedAt: machine.updatedAt,
                    active: machine.active,
                    activeAt: machine.activeAt,
                    metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState,
                    daemonStateVersion: machine.daemonStateVersion || 0
                });
            } catch (error) {
                console.error(`Failed to decrypt machine ${machine.id}:`, error);
                // Still add the machine with null metadata
                decryptedMachines.push({
                    id: machine.id,
                    seq: machine.seq,
                    createdAt: machine.createdAt,
                    updatedAt: machine.updatedAt,
                    active: machine.active,
                    activeAt: machine.activeAt,
                    metadata: null,
                    metadataVersion: machine.metadataVersion,
                    daemonState: null,
                    daemonStateVersion: 0
                });
            }
        }

        // Replace entire machine state with fetched machines
        storage.getState().applyMachines(decryptedMachines, true);
        log.log(`🖥️ fetchMachines completed - processed ${decryptedMachines.length} machines`);
    }

    private fetchFriends = async () => {
        if (!this.credentials) return;
        
        try {
            log.log('👥 Fetching friends list...');
            const friendsList = await getFriendsList(this.credentials);
            storage.getState().applyFriends(friendsList);
            log.log(`👥 fetchFriends completed - processed ${friendsList.length} friends`);
        } catch (error) {
            console.error('Failed to fetch friends:', error);
            // Silently handle error - UI will show appropriate state
        }
    }

    private fetchFriendRequests = async () => {
        // Friend requests are now included in the friends list with status='pending'
        // This method is kept for backward compatibility but does nothing
        log.log('👥 fetchFriendRequests called - now handled by fetchFriends');
    }

    private fetchOpenClawMachines = async () => {
        if (!this.credentials) return;

        console.log('🤖 Sync: Fetching OpenClaw machines...');
        const API_ENDPOINT = getServerUrl();
        const response = await fetch(`${API_ENDPOINT}/v1/openclaw/machines`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch OpenClaw machines: ${response.status}`);
            return;
        }

        const rawMachines = await response.json() as Array<{
            id: string;
            type: string;
            happyMachineId: string | null;
            directConfig: string | null;
            metadata: string;
            metadataVersion: number;
            pairingData: string | null;
            dataEncryptionKey: string | null;
            seq: number;
            createdAt: number;
            updatedAt: number;
        }>;
        console.log(`🤖 Sync: Fetched ${rawMachines.length} OpenClaw machines from server`);

        // Decrypt and process machines
        const decryptedMachines: Array<{
            id: string;
            type: 'happy' | 'direct';
            happyMachineId: string | null;
            gatewayToken: string | null;
            directConfig: any | null;
            metadata: any | null;
            metadataVersion: number;
            pairingData: any | null;
            seq: number;
            createdAt: number;
            updatedAt: number;
        }> = [];

        for (const raw of rawMachines) {
            try {
                // Decrypt the data encryption key if present
                let dataKey: Uint8Array | null = null;
                if (raw.dataEncryptionKey) {
                    dataKey = await this.encryption.decryptEncryptionKey(raw.dataEncryptionKey);
                    if (dataKey) {
                        this.openClawMachineDataKeys.set(raw.id, dataKey);
                    }
                }

                if (!dataKey) {
                    console.error(`No data encryption key for OpenClaw machine ${raw.id}`);
                    continue;
                }

                // Create encryptor for decrypting fields
                const encryptor = await this.encryption.openEncryption(dataKey);

                // Decrypt fields
                let metadata: any | null = null;
                if (raw.metadata) {
                    const decoded = decodeBase64(raw.metadata);
                    const results = await encryptor.decrypt([decoded]);
                    metadata = results[0];
                }

                let directConfig: any | null = null;
                if (raw.directConfig) {
                    const decoded = decodeBase64(raw.directConfig);
                    const results = await encryptor.decrypt([decoded]);
                    directConfig = results[0];
                }

                let pairingData: any | null = null;
                if (raw.pairingData) {
                    const decoded = decodeBase64(raw.pairingData);
                    const results = await encryptor.decrypt([decoded]);
                    pairingData = results[0];
                }

                decryptedMachines.push({
                    id: raw.id,
                    type: raw.type as 'happy' | 'direct',
                    happyMachineId: raw.happyMachineId,
                    gatewayToken: null, // Stored locally only, not synced
                    directConfig,
                    metadata,
                    metadataVersion: raw.metadataVersion,
                    pairingData,
                    seq: raw.seq,
                    createdAt: raw.createdAt,
                    updatedAt: raw.updatedAt,
                });
            } catch (error) {
                console.error(`Failed to decrypt OpenClaw machine ${raw.id}:`, error);
            }
        }

        storage.getState().applyOpenClawMachines(decryptedMachines, true);
        log.log(`🤖 fetchOpenClawMachines completed - processed ${decryptedMachines.length} machines`);
    }

    /**
     * Create a new OpenClaw machine
     */
    public async createOpenClawMachine(params: {
        type: 'happy' | 'direct';
        happyMachineId?: string;
        directConfig?: { url: string; token?: string };
        metadata: { name: string; gatewayToken?: string };
        pairingData?: { deviceId: string; publicKey: string; privateKey: string };
    }): Promise<string> {
        if (!this.credentials || !this.encryption) {
            throw new Error('Not authenticated');
        }

        const encryptionAdapter = {
            decryptWithKey: async (encryptedData: string, key: Uint8Array): Promise<unknown> => {
                const encryptor = await this.encryption.openEncryption(key);
                const decoded = decodeBase64(encryptedData);
                const results = await encryptor.decrypt([decoded]);
                return results[0];
            },
            encryptWithKey: async (data: unknown, key: Uint8Array): Promise<string> => {
                const encryptor = await this.encryption.openEncryption(key);
                const results = await encryptor.encrypt([data]);
                return encodeBase64(results[0]);
            },
            decryptEncryptionKey: async (encryptedKey: string): Promise<Uint8Array | null> => {
                return this.encryption.decryptEncryptionKey(encryptedKey);
            },
            generateDataKey: async () => {
                // Generate 256-bit key for AES-256
                const key = getRandomBytes(32);
                const encryptedKey = await this.encryption.encryptEncryptionKey(key);
                return { key, encryptedKey: encodeBase64(encryptedKey, 'base64') };
            },
        };

        const machine = await createOpenClawMachine(
            this.credentials,
            encryptionAdapter,
            {
                type: params.type,
                happyMachineId: params.happyMachineId,
                directConfig: params.directConfig,
                metadata: params.metadata,
                pairingData: params.pairingData,
            }
        );

        if (machine) {
            storage.getState().applyOpenClawMachines([machine]);
            log.log(`🤖 Created OpenClaw machine ${machine.id}`);
            return machine.id;
        }

        throw new Error('Failed to create OpenClaw machine');
    }

    /**
     * Update a OpenClaw machine's metadata and/or direct config
     */
    public async updateOpenClawMachine(
        machineId: string,
        updates: {
            name?: string;
            gatewayToken?: string;
            directConfig?: { url: string; password?: string };
        }
    ): Promise<void> {
        if (!this.credentials || !this.encryption) {
            throw new Error('Not authenticated');
        }

        // Get current machine from storage
        const currentMachine = storage.getState().openClawMachines[machineId];
        if (!currentMachine) {
            throw new Error('Machine not found');
        }

        // Get data encryption key
        const dataKey = this.openClawMachineDataKeys.get(machineId);
        if (!dataKey) {
            throw new Error('Encryption key not found for machine');
        }

        const encryptionAdapter = {
            decryptWithKey: async (encryptedData: string, key: Uint8Array): Promise<unknown> => {
                const encryptor = await this.encryption.openEncryption(key);
                const decoded = decodeBase64(encryptedData);
                const results = await encryptor.decrypt([decoded]);
                return results[0];
            },
            encryptWithKey: async (data: unknown, key: Uint8Array): Promise<string> => {
                const encryptor = await this.encryption.openEncryption(key);
                const results = await encryptor.encrypt([data]);
                return encodeBase64(results[0]);
            },
            decryptEncryptionKey: async (encryptedKey: string): Promise<Uint8Array | null> => {
                return this.encryption.decryptEncryptionKey(encryptedKey);
            },
            generateDataKey: async () => {
                const key = getRandomBytes(32);
                const encryptedKey = await this.encryption.encryptEncryptionKey(key);
                return { key, encryptedKey: encodeBase64(encryptedKey, 'base64') };
            },
        };

        // Build updated metadata if name or gatewayToken is provided
        const updatedMetadata = (updates.name !== undefined || updates.gatewayToken !== undefined) ? {
            ...currentMachine.metadata,
            name: updates.name ?? currentMachine.metadata?.name ?? '',
            gatewayToken: updates.gatewayToken !== undefined ? (updates.gatewayToken || undefined) : currentMachine.metadata?.gatewayToken,
        } : undefined;

        // Build updated directConfig if provided
        const updatedDirectConfig = updates.directConfig !== undefined ? {
            url: updates.directConfig.url,
            password: updates.directConfig.password,
        } : undefined;

        const updatedMachine = await updateOpenClawMachine(
            this.credentials,
            encryptionAdapter,
            machineId,
            dataKey,
            currentMachine.metadataVersion,
            {
                metadata: updatedMetadata,
                directConfig: updatedDirectConfig,
            }
        );

        if (updatedMachine) {
            storage.getState().applyOpenClawMachines([updatedMachine]);
            log.log(`🤖 Updated OpenClaw machine ${machineId}`);
        } else {
            throw new Error('Failed to update OpenClaw machine');
        }
    }

    /**
     * Delete a OpenClaw machine
     */
    public async deleteOpenClawMachine(machineId: string): Promise<void> {
        if (!this.credentials) {
            throw new Error('Not authenticated');
        }

        const success = await deleteOpenClawMachine(this.credentials, machineId);

        if (success) {
            storage.getState().removeOpenClawMachine(machineId);
            this.openClawMachineDataKeys.delete(machineId);
            log.log(`🤖 Deleted OpenClaw machine ${machineId}`);
        } else {
            throw new Error('Failed to delete OpenClaw machine');
        }
    }

    private fetchFeed = async () => {
        if (!this.credentials) return;

        try {
            // Full refresh mode: treat as fresh load (ignore existing cursors)
            const isFullRefresh = this.feedFullRefresh;
            this.feedFullRefresh = false;

            log.log('📰 Fetching feed...' + (isFullRefresh ? ' (full refresh)' : ''));
            const state = storage.getState();
            const existingItems = state.feedItems;
            const head = isFullRefresh ? null : state.feedHead;

            // Load feed items - if we have a head, load newer items
            let allItems: FeedItem[] = [];
            let hasMore = true;
            let cursor = head ? { after: head } : undefined;
            let loadedCount = 0;
            const maxItems = 500;

            // Keep loading until we reach known items or hit max limit
            while (hasMore && loadedCount < maxItems) {
                const response = await fetchFeed(this.credentials, {
                    limit: 100,
                    ...cursor
                });

                // Check if we reached known items
                const foundKnown = response.items.some(item =>
                    existingItems.some(existing => existing.id === item.id)
                );

                allItems.push(...response.items);
                loadedCount += response.items.length;
                hasMore = response.hasMore && !foundKnown;

                // Update cursor for next page
                if (response.items.length > 0) {
                    const lastItem = response.items[response.items.length - 1];
                    cursor = { after: lastItem.cursor };
                }
            }

            // If this is initial load (no head), also load older items
            if (!head && allItems.length < 100) {
                const response = await fetchFeed(this.credentials, {
                    limit: 100
                });
                const existingIds = new Set(allItems.map(i => i.id));
                response.items.forEach(item => {
                    if (!existingIds.has(item.id)) {
                        allItems.push(item);
                    }
                });
            }
            
            // Collect user IDs from friend-related feed items
            const userIds = new Set<string>();
            allItems.forEach(item => {
                if (item.body && (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')) {
                    userIds.add(item.body.uid);
                }
            });
            
            // Fetch missing users
            if (userIds.size > 0) {
                await this.assumeUsers(Array.from(userIds));
            }
            
            // Filter out items where user is not found (404)
            const users = storage.getState().users;
            const compatibleItems = allItems.filter(item => {
                // Keep text items
                if (item.body.kind === 'text') return true;
                
                // For friend-related items, check if user exists and is not null (404)
                if (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted') {
                    const userProfile = users[item.body.uid];
                    // Keep item only if user exists and is not null
                    return userProfile !== null && userProfile !== undefined;
                }
                
                return true;
            });
            
            // Full refresh replaces all items; incremental merges new ones
            if (isFullRefresh) {
                storage.getState().replaceFeedItems(compatibleItems);
            } else {
                storage.getState().applyFeedItems(compatibleItems);
            }
            log.log(`📰 fetchFeed completed - loaded ${compatibleItems.length} compatible items (${allItems.length - compatibleItems.length} filtered)${isFullRefresh ? ' (replaced)' : ''}`);
        } catch (error) {
            console.error('Failed to fetch feed:', error);
        }
    }

    private syncSessionModeConfig = async () => {
        if (!this.credentials) return;

        let pending = this.pendingSessionModePatches.splice(0);
        const maxRetries = 3;
        let retryCount = 0;
        let didWriteSuccessfully = false;

        if (pending.length > 0) {
            let baseVersion = storage.getState().sessionModeConfigVersion;
            let baseDoc = normalizeSessionModeConfig(storage.getState().sessionModeConfig);

            while (retryCount < maxRetries) {
                const mergedDoc = applySessionModeConfigPatches(baseDoc, pending);
                const value = encodeSessionModeConfigValue(mergedDoc);

                const result = await kvMutate(this.credentials, [{
                    key: SESSION_MODE_CONFIG_KV_KEY,
                    value,
                    version: baseVersion,
                }]);

                if (result.success) {
                    const nextVersion = result.results[0]?.version ?? baseVersion;
                    storage.getState().applySessionModeConfigFromCloud(mergedDoc, nextVersion);
                    pending = [];
                    didWriteSuccessfully = true;
                    break;
                }

                const mismatch = result.errors.find(e => e.key === SESSION_MODE_CONFIG_KV_KEY);
                if (!mismatch) {
                    this.pendingSessionModePatches = [...pending, ...this.pendingSessionModePatches];
                    throw new Error('Failed to update session mode config: missing mismatch payload');
                }

                baseVersion = mismatch.version;
                baseDoc = mismatch.value
                    ? decodeSessionModeConfigValue(mismatch.value)
                    : createEmptySessionModeConfig();

                storage.getState().applySessionModeConfigFromCloud(baseDoc, baseVersion);
                retryCount += 1;
            }

            if (pending.length > 0) {
                this.pendingSessionModePatches = [...pending, ...this.pendingSessionModePatches];
                throw new Error(`Session mode config sync failed after ${maxRetries} retries due to version conflicts`);
            }
        }

        if (didWriteSuccessfully) {
            return;
        }

        const latest = await kvGet(this.credentials, SESSION_MODE_CONFIG_KV_KEY);
        if (!latest) {
            storage.getState().applySessionModeConfigFromCloud(createEmptySessionModeConfig(), -1);
            return;
        }
        const doc = decodeSessionModeConfigValue(latest.value);
        storage.getState().applySessionModeConfigFromCloud(doc, latest.version);
    }

    private syncSessionAppearance = async () => {
        if (!this.credentials) return;

        let pending = this.pendingSessionAppearancePatches.splice(0);
        const maxRetries = 3;
        let retryCount = 0;
        let didWriteSuccessfully = false;

        if (pending.length > 0) {
            let baseVersion = storage.getState().sessionAppearanceVersion;
            let baseDoc = normalizeSessionAppearance(storage.getState().sessionAppearance);

            while (retryCount < maxRetries) {
                const mergedDoc = applySessionAppearancePatches(baseDoc, pending);
                const result = await kvMutate(this.credentials, [{
                    key: SESSION_APPEARANCE_KV_KEY,
                    value: encodeSessionAppearanceValue(mergedDoc),
                    version: baseVersion,
                }]);

                if (result.success) {
                    const nextVersion = result.results[0]?.version ?? baseVersion;
                    storage.getState().applySessionAppearanceFromCloud(mergedDoc, nextVersion);
                    pending = [];
                    didWriteSuccessfully = true;
                    break;
                }

                const mismatch = result.errors.find(error => error.key === SESSION_APPEARANCE_KV_KEY);
                if (!mismatch) {
                    this.pendingSessionAppearancePatches = [...pending, ...this.pendingSessionAppearancePatches];
                    throw new Error('Failed to update session appearance: missing mismatch payload');
                }

                baseVersion = mismatch.version;
                baseDoc = mismatch.value
                    ? decodeSessionAppearanceValue(mismatch.value)
                    : createEmptySessionAppearance();
                storage.getState().applySessionAppearanceFromCloud(baseDoc, baseVersion);
                retryCount += 1;
            }

            if (pending.length > 0) {
                this.pendingSessionAppearancePatches = [...pending, ...this.pendingSessionAppearancePatches];
                throw new Error(`Session appearance sync failed after ${maxRetries} retries due to version conflicts`);
            }
        }

        if (didWriteSuccessfully) return;

        const latest = await kvGet(this.credentials, SESSION_APPEARANCE_KV_KEY);
        if (!latest) {
            storage.getState().applySessionAppearanceFromCloud(createEmptySessionAppearance(), -1);
            return;
        }
        storage.getState().applySessionAppearanceFromCloud(
            decodeSessionAppearanceValue(latest.value),
            latest.version,
        );
    }

    private syncSettings = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        const maxRetries = 3;
        let retryCount = 0;

        // Apply pending settings
        if (Object.keys(this.pendingSettings).length > 0) {

            while (retryCount < maxRetries) {
                let version = storage.getState().settingsVersion;
                let settings = applySettings(storage.getState().settings, this.pendingSettings);
                const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
                    method: 'POST',
                    body: JSON.stringify({
                        settings: await this.encryption.encryptRaw(settings),
                        expectedVersion: version ?? 0
                    }),
                    headers: {
                        'Authorization': `Bearer ${this.credentials.token}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json() as {
                    success: false,
                    error: string,
                    currentVersion: number,
                    currentSettings: string | null
                } | {
                    success: true
                };
                if (data.success) {
                    this.pendingSettings = {};
                    savePendingSettings({});
                    break;
                }
                if (data.error === 'version-mismatch') {
                    // Parse server settings
                    const serverSettings = data.currentSettings
                        ? settingsParse(await this.encryption.decryptRaw(data.currentSettings))
                        : { ...settingsDefaults };

                    // Merge: server base + our pending changes (our changes win)
                    const mergedSettings = applySettings(serverSettings, this.pendingSettings);

                    // Update local storage with merged result at server's version
                    storage.getState().applySettings(mergedSettings, data.currentVersion);

                    // Sync tracking state with merged settings
                    if (tracking) {
                        mergedSettings.analyticsOptOut ? tracking.optOut() : tracking.optIn();
                    }

                    // Log and retry
                    console.log('settings version-mismatch, retrying', {
                        serverVersion: data.currentVersion,
                        retry: retryCount + 1,
                        pendingKeys: Object.keys(this.pendingSettings)
                    });
                    retryCount++;
                    continue;
                } else {
                    throw new Error(`Failed to sync settings: ${data.error}`);
                }
            }
        }

        // If exhausted retries, throw to trigger outer backoff delay
        if (retryCount >= maxRetries) {
            throw new Error(`Settings sync failed after ${maxRetries} retries due to version conflicts`);
        }

        // Run request
        const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch settings: ${response.status}`);
        }
        const data = await response.json() as {
            settings: string | null,
            settingsVersion: number
        };

        // Parse response
        let parsedSettings: Settings;
        if (data.settings) {
            parsedSettings = settingsParse(await this.encryption.decryptRaw(data.settings));
        } else {
            parsedSettings = { ...settingsDefaults };
        }

        // Log
        console.log('settings', JSON.stringify({
            settings: parsedSettings,
            version: data.settingsVersion
        }));

        // Apply settings to storage
        storage.getState().applySettings(parsedSettings, data.settingsVersion);

        // Sync PostHog opt-out state with settings
        if (tracking) {
            if (parsedSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }
    }

    private fetchProfile = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        const response = await fetch(`${API_ENDPOINT}/v1/account/profile`, {
            headers: {
                'Authorization': `Bearer ${this.credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch profile: ${response.status}`);
        }

        const data = await response.json();
        const parsedProfile = profileParse(data);

        // Log profile data for debugging
        console.log('profile', JSON.stringify({
            id: parsedProfile.id,
            timestamp: parsedProfile.timestamp,
            firstName: parsedProfile.firstName,
            lastName: parsedProfile.lastName,
            hasAvatar: !!parsedProfile.avatar,
            hasGitHub: !!parsedProfile.github
        }));

        // Apply profile to storage
        storage.getState().applyProfile(parsedProfile);
    }

    private fetchNativeUpdate = async () => {
        try {
            // Skip in development
            if ((Platform.OS !== 'android' && Platform.OS !== 'ios') || !Constants.expoConfig?.version) {
                return;
            }
            if (Platform.OS === 'ios' && !Constants.expoConfig?.ios?.bundleIdentifier) {
                return;
            }
            if (Platform.OS === 'android' && !Constants.expoConfig?.android?.package) {
                return;
            }

            const serverUrl = getServerUrl();

            // Get platform and app identifiers
            const platform = Platform.OS;
            const version = Constants.expoConfig?.version!;
            const appId = (Platform.OS === 'ios' ? Constants.expoConfig?.ios?.bundleIdentifier! : Constants.expoConfig?.android?.package!);

            const response = await fetch(`${serverUrl}/v1/version`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    platform,
                    version,
                    app_id: appId,
                }),
            });

            if (!response.ok) {
                console.log(`[fetchNativeUpdate] Request failed: ${response.status}`);
                return;
            }

            const data = await response.json();
            console.log('[fetchNativeUpdate] Data:', data);

            // Apply update status to storage
            if (data.update_required && data.update_url) {
                storage.getState().applyNativeUpdateStatus({
                    available: true,
                    updateUrl: data.update_url
                });
            } else {
                storage.getState().applyNativeUpdateStatus({
                    available: false
                });
            }
        } catch (error) {
            console.log('[fetchNativeUpdate] Error:', error);
            storage.getState().applyNativeUpdateStatus(null);
        }
    }

    private upsertMessagesInLocalCache = async (
        sessionId: string,
        messages: ApiMessage[],
        options?: {
            cacheGeneration?: number;
            isCurrent?: () => boolean;
            statePatch?: SessionMessageCacheStatePatch;
        },
    ): Promise<boolean> => {
        if (messages.length === 0 && !options?.statePatch) {
            return true;
        }
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return false;
        }
        const cacheGeneration = options?.cacheGeneration ?? this.getMessageCacheGeneration(sessionId);
        const isCurrent = () =>
            this.isMessageCacheGenerationCurrent(sessionId, cacheGeneration)
            && (options?.isCurrent?.() ?? true);

        try {
            if (!isCurrent()) {
                return false;
            }
            // If a cache clear is already queued/running, wait for it before allowing fresh writes.
            // Stale writers captured before the clear will fail the generation check after the wait.
            await (this.messageCacheResetPromises.get(sessionId) ?? Promise.resolve());
            if (!isCurrent()) {
                return false;
            }
            if (options?.statePatch) {
                await messageRepository.upsertMessagesAndUpdateState(accountKey, sessionId, messages, options.statePatch);
            } else {
                await messageRepository.upsertMessages(accountKey, sessionId, messages);
            }
            this.cachedMessageSearchIndex.delete(sessionId);
            if (!isCurrent()) {
                return false;
            }
            return true;
        } catch (error) {
            console.warn(`Failed to upsert local message cache for ${sessionId}:`, error);
            return false;
        }
    }

    private getCachedMessageState = async (sessionId: string): Promise<SessionMessageCacheState | null> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return null;
        }
        try {
            return await messageRepository.getSessionState(accountKey, sessionId);
        } catch (error) {
            console.warn(`Failed to read local message cache state for ${sessionId}:`, error);
            return null;
        }
    }

    private updateCachedMessageState = async (
        sessionId: string,
        patch: SessionMessageCacheStatePatch,
    ): Promise<SessionMessageCacheState | null> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return null;
        }
        try {
            return await messageRepository.updateSessionState(accountKey, sessionId, patch);
        } catch (error) {
            console.warn(`Failed to update local message cache state for ${sessionId}:`, error);
            return null;
        }
    }

    private readCachedLatestMessages = async (sessionId: string, limit: number): Promise<MessagePage | null> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return null;
        }
        try {
            return await messageRepository.getLatestMessages(accountKey, sessionId, limit);
        } catch (error) {
            console.warn(`Failed to read latest local messages for ${sessionId}:`, error);
            return null;
        }
    }

    private readCachedMessagesBefore = async (sessionId: string, beforeSeq: number, limit: number): Promise<MessagePage | null> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return null;
        }
        try {
            return await messageRepository.getMessagesBefore(accountKey, sessionId, beforeSeq, limit);
        } catch (error) {
            console.warn(`Failed to read older local messages for ${sessionId}:`, error);
            return null;
        }
    }

    private readCachedMessagesAfterCursor = async (sessionId: string, afterSeq: number, limit: number): Promise<MessagePage | null> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return null;
        }
        try {
            return await messageRepository.getMessagesAfter(accountKey, sessionId, afterSeq, limit);
        } catch (error) {
            console.warn(`Failed to read newer local messages for ${sessionId}:`, error);
            return null;
        }
    }

    // Read ALL locally-cached user messages for a session, decrypted+normalized into
    // UserTextMessage objects. Used only to populate the conversation minimap so it can show
    // user prompts that live in the offline cache but haven't been loaded into the message list
    // yet. This deliberately does NOT touch `sessionReceivedMessages` (the dedup set used by
    // `decryptAndNormalizeMessages`): if it did, the real fetch paths would later treat these
    // messages as "already received" and skip applying them to the list.
    getCachedUserMessagesForMinimap = async (sessionId: string): Promise<UserTextMessage[]> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) {
            return [];
        }
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            return [];
        }

        // Skip the (expensive) scan+decrypt when the cache hasn't changed since we last computed it.
        // The cache state's updatedAt bumps on every write, so it's a cheap freshness signature —
        // this keeps refocusing the same session from re-decrypting the whole history each time.
        const cacheState = await this.getCachedMessageState(sessionId);
        const signature = cacheState
            ? `${cacheState.updatedAt}:${cacheState.contiguousMinSeq}:${cacheState.contiguousMaxSeq}:${cacheState.oldestLoadedSeq}`
            : 'empty';
        const memo = this.minimapUserMessagesCache.get(sessionId);
        if (memo && memo.signature === signature) {
            return memo.messages;
        }

        // Proactively seed the minimap with only the newest MAX_USER_MESSAGES prompts. As the user
        // scrolls the list, older prompts are merged in unbounded (via the loaded messages), so the
        // cap only limits what we load up front. Page backwards from the newest message and decrypt
        // PER PAGE so we can stop as soon as we have enough — decryption is the dominant cost, and a
        // long history would otherwise be decrypted in full just to keep the last handful of prompts.
        // MAX_SCAN bounds pathological sparse sessions (few prompts among many tool-call messages).
        const MAX_USER_MESSAGES = 50;
        const MAX_SCAN = 5000;
        const PAGE = Sync.INITIAL_MESSAGES_LIMIT;
        const collectedUserMessages: UserTextMessage[] = [];
        let scanned = 0;
        let hitScanCap = false;
        try {
            let beforeSeq: number | null = null;
            while (collectedUserMessages.length < MAX_USER_MESSAGES) {
                if (scanned >= MAX_SCAN) {
                    hitScanCap = true;
                    break;
                }
                const page: MessagePage | null = beforeSeq === null
                    ? await this.readCachedLatestMessages(sessionId, PAGE)
                    : await this.readCachedMessagesBefore(sessionId, beforeSeq, PAGE);
                if (!page || page.messages.length === 0) {
                    break;
                }
                scanned += page.messages.length;

                // Decrypt this page and pull out top-level user prompts. Build UserTextMessage objects
                // directly from the normalized rows (no reducer): we only need user prompts, so a full
                // reducer pass — traceMessages, sidechain separation, event conversion — would be pure
                // overhead. The real message id also keeps ids stable across refreshes (a fresh reducer
                // would allocate new random ids each run, remounting every marker).
                const decrypted = await encryption.decryptMessages(page.messages);
                for (const item of decrypted) {
                    if (!item) {
                        continue;
                    }
                    const normalized = normalizeRawMessage(item.id, item.localId, item.createdAt, item.content);
                    // Exclude sub-agent (sidechain) prompts, matching what the list shows. `isSidechain`
                    // is set at normalize time and is exactly what the reducer's tracer keys on.
                    if (!normalized || normalized.role !== 'user' || normalized.isSidechain) {
                        continue;
                    }
                    collectedUserMessages.push({
                        kind: 'user-text',
                        id: normalized.id,
                        localId: normalized.localId,
                        createdAt: normalized.createdAt,
                        seq: item.seq,
                        text: normalized.content.text,
                        ...(normalized.meta?.displayText ? { displayText: normalized.meta.displayText } : {}),
                        ...(normalized.content.type === 'mixed' ? { images: normalized.content.images } : {}),
                        meta: normalized.meta,
                        sentBy: item.sentBy,
                        sentByName: item.sentByName,
                    });
                }

                if (!page.hasMoreLocal || page.minSeq === null) {
                    break;
                }
                beforeSeq = page.minSeq;
            }
        } catch (error) {
            console.warn(`Failed to read cached messages for minimap ${sessionId}:`, error);
            return [];
        }
        if (hitScanCap && collectedUserMessages.length < MAX_USER_MESSAGES) {
            log.log(`💬 getCachedUserMessagesForMinimap scanned MAX_SCAN=${MAX_SCAN} cached messages for ${sessionId} without reaching ${MAX_USER_MESSAGES} prompts; older prompts are omitted from the minimap`);
        }

        // Keep only the newest MAX_USER_MESSAGES, ordered oldest→newest (matching the list order).
        collectedUserMessages.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt - b.createdAt);
        const result = collectedUserMessages.length > MAX_USER_MESSAGES
            ? collectedUserMessages.slice(collectedUserMessages.length - MAX_USER_MESSAGES)
            : collectedUserMessages;
        this.minimapUserMessagesCache.set(sessionId, { signature, messages: result });
        return result;
    }

    private getCachedMessageSearchEntries = async (sessionId: string): Promise<CachedMessageSearchEntry[]> => {
        const accountKey = this.getMessageAccountKey();
        if (!accountKey) return [];
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) return [];

        const cacheState = await this.getCachedMessageState(sessionId);
        const signature = cacheState
            ? `${cacheState.updatedAt}:${cacheState.contiguousMinSeq}:${cacheState.contiguousMaxSeq}:${cacheState.oldestLoadedSeq}`
            : 'empty';
        const memo = this.cachedMessageSearchIndex.get(sessionId);
        if (memo?.signature === signature) return memo.entries;

        const PAGE_SIZE = Sync.INITIAL_MESSAGES_LIMIT;
        const entries: CachedMessageSearchEntry[] = [];
        let beforeSeq: number | null = null;

        try {
            while (true) {
                const page: MessagePage | null = beforeSeq === null
                    ? await this.readCachedLatestMessages(sessionId, PAGE_SIZE)
                    : await this.readCachedMessagesBefore(sessionId, beforeSeq, PAGE_SIZE);
                if (!page || page.messages.length === 0) break;

                const decrypted = await encryption.decryptMessages(page.messages);
                for (const item of decrypted) {
                    if (!item) continue;
                    const normalized = normalizeRawMessage(item.id, item.localId, item.createdAt, item.content);
                    if (!normalized) continue;
                    normalized.seq = item.seq;
                    const text = extractCachedMessageText(normalized);
                    if (!text) continue;
                    entries.push({
                        text,
                        normalizedText: normalizeCachedMessageSearchText(text),
                        seq: item.seq ?? 0,
                    });
                }

                if (!page.hasMoreLocal || page.minSeq === null) break;
                beforeSeq = page.minSeq;
            }
        } catch (error) {
            console.warn(`Failed to build cached message search index for ${sessionId}:`, error);
            return [];
        }

        entries.sort((a, b) => b.seq - a.seq);
        this.cachedMessageSearchIndex.set(sessionId, { signature, entries });
        return entries;
    }

    /** Search only locally persisted, already-encrypted message cache. Never makes a network request. */
    searchCachedMessages = async (
        rawQuery: string,
        sessionIds: string[],
        limit = 30,
    ): Promise<CachedMessageSearchMatch[]> => {
        const query = normalizeCachedMessageSearchText(rawQuery);
        if (query.length < 2 || sessionIds.length === 0) return [];

        const matches: CachedMessageSearchMatch[] = [];
        const CONCURRENCY = 3;
        for (let offset = 0; offset < sessionIds.length && matches.length < limit; offset += CONCURRENCY) {
            const batch = sessionIds.slice(offset, offset + CONCURRENCY);
            const batchMatches = await Promise.all(batch.map(async (sessionId) => {
                const entries = await this.getCachedMessageSearchEntries(sessionId);
                const entry = entries.find((candidate) => cachedMessageMatchesQuery(candidate.normalizedText, query));
                return entry
                    ? { sessionId, snippet: cachedMessageSnippet(entry.text, query) }
                    : null;
            }));
            for (const match of batchMatches) {
                if (match) matches.push(match);
                if (matches.length >= limit) break;
            }
        }
        return matches;
    }

    private decryptAndNormalizeMessages = async (
        sessionId: string,
        apiMessages: ApiMessage[],
        encryption: { decryptMessages: (messages: ApiMessage[]) => Promise<any[]> },
    ): Promise<NormalizedMessage[]> => {
        // Collect existing messages for dedup
        let existingMessages = this.sessionReceivedMessages.get(sessionId);
        if (!existingMessages) {
            existingMessages = new Set<string>();
            this.sessionReceivedMessages.set(sessionId, existingMessages);
        }

        // Filter out existing messages and prepare for batch decryption
        const messagesToDecrypt: ApiMessage[] = [];
        for (const msg of [...apiMessages].reverse()) {
            if (!existingMessages.has(msg.id)) {
                messagesToDecrypt.push(msg);
            }
        }

        // Batch decrypt all messages at once
        const start = Date.now();
        const decryptedMessages = await encryption.decryptMessages(messagesToDecrypt);

        // Process decrypted messages
        const normalizedMessages: NormalizedMessage[] = [];
        for (let i = 0; i < decryptedMessages.length; i++) {
            const decrypted = decryptedMessages[i];
            if (decrypted) {
                existingMessages.add(decrypted.id);
                const normalized = normalizeRawMessage(decrypted.id, decrypted.localId, decrypted.createdAt, decrypted.content);
                if (normalized) {
                    normalized.seq = decrypted.seq;
                    normalized.sentBy = decrypted.sentBy;
                    normalized.sentByName = decrypted.sentByName;
                    const deliveryIssue = messagesToDecrypt[i]?.deliveryIssue;
                    if (deliveryIssue?.status === 'error') {
                        normalized.deliveryError = deliveryIssue.reason || 'unknown_error';
                    }
                    normalizedMessages.push(normalized);
                }
            }
        }
        console.log('Batch decrypted and normalized messages in', Date.now() - start, 'ms');

        return normalizedMessages;
    }

    private getSessionMessageLock(sessionId: string): AsyncLock {
        let lock = this.sessionMessageLocks.get(sessionId);
        if (!lock) {
            lock = new AsyncLock();
            this.sessionMessageLocks.set(sessionId, lock);
        }
        return lock;
    }

    // Fetch a page of session messages with a hard timeout and an externally-abortable controller.
    // On timeout (MESSAGE_FETCH_TIMEOUT_MS) or external abort (resetMessagesSync) the request
    // rejects, which propagates as a normal failure so the InvalidateSync backoff retries instead
    // of hanging forever. The timer covers response.json() too, since that body read can also stall.
    private fetchSessionMessages = async (url: string, controller: AbortController, errorLabel: string): Promise<SessionMessagesResponse> => {
        const timer = setTimeout(() => controller.abort(), Sync.MESSAGE_FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this.credentials.token}` },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`${errorLabel}: ${response.status}`);
            }
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    private fetchMessagesV3 = async (sessionId: string) => {
        if (!this.credentials) return;

        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            log.log(`💬 fetchMessagesV3: Session encryption not ready for ${sessionId}, will retry`);
            throw new Error(`Session encryption not ready for ${sessionId}`);
        }

        const controller = new AbortController();
        this.messagesFetchAbort.set(sessionId, controller);
        const lock = this.getSessionMessageLock(sessionId);
        await lock.inLock(async () => {
            // Generation is captured after acquiring the lock; resetMessagesSync bumps it. Re-check
            // via isCurrent() after every awaited boundary and bail before any mutation/apply so a
            // stale run (reset while we were mid-decrypt/await) can't write over a fresh one.
            const generation = this.messagesFetchGeneration.get(sessionId) ?? 0;
            const cacheGeneration = this.getMessageCacheGeneration(sessionId);
            const isCurrent = () => (this.messagesFetchGeneration.get(sessionId) ?? 0) === generation;
            let currentCursor = this.sessionLastSeq.get(sessionId);

            if (currentCursor === undefined) {
                const cachedPage = await this.readCachedLatestMessages(sessionId, Sync.INITIAL_MESSAGES_LIMIT);
                if (!isCurrent()) return;

                if (cachedPage && cachedPage.messages.length > 0) {
                    const cachedState = await this.getCachedMessageState(sessionId);
                    if (!isCurrent()) return;
                    if (!cachedState || !isPageInsideKnownCoverage(cachedState, cachedPage)) {
                        log.log(`💬 fetchMessagesV3 found local messages without verified coverage for ${sessionId}; refreshing from server`);
                    } else {
                        const normalizedMessages = await this.decryptAndNormalizeMessages(sessionId, cachedPage.messages, encryption);
                        if (!isCurrent()) return;

                        const knownMinSeq = getKnownContiguousMinSeq(cachedState);
                        const knownMaxSeq = getKnownContiguousMaxSeq(cachedState);
                        const cachedForwardSeq = clampForwardMaxSeq(knownMaxSeq, cachedPage.maxSeq);
                        const hasMoreOlder = cachedPage.hasMoreLocal || cachedState.hasMoreOlder;

                        await this.enqueueSessionMessageDispatch(sessionId, 'fetchMessagesV3:local-bootstrap', async () => {
                            if (!isCurrent()) return;
                            if (normalizedMessages.length > 0) {
                                this.applyMessages(sessionId, normalizedMessages);
                            }
                            this.sessionLastSeq.set(sessionId, cachedForwardSeq);
                            storage.getState().applyMessagesLoaded(sessionId);
                            storage.getState().setSessionPagination(sessionId, cachedPage.minSeq, hasMoreOlder);
                            await this.updateCachedMessageState(sessionId, {
                                forwardMaxSeq: cachedForwardSeq,
                                oldestLoadedSeq: knownMinSeq,
                                contiguousMinSeq: knownMinSeq,
                                contiguousMaxSeq: knownMaxSeq,
                                remoteOldestSeq: cachedState.remoteOldestSeq,
                                hasMoreOlder: cachedState.hasMoreOlder,
                            });
                        });

                        currentCursor = cachedForwardSeq;
                        log.log(`💬 fetchMessagesV3 restored session ${sessionId} from local cache, lastSeq=${currentCursor}`);
                    }
                }
            }

            if (currentCursor === undefined) {
                // Bootstrap with latest page only to avoid loading very large histories at once.
                // v3 with no after_seq/before_seq returns latest messages in desc order.
                // Remote data is persisted first, then read back from the local message cache for
                // normalization so the durable cache remains the single source for history reads.
                const API_ENDPOINT = getServerUrl();
                const data = await this.fetchSessionMessages(
                    `${API_ENDPOINT}/v3/sessions/${sessionId}/messages?limit=${Sync.INITIAL_MESSAGES_LIMIT}`,
                    controller,
                    'Failed to fetch initial messages',
                );
                if (!isCurrent()) return;
                const apiMessages = (data.messages ?? []) as ApiMessage[];
                const hasMoreOlder: boolean = data.hasMore ?? false;

                const bootstrapMaxSeq = apiMessages.length > 0
                    ? Math.max(...apiMessages.map((m) => m.seq))
                    : null;
                const minSeq = apiMessages.length > 0
                    ? Math.min(...apiMessages.map((m) => m.seq))
                    : null;

                const existingCacheState = await this.getCachedMessageState(sessionId);
                if (!isCurrent()) return;
                const remoteOldestSeq = typeof data.oldestSeq === 'number'
                    ? data.oldestSeq
                    : (!hasMoreOlder ? minSeq : existingCacheState?.remoteOldestSeq ?? null);
                const coveragePatch = buildCoverageStatePatch(existingCacheState, {
                    direction: 'latest',
                    messages: apiMessages,
                    hasMoreOlder,
                    remoteOldestSeq,
                });
                if (!coveragePatch && apiMessages.length > 0) {
                    // The cached coverage no longer connects to the server's latest page (e.g. the
                    // session advanced past a hole while unopened). Retrying with the same stale
                    // coverage would refuse forever, so drop the cached state and let the backoff
                    // retry re-initialize coverage cleanly from this page.
                    console.warn(`💬 fetchMessagesV3 refused to cache non-contiguous bootstrap page for ${sessionId}; clearing stale message cache`);
                    await this.clearSessionMessageCache(sessionId);
                    throw new Error(`Non-contiguous bootstrap message page for ${sessionId}`);
                }
                const cacheWriteOk = coveragePatch
                    ? await this.upsertMessagesInLocalCache(sessionId, apiMessages, { cacheGeneration, isCurrent, statePatch: coveragePatch })
                    : apiMessages.length === 0;
                if (!isCurrent()) return;

                const cachedPage = cacheWriteOk
                    ? await this.readCachedLatestMessages(sessionId, Sync.INITIAL_MESSAGES_LIMIT)
                    : null;
                if (!isCurrent()) return;
                const sourceMessages = cachedPage && cachedPage.messages.length > 0
                    ? cachedPage.messages
                    : apiMessages;
                const normalizedMessages = sourceMessages.length > 0
                    ? await this.decryptAndNormalizeMessages(sessionId, sourceMessages, encryption)
                    : [];
                if (!isCurrent()) return;

                const finalMinSeq = cachedPage?.minSeq ?? minSeq;
                const finalHasMoreOlder = (cachedPage?.hasMoreLocal ?? false) || hasMoreOlder;

                await this.enqueueSessionMessageDispatch(sessionId, 'fetchMessagesV3:bootstrap', async () => {
                    // The dispatch runs later (queue + pacing); a reset may have superseded us in the
                    // meantime, so re-check before applying stale results.
                    if (!isCurrent()) return;
                    if (normalizedMessages.length > 0) {
                        this.applyMessages(sessionId, normalizedMessages);
                    }
                    if (bootstrapMaxSeq !== null) {
                        this.sessionLastSeq.set(sessionId, Math.max(this.sessionLastSeq.get(sessionId) ?? 0, bootstrapMaxSeq));
                    } else if (!this.sessionLastSeq.has(sessionId)) {
                        this.sessionLastSeq.set(sessionId, 0);
                    }
                    storage.getState().applyMessagesLoaded(sessionId);
                    storage.getState().setSessionPagination(sessionId, finalMinSeq, finalHasMoreOlder);
                    if (!coveragePatch) {
                        await this.updateCachedMessageState(sessionId, { invalidatedAt: null });
                    }
                });

                log.log(`💬 fetchMessagesV3 bootstrap completed for session ${sessionId}, lastSeq=${this.sessionLastSeq.get(sessionId) ?? 0}`);
                return;
            }

            let afterSeq = currentCursor;
            let hasMore = true;
            // Highest seq fetched this run. Committed to sessionLastSeq only inside the guarded
            // dispatch (atomically with applyMessages); afterSeq stays local for loop pagination so
            // the persistent cursor never advances past messages that a reset prevented us applying.
            let nextLastSeq = currentCursor;
            const pendingApiMessages: ApiMessage[] = [];

            while (hasMore) {
                const API_ENDPOINT = getServerUrl();
                const data = await this.fetchSessionMessages(
                    `${API_ENDPOINT}/v3/sessions/${sessionId}/messages?after_seq=${afterSeq}&limit=100`,
                    controller,
                    'Failed to fetch v3 messages',
                );
                if (!isCurrent()) return;
                const messages = (data.messages ?? []) as ApiMessage[];
                hasMore = data.hasMore ?? false;

                if (messages.length > 0) {
                    pendingApiMessages.push(...messages);
                    const maxSeq = Math.max(...messages.map((m: any) => m.seq));
                    nextLastSeq = Math.max(nextLastSeq, maxSeq);
                    afterSeq = maxSeq;
                } else {
                    hasMore = false;
                }
            }

            if (!isCurrent()) return;
            const existingCacheState = await this.getCachedMessageState(sessionId);
            if (!isCurrent()) return;
            // cursorSeq proves the pages are the next existing rows above the cursor — seq
            // holes (deleted messages) are not gaps.
            const coverageResolution = resolveNewerCoveragePatch(existingCacheState, pendingApiMessages, currentCursor);
            if (coverageResolution.action === 'reset-stale-coverage') {
                // The persisted coverage no longer connects to the cursor (e.g. the cursor
                // advanced past a lost cache write). Self-invalidating here would re-run
                // immediately with the same cursor and the same state and refuse the same
                // page forever — a zero-delay same-after_seq request loop. Heal like the
                // bootstrap path instead: drop the stale cache and throw, so the backoff-paced
                // retry re-initializes coverage cleanly from this cursor.
                console.warn(`💬 fetchMessagesV3 refused to cache non-contiguous incremental page for ${sessionId}; clearing stale message cache`);
                await this.clearSessionMessageCache(sessionId);
                throw new Error(`Non-contiguous incremental message page for ${sessionId}`);
            }
            const coveragePatch = coverageResolution.action === 'apply' ? coverageResolution.patch : null;
            const cacheWriteOk = await this.upsertMessagesInLocalCache(
                sessionId,
                pendingApiMessages,
                { cacheGeneration, isCurrent, ...(coveragePatch ? { statePatch: coveragePatch } : {}) },
            );
            if (!isCurrent()) return;
            const cachedPage = cacheWriteOk && pendingApiMessages.length > 0
                ? await this.readCachedMessagesAfterCursor(sessionId, currentCursor, Math.max(pendingApiMessages.length, 1000))
                : null;
            if (!isCurrent()) return;
            const sourceMessages = cachedPage && cachedPage.messages.length > 0
                ? cachedPage.messages
                : pendingApiMessages;
            const pendingNormalizedMessages = sourceMessages.length > 0
                ? await this.decryptAndNormalizeMessages(sessionId, sourceMessages, encryption)
                : [];

            if (!isCurrent()) return;
            await this.enqueueSessionMessageDispatch(sessionId, 'fetchMessagesV3:incremental', async () => {
                // The dispatch runs later (queue + pacing); a reset may have superseded us in the
                // meantime, so re-check before applying stale results.
                if (!isCurrent()) return;
                for (const msg of pendingNormalizedMessages) {
                    if (msg.localId) {
                        const pending = this.pendingSendCallbacks.get(msg.localId);
                        if (pending) {
                            this.pendingSendCallbacks.delete(msg.localId);
                            pending();
                        }
                    }
                }

                if (pendingNormalizedMessages.length > 0) {
                    this.applyMessages(sessionId, pendingNormalizedMessages);
                }
                // Commit the cursor atomically with the apply, under the same generation guard.
                const committedSeq = Math.max(this.sessionLastSeq.get(sessionId) ?? 0, nextLastSeq);
                this.sessionLastSeq.set(sessionId, committedSeq);

                storage.getState().applyMessagesLoaded(sessionId);

                // If we got here, cursor-based incremental sync is active and older pagination
                // state should already be established by the initial bootstrap load.
                const sessionState = storage.getState().sessionMessages[sessionId];
                if (sessionState && sessionState.oldestSeq === null) {
                    storage.getState().setSessionPagination(sessionId, 1, false);
                    await this.updateCachedMessageState(sessionId, { oldestLoadedSeq: 1, hasMoreOlder: false });
                }
            });

            log.log(`💬 fetchMessagesV3 completed for session ${sessionId}, lastSeq=${this.sessionLastSeq.get(sessionId) ?? 0}`);
        }).finally(() => {
            // Drop the in-flight aborter only if it's still ours (a concurrent reset may have
            // swapped in a new one).
            if (this.messagesFetchAbort.get(sessionId) === controller) {
                this.messagesFetchAbort.delete(sessionId);
            }
        });
    }


    fetchOlderMessages = async (sessionId: string) => {
        const sessionState = storage.getState().sessionMessages[sessionId];
        if (!sessionState || !sessionState.hasMore || sessionState.oldestSeq === null) {
            return;
        }

        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            return;
        }

        try {
            const cacheGeneration = this.getMessageCacheGeneration(sessionId);
            const isCurrent = () => this.isMessageCacheGenerationCurrent(sessionId, cacheGeneration);
            const before = sessionState.oldestSeq;
            const cachedState = await this.getCachedMessageState(sessionId);
            if (!isCurrent()) return;
            const cachedOlder = await this.readCachedMessagesBefore(sessionId, before, Sync.INITIAL_MESSAGES_LIMIT);
            if (!isCurrent()) return;
            const remoteMayHaveMore = cachedState?.hasMoreOlder ?? true;

            const serveCachedOlderMessages = async (reason: string, page: MessagePage): Promise<void> => {
                const normalizedMessages = await this.decryptAndNormalizeMessages(sessionId, page.messages, encryption);
                if (!isCurrent()) return;
                const hasMore = getCachedOlderPageUiHasMore(page, cachedState);
                const nextOldestLoadedSeq = mergeOldestLoadedSeq(cachedState, page.minSeq);
                const knownMaxSeq = getKnownContiguousMaxSeq(cachedState);
                await this.enqueueSessionMessageDispatch(sessionId, reason, async () => {
                    if (!isCurrent()) return;
                    if (normalizedMessages.length > 0) {
                        this.applyMessages(sessionId, normalizedMessages);
                    }
                    storage.getState().setSessionPagination(sessionId, page.minSeq, hasMore);
                    await this.updateCachedMessageState(sessionId, {
                        // This state tracks whether the *server* may have older messages.  It must
                        // not be flipped back to true merely because there are older rows already
                        // present locally; otherwise a fully cached conversation cannot display its
                        // final short page while offline after reopening.
                        oldestLoadedSeq: nextOldestLoadedSeq,
                        contiguousMinSeq: nextOldestLoadedSeq,
                        contiguousMaxSeq: knownMaxSeq,
                        remoteOldestSeq: cachedState?.remoteOldestSeq ?? null,
                        hasMoreOlder: remoteMayHaveMore,
                    });
                });
                log.log(`💬 fetchOlderMessages restored ${normalizedMessages.length} older local messages for session ${sessionId}, hasMore=${hasMore}`);
            };

            if (cachedOlder && canServeCachedOlderPage(cachedOlder, cachedState, Sync.INITIAL_MESSAGES_LIMIT)) {
                await serveCachedOlderMessages('fetchOlderMessages:local', cachedOlder);
                return;
            }

            const API_ENDPOINT = getServerUrl();
            let data: SessionMessagesResponse;
            try {
                const response = await fetch(
                    `${API_ENDPOINT}/v3/sessions/${sessionId}/messages?before_seq=${before}&limit=${Sync.INITIAL_MESSAGES_LIMIT}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.credentials.token}`
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error(`Failed to fetch older messages: ${response.status}`);
                }

                data = await response.json();
            } catch (error) {
                // If the network is unavailable, still show any local rows we do have.  Keep
                // hasMoreOlder unchanged so reconnecting can continue verifying/filling history.
                if (cachedOlder && canServeCachedOlderPage(cachedOlder, cachedState, Sync.INITIAL_MESSAGES_LIMIT)) {
                    console.warn(`Failed to fetch older messages for ${sessionId}; falling back to local cache:`, error);
                    await serveCachedOlderMessages('fetchOlderMessages:local-fallback', cachedOlder);
                    return;
                }
                throw error;
            }

            if (!isCurrent()) return;
            const apiMessages = (data.messages ?? []) as ApiMessage[];
            const remoteHasMore: boolean = data.hasMore ?? false;
            const remoteOldestSeq = typeof data.oldestSeq === 'number'
                ? data.oldestSeq
                : (!remoteHasMore && apiMessages.length > 0
                    ? Math.min(...apiMessages.map((message) => message.seq))
                    : cachedState?.remoteOldestSeq ?? null);
            const coveragePatch = buildCoverageStatePatch(cachedState, {
                direction: 'older',
                messages: apiMessages,
                hasMoreOlder: remoteHasMore,
                remoteOldestSeq,
                // Proves the page is the next existing rows below `before`, so
                // seq holes (deleted messages) can't be mistaken for gaps.
                cursorSeq: before,
            });
            if (!coveragePatch && apiMessages.length > 0) {
                console.warn(`💬 fetchOlderMessages refused to cache non-contiguous older page for ${sessionId}`);
                return;
            }
            const cacheWriteOk = await this.upsertMessagesInLocalCache(
                sessionId,
                apiMessages,
                { cacheGeneration, isCurrent, ...(coveragePatch ? { statePatch: coveragePatch } : {}) },
            );
            if (!isCurrent()) return;

            // Read the page back from local cache after upsert. If persistence failed (or is
            // unavailable), fall back to the API page so online behavior remains intact.
            const cachedPage = cacheWriteOk
                ? await this.readCachedMessagesBefore(sessionId, before, Sync.INITIAL_MESSAGES_LIMIT)
                : null;
            if (!isCurrent()) return;
            const sourceMessages = cachedPage && cachedPage.messages.length > 0
                ? cachedPage.messages
                : apiMessages;

            // Decrypt and normalize
            const normalizedMessages = await this.decryptAndNormalizeMessages(sessionId, sourceMessages, encryption);
            if (!isCurrent()) return;

            // Update pagination together with the queued list update
            const minSeq = sourceMessages.length > 0
                ? Math.min(...sourceMessages.map(m => m.seq))
                : sessionState.oldestSeq;
            const hasMore = (cachedPage?.hasMoreLocal ?? false) || remoteHasMore;
            await this.enqueueSessionMessageDispatch(sessionId, 'fetchOlderMessages', async () => {
                if (!isCurrent()) return;
                if (normalizedMessages.length > 0) {
                    this.applyMessages(sessionId, normalizedMessages);
                }
                storage.getState().setSessionPagination(sessionId, minSeq, hasMore);
            });

            log.log(`💬 fetchOlderMessages completed for session ${sessionId} - loaded ${normalizedMessages.length} older messages, hasMore=${hasMore}`);
        } catch (error) {
            console.error(`Failed to fetch older messages for session ${sessionId}:`, error);
        }
    }


    public stopPushTokenRegistration = async () => {
        this.pushTokenSync.stop();
        await this.pushTokenRegistrationGate.stop();
    }

    public resumePushTokenRegistration = () => {
        this.pushTokenRegistrationGate = new PushTokenRegistrationGate();
        this.pushTokenSync = new InvalidateSync(async () => {
            await this.pushTokenRegistrationGate.run(
                (signal, startMutation) => this.registerPushToken(signal, startMutation),
            );
        });
        this.pushTokenSync.invalidate();
    }

    private registerPushToken = async (
        signal: AbortSignal,
        startMutation: () => boolean,
    ) => {
        log.log('registerPushToken');
        // Only register on mobile platforms
        if (Platform.OS === 'web') {
            return;
        }

        // Request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        if (signal.aborted) {
            return;
        }
        let finalStatus = existingStatus;
        log.log('existingStatus: ' + JSON.stringify(existingStatus));

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            if (signal.aborted) {
                return;
            }
            finalStatus = status;
        }
        log.log('finalStatus: ' + JSON.stringify(finalStatus));

        if (finalStatus !== 'granted') {
            console.log('Failed to get push token for push notification!');
            return;
        }

        const installationId = getPushInstallationId();

        // Mobile devices prefer DooPush: APNs on iOS and native OEM routing
        // with FCM fallback on Android.
        try {
            const dooPushRegistration = await registerDooPushIfSupported();
            if (signal.aborted) {
                return;
            }
            if (dooPushRegistration) {
                log.log(`DooPush device registration verified (${dooPushRegistration.vendor})`);
                if (!startMutation()) {
                    return;
                }
                await registerPushToken(
                    this.credentials,
                    dooPushRegistration.token,
                    'doopush',
                    installationId,
                    signal,
                );
                log.log('Happy push token binding succeeded');

                const migrationScope = `${getServerUrl()}|${this.serverID}`;
                const cleanupResults = await cleanupSupersededPushTokens({
                    scope: migrationScope,
                    currentToken: dooPushRegistration.token,
                    replacedTokens: dooPushRegistration.replacedTokens ?? [],
                    deleteToken: (token) => deletePushToken(this.credentials, token),
                });
                acknowledgeDooPushTokenCleanup(
                    dooPushRegistration.token,
                    dooPushRegistration.replacedTokens ?? [],
                );
                for (const result of cleanupResults) {
                    if (result.status === 'removed') {
                        log.log('Removed superseded push token');
                    } else {
                        log.log('Failed to remove superseded push token: ' + JSON.stringify(result.error));
                    }
                }

                // Keep an Expo token for older CLIs. The server correlates both
                // providers by installation and returns only one to capable CLIs.
                try {
                    const expoToken = (
                        await Notifications.getExpoPushTokenAsync({
                            projectId: Constants?.expoConfig?.extra?.eas?.projectId
                                ?? Constants?.easConfig?.projectId,
                        })
                    ).data;
                    await registerPushToken(
                        this.credentials,
                        expoToken,
                        'expo',
                        installationId,
                        signal,
                    );
                    markExpoFallbackRegistered(expoToken);
                    log.log('Expo compatibility token registered successfully');
                } catch (error) {
                    log.log('Failed to register Expo compatibility token: ' + JSON.stringify(error));
                }
                return;
            }
        } catch (error) {
            if (signal.aborted) {
                return;
            }
            // Keep Expo as a best-effort fallback so a transient DooPush
            // registration failure does not disable notifications entirely.
            log.log('DooPush registration failed, falling back to Expo: ' + JSON.stringify(error));
        }

        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        if (signal.aborted) {
            return;
        }
        log.log('tokenData: ' + JSON.stringify(tokenData));

        if (!startMutation()) {
            return;
        }
        try {
            await registerPushToken(
                this.credentials,
                tokenData.data,
                'expo',
                installationId,
                signal,
            );
            markExpoFallbackRegistered(tokenData.data);
            log.log('Expo push token registered successfully');
        } catch (error) {
            log.log('Failed to register push token: ' + JSON.stringify(error));
            throw error;
        }
    }

    private subscribeToUpdates = () => {
        // Subscribe to message updates
        apiSocket.onMessage('update', this.handleUpdate.bind(this));
        apiSocket.onMessage('ephemeral', this.handleEphemeralUpdate.bind(this));

        // Subscribe to connection state changes
        apiSocket.onReconnected(() => {
            log.log('🔌 Socket reconnected');
            this.sessionsSync.invalidate();
            this.machinesSync.invalidate();
            log.log('🔌 Socket reconnected: Invalidating artifacts sync');
            this.artifactsSync.invalidate();
            this.friendsSync.invalidate();
            this.friendRequestsSync.invalidate();
            this.feedSync.invalidate();
            if (this.viewingSessionId) {
                this.fetchOrchestratorActivity(this.viewingSessionId);
            }
            const sessionsData = storage.getState().sessionsData;
            if (sessionsData) {
                for (const item of sessionsData) {
                    if (typeof item !== 'string') {
                        this.messagesSync.get(item.id)?.invalidate();
                        this.invalidatePendingMessagesSync(item.id);
                    }
                }
            }
        });

        // Always refresh git status on ANY socket connect (including recovered connections).
        // onReconnected skips recovered connections (socket.recovered=true), but git status
        // local sync state (InvalidateSync, retry counters) may be stuck and needs resetting.
        apiSocket.onStatusChange((status) => {
            if (status === 'connected') {
                gitStatusSync.invalidateForSessions([...Object.keys(storage.getState().sessions), ...Object.keys(storage.getState().sharedSessions)]);
            }
        });
    }

    private handleUpdate = async (update: unknown) => {
        console.log('🔄 Sync: handleUpdate called with:', JSON.stringify(update).substring(0, 300));
        const validatedUpdate = ApiUpdateContainerSchema.safeParse(update);
        if (!validatedUpdate.success) {
            console.log('❌ Sync: Invalid update received:', validatedUpdate.error);
            console.error('❌ Sync: Invalid update data:', update);
            return;
        }
        const updateData = validatedUpdate.data;
        console.log(`🔄 Sync: Validated update type: ${updateData.body.t}`);

        if (updateData.body.t === 'new-message') {
            const sid = updateData.body.sid;
            const incomingSeq = updateData.body.message?.seq;
            const currentLastSeq = this.sessionLastSeq.get(sid);
            const cacheGeneration = this.getMessageCacheGeneration(sid);

            if (currentLastSeq !== undefined && incomingSeq !== undefined) {
                if (incomingSeq <= currentLastSeq) {
                    await this.upsertMessagesInLocalCache(sid, [updateData.body.message], { cacheGeneration });
                    if (!this.isMessageCacheGenerationCurrent(sid, cacheGeneration)) {
                        return;
                    }
                    // Already seen this seq (e.g. echo of our own send), just apply for dedup
                    this.enqueueSessionMessageUpdate(updateData);
                } else if (incomingSeq === currentLastSeq + 1) {
                    const cachedState = await this.getCachedMessageState(sid);
                    const coveragePatch = buildCoverageStatePatch(cachedState, {
                        direction: 'newer',
                        messages: [updateData.body.message],
                    });
                    const wrote = coveragePatch
                        ? await this.upsertMessagesInLocalCache(sid, [updateData.body.message], { cacheGeneration, statePatch: coveragePatch })
                        : false;
                    if (coveragePatch && !this.isMessageCacheGenerationCurrent(sid, cacheGeneration)) {
                        return;
                    }
                    if (wrote) {
                        // Fast path: seq is contiguous, apply directly and bump seq
                        this.sessionLastSeq.set(sid, incomingSeq);
                    } else {
                        // Coverage refused the page, or persistence failed. Bumping the cursor
                        // anyway would let it outrun the persisted coverage max — the stale
                        // state the incremental coverage check then refuses. Keep the cursor
                        // and let the paced fetch deliver and persist this message instead.
                        this.invalidateMessagesSync(sid);
                    }
                    this.enqueueSessionMessageUpdate(updateData);
                } else {
                    // Gap detected: do NOT bump sessionLastSeq — keep the old
                    // cursor so fetchMessagesV3 starts from the last known seq
                    // and fills the gap (current+1..incoming-1).
                    this.enqueueSessionMessageUpdate(updateData);
                    this.invalidateMessagesSync(sid);
                }
            } else {
                // First message or no seq tracking yet — keep cursor unset so
                // fetchMessagesV3 can run bounded bootstrap (latest page only).
                this.enqueueSessionMessageUpdate(updateData);
                this.invalidateMessagesSync(sid);
            }

        } else if (updateData.body.t === 'new-session') {
            log.log('🆕 New session update received');
            this.sessionsSync.invalidate();
        } else if (updateData.body.t === 'delete-session') {
            log.log('🗑️ Delete session update received');
            const sessionId = updateData.body.sid;

            this.applyDeletedSessions([sessionId]);

            log.log(`🗑️ Session ${sessionId} deleted from local storage`);
        } else if (updateData.body.t === 'update-session') {
            const sessionId = updateData.body.id;
            const isShared = !!storage.getState().sharedSessions[sessionId];
            const session = storage.getState().sessions[sessionId]
                ?? storage.getState().sharedSessions[sessionId];
            if (session) {
                // Get session encryption
                const sessionEncryption = this.encryption.getSessionEncryption(sessionId);
                if (!sessionEncryption) {
                    console.error(`Session encryption not found for ${sessionId} - this should never happen`);
                    return;
                }

                const agentState = updateData.body.agentState && sessionEncryption
                    ? await sessionEncryption.decryptAgentState(updateData.body.agentState.version, updateData.body.agentState.value)
                    : session.agentState;
                const metadata = updateData.body.metadata && sessionEncryption
                    ? await sessionEncryption.decryptMetadata(updateData.body.metadata.version, updateData.body.metadata.value)
                    : session.metadata;

                if (updateData.body.capabilities) {
                    try {
                        const decryptedCapabilities = await sessionEncryption.decryptRaw(updateData.body.capabilities.value);
                        const parsedCapabilities = SessionCapabilitiesSchema.safeParse(decryptedCapabilities);
                        if (parsedCapabilities.success) {
                            storage.getState().applySessionCapabilities(
                                sessionId,
                                parsedCapabilities.data,
                                updateData.body.capabilities.version,
                                updateData.createdAt
                            );
                        } else {
                            console.error('❌ Failed to parse session capabilities update:', parsedCapabilities.error);
                        }
                    } catch (error) {
                        console.error('❌ Failed to decrypt session capabilities update:', error);
                    }
                }

                const updatedSession = {
                    ...session,
                    agentState,
                    agentStateVersion: updateData.body.agentState
                        ? updateData.body.agentState.version
                        : session.agentStateVersion,
                    metadata,
                    metadataVersion: updateData.body.metadata
                        ? updateData.body.metadata.version
                        : session.metadataVersion,
                    updatedAt: updateData.createdAt,
                    seq: updateData.seq
                };

                if (isShared) {
                    storage.getState().addSharedSession(updatedSession);
                    // Re-process messages when agentState changes so permission buttons appear
                    if (updateData.body.agentState && storage.getState().sessionMessages[sessionId]?.isLoaded) {
                        void this.enqueueSessionMessageDispatch(sessionId, 'update-session:shared-agent-state', async () => {
                            storage.getState().applyMessages(sessionId, []);
                        });
                    }
                } else {
                    this.applySessions([updatedSession]);
                }

                // If user is viewing this session, keep lastViewedAt fresh
                // so incoming taskCompleted doesn't show a blue dot
                if (this.viewingSessionId === updateData.body.id) {
                    markSessionViewed(updateData.body.id);
                }

                // Invalidate git status when agent state changes (files may have been modified)
                if (updateData.body.agentState) {
                    gitStatusSync.invalidate(updateData.body.id);

                    // Check for new permission requests and notify voice assistant
                    if (agentState?.requests && Object.keys(agentState.requests).length > 0) {
                        const requestIds = Object.keys(agentState.requests);
                        const firstRequest = agentState.requests[requestIds[0]];
                        const toolName = firstRequest?.tool;
                        voiceHooks.onPermissionRequested(updateData.body.id, requestIds[0], toolName, firstRequest?.arguments);
                    }

                    // Re-fetch messages when control returns to mobile (local -> remote mode switch)
                    // This catches up on any messages that were exchanged while desktop had control
                    const wasControlledByUser = session.agentState?.controlledByUser;
                    const isNowControlledByUser = agentState?.controlledByUser;
                    if (!wasControlledByUser && isNowControlledByUser) {
                        log.log(`🔄 Control returned to mobile for session ${updateData.body.id}, re-fetching messages`);
                        this.onSessionVisible(updateData.body.id);
                    }
                }
            }
        } else if (updateData.body.t === 'update-account') {
            const accountUpdate = updateData.body;
            const currentProfile = storage.getState().profile;

            // Build updated profile with new data
            const updatedProfile: Profile = {
                ...currentProfile,
                firstName: accountUpdate.firstName !== undefined ? accountUpdate.firstName : currentProfile.firstName,
                lastName: accountUpdate.lastName !== undefined ? accountUpdate.lastName : currentProfile.lastName,
                avatar: accountUpdate.avatar !== undefined ? accountUpdate.avatar : currentProfile.avatar,
                github: accountUpdate.github !== undefined ? accountUpdate.github : currentProfile.github,
                timestamp: updateData.createdAt // Update timestamp to latest
            };

            // Apply the updated profile to storage
            storage.getState().applyProfile(updatedProfile);

            // Handle settings updates (new for profile sync)
            if (accountUpdate.settings?.value) {
                try {
                    const decryptedSettings = await this.encryption.decryptRaw(accountUpdate.settings.value);
                    const parsedSettings = settingsParse(decryptedSettings);

                    // Version compatibility check
                    const settingsSchemaVersion = parsedSettings.schemaVersion ?? 1;
                    if (settingsSchemaVersion > SUPPORTED_SCHEMA_VERSION) {
                        console.warn(
                            `⚠️ Received settings schema v${settingsSchemaVersion}, ` +
                            `we support v${SUPPORTED_SCHEMA_VERSION}. Update app for full functionality.`
                        );
                    }

                    storage.getState().applySettings(parsedSettings, accountUpdate.settings.version);
                    log.log(`📋 Settings synced from server (schema v${settingsSchemaVersion}, version ${accountUpdate.settings.version})`);
                } catch (error) {
                    console.error('❌ Failed to process settings update:', error);
                    // Don't crash on settings sync errors, just log
                }
            }
        } else if (updateData.body.t === 'kv-batch-update') {
            const modeConfigChange = updateData.body.changes.find((item) => item.key === SESSION_MODE_CONFIG_KV_KEY);
            if (modeConfigChange) {
                const doc = modeConfigChange.value
                    ? decodeSessionModeConfigValue(modeConfigChange.value)
                    : createEmptySessionModeConfig();
                storage.getState().applySessionModeConfigFromCloud(doc, modeConfigChange.version);
            }

            const appearanceChange = updateData.body.changes.find((item) => item.key === SESSION_APPEARANCE_KV_KEY);
            if (appearanceChange) {
                const doc = appearanceChange.value
                    ? decodeSessionAppearanceValue(appearanceChange.value)
                    : createEmptySessionAppearance();
                storage.getState().applySessionAppearanceFromCloud(doc, appearanceChange.version);
            }
        } else if (updateData.body.t === 'new-machine') {
            // Re-fetch all machines to pick up the newly registered device
            this.machinesSync.invalidate();
        } else if (updateData.body.t === 'update-machine') {
            const machineUpdate = updateData.body;
            const machineId = machineUpdate.machineId;  // Changed from .id to .machineId
            const machine = storage.getState().machines[machineId];

            // Create or update machine with all required fields
            const updatedMachine: Machine = {
                id: machineId,
                seq: updateData.seq,
                createdAt: machine?.createdAt ?? updateData.createdAt,
                updatedAt: updateData.createdAt,
                active: machineUpdate.active ?? true,
                activeAt: machineUpdate.activeAt ?? updateData.createdAt,
                metadata: machine?.metadata ?? null,
                metadataVersion: machine?.metadataVersion ?? 0,
                daemonState: machine?.daemonState ?? null,
                daemonStateVersion: machine?.daemonStateVersion ?? 0
            };

            // Get machine-specific encryption (might not exist if machine wasn't initialized)
            const machineEncryption = this.encryption.getMachineEncryption(machineId);
            if (!machineEncryption) {
                // Machine encryption not initialized yet (e.g. machine just registered,
                // fetchMachines still in progress). Re-fetch to pick up the full state.
                this.machinesSync.invalidate();
                return;
            }

            // If metadata is provided, decrypt and update it
            const metadataUpdate = machineUpdate.metadata;
            if (metadataUpdate) {
                try {
                    const metadata = await machineEncryption.decryptMetadata(metadataUpdate.version, metadataUpdate.value);
                    updatedMachine.metadata = metadata;
                    updatedMachine.metadataVersion = metadataUpdate.version;
                } catch (error) {
                    console.error(`Failed to decrypt machine metadata for ${machineId}:`, error);
                }
            }

            // If daemonState is provided, decrypt and update it
            const daemonStateUpdate = machineUpdate.daemonState;
            if (daemonStateUpdate) {
                try {
                    const daemonState = await machineEncryption.decryptDaemonState(daemonStateUpdate.version, daemonStateUpdate.value);
                    updatedMachine.daemonState = daemonState;
                    updatedMachine.daemonStateVersion = daemonStateUpdate.version;
                } catch (error) {
                    console.error(`Failed to decrypt machine daemonState for ${machineId}:`, error);
                }
            }

            // Update storage using applyMachines which rebuilds sessionListViewData
            storage.getState().applyMachines([updatedMachine]);
        } else if (updateData.body.t === 'relationship-updated') {
            log.log('👥 Received relationship-updated update');
            this.friendsSync.invalidate();
            this.friendRequestsSync.invalidate();

            // When relationship is cleared (rejected/cancelled), remove stale feed items locally
            if (updateData.body.status === 'none') {
                const uid = updateData.body.uid;
                const feedItems = storage.getState().feedItems;
                const itemToRemove = feedItems.find(item =>
                    (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')
                    && item.body.uid === uid
                );
                if (itemToRemove) {
                    storage.getState().removeFeedItem(itemToRemove.id);
                }
            }

            this.feedSync.invalidate();
        } else if (updateData.body.t === 'session-shared') {
            log.log('Received session-shared update');
            const { sessionId, sharedBy, accessLevel, encryptedDataKey, createdAt } = updateData.body;

            // Decrypt the shared session's data encryption key
            let decryptedDataKey: Uint8Array | null = null;
            if (encryptedDataKey) {
                try {
                    decryptedDataKey = await this.encryption.decryptEncryptionKey(encryptedDataKey);
                    if (!decryptedDataKey) {
                        console.error(`Failed to decrypt data key for shared session ${sessionId}`);
                    }
                } catch (error) {
                    console.error(`Error decrypting data key for shared session ${sessionId}:`, error);
                }
            }

            // Initialize session encryption if we have the key
            if (decryptedDataKey) {
                this.sessionDataKeys.set(sessionId, decryptedDataKey);
                await this.encryption.initializeSessions(new Map([[sessionId, decryptedDataKey]]));
            }

            // Add to shared sessions in storage
            storage.getState().addSharedSession({
                id: sessionId,
                seq: 0,
                createdAt,
                updatedAt: createdAt,
                active: false,
                activeAt: createdAt,
                metadata: null,
                metadataVersion: 0,
                agentState: null,
                agentStateVersion: 0,
                thinking: false,
                thinkingAt: 0,
                presence: createdAt,
                owner: sharedBy.id,
                ownerProfile: {
                    id: sharedBy.id,
                    username: sharedBy.username ?? null,
                    firstName: sharedBy.firstName ?? '',
                    lastName: sharedBy.lastName,
                    avatar: typeof sharedBy.avatar === 'string' ? sharedBy.avatar : null,
                },
                accessLevel,
            });

            // Refresh shared sessions to get metadata from server
            this.sharedSessionsSync.invalidate();

        } else if (updateData.body.t === 'session-share-updated') {
            log.log('Received session-share-updated');
            const { sessionId, accessLevel } = updateData.body;
            storage.getState().updateSharedSessionAccessLevel(sessionId, accessLevel);

        } else if (updateData.body.t === 'session-share-revoked') {
            log.log('Received session-share-revoked');
            const { sessionId } = updateData.body;
            storage.getState().removeSharedSession(sessionId);

        } else if (updateData.body.t === 'public-share-created') {
            log.log('Received public-share-created');
            const { sessionId } = updateData.body;
            // Optimistically mark session as shared
            const session = storage.getState().sessions[sessionId];
            if (session) {
                storage.getState().applySessions([{ ...session, isShared: true }]);
            }

        } else if (updateData.body.t === 'public-share-updated') {
            log.log('Received public-share-updated');

        } else if (updateData.body.t === 'public-share-deleted') {
            log.log('Received public-share-deleted');
            // Re-fetch sessions to determine accurate isShared state
            this.sessionsSync.invalidate();

        } else if (updateData.body.t === 'new-artifact') {
            log.log('📦 Received new-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            try {
                // Decrypt the data encryption key
                const decryptedKey = await this.encryption.decryptEncryptionKey(artifactUpdate.dataEncryptionKey);
                if (!decryptedKey) {
                    console.error(`Failed to decrypt key for new artifact ${artifactId}`);
                    return;
                }
                
                // Store the decrypted key in memory
                this.artifactDataKeys.set(artifactId, decryptedKey);
                
                // Create artifact encryption instance
                const artifactEncryption = new ArtifactEncryption(decryptedKey);
                
                // Decrypt header
                const header = await artifactEncryption.decryptHeader(artifactUpdate.header);
                
                // Decrypt body if provided
                let decryptedBody: string | null | undefined = undefined;
                if (artifactUpdate.body && artifactUpdate.bodyVersion !== undefined) {
                    const body = await artifactEncryption.decryptBody(artifactUpdate.body);
                    decryptedBody = body?.body || null;
                }
                
                // Add to storage
                const decryptedArtifact: DecryptedArtifact = {
                    id: artifactId,
                    title: header?.title || null,
                    body: decryptedBody,
                    headerVersion: artifactUpdate.headerVersion,
                    bodyVersion: artifactUpdate.bodyVersion,
                    seq: artifactUpdate.seq,
                    createdAt: artifactUpdate.createdAt,
                    updatedAt: artifactUpdate.updatedAt,
                    isDecrypted: !!header,
                };
                
                storage.getState().addArtifact(decryptedArtifact);
                log.log(`📦 Added new artifact ${artifactId} to storage`);
            } catch (error) {
                console.error(`Failed to process new artifact ${artifactId}:`, error);
            }
        } else if (updateData.body.t === 'update-artifact') {
            log.log('📦 Received update-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            // Get existing artifact
            const existingArtifact = storage.getState().artifacts[artifactId];
            if (!existingArtifact) {
                console.error(`Artifact ${artifactId} not found in storage`);
                // Fetch all artifacts to sync
                this.artifactsSync.invalidate();
                return;
            }
            
            try {
                // Get the data encryption key from memory
                let dataEncryptionKey = this.artifactDataKeys.get(artifactId);
                if (!dataEncryptionKey) {
                    console.error(`Encryption key not found for artifact ${artifactId}, fetching artifacts`);
                    this.artifactsSync.invalidate();
                    return;
                }
                
                // Create artifact encryption instance
                const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);
                
                // Update artifact with new data  
                const updatedArtifact: DecryptedArtifact = {
                    ...existingArtifact,
                    seq: updateData.seq,
                    updatedAt: updateData.createdAt,
                };
                
                // Decrypt and update header if provided
                if (artifactUpdate.header) {
                    const header = await artifactEncryption.decryptHeader(artifactUpdate.header.value);
                    updatedArtifact.title = header?.title || null;
                    updatedArtifact.sessions = header?.sessions;
                    updatedArtifact.draft = header?.draft;
                    updatedArtifact.headerVersion = artifactUpdate.header.version;
                }
                
                // Decrypt and update body if provided
                if (artifactUpdate.body) {
                    const body = await artifactEncryption.decryptBody(artifactUpdate.body.value);
                    updatedArtifact.body = body?.body || null;
                    updatedArtifact.bodyVersion = artifactUpdate.body.version;
                }
                
                storage.getState().updateArtifact(updatedArtifact);
                log.log(`📦 Updated artifact ${artifactId} in storage`);
            } catch (error) {
                console.error(`Failed to process artifact update ${artifactId}:`, error);
            }
        } else if (updateData.body.t === 'delete-artifact') {
            log.log('📦 Received delete-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            // Remove from storage
            storage.getState().deleteArtifact(artifactId);
            
            // Remove encryption key from memory
            this.artifactDataKeys.delete(artifactId);
        } else if (updateData.body.t === 'new-feed-post') {
            log.log('📰 Received new-feed-post update');
            const feedUpdate = updateData.body;
            
            // Convert to FeedItem with counter from cursor
            const feedItem: FeedItem = {
                id: feedUpdate.id,
                body: feedUpdate.body,
                cursor: feedUpdate.cursor,
                createdAt: feedUpdate.createdAt,
                repeatKey: feedUpdate.repeatKey ?? null,
                badge: feedUpdate.badge ?? false,
                meta: feedUpdate.meta ?? null,
                counter: parseInt(feedUpdate.cursor.substring(2), 10)
            };
            
            // Check if we need to fetch user for friend-related items
            if (feedItem.body && (feedItem.body.kind === 'friend_request' || feedItem.body.kind === 'friend_accepted')) {
                await this.assumeUsers([feedItem.body.uid]);
                
                // Check if user fetch failed (404) - don't store item if user not found
                const users = storage.getState().users;
                const userProfile = users[feedItem.body.uid];
                if (userProfile === null || userProfile === undefined) {
                    // User was not found or 404, don't store this item
                    log.log(`📰 Skipping feed item ${feedItem.id} - user ${feedItem.body.uid} not found`);
                    return;
                }
            }
            
            // Apply to storage (will handle repeatKey replacement)
            storage.getState().applyFeedItems([feedItem]);
        } else if (updateData.body.t === 'new-openclaw-machine') {
            log.log('🤖 Received new-openclaw-machine update');
            const openClawUpdate = updateData.body;

            try {
                // Create encryption adapter for processing using openEncryption
                const createEncryptionAdapter = async (key: Uint8Array) => {
                    const encryptor = await this.encryption.openEncryption(key);
                    return {
                        decryptWithKey: async (encryptedData: string, _key: Uint8Array): Promise<unknown> => {
                            const decoded = decodeBase64(encryptedData);
                            const results = await encryptor.decrypt([decoded]);
                            return results[0];
                        },
                        encryptWithKey: async (data: unknown, _key: Uint8Array): Promise<string> => {
                            const results = await encryptor.encrypt([data]);
                            return encodeBase64(results[0]);
                        },
                        decryptEncryptionKey: async (encryptedKey: string): Promise<Uint8Array | null> => {
                            return this.encryption.decryptEncryptionKey(encryptedKey);
                        },
                        generateDataKey: async () => {
                            throw new Error('Not needed for receiving events');
                        },
                    };
                };

                // First decrypt the data encryption key
                if (!openClawUpdate.dataEncryptionKey) {
                    console.error('No data encryption key for new OpenClaw machine');
                    return;
                }

                const dataKey = await this.encryption.decryptEncryptionKey(openClawUpdate.dataEncryptionKey);
                if (!dataKey) {
                    console.error('Failed to decrypt data encryption key for new OpenClaw machine');
                    return;
                }

                const encryptionAdapter = await createEncryptionAdapter(dataKey);
                const machine = await processNewOpenClawMachineEvent(openClawUpdate, encryptionAdapter);
                if (machine) {
                    // Store the data encryption key
                    this.openClawMachineDataKeys.set(machine.id, dataKey);

                    storage.getState().applyOpenClawMachines([machine]);
                    log.log(`🤖 Added new OpenClaw machine ${machine.id} to storage`);
                }
            } catch (error) {
                console.error('Failed to process new OpenClaw machine:', error);
            }
        } else if (updateData.body.t === 'update-openclaw-machine') {
            log.log('🤖 Received update-openclaw-machine update');
            const openClawUpdate = updateData.body;
            const machineId = openClawUpdate.machineId;

            // Get existing machine
            const existingMachine = storage.getState().openClawMachines[machineId];
            if (!existingMachine) {
                console.error(`OpenClaw machine ${machineId} not found in storage`);
                // Fetch all machines to sync
                this.openClawMachinesSync.invalidate();
                return;
            }

            // Get the data encryption key from memory
            const dataKey = this.openClawMachineDataKeys.get(machineId);
            if (!dataKey) {
                console.error(`Encryption key not found for OpenClaw machine ${machineId}, fetching machines`);
                this.openClawMachinesSync.invalidate();
                return;
            }

            try {
                // Create encryption adapter using openEncryption
                const encryptor = await this.encryption.openEncryption(dataKey);
                const encryptionAdapter = {
                    decryptWithKey: async (encryptedData: string, _key: Uint8Array): Promise<unknown> => {
                        const decoded = decodeBase64(encryptedData);
                        const results = await encryptor.decrypt([decoded]);
                        return results[0];
                    },
                    encryptWithKey: async (data: unknown, _key: Uint8Array): Promise<string> => {
                        const results = await encryptor.encrypt([data]);
                        return encodeBase64(results[0]);
                    },
                    decryptEncryptionKey: async (encryptedKey: string): Promise<Uint8Array | null> => {
                        return this.encryption.decryptEncryptionKey(encryptedKey);
                    },
                    generateDataKey: async () => {
                        throw new Error('Not needed for receiving events');
                    },
                };

                const updatedMachine = await processUpdateOpenClawMachineEvent(
                    openClawUpdate,
                    existingMachine,
                    encryptionAdapter,
                    dataKey
                );

                storage.getState().applyOpenClawMachines([updatedMachine]);
                log.log(`🤖 Updated OpenClaw machine ${machineId} in storage`);
            } catch (error) {
                console.error(`Failed to process OpenClaw machine update ${machineId}:`, error);
            }
        } else if (updateData.body.t === 'delete-openclaw-machine') {
            log.log('🤖 Received delete-openclaw-machine update');
            const openClawUpdate = updateData.body;
            const machineId = openClawUpdate.machineId;

            // Remove from storage
            storage.getState().removeOpenClawMachine(machineId);

            // Remove encryption key from memory
            this.openClawMachineDataKeys.delete(machineId);

            log.log(`🤖 Deleted OpenClaw machine ${machineId} from storage`);
        }
    }

    private enqueueSessionMessageUpdate = (updateData: ApiUpdateContainer) => {
        if (updateData.body.t !== 'new-message') {
            return;
        }
        const sid = updateData.body.sid;
        const queue = this.sessionMessageUpdateQueues.get(sid);
        if (queue) {
            queue.push(updateData);
        } else {
            this.sessionMessageUpdateQueues.set(sid, [updateData]);
        }
        if (!this.sessionMessageQueueRunning.has(sid)) {
            void this.processSessionMessageQueue(sid);
        }
    }

    private processSessionMessageQueue = async (sessionId: string) => {
        if (this.sessionMessageQueueRunning.has(sessionId)) {
            return;
        }
        this.sessionMessageQueueRunning.add(sessionId);
        try {
            while (true) {
                const queue = this.sessionMessageUpdateQueues.get(sessionId);
                if (!queue || queue.length === 0) {
                    this.sessionMessageUpdateQueues.delete(sessionId);
                    break;
                }

                const batch = queue.splice(0, queue.length);
                await this.applyNewMessageUpdates(sessionId, batch);
            }
        } finally {
            this.sessionMessageQueueRunning.delete(sessionId);
            if ((this.sessionMessageUpdateQueues.get(sessionId)?.length ?? 0) > 0) {
                void this.processSessionMessageQueue(sessionId);
            }
        }
    }

    private resetSessionMessageDispatch = (sessionId: string) => {
        const queue = this.sessionMessageDispatchQueues.get(sessionId);
        if (queue) {
            for (const task of queue) {
                task.resolve();
            }
            this.sessionMessageDispatchQueues.delete(sessionId);
        }

        // Don't clear an in-flight delay timer here: processSessionMessageDispatchQueue may
        // already be awaiting it. Let the timer resolve naturally, then generation-check skip
        // any stale work and continue with the fresh queue state.
        this.sessionMessageDispatchGeneration.set(sessionId, (this.sessionMessageDispatchGeneration.get(sessionId) ?? 0) + 1);

        // Clear last-run timestamp so the first message after reset executes immediately.
        this.sessionMessageDispatchLastRunAt.delete(sessionId);
    }

    private enqueueSessionMessageDispatch = (
        sessionId: string,
        reason: string,
        run: () => Promise<void> | void,
    ): Promise<void> => {
        const generation = this.sessionMessageDispatchGeneration.get(sessionId) ?? 0;

        return new Promise<void>((resolve) => {
            const queue = this.sessionMessageDispatchQueues.get(sessionId);
            const task: SessionMessageDispatchTask = {
                reason,
                generation,
                run,
                resolve,
            };

            if (queue) {
                queue.push(task);
            } else {
                this.sessionMessageDispatchQueues.set(sessionId, [task]);
            }

            if (!this.sessionMessageDispatchRunning.has(sessionId)) {
                void this.processSessionMessageDispatchQueue(sessionId);
            }
        });
    }

    private waitForSessionMessageDispatchInterval = (sessionId: string) => {
        return new Promise<void>((resolve) => {
            const existingTimer = this.sessionMessageDispatchTimers.get(sessionId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                this.sessionMessageDispatchTimers.delete(sessionId);
                resolve();
            }, Sync.MESSAGE_LIST_DISPATCH_INTERVAL_MS);

            this.sessionMessageDispatchTimers.set(sessionId, timer);
        });
    }

    private processSessionMessageDispatchQueue = async (sessionId: string) => {
        if (this.sessionMessageDispatchRunning.has(sessionId)) {
            return;
        }

        this.sessionMessageDispatchRunning.add(sessionId);

        try {
            while (true) {
                const queue = this.sessionMessageDispatchQueues.get(sessionId);
                const next = queue?.shift();
                if (!next) {
                    this.sessionMessageDispatchQueues.delete(sessionId);
                    break;
                }

                // Enforce minimum interval since the last dispatch, even across
                // queue cycles.  Without this, each cycle's first task would
                // execute immediately, allowing back-to-back store updates that
                // break maintainVisibleContentPosition auto-scroll.
                const lastRunAt = this.sessionMessageDispatchLastRunAt.get(sessionId) ?? 0;
                const elapsed = performance.now() - lastRunAt;
                if (lastRunAt > 0 && elapsed < Sync.MESSAGE_LIST_DISPATCH_INTERVAL_MS) {
                    const remaining = Sync.MESSAGE_LIST_DISPATCH_INTERVAL_MS - elapsed;
                    await new Promise<void>(r => setTimeout(r, remaining));
                }

                const currentGeneration = this.sessionMessageDispatchGeneration.get(sessionId) ?? 0;
                if (next.generation !== currentGeneration) {
                    next.resolve();
                    continue;
                }

                try {
                    await next.run();
                } catch (error) {
                    console.error(`Failed to run session message dispatch (${next.reason}) for ${sessionId}:`, error);
                } finally {
                    this.sessionMessageDispatchLastRunAt.set(sessionId, performance.now());
                    next.resolve();
                }
            }
        } finally {
            this.sessionMessageDispatchRunning.delete(sessionId);
            const timer = this.sessionMessageDispatchTimers.get(sessionId);
            if (timer) {
                clearTimeout(timer);
                this.sessionMessageDispatchTimers.delete(sessionId);
            }
            if ((this.sessionMessageDispatchQueues.get(sessionId)?.length ?? 0) > 0) {
                void this.processSessionMessageDispatchQueue(sessionId);
            }
        }
    }

    private applyNewMessageUpdates = async (sessionId: string, updates: ApiUpdateContainer[]) => {
        if (updates.length === 0) {
            return;
        }

        // Get encryption
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) { // Should never happen
            console.error(`Session ${sessionId} not found`);
            this.sessionsSync.invalidate(); // Just fetch sessions again
            return;
        }

        const preparedUpdates: PreparedNewMessageUpdate[] = [];

        for (const updateData of updates) {
            if (updateData.body.t !== 'new-message' || updateData.body.sid !== sessionId) {
                continue;
            }

            // Decrypt message (outside lock — idempotent and potentially slow)
            let lastMessage: NormalizedMessage | null = null;
            let isTaskComplete = false;
            let isTaskStarted = false;
            if (updateData.body.message) {
                const decrypted = await encryption.decryptMessage(updateData.body.message);
                if (decrypted) {
                    let existingMessages = this.sessionReceivedMessages.get(sessionId);
                    if (!existingMessages) {
                        existingMessages = new Set<string>();
                        this.sessionReceivedMessages.set(sessionId, existingMessages);
                    }
                    existingMessages.add(decrypted.id);

                    lastMessage = normalizeRawMessage(decrypted.id, decrypted.localId, decrypted.createdAt, decrypted.content);
                    if (lastMessage) {
                        lastMessage.seq = decrypted.seq;
                        lastMessage.sentBy = decrypted.sentBy;
                        lastMessage.sentByName = decrypted.sentByName;
                        if (updateData.body.message.deliveryIssue?.status === 'error') {
                            lastMessage.deliveryError = updateData.body.message.deliveryIssue.reason || 'unknown_error';
                        }
                    }

                    // Check for task lifecycle events to update thinking state
                    // This ensures UI updates even if volatile activity updates are lost
                    const rawContent = decrypted.content as { role?: string; content?: { type?: string; data?: { type?: string } } } | null;
                    const contentType = rawContent?.content?.type;
                    const dataType = rawContent?.content?.data?.type;

                    // Debug logging to trace lifecycle events
                    if (dataType === 'task_complete' || dataType === 'turn_aborted' || dataType === 'task_started') {
                        console.log(`🔄 [Sync] Lifecycle event detected: contentType=${contentType}, dataType=${dataType}`);
                    }

                    isTaskComplete =
                        ((contentType === 'acp' || contentType === 'codex') &&
                            (dataType === 'task_complete' || dataType === 'turn_aborted'));

                    isTaskStarted =
                        ((contentType === 'acp' || contentType === 'codex') && dataType === 'task_started');

                    if (isTaskComplete || isTaskStarted) {
                        console.log(`🔄 [Sync] Updating thinking state: isTaskComplete=${isTaskComplete}, isTaskStarted=${isTaskStarted}`);
                    }
                }
            }

            if (lastMessage !== null || isTaskComplete || isTaskStarted) {
                preparedUpdates.push({
                    updateData,
                    lastMessage,
                    isTaskComplete,
                    isTaskStarted,
                });
            }
        }

        // Enqueue message-list updates through the unified dispatcher (serialized with fetchMessagesV3)
        if (preparedUpdates.length > 0) {
            const lock = this.getSessionMessageLock(sessionId);
            await lock.inLock(async () => {
                await this.enqueueSessionMessageDispatch(sessionId, `websocket:new-message-batch:${preparedUpdates.length}`, async () => {
                    const latestUpdate = preparedUpdates[preparedUpdates.length - 1].updateData;
                    let thinkingUpdate: boolean | null = null;
                    for (const prepared of preparedUpdates) {
                        if (prepared.isTaskStarted) {
                            thinkingUpdate = true;
                        }
                        if (prepared.isTaskComplete) {
                            thinkingUpdate = false;
                        }
                    }

                    // Update session metadata (updatedAt, seq, thinking state)
                    const session = storage.getState().sessions[sessionId];
                    if (session) {
                        this.applySessions([{
                            ...session,
                            updatedAt: latestUpdate.createdAt,
                            seq: latestUpdate.seq,
                            ...(thinkingUpdate === false ? { thinking: false } : {}),
                            ...(thinkingUpdate === true ? { thinking: true } : {})
                        }]);
                    } else {
                        this.sessionsSync.invalidate();
                    }

                    const messagesToApply = preparedUpdates
                        .map((prepared) => prepared.lastMessage)
                        .filter((message): message is NormalizedMessage => message !== null);

                    for (const message of messagesToApply) {
                        // If this is an echo of our own send, invoke the pending callback
                        // (e.g. clear input) before the message appears in the list.
                        if (message.localId) {
                            const pending = this.pendingSendCallbacks.get(message.localId);
                            if (pending) {
                                this.pendingSendCallbacks.delete(message.localId);
                                pending();
                            }
                        }
                    }

                    if (messagesToApply.length > 0) {
                        console.log(`🔄 Sync: Applying websocket batch (${messagesToApply.length} messages) for session ${sessionId}`);
                        this.applyMessages(sessionId, messagesToApply);
                        emitDesktopMessages({ sessionId, messages: messagesToApply });

                        let hasMutableTool = false;
                        for (const message of messagesToApply) {
                            if (message.role === 'agent' && message.content[0] && message.content[0].type === 'tool-result') {
                                hasMutableTool = storage.getState().isMutableToolCall(sessionId, message.content[0].tool_use_id);
                                if (hasMutableTool) {
                                    break;
                                }
                            }
                        }
                        if (hasMutableTool) {
                            gitStatusSync.invalidate(sessionId);
                        }
                    }
                });
            });
        }

        // Ping session once per websocket batch
        this.onSessionVisible(sessionId);
    }

    private flushActivityUpdates = (updates: Map<string, ApiEphemeralActivityUpdate>) => {
        // log.log(`🔄 Flushing activity updates for ${updates.size} sessions - acquiring lock`);

        const sessions: Session[] = [];
        const recoveredSessionIds: string[] = [];
        const state = storage.getState();

        for (const [sessionId, update] of updates) {
            const session = state.sessions[sessionId];
            if (session) {
                if (shouldInvalidateGitStatusOnActivityTransition(session.active, update.active)) {
                    recoveredSessionIds.push(sessionId);
                }
                sessions.push({
                    ...session,
                    active: update.active,
                    activeAt: update.activeAt,
                    thinking: update.thinking ?? false,
                    thinkingAt: update.activeAt // Always use activeAt for consistency
                });
            } else if (state.sharedSessions[sessionId]) {
                // Update shared session activity
                state.updateSharedSessionActivity(
                    sessionId,
                    update.active,
                    update.activeAt,
                    update.thinking ?? false
                );
            }
        }

        if (sessions.length > 0) {
            // console.log('flushing activity updates ' + sessions.length);
            this.applySessions(sessions);
            for (const sessionId of recoveredSessionIds) {
                gitStatusSync.invalidate(sessionId);
            }
            // log.log(`🔄 Activity updates flushed - updated ${sessions.length} sessions`);
        }
    }

    private handleEphemeralUpdate = (update: unknown) => {
        const validatedUpdate = ApiEphemeralUpdateSchema.safeParse(update);
        if (!validatedUpdate.success) {
            console.log('Invalid ephemeral update received:', validatedUpdate.error);
            console.error('Invalid ephemeral update received:', update);
            return;
        } else {
            // console.log('Ephemeral update received:', update);
        }
        const updateData = validatedUpdate.data;

        // Process activity updates through smart debounce accumulator
        if (updateData.type === 'activity') {
            // console.log('adding activity update ' + updateData.id);
            this.activityAccumulator.addUpdate(updateData);
        }

        if (updateData.type === 'message-syncing') {
            const sessionId = updateData.id;
            const existing = this.messageSyncTimeouts.get(sessionId);
            if (existing) {
                clearTimeout(existing);
            }
            storage.getState().setSessionMessageSyncing(sessionId, true);
            // Invalidate any in-flight message fetch (bump generation + abort + stop the sync, drop
            // the dedupe set). message-syncing on its own does NOT bump the fetch generation, so a
            // run started before this signal would still pass isCurrent() and could re-apply
            // pre-sync messages and re-commit sessionLastSeq — defeating the clear+full-reload intent
            // below and turning the delayed re-fetch into a stale-cursor incremental.
            this.resetMessagesSync(sessionId);
            this.resetSessionMessageDispatch(sessionId);
            this.sessionMessageUpdateQueues.delete(sessionId);
            storage.getState().clearSessionMessages(sessionId);
            this.sessionReceivedMessages.delete(sessionId);
            this.bumpMessageCacheGeneration(sessionId);
            const accountKey = this.getMessageAccountKey();
            let resetPromise: Promise<void> = Promise.resolve();
            if (accountKey) {
                resetPromise = messageRepository.clearSession(accountKey, sessionId).catch((error) => {
                    console.warn(`Failed to clear local message cache for ${sessionId}:`, error);
                });
            }
            this.messageCacheResetPromises.set(sessionId, resetPromise);
            void resetPromise.finally(() => {
                if (this.messageCacheResetPromises.get(sessionId) === resetPromise) {
                    this.messageCacheResetPromises.delete(sessionId);
                }
            });
            // Reset seq cursor so the subsequent re-fetch starts from seq 0
            // and retrieves all messages, not just those after the old cursor.
            this.sessionLastSeq.delete(sessionId);

            const timeout = setTimeout(() => {
                this.messageSyncTimeouts.delete(sessionId);
                storage.getState().setSessionMessageSyncing(sessionId, false);
                void (this.messageCacheResetPromises.get(sessionId) ?? Promise.resolve()).finally(() => {
                    this.invalidateMessagesSync(sessionId);
                });
            }, 30000);
            this.messageSyncTimeouts.set(sessionId, timeout);
        }

        if (updateData.type === 'message-synced') {
            const sessionId = updateData.id;
            const existing = this.messageSyncTimeouts.get(sessionId);
            if (existing) {
                clearTimeout(existing);
                this.messageSyncTimeouts.delete(sessionId);
            }
            storage.getState().setSessionMessageSyncing(sessionId, false);
            void (this.messageCacheResetPromises.get(sessionId) ?? Promise.resolve()).finally(() => {
                this.invalidateMessagesSync(sessionId);
            });
        }

        if (updateData.type === 'message-errored') {
            const sessionId = updateData.id;
            const existing = this.messageSyncTimeouts.get(sessionId);
            if (existing) {
                clearTimeout(existing);
                this.messageSyncTimeouts.delete(sessionId);
            }
            storage.getState().setSessionMessageSyncing(sessionId, false);
            void (this.messageCacheResetPromises.get(sessionId) ?? Promise.resolve()).finally(() => {
                this.invalidateMessagesSync(sessionId);
            });
        }

        if (updateData.type === 'message-delivery-error') {
            const key = `${updateData.sid}:${updateData.messageId}`;
            const existing = this.deliveryErrorTimers.get(key);
            if (existing) {
                clearTimeout(existing);
                this.deliveryErrorTimers.delete(key);
            }
            if (updateData.error === 'no_cli_connection') {
                const accountKey = this.getMessageAccountKey();
                if (accountKey) {
                    void messageRepository.updateDeliveryIssue(
                        accountKey,
                        updateData.sid,
                        { messageId: updateData.messageId, localId: updateData.localId ?? null },
                        { status: 'error', reason: updateData.error },
                    ).catch(() => {});
                }
                const timer = setTimeout(() => {
                    this.deliveryErrorTimers.delete(key);
                    storage.getState().setMessageDeliveryError(
                        updateData.sid,
                        updateData.messageId,
                        updateData.localId ?? null,
                        updateData.error
                    );
                    // Error badge now visible — stop showing the optimistic "processing…".
                    storage.getState().setAwaitingResponse(updateData.sid, null);
                }, 10_000);
                this.deliveryErrorTimers.set(key, timer);
            } else {
                storage.getState().setMessageDeliveryError(
                    updateData.sid,
                    updateData.messageId,
                    updateData.localId ?? null,
                    updateData.error
                );
                const accountKey = this.getMessageAccountKey();
                if (accountKey) {
                    void messageRepository.updateDeliveryIssue(
                        accountKey,
                        updateData.sid,
                        { messageId: updateData.messageId, localId: updateData.localId ?? null },
                        { status: 'error', reason: updateData.error },
                    ).catch(() => {});
                }
                storage.getState().setAwaitingResponse(updateData.sid, null);
            }
        }

        if (updateData.type === 'message-delivery-cleared') {
            const key = `${updateData.sid}:${updateData.messageId}`;
            const pending = this.deliveryErrorTimers.get(key);
            if (pending) {
                clearTimeout(pending);
                this.deliveryErrorTimers.delete(key);
            }
            storage.getState().setMessageDeliveryError(
                updateData.sid,
                updateData.messageId,
                updateData.localId ?? null,
                null
            );
            const accountKey = this.getMessageAccountKey();
            if (accountKey) {
                void messageRepository.updateDeliveryIssue(
                    accountKey,
                    updateData.sid,
                    { messageId: updateData.messageId, localId: updateData.localId ?? null },
                    null,
                ).catch(() => {});
            }
        }

        if (updateData.type === 'pending-message-upsert') {
            void (async () => {
                const pending = await this.decryptPendingMessage(updateData.sid, updateData.pending);
                if (pending) {
                    storage.getState().upsertPendingMessage(updateData.sid, pending);
                } else {
                    this.invalidatePendingMessagesSync(updateData.sid);
                }
            })();
        }

        if (updateData.type === 'pending-message-delete') {
            storage.getState().removePendingMessage(updateData.sid, updateData.pendingId);
        }

        // Handle machine activity updates
        if (updateData.type === 'machine-activity') {
            // Update machine's active status and lastActiveAt
            const machine = storage.getState().machines[updateData.id];
            if (machine) {
                const updatedMachine: Machine = {
                    ...machine,
                    active: updateData.active,
                    activeAt: updateData.activeAt
                };
                storage.getState().applyMachines([updatedMachine]);
            } else if (updateData.active) {
                // Machine not in store yet (e.g. just registered) — re-fetch all machines
                this.machinesSync.invalidate();
            }
        }

        if (updateData.type === 'orchestrator-activity') {
            storage.getState().setOrchestratorActivity(updateData.controllerSessionId, updateData.activity, updateData.totalRunCount);
        }

        // daemon-status ephemeral updates are deprecated, machine status is handled via machine-activity
    }

    //
    // Apply store
    //

    private applyMessages = (sessionId: string, messages: NormalizedMessage[]) => {
        const result = storage.getState().applyMessages(sessionId, messages);
        let m: Message[] = [];
        for (let messageId of result.changed) {
            const message = storage.getState().sessionMessages[sessionId].messagesMap[messageId];
            if (message) {
                m.push(message);
            }
        }
        if (m.length > 0) {
            voiceHooks.onMessages(sessionId, m);
            // Any agent/non-user output means the turn has started — drop the
            // optimistic "awaiting response" marker if it's still set.
            if (m.some((msg) => msg.kind !== 'user-text')) {
                storage.getState().setAwaitingResponse(sessionId, null);
            }
        }
        if (result.hasReadyEvent) {
            voiceHooks.onReady(sessionId);
        }
    }

    private applySessions = (sessions: (Omit<Session, "presence"> & {
        presence?: "online" | number;
    })[]) => {
        const active = storage.getState().getActiveSessions();
        storage.getState().applySessions(sessions);
        const newActive = storage.getState().getActiveSessions();
        this.scheduleSessionsCacheSave();
        this.applySessionDiff(active, newActive);
    }

    private applyDeletedSessions = (sessionIds: string[]) => {
        if (sessionIds.length === 0) return;

        for (const sessionId of sessionIds) {
            this.bumpMessageCacheGeneration(sessionId);
        }
        storage.getState().deleteSessions(sessionIds);
        const accountKey = this.getMessageAccountKey();
        if (accountKey) {
            void messageRepository.deleteSessions(accountKey, sessionIds).catch((error) => {
                console.warn('Failed to delete local cached messages for sessions:', error);
            });
        }
        for (const sessionId of sessionIds) {
            this.encryption.removeSessionEncryption(sessionId);
            this.sessionDataKeys.delete(sessionId);
            this.encryptedSessionDataKeys.delete(sessionId);
            projectManager.removeSession(sessionId);
            gitStatusSync.clearForSession(sessionId);
            // Bump (don't delete) the generation so any in-flight run for this now-deleted session
            // sees a stale generation and bails instead of resurrecting it.
            this.messagesFetchGeneration.set(sessionId, (this.messagesFetchGeneration.get(sessionId) ?? 0) + 1);
            this.messagesFetchAbort.get(sessionId)?.abort();
            this.messagesFetchAbort.delete(sessionId);
            this.messagesFetchingToken.delete(sessionId);
            this.sessionReceivedMessages.delete(sessionId);
            this.messageCacheResetPromises.delete(sessionId);
            this.messagesSync.get(sessionId)?.stop();
            this.messagesSync.delete(sessionId);
            this.pendingMessagesSync.delete(sessionId);
            this.sessionLastSeq.delete(sessionId);
            this.sessionMessageLocks.delete(sessionId);
            this.sessionMessageUpdateQueues.delete(sessionId);
            this.sessionMessageQueueRunning.delete(sessionId);
            this.resetSessionMessageDispatch(sessionId);
        }
        this.scheduleSessionsCacheSave();
    }

    private scheduleSessionsCacheSave = () => {
        if (!this.serverID) return;
        if (this.sessionsCacheSaveTimer) {
            return;
        }
        const now = Date.now();
        const delay = this.lastSessionsCacheSaveAt === 0
            ? SESSIONS_CACHE_SAVE_DEBOUNCE_MS
            : Math.max(
                SESSIONS_CACHE_SAVE_DEBOUNCE_MS,
                SESSIONS_CACHE_SAVE_MIN_INTERVAL_MS - (now - this.lastSessionsCacheSaveAt),
            );
        this.sessionsCacheSaveTimer = setTimeout(() => {
            this.sessionsCacheSaveTimer = null;
            const state = storage.getState();
            saveSessionsCache(this.serverID, {
                lastSessionsCursorMs: this.lastSessionsCursorMs,
                sessions: state.sessions,
                sharedSessions: state.sharedSessions,
                sessionDataKeys: Object.fromEntries(this.encryptedSessionDataKeys),
            });
            this.lastSessionsCacheSaveAt = Date.now();
        }, delay);
    }

    private applySessionDiff = (active: Session[], newActive: Session[]) => {
        let wasActive = new Set(active.map(s => s.id));
        let isActive = new Set(newActive.map(s => s.id));
        for (let s of active) {
            if (!isActive.has(s.id)) {
                voiceHooks.onSessionOffline(s.id, s.metadata ?? undefined);
            }
        }
        for (let s of newActive) {
            if (!wasActive.has(s.id)) {
                voiceHooks.onSessionOnline(s.id, s.metadata ?? undefined);
            }
        }
    }

}

// Global singleton instance
export const sync = new Sync();

//
// Init sequence
//

let isInitialized = false;
export async function syncCreate(credentials: AuthCredentials) {
    if (isInitialized) {
        console.warn('Sync already initialized: ignoring');
        return;
    }
    isInitialized = true;
    await syncInit(credentials, false);
}

export async function syncRestore(credentials: AuthCredentials) {
    if (isInitialized) {
        console.warn('Sync already initialized: ignoring');
        return;
    }
    isInitialized = true;
    await syncInit(credentials, true);
}

export async function stopPushTokenRegistration() {
    await sync.stopPushTokenRegistration();
}

export function resumePushTokenRegistration() {
    sync.resumePushTokenRegistration();
}

async function syncInit(credentials: AuthCredentials, restore: boolean) {

    // Initialize sync engine
    const secretKey = decodeBase64(credentials.secret, 'base64url');
    if (secretKey.length !== 32) {
        throw new Error(`Invalid secret key length: ${secretKey.length}, expected 32`);
    }
    const encryption = await Encryption.create(secretKey);

    // Initialize tracking
    initializeTracking(encryption.anonID);

    // Initialize socket connection
    const API_ENDPOINT = getServerUrl();
    apiSocket.initialize({ endpoint: API_ENDPOINT, token: credentials.token }, encryption);
    onServerUrlChanged((serverUrl) => {
        apiSocket.updateEndpoint(serverUrl);
    });

    // Wire socket status to storage
    apiSocket.onStatusChange((status) => {
        log.log(`[SEND_DEBUG][SOCKET] status=${status}`);
        storage.getState().setSocketStatus(status);
    });

    // Initialize sessions engine
    if (restore) {
        await sync.restore(credentials, encryption);
    } else {
        await sync.create(credentials, encryption);
    }
}
