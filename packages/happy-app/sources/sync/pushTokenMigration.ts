export function getSupersededPushTokens(
    currentToken: string,
    candidates: Array<string | null | undefined>,
): string[] {
    return [...new Set(candidates.filter(
        (token): token is string =>
            typeof token === 'string' && token.length > 0 && token !== currentToken,
    ))];
}
