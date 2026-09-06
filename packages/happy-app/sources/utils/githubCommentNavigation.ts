export type GithubCommentKind = 'issue' | 'pull';

function encodeRouteSegment(value: string): string {
    return encodeURIComponent(value);
}

export function getGithubCommentFallbackRoute(
    kind: GithubCommentKind,
    owner: string,
    repo: string,
    number: number,
): string {
    const ownerSegment = encodeRouteSegment(owner);
    const repoSegment = encodeRouteSegment(repo);
    const detailSegment = kind === 'pull' ? 'pulls' : 'issue';
    return `/repos/${ownerSegment}/${repoSegment}/${detailSegment}/${number}`;
}
