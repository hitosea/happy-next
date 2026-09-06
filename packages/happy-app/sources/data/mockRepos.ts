export interface RepoInfo {
    fullName: string;
    name: string;
    owner: string;
    ownerAvatarUrl: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    watchers: number;
    openIssuesCount: number;
    openPRsCount: number;
    commitsCount: number;
    repoSizeKb: number;
    createdAt: string;
    pushedAt: string;
    defaultBranch: string;
    branches: string[];
    updatedAt: string;
    isPrivate: boolean;
    isFork: boolean;
    readme: string;
    viewerHasStarred?: boolean;
    lastSyncedAt?: string;
    /** Machine ID this repo is bound to (required for code storage) */
    machineId?: string;
    /** Path on the machine where code is stored */
    bindingPath?: string;
}

/** Format lastSyncedAt to a human-readable string */
export function formatSyncTime(lastSyncedAt?: string): string {
    if (!lastSyncedAt) return 'Never synced';
    const now = Date.now();
    const then = new Date(lastSyncedAt).getTime();
    const diffMs = now - then;
    const diffM = Math.floor(diffMs / (1000 * 60));
    if (diffM < 1) return 'Just synced';
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
}

export interface RepoCommit {
    sha: string;
    message: string;
    author: string;
    authorAvatar?: string;
    createdAt: string;
}

export interface RepoContributor {
    login: string;
    avatarUrl: string;
    commitsCount: number;
}

export interface RepoPR {
    number: number;
    title: string;
    author: string;
    authorAvatarUrl: string;
    createdAt: string;
    mergedAt?: string;
    status: 'open' | 'closed' | 'merged';
    headRefName?: string;
    body?: string;
}

export interface RepoFileContent {
    path: string;
    content: string;
    size: number;
    isBinary: boolean;
}

export interface RepoIssue {
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    author: string;
    authorAvatarUrl: string;
    createdAt: string;
    labels: { name: string; color: string }[];
    linkedPR?: number;
}

export interface RepoIssueComment {
    id: number;
    body: string;
    author: string;
    authorAvatarUrl: string;
    authorAssociation: string;
    createdAt: string;
    updatedAt: string;
}

export interface RepoSession {
    id: string;
    title: string;
    status: 'active' | 'completed' | 'failed';
    createdAt: string;
    issueNumber?: number;
    ownerType: 'user' | 'ai'; // Added identity discriminator
    ownerName?: string;
    currentActivity?: string; // What AI is doing right now
}

export interface CloudMachine {
    id: string;
    status: 'running' | 'creating' | 'sleeping' | 'stopped';
    lastActiveAt: string;
    branch: string;
}

export interface AutomationRule {
    enabled: boolean;
    triggerLabels: string[];
    scheduleCron: string | null;
    model: string;
    permissionMode: string;
}

export const CRON_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Daily', value: '0 0 * * *' },
    { label: 'Weekly', value: '0 0 * * 0' },
] as const;

export function getCronLabel(cron: string | null): string {
    if (!cron) return 'Disabled';
    const preset = CRON_PRESETS.find((p) => p.value === cron);
    return preset?.label ?? cron;
}

/**
 * Returns a human-readable description of a cron expression.
 * Handles common presets and provides fallback descriptions for custom expressions.
 */
export function describeCron(cron: string): string {
    const preset = CRON_PRESETS.find((p) => p.value === cron);
    if (preset) return preset.label;

    // Parse common cron patterns for custom expressions
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every hour: "0 * * * *"
    if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        if (minute === '0') return 'Every hour';
        return `At minute ${minute} of every hour`;
    }

    // Every N hours: "0 */N * * *"
    if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const interval = hour.slice(2);
        return `Every ${interval} hours`;
    }

    // Daily at specific hour: "0 H * * *"
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return `Daily at ${timeStr}`;
    }

    // Weekly: "0 H * * D" where D is 0-6
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const d = parseInt(dayOfWeek, 10);
        const dayStr = days[d] ?? `Day ${dayOfWeek}`;
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return `Every ${dayStr} at ${timeStr}`;
    }

    return cron;
}

// GitHub repo data is now fetched from the server via /v1/github/* endpoints.
// See @/sync/apiGithubData.ts and @/hooks/useGithubData.ts.

// ---------------------------------------------------------------------------
// Shared creating repo state — connects add.tsx → repos/index.tsx
// Module-level so it survives navigation between the two screens
// ---------------------------------------------------------------------------
let _pendingCreatingRepo: RepoInfo | null = null;
let _pendingCreatingListeners: Array<(repo: RepoInfo | null) => void> = [];
let _batchListeners: Array<(repos: RepoInfo[]) => void> = [];

export function setPendingCreatingRepo(repo: RepoInfo | null): void {
    _pendingCreatingRepo = repo;
    _pendingCreatingListeners.forEach((fn) => fn(repo));
}

export function getPendingCreatingRepo(): RepoInfo | null {
    return _pendingCreatingRepo;
}

export function subscribeCreatingRepo(fn: (repo: RepoInfo | null) => void): () => void {
    _pendingCreatingListeners.push(fn);
    return () => {
        _pendingCreatingListeners = _pendingCreatingListeners.filter((l) => l !== fn);
    };
}

/** Subscribe to batch add events (multiple repos added at once) */
export function subscribeCreatingBatch(fn: (repos: RepoInfo[]) => void): () => void {
    _batchListeners.push(fn);
    return () => {
        _batchListeners = _batchListeners.filter((l) => l !== fn);
    };
}

/**
 * Add multiple repos at once. Fires the batch event immediately so all repos
 * appear in the list at once; individual repo subscribers are NOT called.
 */
export function setPendingCreatingBatch(repos: RepoInfo[]): void {
    if (repos.length === 0) return;
    _batchListeners.forEach((fn) => fn(repos));
}

// ---------------------------------------------------------------------------
// Mock state helpers — manage local component state, not a global store
// ---------------------------------------------------------------------------

/** Parse a GitHub URL to extract owner/repo, or null if invalid */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+)\/?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/** Parse a GitLab URL to extract owner/repo, or null if invalid */
export function parseGitLabUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/\s]+)\/?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/** Parse a generic git URL (SSH like git@host:owner/repo.git or other git URLs) */
export function parseGenericGitUrl(url: string): { owner: string; repo: string } | null {
    // Try SSH format: git@host:owner/repo.git or git@host:owner/repo
    const sshMatch = url.match(/^git@[^:]+:([^/]+)\/([^/\s]+)\/?$/);
    if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/, '') };
    }
    // Try HTTPS/HTTP format with .git suffix: https://host/owner/repo.git
    const httpsMatch = url.match(/^https?:\/\/[^\/]+\/([^/]+)\/([^/\s]+)\.git\/?$/);
    if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    // Try another HTTPS format: https://host/owner/repo
    const httpsPlainMatch = url.match(/^https?:\/\/[^\/]+\/([^/]+)\/([^/\s]+)\/?$/);
    if (httpsPlainMatch) {
        return { owner: httpsPlainMatch[1], repo: httpsPlainMatch[2].replace(/\.git$/, '') };
    }
    return null;
}

/** Step labels and weight boundaries for the "Creating" progress bar */
export const CREATING_STEPS = [
    { label: 'Pulling Docker Image…', minWeight: 0, maxWeight: 33 },
    { label: 'Cloning Repository…', minWeight: 33, maxWeight: 66 },
    { label: 'Starting Happy Container…', minWeight: 66, maxWeight: 100 },
] as const;

/** Given a progress 0-100, returns the current creating step label */
export function getCreatingStepLabel(progress: number): string {
    for (const step of CREATING_STEPS) {
        if (progress <= step.maxWeight) return step.label;
    }
    return CREATING_STEPS[CREATING_STEPS.length - 1].label;
}

/** Activity messages shown while AI is working */
export const AI_ACTIVITIES = [
    'Analyzing repository structure…',
    'Searching for relevant code patterns…',
    'Generating implementation plan…',
    'Applying code changes…',
    'Running tests…',
    'Verifying changes…',
    'Creating Pull Request…',
];

/** Machine statuses and their colors */
export const CLOUD_STATUS_CONFIG: Record<CloudMachine['status'], { color: string; label: string }> = {
    running: { color: '#34C759', label: 'Running' },
    creating: { color: '#FF9500', label: 'Creating…' },
    sleeping: { color: '#AF52DE', label: 'Sleeping' },
    stopped: { color: '#8E8E93', label: 'Stopped' },
};

/** Machine statuses that count as "online" for CloudMachine */
export const ONLINE_CLOUD_MACHINE_STATUSES: CloudMachine['status'][] = ['running', 'creating', 'sleeping'];

export function isCloudMachineOnline(machine: CloudMachine): boolean {
    return ONLINE_CLOUD_MACHINE_STATUSES.includes(machine.status);
}

// ---------------------------------------------------------------------------
// Mock Lab Machines — separate from the real Machine storage
// These are cloud machines managed by the happy-agent container
// ---------------------------------------------------------------------------

export type MockLabMachineType = 'local' | 'cloud';
export type MockLabMachineStatus = 'online' | 'offline' | 'creating' | 'connecting';

export interface MockLabMachine {
    id: string;
    type: MockLabMachineType;
    name: string;
    host: string;
    status: MockLabMachineStatus;
    createdAt: string;
    lastSeen: string;
    /** Current creating progress 0-100, only valid when status === 'creating' */
    creatingProgress: number;
    /** Which registration method was used */
    registeredVia: 'qr' | 'docker' | 'manual' | 'server';
}

const MOCK_LAB_MACHINES: MockLabMachine[] = [
    {
        id: 'lab-mach-1',
        type: 'cloud',
        name: 'My Cloud Server',
        host: 'cloud.example.com:3000',
        status: 'online',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        lastSeen: new Date().toISOString(),
        creatingProgress: 100,
        registeredVia: 'docker',
    },
    {
        id: 'lab-mach-2',
        type: 'cloud',
        name: 'Docker Desktop Agent',
        host: 'localhost:3001',
        status: 'online',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        lastSeen: new Date().toISOString(),
        creatingProgress: 100,
        registeredVia: 'docker',
    },
];

// ---------------------------------------------------------------------------
// Mock Lab Machine state management
// ---------------------------------------------------------------------------
type MachineListener = (machines: MockLabMachine[]) => void;
let _mockLabMachines: MockLabMachine[] = [...MOCK_LAB_MACHINES];
let _machineListeners: MachineListener[] = [];

function _notifyMachineListeners(): void {
    _machineListeners.forEach((fn) => fn([..._mockLabMachines]));
}

export function getMockLabMachines(): MockLabMachine[] {
    return [..._mockLabMachines];
}

export function subscribeMockLabMachines(fn: MachineListener): () => void {
    _machineListeners.push(fn);
    return () => {
        _machineListeners = _machineListeners.filter((l) => l !== fn);
    };
}

export function getMockLabMachine(id: string): MockLabMachine | undefined {
    return _mockLabMachines.find((m) => m.id === id);
}

export function addMockLabMachine(machine: MockLabMachine): void {
    _mockLabMachines = [..._mockLabMachines, machine];
    _notifyMachineListeners();
}

export function updateMockLabMachine(id: string, updates: Partial<MockLabMachine>): void {
    _mockLabMachines = _mockLabMachines.map((m) => (m.id === id ? { ...m, ...updates } : m));
    _notifyMachineListeners();
}

export function removeMockLabMachine(id: string): void {
    _mockLabMachines = _mockLabMachines.filter((m) => m.id !== id);
    _notifyMachineListeners();
}

export function generateDockerCommand(machineId: string): string {
    return `docker run -e HAPPY_MACHINE_ID=${machineId} -p 3000:3000 happy-agent`;
}

export const MACHINE_TYPE_CONFIG: Record<MockLabMachineType, { label: string; color: string }> = {
    local: { label: 'Local', color: '#34C759' },
    cloud: { label: 'Cloud', color: '#5AC8FA' },
};

export const MACHINE_STATUS_CONFIG: Record<MockLabMachineStatus, { color: string; label: string }> = {
    online: { color: '#34C759', label: 'Online' },
    offline: { color: '#8E8E93', label: 'Offline' },
    creating: { color: '#FF9500', label: 'Creating…' },
    connecting: { color: '#FF9500', label: 'Connecting…' },
};

export const ONLINE_MACHINE_STATUSES: MockLabMachineStatus[] = ['online', 'creating', 'connecting'];

export function isMockLabMachineOnline(machine: MockLabMachine): boolean {
    return ONLINE_MACHINE_STATUSES.includes(machine.status);
}
