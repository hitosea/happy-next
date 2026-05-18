/**
 * Suggestion skills functionality for Codex `$skill` mentions.
 * Reads discovered skills from session metadata.
 */

import Fuse from 'fuse.js';
import { getSession } from './storage';

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
    const session = getSession(sessionId);
    if (!session?.metadata?.skills) {
        return [];
    }

    return session.metadata.skills;
}

export async function searchSkills(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): Promise<SkillItem[]> {
    const { limit, threshold = 0.35 } = options;
    const skills = getSkillsFromSession(sessionId);

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

export function getAllSkills(sessionId: string): SkillItem[] {
    return getSkillsFromSession(sessionId);
}
