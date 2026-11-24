/**
 * Qoder's saved conversations, for the app's history list and duplicate picker.
 *
 * qodercli keeps them in Claude Code's transcript format under its config
 * directory, so Claude's reader serves both. The first user message carries
 * Happy's session instructions, which are stripped before it is shown.
 */

import { join } from 'node:path';
import { findClaudeProjectId, readAllClaudeSessionUserMessages, type ClaudeUserMessageWithUuid, type TranscriptStore } from '@/claude/utils/claudeSessionIndex';
import { truncateSessionFile } from '@/claude/utils/claudeSessionFork';
import { forkQoderSession } from '@/qoder/sessions';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import { QODER_SLUGS, qoderBuildOf, qoderConfigDir, resolveQoderCommand, type QoderBuild } from '@/qoder/constants';

/** Qoder CN (`qoderclicn`) keeps its own directory, `~/.qoder-cn`. Without a build, the one Happy would start. */
export function qoderTranscriptStore(build: QoderBuild = qoderBuildOf(resolveQoderCommand())): TranscriptStore {
  return {
    configDir: qoderConfigDir(build),
    cacheFileName: `${QODER_SLUGS[build]}-session-metadata-cache.json`,
    cleanUserText: stripAcpSessionInstructions,
  };
}

/** The user messages of a Qoder conversation, oldest first. */
export async function readAllQoderSessionUserMessages(sessionId: string, build: QoderBuild): Promise<ClaudeUserMessageWithUuid[]> {
  const store = qoderTranscriptStore(build);
  const projectId = await findClaudeProjectId(sessionId, store);
  if (!projectId) throw new Error('Session not found');
  return readAllClaudeSessionUserMessages(projectId, sessionId, store);
}

/**
 * Copies a Qoder conversation up to, not including, the user message `truncateBeforeUuid`
 * and returns the new session id. qodercli's own fork keeps message uuids, so its copy
 * is cut at the same message.
 */
export async function duplicateQoderSession(sessionId: string, cwd: string, truncateBeforeUuid: string, build: QoderBuild): Promise<string> {
  const newSessionId = await forkQoderSession(sessionId, cwd, build);
  const store = qoderTranscriptStore(build);
  const projectId = await findClaudeProjectId(newSessionId, store);
  if (!projectId) throw new Error(`Qoder session ${newSessionId} not found`);
  const truncated = await truncateSessionFile(join(store.configDir, 'projects', projectId, `${newSessionId}.jsonl`), truncateBeforeUuid);
  if (!truncated.success) throw new Error(truncated.errorMessage);
  return newSessionId;
}
