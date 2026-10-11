/**
 * Claude Session Fork Utility
 *
 * Handles forking and truncating Claude sessions for the /duplicate feature.
 * Simply copies the original JSONL file and truncates it at the specified point.
 */

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createReadStream, createWriteStream, unlink } from 'node:fs';
import { copyFile, rename, unlink as unlinkAsync, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { logger } from '@/ui/logger';

export interface ForkAndTruncateResult {
    success: boolean;
    newSessionId?: string;
    errorMessage?: string;
}

/**
 * Fork a Claude session without truncation.
 * This simply copies the original JSONL file and returns a new session ID.
 */
export async function forkSession(
    projectId: string,
    sessionId: string
): Promise<ForkAndTruncateResult> {
    return forkAndTruncateSession(projectId, sessionId);
}

/**
 * Fork a Claude session and truncate it at a specific point
 *
 * Steps:
 * 1. Generate a new session ID
 * 2. Copy the original JSONL file to a new file with the new session ID
 * 3. Truncate the new JSONL file: remove all lines from truncateBeforeUuid onwards
 * 4. Return the new session ID
 */
export async function forkAndTruncateSession(
    projectId: string,
    sessionId: string,
    truncateBeforeUuid?: string
): Promise<ForkAndTruncateResult> {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const projectDir = join(claudeConfigDir, 'projects', projectId);
    const newSessionId = randomUUID();

    const originalJsonlPath = join(projectDir, `${sessionId}.jsonl`);
    const newJsonlPath = join(projectDir, `${newSessionId}.jsonl`);

    try {
        // Step 1: Copy the original file
        await copyFile(originalJsonlPath, newJsonlPath);

        if (truncateBeforeUuid) {
            // Step 2: Truncate the new session file at the specified UUID
            const truncateResult = await truncateSessionFile(newJsonlPath, truncateBeforeUuid);

            if (!truncateResult.success) {
                // Clean up the copied file on failure
                try {
                    await unlinkAsync(newJsonlPath);
                } catch {
                    // Ignore cleanup errors
                }
                return {
                    success: false,
                    errorMessage: truncateResult.errorMessage
                };
            }
        }

        // Step 3: Fix up the resume bookmark. Claude Code resumes a session from
        // `last-prompt.leafUuid`. That bookmark can be stale: a mid-session error
        // (or interrupt) can split the conversation into sibling branches, leaving
        // the bookmark on an early branch while the real latest progress lives on
        // another; and truncation can delete the node it pointed at. Either way the
        // resumed session would silently drop history. Repoint the bookmark to the
        // genuine latest leaf of the retained tree. Best-effort: a failure here must
        // not fail the fork itself.
        try {
            await repointLastPromptToLatestLeaf(newJsonlPath, newSessionId);
        } catch (error) {
            logger.debug('[claudeSessionFork] Failed to repoint last-prompt:', error);
        }

        return {
            success: true,
            newSessionId
        };
    } catch (error) {
        // Clean up the copied file on failure
        try {
            await unlinkAsync(newJsonlPath);
        } catch {
            // Ignore cleanup errors
        }
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Failed to fork session'
        };
    }
}

/**
 * Truncate a session JSONL file by removing all lines from a specific UUID onwards
 * The line with the UUID and all subsequent lines are removed
 */
export async function truncateSessionFile(
    jsonlPath: string,
    truncateBeforeUuid: string
): Promise<{ success: boolean; errorMessage?: string }> {
    const tempPath = `${jsonlPath}.tmp`;

    try {
        const readStream = createReadStream(jsonlPath, { encoding: 'utf8' });
        const writeStream = createWriteStream(tempPath, { encoding: 'utf8' });
        const rl = createInterface({
            input: readStream,
            crlfDelay: Infinity
        });

        let foundTruncationPoint = false;

        for await (const line of rl) {
            if (!line.trim()) {
                // Keep empty lines before truncation point
                if (!foundTruncationPoint) {
                    writeStream.write(line + '\n');
                }
                continue;
            }

            // Check if this line has the truncation UUID
            try {
                const entry = JSON.parse(line);
                if (entry.uuid === truncateBeforeUuid) {
                    // Found the truncation point - stop writing
                    foundTruncationPoint = true;
                    continue;
                }
            } catch {
                // Not valid JSON, but if we haven't found truncation point, keep it
            }

            // Write line if before truncation point
            if (!foundTruncationPoint) {
                writeStream.write(line + '\n');
            }
        }

        // Close the write stream properly
        await new Promise<void>((resolve, reject) => {
            writeStream.end((err: Error | null | undefined) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Replace original file with truncated version
        await rename(tempPath, jsonlPath);

        return { success: true };
    } catch (error) {
        // Clean up temp file if it exists
        try {
            await new Promise<void>((resolve) => {
                unlink(tempPath, () => resolve());
            });
        } catch {
            // Ignore cleanup errors
        }

        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Failed to truncate session file'
        };
    }
}

/**
 * Find the genuine latest leaf of the conversation tree: the most recent
 * (by timestamp) user/assistant message that no other message descends from,
 * excluding sidechain (sub-agent) branches. This is the message a resume should
 * continue from.
 */
function findLatestLeafUuid(jsonl: string): string | null {
    const parents = new Set<string>();
    const candidates: { uuid: string; type: string; timestamp: number; isSidechain: boolean }[] = [];

    for (const line of jsonl.split('\n')) {
        if (!line.trim()) continue;
        let entry: any;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        if (typeof entry?.parentUuid === 'string') parents.add(entry.parentUuid);
        if (typeof entry?.uuid !== 'string' || !entry.uuid) continue;
        const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
        candidates.push({
            uuid: entry.uuid,
            type: entry.type,
            timestamp: Number.isNaN(ts) ? 0 : ts,
            isSidechain: entry.isSidechain === true,
        });
    }

    let best: { uuid: string; timestamp: number } | null = null;
    for (const c of candidates) {
        if (parents.has(c.uuid)) continue; // not a leaf
        if (c.type !== 'user' && c.type !== 'assistant') continue;
        if (c.isSidechain) continue;
        if (!best || c.timestamp > best.timestamp) best = { uuid: c.uuid, timestamp: c.timestamp };
    }
    return best?.uuid ?? null;
}

/**
 * Repoint the session's `last-prompt` bookmark to the genuine latest leaf so a
 * resume continues from the real last message. Rewrites an existing bookmark in
 * place; appends one if truncation removed it. No-op when no resumable leaf can
 * be determined.
 */
async function repointLastPromptToLatestLeaf(jsonlPath: string, sessionId: string): Promise<void> {
    const content = await readFile(jsonlPath, 'utf8');
    const leafUuid = findLatestLeafUuid(content);
    if (!leafUuid) return;

    const out: string[] = [];
    let found = false;
    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let entry: any;
        try {
            entry = JSON.parse(line);
        } catch {
            out.push(line);
            continue;
        }
        if (entry?.type === 'last-prompt') {
            found = true;
            entry.leafUuid = leafUuid;
            out.push(JSON.stringify(entry));
        } else {
            out.push(line);
        }
    }

    if (!found) {
        out.push(JSON.stringify({ type: 'last-prompt', lastPrompt: '', leafUuid, sessionId }));
    }

    await writeFile(jsonlPath, out.join('\n') + '\n');
}
