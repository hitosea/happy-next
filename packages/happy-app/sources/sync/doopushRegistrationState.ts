import { MMKV } from 'react-native-mmkv';
import type { DooPushVendor } from 'doopush-react-native-sdk';

const registrationStorage = new MMKV({ id: 'doopush-registration' });
const REGISTRATION_KEY = 'last-synced-registration';
const DEFAULT_BASE_URL = 'https://doopush.com/api/v1';

interface DooPushRegistrationSnapshot {
    scope: string;
    token: string;
    deviceId: string;
    vendor: DooPushVendor;
    invalidated?: boolean;
    pendingReplacedTokens?: string[];
}

export function getDooPushRegistrationScope(appId: string, baseURL?: string): string {
    const normalizedBaseURL = (baseURL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    return `${normalizedBaseURL}|${appId.trim()}`;
}

function readRegistrationSnapshot(): DooPushRegistrationSnapshot | null {
    const value = registrationStorage.getString(REGISTRATION_KEY);
    if (!value) {
        return null;
    }

    try {
        const snapshot = JSON.parse(value) as Partial<DooPushRegistrationSnapshot>;
        if (
            typeof snapshot.scope !== 'string'
            || typeof snapshot.token !== 'string'
            || typeof snapshot.deviceId !== 'string'
            || typeof snapshot.vendor !== 'string'
        ) {
            return null;
        }
        const pendingReplacedTokens = Array.isArray(snapshot.pendingReplacedTokens)
            ? [...new Set(snapshot.pendingReplacedTokens.filter(
                (token): token is string => typeof token === 'string' && token.length > 0,
            ))]
            : [];
        return {
            ...snapshot as DooPushRegistrationSnapshot,
            pendingReplacedTokens: undefined,
            ...(pendingReplacedTokens.length > 0 ? { pendingReplacedTokens } : {}),
        };
    } catch {
        return null;
    }
}

export function getStoredDooPushRegistrationToken(): string | null {
    return readRegistrationSnapshot()?.token ?? null;
}

export function isDooPushRegistrationCurrent(snapshot: DooPushRegistrationSnapshot): boolean {
    const stored = readRegistrationSnapshot();
    return stored?.invalidated !== true
        && stored?.scope === snapshot.scope
        && stored.token === snapshot.token
        && stored.deviceId === snapshot.deviceId
        && stored.vendor === snapshot.vendor;
}

export function invalidateDooPushRegistration(): void {
    const stored = readRegistrationSnapshot();
    if (!stored) {
        return;
    }

    registrationStorage.set(REGISTRATION_KEY, JSON.stringify({
        ...stored,
        invalidated: true,
    }));
}

export function getReplacedDooPushRegistrationTokens(currentToken: string): string[] {
    const stored = readRegistrationSnapshot();
    if (!stored) {
        return [];
    }
    return [...new Set([
        ...(stored.pendingReplacedTokens ?? []),
        stored.token,
    ].filter((token) => token !== currentToken))];
}

export function markDooPushRegistrationCurrent(
    snapshot: DooPushRegistrationSnapshot,
    replacedTokenCandidates: readonly string[] = [],
): void {
    const pendingReplacedTokens = [...new Set([
        ...getReplacedDooPushRegistrationTokens(snapshot.token),
        ...replacedTokenCandidates.filter((token) => token !== snapshot.token),
    ])];
    registrationStorage.set(REGISTRATION_KEY, JSON.stringify({
        ...snapshot,
        invalidated: undefined,
        pendingReplacedTokens: undefined,
        ...(pendingReplacedTokens.length > 0 ? { pendingReplacedTokens } : {}),
    }));
}

export function acknowledgeReplacedDooPushRegistrationTokens(
    currentToken: string,
    acknowledgedTokens: readonly string[],
): void {
    const stored = readRegistrationSnapshot();
    if (!stored || stored.token !== currentToken) {
        return;
    }

    const acknowledged = new Set(acknowledgedTokens);
    const pendingReplacedTokens = (stored.pendingReplacedTokens ?? [])
        .filter((token) => !acknowledged.has(token));
    registrationStorage.set(REGISTRATION_KEY, JSON.stringify({
        ...stored,
        pendingReplacedTokens: undefined,
        ...(pendingReplacedTokens.length > 0 ? { pendingReplacedTokens } : {}),
    }));
}
