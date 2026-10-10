import Fuse from 'fuse.js';
import { getSession, storage } from './storage';
import type { SessionCapabilities } from './storageTypes';

export type SkillScope = 'REPO' | 'USER' | 'ADMIN' | 'SYSTEM';

export interface SkillItem {
    name: string;
    description: string;
    scope: SkillScope;
    path: string;
    displayName?: string;
    shortDescription?: string;
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

function getSkillsFromSession(sessionId: string): SkillItem[] {
    const capabilities = storage.getState().sessionCapabilities[sessionId]?.capabilities;
    if (capabilities?.skills) {
        return capabilities.skills;
    }

    const session = getSession(sessionId);
    if (!session?.metadata?.skills) {
        return [];
    }

    return session.metadata.skills;
}

export function searchSkills(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): SkillItem[] {
    return searchSkillItems(getSkillsFromSession(sessionId), query, options);
}

// Searches the skills discovered for a session that has not started yet
export function searchCapabilitySkills(
    capabilities: SessionCapabilities,
    query: string,
    options: SearchOptions = {}
): SkillItem[] {
    return searchSkillItems(capabilities.skills ?? [], query, options);
}

function searchSkillItems(
    skills: SkillItem[],
    query: string,
    options: SearchOptions
): SkillItem[] {
    const { limit, threshold = 0.35 } = options;

    if (!query || query.trim().length === 0) {
        return limit ? skills.slice(0, limit) : skills;
    }

    const fuse = new Fuse(skills, {
        keys: [
            { name: 'name', weight: 0.45 },
            { name: 'displayName', weight: 0.25 },
            { name: 'description', weight: 0.2 },
            { name: 'shortDescription', weight: 0.1 },
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
    });

    return fuse.search(query, limit ? { limit } : undefined).map(result => result.item);
}
