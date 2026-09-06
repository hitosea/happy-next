import { z } from "zod";
import { type Fastify } from "../types";
import { getUserOctokit, GitHubNotConnectedError } from "@/app/github/githubApi";
import type { RequestError } from "octokit";
import { githubImageUpload } from "@/app/github/githubImageUpload";

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

const RepoInfoSchema = z.object({
    fullName: z.string(),
    name: z.string(),
    owner: z.string(),
    ownerAvatarUrl: z.string(),
    description: z.string(),
    language: z.string(),
    stars: z.number(),
    forks: z.number(),
    watchers: z.number(),
    openIssuesCount: z.number(),
    openPRsCount: z.number(),
    commitsCount: z.number(),
    repoSizeKb: z.number(),
    createdAt: z.string(),
    pushedAt: z.string(),
    defaultBranch: z.string(),
    branches: z.array(z.string()),
    updatedAt: z.string(),
    isPrivate: z.boolean(),
    isFork: z.boolean(),
    readme: z.string(),
    viewerHasStarred: z.boolean().optional(),
});

const RepoIssueSchema = z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    state: z.enum(['open', 'closed']),
    author: z.string(),
    authorAvatarUrl: z.string(),
    createdAt: z.string(),
    labels: z.array(z.object({ name: z.string(), color: z.string() })),
    aiStatus: z.enum(['idle', 'running', 'completed', 'failed']),
    linkedPR: z.number().optional(),
    currentPhase: z.enum(['analyze', 'modify', 'pr']).optional(),
    progress: z.number().optional(),
});

const RepoIssueCommentSchema = z.object({
    id: z.number(),
    body: z.string(),
    author: z.string(),
    authorAvatarUrl: z.string(),
    authorAssociation: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const RepoPRSchema = z.object({
    number: z.number(),
    title: z.string(),
    author: z.string(),
    authorAvatarUrl: z.string(),
    createdAt: z.string(),
    mergedAt: z.string().optional(),
    status: z.enum(['open', 'closed', 'merged']),
    headRefName: z.string().optional(),
    body: z.string().optional(),
});

const RepoCommitSchema = z.object({
    sha: z.string(),
    message: z.string(),
    author: z.string(),
    authorAvatar: z.string().optional(),
    createdAt: z.string(),
});

const RepoContributorSchema = z.object({
    login: z.string(),
    avatarUrl: z.string(),
    commitsCount: z.number(),
});

const RepoFileContentSchema = z.object({
    path: z.string(),
    content: z.string(),
    size: z.number(),
    isBinary: z.boolean(),
});

const ErrorSchema = z.object({ error: z.string() });

const OwnerRepoParams = z.object({ owner: z.string(), repo: z.string() });
const OwnerRepoNumberParams = OwnerRepoParams.extend({ number: z.coerce.number().int() });

const githubErrorResponses = {
    401: ErrorSchema,
    404: ErrorSchema,
    422: ErrorSchema,
    429: ErrorSchema,
    500: ErrorSchema,
};

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

const PaginationQuery = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
});

function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
    return z.object({
        items: z.array(itemSchema),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
        totalCount: z.number().optional(),
    });
}

function encodeCursor(page: number): string {
    return `page:${page}`;
}

function decodeCursor(cursor: string): number {
    const match = cursor.match(/^page:(\d+)$/);
    return match ? parseInt(match[1], 10) : 1;
}

// ---------------------------------------------------------------------------
// Mappers — convert GitHub API responses to our schema
// ---------------------------------------------------------------------------

function mapIssue(i: any): z.infer<typeof RepoIssueSchema> {
    return {
        number: i.number,
        title: i.title,
        body: i.body ?? '',
        state: i.state as 'open' | 'closed',
        author: i.user?.login ?? '',
        authorAvatarUrl: i.user?.avatar_url ?? '',
        createdAt: i.created_at,
        labels: (i.labels ?? []).map((l: any) => {
            if (typeof l === 'string') return { name: l, color: '' };
            return { name: l.name ?? '', color: l.color ?? '' };
        }),
        aiStatus: 'idle' as const,
    };
}

function mapPR(p: any): z.infer<typeof RepoPRSchema> {
    return {
        number: p.number,
        title: p.title,
        author: p.user?.login ?? '',
        authorAvatarUrl: p.user?.avatar_url ?? '',
        createdAt: p.created_at,
        mergedAt: p.merged_at ?? undefined,
        status: p.merged_at ? 'merged' as const : p.state as 'open' | 'closed',
        headRefName: p.head?.ref,
        body: p.body ?? undefined,
    };
}

function mapComment(c: any): z.infer<typeof RepoIssueCommentSchema> {
    return {
        id: c.id,
        body: c.body ?? '',
        author: c.user?.login ?? '',
        authorAvatarUrl: c.user?.avatar_url ?? '',
        authorAssociation: c.author_association ?? 'NONE',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleGitHubError(error: unknown, reply: any) {
    if (error instanceof GitHubNotConnectedError) {
        return reply.code(401).send({ error: 'github_not_connected' });
    }
    const status = (error as RequestError)?.status;
    const message = (error as any)?.message ?? String(error);
    console.error('[github-routes] error:', status, message, (error as any)?.response?.data ?? '');
    if (status === 401 || status === 403) {
        return reply.code(401).send({ error: 'github_token_expired' });
    }
    if (status === 404) {
        return reply.code(404).send({ error: 'not_found' });
    }
    if (status === 410) {
        return reply.code(422).send({ error: 'This feature has been disabled in this repository' });
    }
    if (status === 422) {
        return reply.code(422).send({ error: message });
    }
    if (status === 429) {
        return reply.code(429).send({ error: 'rate_limited' });
    }
    return reply.code(500).send({ error: message });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function githubRoutes(app: Fastify) {

    // List authenticated user's repos
    app.get('/v1/github/repos', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                sort: z.enum(['created', 'updated', 'pushed', 'full_name']).default('updated'),
                search: z.string().optional(),
            }).merge(PaginationQuery),
            response: { 200: paginatedSchema(RepoInfoSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { sort, cursor, limit, search } = request.query;

            let nodes: any[] = [];
            let hasNextPage = false;
            let endCursor: string | null = null;
            let totalCount: number | undefined;

            if (search && search.trim()) {
                const sanitized = search.replace(/[^\w\s\-_.]/g, '').trim();
                const searchQuery = `${sanitized} in:name fork:true user:@me`;
                const gqlSearch = `
                    query($query: String!, $first: Int!, $after: String) {
                        search(query: $query, type: REPOSITORY, first: $first, after: $after) {
                            nodes {
                                ... on Repository {
                                    nameWithOwner
                                    name
                                    owner { login avatarUrl }
                                    description
                                    primaryLanguage { name }
                                    stargazerCount
                                    forkCount
                                    watchers { totalCount }
                                    issues(states: OPEN) { totalCount }
                                    pullRequests(states: OPEN) { totalCount }
                                    diskUsage
                                    createdAt
                                    pushedAt
                                    defaultBranchRef { name }
                                    updatedAt
                                    isPrivate
                                    isFork
                                    viewerHasStarred
                                }
                            }
                            repositoryCount
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                `;
                const result: any = await octokit.graphql(gqlSearch, {
                    query: searchQuery,
                    first: limit,
                    after: cursor || null,
                });
                nodes = result.search.nodes.filter((n: any) => n.nameWithOwner);
                hasNextPage = result.search.pageInfo.hasNextPage;
                endCursor = result.search.pageInfo.endCursor;
                totalCount = result.search.repositoryCount;
            } else {
                const sortMap: Record<string, { field: string; direction: string }> = {
                    created: { field: 'CREATED_AT', direction: 'DESC' },
                    updated: { field: 'UPDATED_AT', direction: 'DESC' },
                    pushed: { field: 'PUSHED_AT', direction: 'DESC' },
                    full_name: { field: 'NAME', direction: 'ASC' },
                };

                const gqlQuery = `
                    query($cursor: String, $orderBy: RepositoryOrder!, $first: Int!) {
                        viewer {
                            repositories(first: $first, after: $cursor, orderBy: $orderBy, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
                                nodes {
                                    nameWithOwner
                                    name
                                    owner { login avatarUrl }
                                    description
                                    primaryLanguage { name }
                                    stargazerCount
                                    forkCount
                                    watchers { totalCount }
                                    issues(states: OPEN) { totalCount }
                                    pullRequests(states: OPEN) { totalCount }
                                    diskUsage
                                    createdAt
                                    pushedAt
                                    defaultBranchRef { name }
                                    updatedAt
                                    isPrivate
                                    isFork
                                    viewerHasStarred
                                }
                                totalCount
                                pageInfo { hasNextPage endCursor }
                            }
                        }
                    }
                `;

                const orderBy = sortMap[sort] ?? sortMap.updated;
                const result: any = await octokit.graphql(gqlQuery, {
                    cursor: cursor || null,
                    orderBy,
                    first: limit,
                });
                nodes = result.viewer.repositories.nodes;
                hasNextPage = result.viewer.repositories.pageInfo.hasNextPage;
                endCursor = result.viewer.repositories.pageInfo.endCursor;
                totalCount = result.viewer.repositories.totalCount;
            }

            const items = nodes.map((r: any) => ({
                fullName: r.nameWithOwner,
                name: r.name,
                owner: r.owner?.login ?? '',
                ownerAvatarUrl: r.owner?.avatarUrl ?? '',
                description: r.description ?? '',
                language: r.primaryLanguage?.name ?? '',
                stars: r.stargazerCount ?? 0,
                forks: r.forkCount ?? 0,
                watchers: r.watchers?.totalCount ?? 0,
                openIssuesCount: r.issues?.totalCount ?? 0,
                openPRsCount: r.pullRequests?.totalCount ?? 0,
                commitsCount: 0,
                repoSizeKb: r.diskUsage ?? 0,
                createdAt: r.createdAt ?? '',
                pushedAt: r.pushedAt ?? '',
                defaultBranch: r.defaultBranchRef?.name ?? 'main',
                branches: [],
                updatedAt: r.updatedAt ?? '',
                isPrivate: r.isPrivate,
                isFork: r.isFork ?? false,
                readme: '',
                viewerHasStarred: r.viewerHasStarred,
            }));

            return reply.send({
                items,
                nextCursor: hasNextPage ? endCursor : null,
                hasMore: hasNextPage,
                totalCount,
            });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Get single repo details (includes readme)
    app.get('/v1/github/repos/:owner/:repo', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({ branch: z.string().optional() }),
            response: { 200: RepoInfoSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { branch } = request.query;

            const [repoRes, readmeRes, branchesRes, starred, commitsRes, pullsRes] = await Promise.all([
                octokit.rest.repos.get({ owner, repo }),
                octokit.rest.repos.getReadme({ owner, repo, mediaType: { format: 'html' } }).catch(() => null),
                octokit.rest.repos.listBranches({ owner, repo, per_page: 30 }).catch(() => null),
                octokit.rest.activity.checkRepoIsStarredByAuthenticatedUser({ owner, repo })
                    .then(() => true).catch(() => false),
                octokit.rest.repos.listCommits({ owner, repo, sha: branch, per_page: 1 }).catch(() => null),
                octokit.rest.pulls.list({ owner, repo, state: 'open', per_page: 1 }).catch(() => null),
            ]);

            const r = repoRes.data;
            const readme = typeof readmeRes?.data === 'string' ? readmeRes.data : '';
            const branches = branchesRes?.data.map((b: any) => b.name) ?? [r.default_branch];

            let commitsCount = 0;
            if (commitsRes) {
                const link = commitsRes.headers.link ?? '';
                const lastMatch = link.match(/[&?]page=(\d+)>;\s*rel="last"/);
                commitsCount = lastMatch ? parseInt(lastMatch[1], 10) : commitsRes.data.length;
            }

            let openPRsCount = 0;
            if (pullsRes) {
                const link = pullsRes.headers?.link ?? '';
                const lastMatch = link.match(/[&?]page=(\d+)>;\s*rel="last"/);
                openPRsCount = lastMatch ? parseInt(lastMatch[1], 10) : pullsRes.data.length;
            }

            return reply.send({
                fullName: r.full_name,
                name: r.name,
                owner: r.owner?.login ?? owner,
                ownerAvatarUrl: r.owner?.avatar_url ?? '',
                description: r.description ?? '',
                language: r.language ?? '',
                stars: r.stargazers_count ?? 0,
                forks: r.forks_count ?? 0,
                watchers: r.watchers_count ?? 0,
                openIssuesCount: Math.max(0, (r.open_issues_count ?? 0) - openPRsCount),
                openPRsCount,
                commitsCount,
                repoSizeKb: r.size ?? 0,
                createdAt: r.created_at ?? '',
                pushedAt: r.pushed_at ?? '',
                defaultBranch: r.default_branch ?? 'main',
                branches,
                updatedAt: r.updated_at ?? '',
                isPrivate: r.private,
                isFork: r.fork ?? false,
                readme,
                viewerHasStarred: starred,
            });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // List issues (excludes pull requests)
    app.get('/v1/github/repos/:owner/:repo/issues', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({
                state: z.enum(['open', 'closed', 'all']).default('open'),
            }).merge(PaginationQuery),
            response: { 200: paginatedSchema(RepoIssueSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { state, cursor, limit } = request.query;

            const page = cursor ? decodeCursor(cursor) : 1;

            const { data: issues } = await octokit.rest.issues.listForRepo({
                owner,
                repo,
                page,
                per_page: limit + 10,
                state,
                sort: 'created',
                direction: 'desc',
            });

            const filtered = issues.filter((i: any) => !i.pull_request);
            const items = filtered.slice(0, limit).map(mapIssue);
            const hasMore = filtered.length > limit || issues.length >= limit + 10;

            return reply.send({
                items,
                nextCursor: hasMore ? encodeCursor(page + 1) : null,
                hasMore,
            });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Get single issue
    app.get('/v1/github/repos/:owner/:repo/issues/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            response: { 200: RepoIssueSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: i } = await octokit.rest.issues.get({ owner, repo, issue_number: number });

            return reply.send(mapIssue(i));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Create issue
    app.post('/v1/github/repos/:owner/:repo/issues', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            body: z.object({
                title: z.string(),
                body: z.string().optional(),
                labels: z.array(z.string()).optional(),
            }),
            response: { 200: RepoIssueSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { title, body, labels } = request.body;

            const { data: i } = await octokit.rest.issues.create({
                owner,
                repo,
                title,
                body,
                labels,
            });

            return reply.send(mapIssue(i));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Update issue (close / reopen / edit)
    app.patch('/v1/github/repos/:owner/:repo/issues/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({
                state: z.enum(['open', 'closed']).optional(),
                title: z.string().optional(),
                body: z.string().optional(),
                labels: z.array(z.string()).optional(),
            }),
            response: { 200: RepoIssueSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: i } = await octokit.rest.issues.update({
                owner,
                repo,
                issue_number: number,
                ...request.body,
            });

            return reply.send(mapIssue(i));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Update pull request (close / reopen)
    app.patch('/v1/github/repos/:owner/:repo/pulls/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({
                state: z.enum(['open', 'closed']).optional(),
                title: z.string().optional(),
                body: z.string().optional(),
            }),
            response: { 200: RepoPRSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: p } = await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number: number,
                ...request.body,
            });

            return reply.send(mapPR(p));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // List comments on an issue or pull request
    // GitHub's issue-comments endpoint covers both issues and PR conversation
    // comments (not review comments on diff lines).
    app.get('/v1/github/repos/:owner/:repo/issues/:number/comments', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            querystring: PaginationQuery,
            response: { 200: paginatedSchema(RepoIssueCommentSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;
            const { cursor, limit } = request.query;

            const page = cursor ? decodeCursor(cursor) : 1;

            const { data: comments } = await octokit.rest.issues.listComments({
                owner,
                repo,
                issue_number: number,
                page,
                per_page: limit,
            });

            const items = comments.map(mapComment);
            const hasMore = comments.length === limit;

            return reply.send({
                items,
                nextCursor: hasMore ? encodeCursor(page + 1) : null,
                hasMore,
            });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Create a comment on an issue or pull request
    app.post('/v1/github/repos/:owner/:repo/issues/:number/comments', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({ body: z.string().min(1) }),
            response: { 200: RepoIssueCommentSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;
            const { body } = request.body;

            const { data: c } = await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: number,
                body,
            });

            return reply.send(mapComment(c));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Edit a comment on an issue or pull request
    app.patch('/v1/github/repos/:owner/:repo/issues/comments/:commentId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ owner: z.string(), repo: z.string(), commentId: z.coerce.number() }),
            body: z.object({ body: z.string().min(1) }),
            response: { 200: RepoIssueCommentSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, commentId } = request.params;
            const { body } = request.body;

            const { data } = await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: commentId,
                body,
            });

            return reply.send(mapComment(data));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Delete a comment on an issue or pull request
    app.delete('/v1/github/repos/:owner/:repo/issues/comments/:commentId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ owner: z.string(), repo: z.string(), commentId: z.coerce.number() }),
            response: { 200: z.object({ success: z.literal(true) }), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, commentId } = request.params;

            await octokit.rest.issues.deleteComment({
                owner,
                repo,
                comment_id: commentId,
            });

            return reply.send({ success: true as const });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // List pull requests
    app.get('/v1/github/repos/:owner/:repo/pulls', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({
                state: z.enum(['open', 'closed', 'all']).default('open'),
            }).merge(PaginationQuery),
            response: { 200: paginatedSchema(RepoPRSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { state, cursor, limit } = request.query;

            const page = cursor ? decodeCursor(cursor) : 1;

            const { data: pulls } = await octokit.rest.pulls.list({
                owner,
                repo,
                page,
                per_page: limit,
                state,
                sort: 'created',
                direction: 'desc',
            });

            const items = pulls.map(mapPR);
            const hasMore = pulls.length === limit;

            return reply.send({
                items,
                nextCursor: hasMore ? encodeCursor(page + 1) : null,
                hasMore,
            });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Create pull request
    app.post('/v1/github/repos/:owner/:repo/pulls', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            body: z.object({
                title: z.string(),
                body: z.string().optional(),
                head: z.string(),
                base: z.string(),
            }),
            response: { 200: RepoPRSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { title, body, head, base } = request.body;

            const { data: p } = await octokit.rest.pulls.create({
                owner,
                repo,
                title,
                body,
                head,
                base,
            });

            return reply.send(mapPR(p));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Get single pull request
    app.get('/v1/github/repos/:owner/:repo/pulls/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            response: { 200: RepoPRSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: p } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });

            return reply.send(mapPR(p));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // List commits
    app.get('/v1/github/repos/:owner/:repo/commits', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({
                page: z.coerce.number().int().min(1).default(1),
                per_page: z.coerce.number().int().min(1).max(100).default(30),
                sha: z.string().optional(),
            }),
            response: { 200: z.array(RepoCommitSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { page, per_page, sha } = request.query;

            const { data: commits } = await octokit.rest.repos.listCommits({
                owner,
                repo,
                page,
                per_page,
                sha,
            });

            const result = commits.map((c: any) => ({
                sha: c.sha.slice(0, 7),
                message: c.commit.message.split('\n')[0],
                author: c.author?.login ?? c.commit.author?.name ?? '',
                authorAvatar: c.author?.avatar_url,
                createdAt: c.commit.author?.date ?? '',
            }));

            return reply.send(result);
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // List contributors
    app.get('/v1/github/repos/:owner/:repo/contributors', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({
                page: z.coerce.number().int().min(1).default(1),
                per_page: z.coerce.number().int().min(1).max(100).default(30),
            }),
            response: { 200: z.array(RepoContributorSchema), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { page, per_page } = request.query;

            const { data: contributors } = await octokit.rest.repos.listContributors({
                owner,
                repo,
                page,
                per_page,
            });

            const result = (contributors ?? []).map((c: any) => ({
                login: c.login ?? '',
                avatarUrl: c.avatar_url ?? '',
                commitsCount: c.contributions ?? 0,
            }));

            return reply.send(result);
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Get file/directory contents
    app.get('/v1/github/repos/:owner/:repo/contents', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            querystring: z.object({
                path: z.string().default(''),
                ref: z.string().optional(),
            }),
            response: { 200: RepoFileContentSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { path, ref } = request.query;

            const { data } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref,
            });

            // Single file
            if (!Array.isArray(data) && data.type === 'file') {
                const content = data.encoding === 'base64' && data.content
                    ? Buffer.from(data.content, 'base64').toString('utf-8')
                    : '';

                return reply.send({
                    path: data.path,
                    content,
                    size: data.size,
                    isBinary: false,
                });
            }

            // Directory — return listing as JSON content
            if (Array.isArray(data)) {
                const listing = data.map((entry) => ({
                    name: entry.name,
                    path: entry.path,
                    type: entry.type,
                    size: entry.size,
                }));

                return reply.send({
                    path: path || '/',
                    content: JSON.stringify(listing),
                    size: 0,
                    isBinary: false,
                });
            }

            return reply.code(404).send({ error: 'not_found' });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Upload an image for use in GitHub issue/PR comments.
    // Uploads as a GitHub Release asset — returns a github.com download URL.
    app.post('/v1/github/repos/:owner/:repo/upload-image', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
        },
    }, async (request, reply) => {
        const { owner, repo } = request.params;

        let fileBuffer: Buffer | null = null;
        let fileMimeType: string | null = null;

        for await (const part of request.parts()) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                fileMimeType = part.mimetype;
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        // Validate magic bytes instead of trusting client-declared MIME type
        const isJPEG = fileBuffer[0] === 0xFF && fileBuffer[1] === 0xD8 && fileBuffer[2] === 0xFF;
        const isPNG = fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4E && fileBuffer[3] === 0x47;
        if (!isJPEG && !isPNG) {
            return reply.status(400).send({ error: 'Only JPEG and PNG images are supported' });
        }
        const mimeType = isJPEG ? 'image/jpeg' : 'image/png';

        try {
            const octokit = await getUserOctokit(request.userId);
            const result = await githubImageUpload(octokit, owner, repo, fileBuffer, mimeType);
            return reply.send({ success: true, data: result });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });
}
