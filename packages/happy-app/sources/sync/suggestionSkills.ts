import { getSession, storage } from './storage';
import type { SessionCapabilities } from './storageTypes';
import { getRecentSuggestions } from './recentSuggestions';
import { rankSuggestions } from './suggestionRanking';

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

export function getSkillsFromSession(sessionId: string): SkillItem[] {
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
    return searchSkillItems(getSkillsFromSession(sessionId), query, getSession(sessionId)?.metadata?.flavor ?? 'claude', options);
}

// Searches the skills discovered for a session that has not started yet
export function searchCapabilitySkills(
    capabilities: SessionCapabilities,
    agent: string,
    query: string,
    options: SearchOptions = {}
): SkillItem[] {
    return searchSkillItems(capabilities.skills ?? [], query, agent, options);
}

function searchSkillItems(
    skills: SkillItem[],
    query: string,
    agent: string,
    options: SearchOptions
): SkillItem[] {
    return rankSuggestions(skills, query, {
        name: (skill) => skill.name,
        recentKey: (skill) => `$${skill.name}`,
        otherText: (skill) => [skill.displayName, skill.description, skill.shortDescription],
        fuzzyKeys: [
            { name: 'name', weight: 0.45 },
            { name: 'displayName', weight: 0.25 },
            { name: 'description', weight: 0.2 },
            { name: 'shortDescription', weight: 0.1 },
        ],
        recent: getRecentSuggestions(agent),
        threshold: options.threshold ?? 0.35,
        limit: options.limit,
    });
}
