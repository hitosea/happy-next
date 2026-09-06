export const DOOPUSH_RELAY_CAPABILITY = 'doopush-relay-v1';

export interface SelectablePushToken {
    provider: string;
    installationId: string | null;
}

export function supportsDooPushRelay(header: string | string[] | undefined): boolean {
    const value = Array.isArray(header) ? header.join(',') : header;
    return value?.split(',').some(
        (capability) => capability.trim() === DOOPUSH_RELAY_CAPABILITY,
    ) ?? false;
}

export function selectPushTokensForClient<T extends SelectablePushToken>(
    tokens: readonly T[],
    dooPushRelaySupported: boolean,
): T[] {
    if (!dooPushRelaySupported) {
        return tokens.filter(({ provider }) => provider === 'expo');
    }

    const dooPushInstallations = new Set(
        tokens
            .filter(({ provider, installationId }) => provider === 'doopush' && installationId)
            .map(({ installationId }) => installationId),
    );

    return tokens.filter(({ provider, installationId }) =>
        provider === 'doopush'
        || (
            provider === 'expo'
            && (!installationId || !dooPushInstallations.has(installationId))
        )
    );
}
