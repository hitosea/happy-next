import React from 'react';
import { View, Text, Platform, useWindowDimensions } from 'react-native';
import { Typography } from '@/constants/Typography';
import { useAllMachines, storage, useLocalSetting, useSessionModeLastUsed, useSetting, useSessions } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { machineBash, machineSpawnNewSession, sessionUpdateMetadataFields } from '@/sync/ops';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { SessionTypeSelector } from '@/components/SessionTypeSelector';
import { createWorktree } from '@/utils/createWorktree';
import { createWorkspace, type WorkspaceRepoInput } from '@/utils/createWorkspace';
import { RepoPickerBar, type SelectedRepo } from '@/components/RepoPickerBar';
import type { RegisteredRepo } from '@/utils/workspaceRepos';
import { saveRegisteredRepos, loadRegisteredRepos } from '@/sync/repoStore';
import { getTempData, type NewSessionData } from '@/utils/tempDataStore';
import { PermissionMode, ModelMode } from '@/components/PermissionModeSelector';
import { AgentInput } from '@/components/AgentInput';
import { isRunningOnMac } from '@/utils/platform';
import { StyleSheet } from 'react-native-unistyles';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { resolveSessionIcon } from '@/components/Avatar';
import { useCLIDetection } from '@/hooks/useCLIDetection';
import { useQoderModels } from '@/hooks/useQoderModels';
import { useNewSessionAutocomplete } from '@/hooks/useNewSessionAutocomplete';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { clearNewSessionDraft, loadNewSessionDraft, saveNewSessionDraft } from '@/sync/persistence';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useWebImageDrop } from '@/hooks/useWebImageDrop';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { MODEL_MODE_DEFAULT, isModelModeForAgent, parseQoderModelMode } from 'happy-wire';
import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import { getDooTaskProjectId, getRecentDooTaskProjectConfig } from '@/utils/dootaskSessionDefaults';

// Simple temporary state for passing selections back from picker screens
let onMachineSelected: (machineId: string) => void = () => { };

export const callbacks = {
    onMachineSelected: (machineId: string) => {
        onMachineSelected(machineId);
    }
}

const isConcreteSessionMachineTab = (tab: string | null): tab is string => {
    return !!tab && tab !== 'all' && tab !== 'shared' && tab !== 'sharedByMe';
};

// Helper function to get the most recent path for a machine
// Returns the path from the most recently CREATED session for this machine
const getRecentPathForMachine = (machineId: string | null, recentPaths: Array<{ machineId: string; path: string }>): string => {
    if (!machineId) return '';

    const machine = storage.getState().machines[machineId];
    const defaultPath = machine?.metadata?.homeDir || '';

    // Get all sessions for this machine, sorted by creation time (most recent first)
    const sessions = Object.values(storage.getState().sessions);
    const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

    sessions.forEach(session => {
        if (session.metadata?.machineId === machineId && session.metadata?.path) {
            pathsWithTimestamps.push({
                path: session.metadata.path,
                timestamp: session.createdAt // Use createdAt, not updatedAt
            });
        }
    });

    // Sort by creation time (most recently created first)
    pathsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

    // Return the most recently created session's path, or default
    return pathsWithTimestamps[0]?.path || defaultPath;
};

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    },
}));

function NewSessionWizard() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    // The soft header sits over this screen. The layout pads its own top by its height rather
    // than letting UIKit inset the scroll view: the whole column is translated with the keyboard,
    // and a transformed scroll view would keep having its safe-area inset recomputed mid-animation.
    const softHeaderInset = useSoftHeaderInset();
    const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
    const animatedInputStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: kbHeight.value + safeArea.bottom * kbProgress.value }],
    }), [safeArea.bottom]);
    const { prompt, dataId, machineId: machineIdParam, path: pathParam } = useLocalSearchParams<{
        prompt?: string;
        dataId?: string;
        machineId?: string;
        path?: string;
    }>();

    // Try to get data from temporary store first
    const tempSessionData = React.useMemo(() => {
        if (dataId) {
            return getTempData<NewSessionData>(dataId);
        }
        return null;
    }, [dataId]);

    // Load persisted draft state (survives remounts/screen navigation)
    const persistedDraft = React.useRef(loadNewSessionDraft()).current;

    // Settings and state
    const recentMachinePaths = useSetting('recentMachinePaths');
    const lastUsedAgent = useSetting('lastUsedAgent');
    const sessionListSelectedTab = useLocalSetting('sessionListSelectedTab');

    const machines = useAllMachines();
    const sessions = useSessions();
    const dooTaskProjectId = React.useMemo(() => getDooTaskProjectId(tempSessionData), [tempSessionData]);
    const dooTaskProjectRecentConfig = React.useMemo(() => {
        return getRecentDooTaskProjectConfig(
            dooTaskProjectId,
            sessions,
            new Set(machines.map(machine => machine.id)),
        );
    }, [dooTaskProjectId, sessions, machines]);

    const [agentType, setAgentType] = React.useState<'claude' | 'codex' | 'gemini' | 'qoder'>(() => {
        // Check if agent type was provided in temp data
        if (tempSessionData?.agentType) {
            return tempSessionData.agentType;
        }
        if (lastUsedAgent === 'claude' || lastUsedAgent === 'codex' || lastUsedAgent === 'gemini' || lastUsedAgent === 'qoder') {
            return lastUsedAgent;
        }
        return 'claude';
    });
    const lastUsedSessionMode = useSessionModeLastUsed(agentType);
    const manualPermissionModeByAgentRef = React.useRef<Partial<Record<'claude' | 'codex' | 'gemini' | 'qoder', PermissionMode>>>({});
    const manualModelModeByAgentRef = React.useRef<Partial<Record<'claude' | 'codex' | 'gemini' | 'qoder', ModelMode>>>({});

    // Persist agent selection changes (separate from setState to avoid race condition)
    // This runs after agentType state is updated, ensuring the value is stable
    React.useEffect(() => {
        sync.applySettings({ lastUsedAgent: agentType });
    }, [agentType]);

    const [sessionType, setSessionType] = React.useState<'simple' | 'worktree'>(persistedDraft?.sessionType || 'simple');
    const [selectedRepos, setSelectedRepos] = React.useState<SelectedRepo[]>([]);
    const [addDirBranchMenu, setAddDirBranchMenu] = React.useState<{ visible: boolean; items: ActionMenuItem[] }>({ visible: false, items: [] });
    const addDirBranchResolveRef = React.useRef<((value: string | undefined) => void) | null>(null);
    const folderPickerRef = React.useRef<BottomSheetModal>(null);
    const [permissionMode, setPermissionMode] = React.useState<PermissionMode>(() => {
        const mode = lastUsedSessionMode?.permissionMode;

        const validClaudeModes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
        const validCodexModes: PermissionMode[] = ['default', 'read-only', 'on-failure', 'full-auto'];
        const validGeminiModes: PermissionMode[] = ['default', 'auto_edit', 'plan', 'yolo'];
        const validQoderModes: PermissionMode[] = ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'];
        const validModes = agentType === 'codex' ? validCodexModes : agentType === 'gemini' ? validGeminiModes : agentType === 'qoder' ? validQoderModes : validClaudeModes;

        if (mode && validModes.includes(mode as PermissionMode)) {
            return mode as PermissionMode;
        }
        return 'default';
    });

    // NOTE: Permission mode reset on agentType change is handled by the validation useEffect below (lines ~670-681)
    // which intelligently resets only when the current mode is invalid for the new agent type.
    // A duplicate unconditional reset here was removed to prevent race conditions.

    const [modelMode, setModelMode] = React.useState<ModelMode>(() => {
        const mode = lastUsedSessionMode?.modelMode;
        // A saved Qoder model is restored by the effect below once the account's models are known
        if (mode && isModelModeForAgent(agentType, mode)) {
            return mode as ModelMode;
        }
        return MODEL_MODE_DEFAULT;
    });
    const [fastMode, setFastMode] = React.useState(() => lastUsedSessionMode?.fastMode ?? false);
    const applyManualPermissionMode = React.useCallback((mode: PermissionMode) => {
        manualPermissionModeByAgentRef.current[agentType] = mode;
        setPermissionMode(mode);
    }, [agentType]);
    const applyManualModelMode = React.useCallback((mode: ModelMode) => {
        manualModelModeByAgentRef.current[agentType] = mode;
        setModelMode(mode);
    }, [agentType]);

    // Session details state
    const tabDefaultSelectionRef = React.useRef(false);
    const hasManualMachineOrPathSelectionRef = React.useRef(false);
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => {
        if (tempSessionData?.machineId && machines.find(m => m.id === tempSessionData.machineId)) {
            return tempSessionData.machineId;
        }
        if (tempSessionData?.externalContext?.source === 'dootask') {
            return dooTaskProjectRecentConfig?.machineId ?? null;
        }
        if (dooTaskProjectRecentConfig?.machineId) {
            return dooTaskProjectRecentConfig.machineId;
        }
        // When launching from the session list, prefer the currently selected concrete machine tab.
        if (!tempSessionData && isConcreteSessionMachineTab(sessionListSelectedTab) && machines.find(m => m.id === sessionListSelectedTab)) {
            tabDefaultSelectionRef.current = true;
            return sessionListSelectedTab;
        }
        // Then try the persisted draft (saved immediately on selection).
        if (!tempSessionData && persistedDraft?.selectedMachineId && machines.find(m => m.id === persistedDraft.selectedMachineId)) {
            return persistedDraft.selectedMachineId;
        }
        if (machines.length > 0) {
            if (recentMachinePaths.length > 0) {
                for (const recent of recentMachinePaths) {
                    if (machines.find(m => m.id === recent.machineId)) {
                        return recent.machineId;
                    }
                }
            }
            return machines[0].id;
        }
        return null;
    });

    const handlePermissionModeChange = React.useCallback((mode: PermissionMode) => {
        applyManualPermissionMode(mode);
        sync.queueSessionModeConfigUpdate({
            agentType,
            permissionMode: mode,
            modelMode: modelMode || MODEL_MODE_DEFAULT,
            fastMode,
            includeSessionEntry: false,
            includeLastUsed: true,
        });
    }, [agentType, applyManualPermissionMode, modelMode, fastMode]);

    const handleFastModeChange = React.useCallback((enabled: boolean) => {
        setFastMode(enabled);
        sync.queueSessionModeConfigUpdate({
            agentType,
            permissionMode: permissionMode || 'default',
            modelMode: modelMode || MODEL_MODE_DEFAULT,
            fastMode: enabled,
            includeSessionEntry: false,
            includeLastUsed: true,
        });
    }, [agentType, permissionMode, modelMode]);

    const handleModelModeChange = React.useCallback((mode: ModelMode) => {
        applyManualModelMode(mode);
        sync.queueSessionModeConfigUpdate({
            agentType,
            permissionMode: permissionMode || 'default',
            modelMode: mode,
            fastMode,
            includeSessionEntry: false,
            includeLastUsed: true,
        });
    }, [agentType, applyManualModelMode, permissionMode, fastMode]);

    //
    // Path selection
    //

    const [selectedPath, setSelectedPath] = React.useState<string>(() => {
        if (tempSessionData?.path) {
            return tempSessionData.path;
        }
        if (tempSessionData?.externalContext?.source === 'dootask') {
            return dooTaskProjectRecentConfig?.path ?? '';
        }
        if (dooTaskProjectRecentConfig?.path) {
            return dooTaskProjectRecentConfig.path;
        }
        // If the machine comes from the selected session-list tab, mirror manual machine selection:
        // switch the path to that machine's most recent path instead of keeping a stale draft path.
        if (!tempSessionData && isConcreteSessionMachineTab(sessionListSelectedTab) && machines.some(m => m.id === sessionListSelectedTab)) {
            return getRecentPathForMachine(sessionListSelectedTab, recentMachinePaths);
        }
        // Then try the persisted draft (saved immediately on selection)
        if (!tempSessionData && persistedDraft?.selectedPath) {
            return persistedDraft.selectedPath;
        }
        return getRecentPathForMachine(selectedMachineId, recentMachinePaths);
    });
    const didApplyDooTaskProjectDefaultsRef = React.useRef(Boolean(dooTaskProjectRecentConfig));

    // Hydrate selectedMachineId after sync completes.
    // On page refresh, machines is [] until isDataReady flips true; the useState
    // initializer above runs before that and falls through to null, leaving the
    // UI without a machine chip and the path chip unclickable. Re-run the same
    // selection priority once machines actually arrive.
    React.useEffect(() => {
        if (selectedMachineId !== null || machines.length === 0) return;
        let pick: string | null = null;
        if (isConcreteSessionMachineTab(sessionListSelectedTab) && machines.some(m => m.id === sessionListSelectedTab)) {
            pick = sessionListSelectedTab;
            tabDefaultSelectionRef.current = true;
        } else if (persistedDraft?.selectedMachineId && machines.some(m => m.id === persistedDraft.selectedMachineId)) {
            pick = persistedDraft.selectedMachineId;
        } else {
            for (const recent of recentMachinePaths) {
                if (machines.some(m => m.id === recent.machineId)) {
                    pick = recent.machineId;
                    break;
                }
            }
            if (!pick) pick = machines[0].id;
        }
        setSelectedMachineId(pick);
        const shouldMirrorTabMachinePath = pick === sessionListSelectedTab && isConcreteSessionMachineTab(sessionListSelectedTab);
        if (!selectedPath || shouldMirrorTabMachinePath) {
            setSelectedPath(getRecentPathForMachine(pick, recentMachinePaths));
        }
    }, [machines, selectedMachineId, selectedPath, recentMachinePaths, persistedDraft, sessionListSelectedTab]);

    React.useEffect(() => {
        if (!tempSessionData || tempSessionData.externalContext?.source !== 'dootask') return;
        if (tempSessionData.machineId || tempSessionData.path) return;
        if (!dooTaskProjectRecentConfig || didApplyDooTaskProjectDefaultsRef.current) return;
        if (selectedMachineId == null) {
            setSelectedMachineId(dooTaskProjectRecentConfig.machineId);
        }
        if (!selectedPath) {
            setSelectedPath(dooTaskProjectRecentConfig.path);
        }
        didApplyDooTaskProjectDefaultsRef.current = true;
    }, [tempSessionData, dooTaskProjectRecentConfig, selectedMachineId, selectedPath]);

    // Worktrees aren't created until send; their source repo has the same .claude/.codex files
    const autocomplete = useNewSessionAutocomplete(
        selectedMachineId,
        sessionType === 'worktree' && selectedRepos.length > 0 ? selectedRepos[0].repo.path : selectedPath,
        agentType,
    );

    const { inputHistory, rememberSentInput } = useInputHistory();
    const [sessionPrompt, setSessionPrompt] = React.useState(() => {
        return tempSessionData?.prompt || prompt || persistedDraft?.input || '';
    });
    const [isCreating, setIsCreating] = React.useState(false);

    // Image picker
    const {
        images,
        pickFromGallery,
        pickFromCamera,
        addImagesFromFiles,
        removeImage,
        clearImages,
        initImages,
        canAddMore,
    } = useImagePicker({ maxImages: 4 });

    // Restore images from persisted draft on mount
    React.useEffect(() => {
        if (persistedDraft?.images && persistedDraft.images.length > 0) {
            initImages(persistedDraft.images);
        }
    }, []);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [imagePickerSheetVisible, setImagePickerSheetVisible] = React.useState(false);

    const supportsImages = agentType === 'claude' || agentType === 'gemini' || agentType === 'codex' || agentType === 'qoder';
    const isFocused = useIsFocused();

    const handleImageButtonPress = React.useCallback(() => {
        if (Platform.OS === 'web') {
            fileInputRef.current?.click();
        } else {
            setImagePickerSheetVisible(true);
        }
    }, []);

    const imagePickerMenuItems: ActionMenuItem[] = React.useMemo(() => [
        { label: t('session.takePhoto'), onPress: pickFromCamera, disabled: !supportsImages },
        { label: t('session.chooseFromLibrary'), onPress: pickFromGallery, disabled: !supportsImages },
    ], [pickFromCamera, pickFromGallery, supportsImages]);

    const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        void addImagesFromFiles(Array.from(files));
        event.target.value = '';
    }, [addImagesFromFiles]);

    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleImagePasteEvent(event, {
            isScreenFocused: isFocused,
            canAddMore,
            supportsImages,
            onImageFile: async (file) => addImagesFromFiles([file]),
        });
    }, [isFocused, canAddMore, supportsImages, addImagesFromFiles]);

    // Add paste event listener for images (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const pasteListener = (e: Event) => handlePaste(e as ClipboardEvent);
        document.addEventListener('paste', pasteListener);

        return () => {
            document.removeEventListener('paste', pasteListener);
        };
    }, [handlePaste]);

    const handleImageDrop = React.useCallback(async (files: File[]) => {
        if (!supportsImages) return;
        await addImagesFromFiles(files);
    }, [supportsImages, addImagesFromFiles]);
    const { dropZoneRef, isDragging: isDraggingImage } = useWebImageDrop({
        enabled: isFocused && supportsImages,
        onImageDrop: handleImageDrop,
    });

    // Handle machineId route param from picker screens (main's navigation pattern)
    React.useEffect(() => {
        if (typeof machineIdParam !== 'string' || machines.length === 0) {
            return;
        }
        if (!machines.some(m => m.id === machineIdParam)) {
            return;
        }
        if (machineIdParam !== selectedMachineId) {
            hasManualMachineOrPathSelectionRef.current = true;
            tabDefaultSelectionRef.current = false;
            setSelectedMachineId(machineIdParam);
            const bestPath = getRecentPathForMachine(machineIdParam, recentMachinePaths);
            setSelectedPath(bestPath);
        }
    }, [machineIdParam, machines, recentMachinePaths, selectedMachineId]);

    // Handle path route param from picker screens (main's navigation pattern)
    React.useEffect(() => {
        if (typeof pathParam !== 'string') {
            return;
        }
        const trimmedPath = pathParam.trim();
        if (trimmedPath && trimmedPath !== selectedPath) {
            hasManualMachineOrPathSelectionRef.current = true;
            tabDefaultSelectionRef.current = false;
            setSelectedPath(trimmedPath);
        }
    }, [pathParam, selectedPath]);

    // Load registered repos from server when machine is selected (ensures repos
    // are available even if the user hasn't visited the machine detail page yet,
    // and always fetches fresh data to stay in sync with other devices/pages)
    React.useEffect(() => {
        if (!selectedMachineId) return;
        const credentials = sync.getCredentials();
        if (!credentials) return;
        loadRegisteredRepos(credentials, selectedMachineId).then(({ repos, version }) => {
            if (repos.length > 0) {
                storage.getState().setRegisteredRepos(selectedMachineId, repos, version);
            }
        }).catch(() => { /* ignore load errors */ });
    }, [selectedMachineId]);

    // Path selection state - initialize with formatted selected path

    // CLI Detection - automatic, non-blocking detection of installed CLIs on selected machine
    const cliAvailability = useCLIDetection(selectedMachineId);

    // Agent cycling handler: claude -> codex -> gemini -> qoder -> claude, skipping agents detected as not installed
    // (landing on one would make the auto-correct below jump back to the first available agent).
    // Note: Does NOT persist immediately - persistence is handled by useEffect above
    const handleAgentClick = React.useCallback(() => {
        const order = ['claude', 'codex', 'gemini', 'qoder'] as const;
        setAgentType(prev => {
            const start = order.indexOf(prev);
            for (let step = 1; step <= order.length; step++) {
                const next = order[(start + step) % order.length];
                if (cliAvailability[next] !== false) return next;
            }
            return prev;
        });
    }, [cliAvailability]);

    // Auto-correct invalid agent selection after CLI detection completes
    // This handles the case where lastUsedAgent was 'codex' but codex is not installed
    React.useEffect(() => {
        // Only act when detection has completed (timestamp > 0)
        if (cliAvailability.timestamp === 0) return;

        // Check if currently selected agent is available
        const agentAvailable = cliAvailability[agentType];

        if (agentAvailable === false) {
            // Current agent not available - find first available
            const availableAgent: 'claude' | 'codex' | 'gemini' | 'qoder' =
                cliAvailability.claude === true ? 'claude' :
                cliAvailability.codex === true ? 'codex' :
                cliAvailability.gemini === true ? 'gemini' :
                cliAvailability.qoder === true ? 'qoder' :
                'claude'; // Fallback to claude (will fail at spawn with clear error)

            console.warn(`[AgentSelection] ${agentType} not available, switching to ${availableAgent}`);
            setAgentType(availableAgent);
        }
    }, [cliAvailability.timestamp, cliAvailability.claude, cliAvailability.codex, cliAvailability.gemini, cliAvailability.qoder, agentType]);

    const selectedMachine = React.useMemo(() => {
        if (!selectedMachineId) return null;
        return machines.find(m => m.id === selectedMachineId);
    }, [selectedMachineId, machines]);

    const qoderModels = useQoderModels(selectedMachineId, selectedPath || selectedMachine?.metadata?.homeDir || '', agentType === 'qoder');
    // Qoder models are per account and not in the catalog: a saved one is kept while the account still offers it.
    const isModelModeAvailable = (agent: 'claude' | 'codex' | 'gemini' | 'qoder', mode: string) => {
        if (agent !== 'qoder') return isModelModeForAgent(agent, mode);
        const { model, effort } = parseQoderModelMode(mode);
        const listed = qoderModels?.find((candidate) => candidate.code === model);
        return !!listed && (!effort || !!listed.efforts?.some((level) => level.code === effort));
    };
    // Qoder offers no "CLI default" entry, so it starts on the first model the account lists (Qoder's Auto).
    const fallbackModelMode = (agentType === 'qoder' ? qoderModels?.[0]?.code : undefined) ?? MODEL_MODE_DEFAULT;

    /** Save defaultTargetBranch on a registered repo (fire-and-forget). */
    const persistDefaultBranch = React.useCallback((mId: string, repoId: string, branch: string) => {
        const latestRepos = storage.getState().registeredRepos[mId] || [];
        const updatedRepos = latestRepos.map(r =>
            r.id === repoId ? { ...r, defaultTargetBranch: branch } : r
        );
        const ver = storage.getState().registeredReposVersions[mId] ?? -1;
        const creds = sync.getCredentials();
        if (creds) {
            saveRegisteredRepos(creds, mId, updatedRepos, ver).then(nv => {
                storage.getState().setRegisteredRepos(mId, updatedRepos, nv);
            }).catch(() => {
                storage.getState().setRegisteredRepos(mId, updatedRepos, ver);
            });
        } else {
            storage.getState().setRegisteredRepos(mId, updatedRepos, ver);
        }
    }, []);

    /** Handle folder selected from FolderPickerSheet (registers + selects + branch picker). */
    const handleFolderSelected = React.useCallback(async (selectedPath: string) => {
        if (!selectedMachineId) return;
        const gitCheck = await machineBash(selectedMachineId, 'git rev-parse --git-dir', selectedPath);
        if (!gitCheck.success) {
            const stderr = gitCheck.stderr?.trim() || '';
            const isNotRepo = !stderr || stderr.includes('not a git repository');
            Modal.alert(t('common.error'), isNotRepo ? t('newSession.worktree.notGitRepo') : stderr);
            return;
        }
        const displayName = selectedPath.split('/').filter(Boolean).pop() || 'repo';

        // Register the repo permanently so it persists and shows in the picker next time
        let repoToSelect: RegisteredRepo;
        const currentRepos = storage.getState().registeredRepos[selectedMachineId] || [];
        const existing = currentRepos.find(r => r.path === selectedPath);
        if (existing) {
            repoToSelect = existing;
        } else {
            repoToSelect = { id: randomUUID(), path: selectedPath, displayName };
            const updatedRepos = [...currentRepos, repoToSelect];
            const version = storage.getState().registeredReposVersions[selectedMachineId] ?? -1;
            const credentials = sync.getCredentials();
            if (credentials) {
                try {
                    const newVersion = await saveRegisteredRepos(credentials, selectedMachineId, updatedRepos, version);
                    storage.getState().setRegisteredRepos(selectedMachineId, updatedRepos, newVersion);
                } catch {
                    storage.getState().setRegisteredRepos(selectedMachineId, updatedRepos, version);
                }
            } else {
                storage.getState().setRegisteredRepos(selectedMachineId, updatedRepos, version);
            }
        }

        // Fetch current branch, local branches, and remote branches in parallel
        const [currentBranchResult, localResult, remoteResult] = await Promise.all([
            machineBash(selectedMachineId, 'git rev-parse --abbrev-ref HEAD', selectedPath),
            machineBash(selectedMachineId, "git branch --list --format='%(refname:short)'", selectedPath),
            machineBash(selectedMachineId, "git branch -r --format='%(refname:short)'", selectedPath),
        ]);
        const currentBranch = currentBranchResult.success ? currentBranchResult.stdout.trim() : undefined;
        const localBranches = localResult.success && localResult.stdout.trim()
            ? localResult.stdout.trim().split('\n').filter(Boolean)
            : [];
        const remoteBranches = remoteResult.success && remoteResult.stdout.trim()
            ? remoteResult.stdout.trim().split('\n').filter(b => b && b.includes('/') && !b.endsWith('/HEAD'))
            : [];

        if (localBranches.length > 0 || remoteBranches.length > 0) {
            const selectedBranch = await new Promise<string | undefined>((resolve) => {
                addDirBranchResolveRef.current = resolve;
                const localSet = new Set(localBranches);
                const items: ActionMenuItem[] = localBranches.map(branch => ({
                    label: branch,
                    selected: branch === currentBranch,
                    onPress: () => {
                        resolve(branch);
                        setAddDirBranchMenu({ visible: false, items: [] });
                        addDirBranchResolveRef.current = null;
                    },
                }));
                for (const remote of remoteBranches) {
                    const shortName = remote.includes('/') ? remote.substring(remote.indexOf('/') + 1) : remote;
                    if (!localSet.has(shortName)) {
                        items.push({
                            label: remote,
                            onPress: () => {
                                resolve(remote);
                                setAddDirBranchMenu({ visible: false, items: [] });
                                addDirBranchResolveRef.current = null;
                            },
                            secondary: true,
                        });
                    }
                }
                setAddDirBranchMenu({ visible: true, items });
            });
            const finalBranch = selectedBranch ?? currentBranch;
            setSelectedRepos(prev => [...prev, { repo: repoToSelect, targetBranch: finalBranch }]);
            if (finalBranch) persistDefaultBranch(selectedMachineId, repoToSelect.id, finalBranch);
        } else {
            setSelectedRepos(prev => [...prev, { repo: repoToSelect, targetBranch: currentBranch }]);
            if (currentBranch) persistDefaultBranch(selectedMachineId, repoToSelect.id, currentBranch);
        }
    }, [selectedMachineId, persistDefaultBranch]);

    const handleAddDirectory = React.useCallback(() => {
        folderPickerRef.current?.present();
    }, []);

    // Validation
    const canCreate = React.useMemo(() => {
        return (
            selectedMachineId !== null &&
            selectedPath.trim() !== ''
        );
    }, [selectedMachineId, selectedPath]);

    // Restore saved permission mode when agent type changes
    React.useEffect(() => {
        const validClaudeModes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
        const validCodexModes: PermissionMode[] = ['default', 'read-only', 'on-failure', 'full-auto'];
        const validGeminiModes: PermissionMode[] = ['default', 'auto_edit', 'plan', 'yolo'];
        const validQoderModes: PermissionMode[] = ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'];
        const validModes = agentType === 'codex' ? validCodexModes : agentType === 'gemini' ? validGeminiModes : agentType === 'qoder' ? validQoderModes : validClaudeModes;
        const manualMode = manualPermissionModeByAgentRef.current[agentType];

        if (manualMode && validModes.includes(manualMode)) {
            setPermissionMode((prev) => (prev === manualMode ? prev : manualMode));
            return;
        }

        const savedMode = lastUsedSessionMode?.permissionMode;
        if (savedMode && validModes.includes(savedMode)) {
            setPermissionMode((prev) => (prev === savedMode ? prev : savedMode));
        } else {
            setPermissionMode((prev) => (prev === 'default' ? prev : 'default'));
        }
    }, [agentType, lastUsedSessionMode?.permissionMode]);

    // Restore saved model mode when agent type changes
    React.useEffect(() => {
        const manualMode = manualModelModeByAgentRef.current[agentType];
        if (manualMode && isModelModeAvailable(agentType, manualMode)) {
            setModelMode((prev) => (prev === manualMode ? prev : manualMode));
            return;
        }

        const savedMode = lastUsedSessionMode?.modelMode;
        if (savedMode && isModelModeAvailable(agentType, savedMode)) {
            setModelMode((prev) => (prev === savedMode ? prev : (savedMode as ModelMode)));
        } else {
            setModelMode((prev) => (prev === fallbackModelMode ? prev : fallbackModelMode));
        }
    }, [agentType, lastUsedSessionMode?.modelMode, qoderModels]);

    // Restore saved fast mode when agent type changes
    React.useEffect(() => {
        const next = lastUsedSessionMode?.fastMode ?? false;
        setFastMode((prev) => (prev === next ? prev : next));
    }, [agentType, lastUsedSessionMode?.fastMode]);

    // Handle machine and path selection callbacks
    React.useEffect(() => {
        let handler = (machineId: string) => {
            let machine = storage.getState().machines[machineId];
            if (machine) {
                setSelectedMachineId(machineId);
                const bestPath = getRecentPathForMachine(machineId, recentMachinePaths);
                setSelectedPath(bestPath);
            }
        };
        onMachineSelected = handler;
        return () => {
            onMachineSelected = () => { };
        };
    }, [recentMachinePaths]);

    const handleMachineClick = React.useCallback(() => {
        router.push('/new/pick/machine');
    }, [router]);

    const handlePathClick = React.useCallback(() => {
        if (selectedMachineId) {
            router.push({
                pathname: '/new/pick/path',
                params: {
                    machineId: selectedMachineId,
                    selectedPath,
                },
            });
        }
    }, [selectedMachineId, selectedPath, router]);

    // Session creation
    const handleCreateSession = React.useCallback(async (promptSnapshot?: string) => {
        const promptToSend = (promptSnapshot ?? sessionPrompt).trim();
        if (!selectedMachineId) {
            Modal.alert(t('common.error'), t('newSession.noMachineSelected'));
            return;
        }
        if (!selectedPath) {
            Modal.alert(t('common.error'), t('newSession.noPathSelected'));
            return;
        }

        if (promptToSend) {
            rememberSentInput(promptToSend);
        }

        setIsCreating(true);

        try {
            let actualPath = selectedPath;
            let worktreeBranchName: string | undefined;
            let workspaceRepos: Array<{ repoId?: string; path: string; basePath: string; branchName: string; targetBranch?: string; displayName?: string }> | undefined;
            let workspacePath: string | undefined;
            let repoScripts: Array<{ repoDisplayName: string; worktreePath: string; setupScript?: string; parallelSetup?: boolean; cleanupScript?: string; archiveScript?: string; devServerScript?: string }> | undefined;

            // Handle worktree creation
            if (sessionType === 'worktree') {
                if (selectedRepos.length > 0) {
                    // Multi-repo workspace creation
                    const repoInputs: WorkspaceRepoInput[] = selectedRepos.map(sr => ({
                        repo: sr.repo,
                        targetBranch: sr.targetBranch,
                    }));
                    const wsResult = await createWorkspace(selectedMachineId, repoInputs);
                    if (!wsResult.success) {
                        Modal.alert(t('common.error'), t('newSession.worktree.failed', { error: wsResult.error || 'Unknown error' }));
                        setIsCreating(false);
                        return;
                    }
                    workspaceRepos = wsResult.repos;
                    workspacePath = wsResult.workspacePath;

                    // Build repoScripts from registered repo config
                    const allRegisteredRepos = storage.getState().registeredRepos[selectedMachineId] || [];

                    // CWD: single repo -> inside repo dir (+ defaultWorkingDir), multi repo -> workspace root
                    if (wsResult.repos.length === 1) {
                        const r = wsResult.repos[0];
                        const registered = r.repoId ? allRegisteredRepos.find(rr => rr.id === r.repoId) : undefined;
                        const subdir = registered?.defaultWorkingDir;
                        actualPath = subdir ? `${r.path}/${subdir}` : r.path;
                    } else {
                        actualPath = wsResult.workspacePath;
                    }
                    repoScripts = wsResult.repos.map(r => {
                        const registered = r.repoId ? allRegisteredRepos.find(rr => rr.id === r.repoId) : undefined;
                        return {
                            repoDisplayName: r.displayName || '',
                            worktreePath: r.path,
                            setupScript: registered?.setupScript,
                            parallelSetup: registered?.parallelSetup,
                            cleanupScript: registered?.cleanupScript,
                            archiveScript: registered?.archiveScript,
                            devServerScript: registered?.devServerScript,
                        };
                    });
                } else {
                    // Legacy single-repo worktree
                    const worktreeResult = await createWorktree(selectedMachineId, selectedPath);
                    if (!worktreeResult.success) {
                        if (worktreeResult.error === 'Not a Git repository') {
                            Modal.alert(t('common.error'), t('newSession.worktree.notGitRepo'));
                        } else {
                            Modal.alert(t('common.error'), t('newSession.worktree.failed', { error: worktreeResult.error || 'Unknown error' }));
                        }
                        setIsCreating(false);
                        return;
                    }
                    actualPath = worktreeResult.worktreePath;
                    worktreeBranchName = worktreeResult.branchName;
                }
            }

            // Save settings
            const updatedPaths = [{ machineId: selectedMachineId, path: selectedPath }, ...recentMachinePaths.filter(rp => rp.machineId !== selectedMachineId)].slice(0, 10);
            sync.applySettings({
                recentMachinePaths: updatedPaths,
                lastUsedAgent: agentType,
            });

            const result = await machineSpawnNewSession({
                machineId: selectedMachineId,
                directory: actualPath,
                approvedNewDirectoryCreation: true,
                agent: agentType,
                ...(tempSessionData?.environmentVariables ? { environmentVariables: tempSessionData.environmentVariables } : {}),
                // Pass worktree metadata so CLI includes it in initial metadata (avoids race condition)
                ...(sessionType === 'worktree' && worktreeBranchName ? {
                    worktreeBasePath: selectedPath,
                    worktreeBranchName,
                } : {}),
                // Pass workspace metadata for multi-repo sessions
                ...(workspaceRepos ? { workspaceRepos, workspacePath, repoScripts } : {}),
                // Pass through external MCP servers and session title
                ...(tempSessionData?.mcpServers ? { mcpServers: tempSessionData.mcpServers } : {}),
                ...(tempSessionData?.sessionTitle ? { sessionTitle: tempSessionData.sessionTitle } : {}),
            });

            if (result.type === 'error') {
                throw new Error(result.errorMessage);
            }
            if (result.type === 'success' && result.sessionId) {
                // Clear draft state on successful session creation
                clearNewSessionDraft();

                await sync.refreshSessions();

                // Write external context, session icon, and githubRepo to metadata
                if (tempSessionData?.externalContext || tempSessionData?.sessionIcon || tempSessionData?.githubRepo) {
                    const freshSession = storage.getState().sessions[result.sessionId];
                    if (freshSession?.metadata) {
                        try {
                            await sessionUpdateMetadataFields(
                                result.sessionId,
                                freshSession.metadata,
                                {
                                    ...(tempSessionData.externalContext ? { externalContext: tempSessionData.externalContext } : {}),
                                    ...(tempSessionData.sessionIcon ? { sessionIcon: tempSessionData.sessionIcon } : {}),
                                    ...(tempSessionData.githubRepo ? { githubRepo: tempSessionData.githubRepo } : {}),
                                },
                                freshSession.metadataVersion
                            );
                        } catch (e) {
                            console.warn('Failed to write external context to session metadata:', e);
                        }
                    } else {
                        console.warn('Session metadata not available after refresh, external context not written for session:', result.sessionId);
                    }
                }

                // Set permission mode and model mode on the session
                storage.getState().updateSessionPermissionMode(result.sessionId, permissionMode);
                if (modelMode && modelMode !== MODEL_MODE_DEFAULT) {
                    storage.getState().updateSessionModelMode(result.sessionId, modelMode);
                }
                sync.queueSessionModeConfigUpdate({
                    sessionId: result.sessionId,
                    agentType,
                    permissionMode,
                    modelMode: modelMode || MODEL_MODE_DEFAULT,
                    fastMode,
                    includeSessionEntry: true,
                    includeLastUsed: true,
                });

                // Send initial message if provided. Use sendOrQueueMessage (the /send
                // path) so the first message gets the same hedged-retry resilience and
                // the optimistic "processing…" status as a normal send.
                if (promptToSend || images.length > 0) {
                    await sync.sendOrQueueMessage(result.sessionId, promptToSend, undefined, images.length > 0 ? images : undefined);
                    clearImages();
                }

                router.replace(`/session/${result.sessionId}`, {
                    dangerouslySingular() {
                        return 'session'
                    },
                });
            } else {
                throw new Error('Session spawning failed - no session ID returned.');
            }
        } catch (error) {
            console.error('Failed to start session', error);
            let errorMessage = 'Failed to start session. Make sure the daemon is running on the target machine.';
            if (error instanceof Error) {
                errorMessage = error.message || errorMessage;
            }
            Modal.alert(t('common.error'), errorMessage);
            setIsCreating(false);
        }
    }, [selectedMachineId, selectedPath, sessionPrompt, sessionType, agentType, permissionMode, modelMode, fastMode, recentMachinePaths, router, images, clearImages, tempSessionData, selectedRepos]);

    const screenWidth = useWindowDimensions().width;

    // Machine online status for AgentInput (DRY - reused in info box too)
    const connectionStatus = React.useMemo(() => {
        if (!selectedMachine) return undefined;
        const isOnline = isMachineOnline(selectedMachine);

        return {
            text: isOnline ? 'online' : 'offline',
            color: isOnline ? theme.colors.success : theme.colors.textDestructive,
            dotColor: isOnline ? theme.colors.success : theme.colors.textDestructive,
            isPulsing: isOnline,
        };
    }, [selectedMachine, theme]);

    // Persist the current wizard state so it survives remounts and screen navigation
    // Uses debouncing to avoid excessive writes
    // Skip draft saving when opened via external context (e.g. DooTask "Start AI Session")
    const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => {
        if (tempSessionData) return;
        if (draftSaveTimerRef.current) {
            clearTimeout(draftSaveTimerRef.current);
        }
        draftSaveTimerRef.current = setTimeout(() => {
            const shouldKeepTabDefaultOutOfDraft = tabDefaultSelectionRef.current && !hasManualMachineOrPathSelectionRef.current;
            saveNewSessionDraft({
                input: sessionPrompt,
                selectedMachineId: shouldKeepTabDefaultOutOfDraft ? (persistedDraft?.selectedMachineId ?? null) : selectedMachineId,
                selectedPath: shouldKeepTabDefaultOutOfDraft ? (persistedDraft?.selectedPath ?? null) : selectedPath,
                agentType,
                permissionMode,
                sessionType,
                images: images.length > 0 ? images : undefined,
                updatedAt: Date.now(),
            });
        }, 250);
        return () => {
            if (draftSaveTimerRef.current) {
                clearTimeout(draftSaveTimerRef.current);
            }
        };
    }, [tempSessionData, sessionPrompt, selectedMachineId, selectedPath, agentType, permissionMode, sessionType, images]);

    const externalContextBanner = tempSessionData?.externalContext ? (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            gap: 8,
            backgroundColor: theme.colors.surface,
            borderRadius: 10,
            marginBottom: 8,
        }}>
            {tempSessionData.sessionIcon ? (() => {
                const resolved = resolveSessionIcon(tempSessionData.sessionIcon);
                return resolved.type === 'image' ? (
                    <Image
                        source={resolved.source}
                        style={{ width: 28, height: 28, borderRadius: 6 }}
                        contentFit="cover"
                    />
                ) : (
                    <Text style={{ fontSize: 18 }}>{resolved.value}</Text>
                );
            })() : null}
            <View style={{ flex: 1 }}>
                <Text style={{ ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary }}>
                    {tempSessionData.externalContext.source === 'dootask' ? t('dootask.title') : tempSessionData.externalContext.source}
                </Text>
                {tempSessionData.externalContext.title ? (
                    <Text style={{ ...Typography.default('semiBold'), fontSize: 14, color: theme.colors.text }} numberOfLines={1}>
                        {tempSessionData.externalContext.title}
                    </Text>
                ) : null}
            </View>
        </View>
    ) : null;

    const imageDropOverlay = isDraggingImage ? (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                top: 8,
                left: 8,
                right: 8,
                bottom: 8,
                zIndex: 997,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#007AFF',
                borderRadius: 8,
                backgroundColor: theme.dark ? 'rgba(0, 122, 255, 0.14)' : 'rgba(0, 122, 255, 0.08)',
            }}
        >
            <Ionicons name="images-outline" size={42} color="#007AFF" />
        </View>
    ) : null;

    // On iOS the composer's status row sits inside its card, leaving a plain stack of cards.
    // AgentInput adds 8pt above itself, so whatever sits directly above it takes 8pt to keep
    // every gap in the stack at 16pt.
    const iosCardStack = Platform.OS === 'ios' && !isRunningOnMac();
    const showRepoPicker = sessionType === 'worktree' && !!selectedMachineId;
    return (
        <View ref={dropZoneRef} style={[styles.container, { position: 'relative' }, Platform.OS !== 'web' && { paddingTop: 40 + softHeaderInset }]}>
            {imageDropOverlay}
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Animated.View style={animatedInputStyle}>
                {/* External context banner */}
                {externalContextBanner && (
                    <View style={{ paddingHorizontal: screenWidth > 700 ? 16 : 8, marginBottom: 8 }}>
                        <View style={{ maxWidth: layout.maxWidth, width: '100%', paddingHorizontal: 8, alignSelf: 'center' }}>
                            {externalContextBanner}
                        </View>
                    </View>
                )}

                {/* Session type selector */}
                <View style={{ paddingHorizontal: screenWidth > 700 ? 16 : 8, marginBottom: iosCardStack && !showRepoPicker ? 8 : 16 }}>
                    <View style={{ maxWidth: layout.maxWidth, width: '100%', paddingHorizontal: 8, alignSelf: 'center' }}>
                        <SessionTypeSelector
                            value={sessionType}
                            onChange={setSessionType}
                        />
                    </View>
                </View>

                {/* Repo picker for worktree mode */}
                {showRepoPicker && (
                    <View style={{ paddingHorizontal: screenWidth > 700 ? 16 : 8, marginBottom: iosCardStack ? 8 : 12 }}>
                        <View style={{ maxWidth: layout.maxWidth, width: '100%', paddingHorizontal: 8, alignSelf: 'center' }}>
                            <RepoPickerBar
                                machineId={selectedMachineId}
                                selectedRepos={selectedRepos}
                                onReposChange={setSelectedRepos}
                                onAddDirectory={handleAddDirectory}
                            />
                        </View>
                    </View>
                )}

                {/* AgentInput with inline chips - sticky at bottom */}
                <View style={{ paddingBottom: safeArea.bottom + (Platform.OS === 'web' ? 8 : 0) }}>
                    <AgentInput
                        panelSideMargin
                        value={sessionPrompt}
                        onChangeText={setSessionPrompt}
                        inputHistory={inputHistory}
                        onSend={handleCreateSession}
                        isSendDisabled={!canCreate}
                        allowEmptySend={true}
                        isSending={isCreating}
                        placeholder={t('session.initialMessage')}
                        autocompletePrefixes={autocomplete.prefixes}
                        autocompleteSuggestions={autocomplete.suggestions}
                        agentType={agentType}
                        agentModels={agentType === 'qoder' ? qoderModels : undefined}
                        onAgentClick={handleAgentClick}
                        permissionMode={permissionMode}
                        onPermissionModeChange={handlePermissionModeChange}
                        modelMode={modelMode}
                        onModelModeChange={handleModelModeChange}
                        fastMode={fastMode}
                        onFastModeChange={handleFastModeChange}
                        connectionStatus={connectionStatus}
                        machineName={selectedMachine?.metadata?.displayName || selectedMachine?.metadata?.host}
                        onMachineClick={handleMachineClick}
                        currentPath={sessionType === 'worktree' && selectedRepos.length > 0 ? t('machine.worktreeAutoPath') : formatPathRelativeToHome(selectedPath, selectedMachine?.metadata?.homeDir)}
                        onPathClick={sessionType === 'worktree' && selectedRepos.length > 0 ? undefined : handlePathClick}
                        images={images}
                        onImagesChange={(newImages) => {
                            const currentUris = new Set(newImages.map(img => img.uri));
                            images.forEach((img, index) => {
                                if (!currentUris.has(img.uri)) {
                                    removeImage(index);
                                }
                            });
                        }}
                        onImageButtonPress={handleImageButtonPress}
                        imageButtonIcon="image-outline"
                        imageMenuItems={imagePickerMenuItems}
                        supportsImages={supportsImages}
                    />
                </View>
                </Animated.View>
            </View>

            {/* Hidden file input for web image upload */}
            {Platform.OS === 'web' && (
                <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange as any}
                />
            )}

            {/* Image Picker Sheet (native) */}
            <ActionMenuModal
                visible={imagePickerSheetVisible}
                items={imagePickerMenuItems}
                onClose={() => setImagePickerSheetVisible(false)}
                deferItemPress
            />

            {/* Branch picker for Add Directory flow */}
            <ActionMenuModal
                visible={addDirBranchMenu.visible}
                title={t('newSession.repos.targetBranch')}
                items={addDirBranchMenu.items}
                onClose={() => {
                    setAddDirBranchMenu({ visible: false, items: [] });
                    addDirBranchResolveRef.current?.(undefined);
                    addDirBranchResolveRef.current = null;
                }}
            />

            {/* Folder picker for Add Directory flow */}
            {selectedMachineId && (
                <FolderPickerSheet
                    ref={folderPickerRef}
                    machineId={selectedMachineId}
                    homeDir={selectedMachine?.metadata?.homeDir}
                    onSelect={handleFolderSelected}
                />
            )}
        </View>
    );
}

export default React.memo(NewSessionWizard);
