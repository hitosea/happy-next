import type { View } from 'react-native';

// The hover card's project path finds that project in the session list: the list says whether
// and how, and each project header says where it is (by its collapse key).
type SessionProjectLocator = {
    canLocate: (sessionId: string) => boolean;
    locate: (sessionId: string) => void;
};

let locator: SessionProjectLocator | null = null;
const projectHeaders = new Map<string, View>();

export function setSessionProjectLocator(next: SessionProjectLocator | null) {
    locator = next;
}

export function canLocateSessionProject(sessionId: string): boolean {
    return locator?.canLocate(sessionId) ?? false;
}

export function locateSessionProject(sessionId: string) {
    locator?.locate(sessionId);
}

export function registerProjectHeader(collapseKey: string, header: View | null) {
    if (header) projectHeaders.set(collapseKey, header);
    else projectHeaders.delete(collapseKey);
}

export function getProjectHeader(collapseKey: string): View | null {
    return projectHeaders.get(collapseKey) ?? null;
}

// A located header flashes like a session row the list jumped to (see SessionRowFlash).
export function getProjectHeaderFlashId(collapseKey: string): string {
    return `project:${collapseKey}`;
}
