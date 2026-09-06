import type { Metadata } from '@/sync/storageTypes';

/**
 * A registered repository on a specific machine.
 * Stored per-machine in UserKVStore with key `repos:{machineId}`.
 */
export interface RegisteredRepo {
    id: string;
    path: string;
    displayName: string;
    githubOwner?: string;
    githubRepo?: string;
    defaultTargetBranch?: string;
    defaultWorkingDir?: string;
    setupScript?: string;
    parallelSetup?: boolean;
    cleanupScript?: string;
    archiveScript?: string;
    devServerScript?: string;
    copyFiles?: string;
    lastUsedAt?: number;
}

export function matchesGithubRepo(r: RegisteredRepo, owner: string, repo: string): boolean {
    return r.githubOwner === owner && r.githubRepo === repo;
}

/**
 * Pick the (only) RegisteredRepo binding for an AutoPilot run.
 *
 * Repo ↔ machine is strictly 1:1: `handlePathConfirm` drop-stales other machines' bindings
 * for the same GitHub owner/repo, so `candidates` is always 0 or 1 entries. The function
 * shape is preserved as a stable entrypoint in case binding-selection rules ever need
 * to evolve (e.g., online/offline fallback), but today it just returns the first candidate.
 */
export function pickAutoPilotBinding<T extends RegisteredRepo & { machineId: string }>(
    candidates: T[],
    _isOnline: (machineId: string) => boolean,
): T | null {
    return candidates[0] ?? null;
}

/**
 * A repo within a workspace session, stored in session metadata.
 */
export interface WorkspaceRepo {
    repoId?: string;
    path: string;
    basePath: string;
    branchName: string;
    targetBranch?: string;
    prUrl?: string;
    displayName?: string;
}

/**
 * Unified accessor for workspace repos from session metadata.
 * Handles both new `workspaceRepos` field and legacy single-repo worktree fields.
 */
export function getWorkspaceRepos(metadata: Metadata | null | undefined): WorkspaceRepo[] {
    if (!metadata) return [];
    if (metadata.workspaceRepos && metadata.workspaceRepos.length > 0) {
        return metadata.workspaceRepos;
    }
    // Legacy fallback: single-repo worktree
    if (metadata.isWorktree && metadata.worktreeBasePath) {
        return [{
            path: metadata.path,
            basePath: metadata.worktreeBasePath,
            branchName: metadata.worktreeBranchName || '',
            prUrl: metadata.worktreePrUrl,
        }];
    }
    return [];
}

/**
 * Check if a session is a multi-repo workspace (not legacy single-repo).
 */
export function isMultiRepoWorkspace(metadata: Metadata | null | undefined): boolean {
    return (metadata?.workspaceRepos?.length ?? 0) > 1;
}

/**
 * UserKVStore key for registered repos on a machine.
 */
export const REPOS_KV_KEY = (machineId: string) => `repos:${machineId}`;
