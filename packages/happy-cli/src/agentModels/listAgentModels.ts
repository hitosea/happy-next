/**
 * The models each agent offers on this machine, as its own CLI lists them, in one shape for all.
 *
 * Every list comes from a short-lived CLI process: Claude Code's `initialize` control answer, Codex
 * app-server's `model/list`, Gemini CLI's and agy's ACP session, and qodercli's SDK server (see
 * qoder/models). Models depend on the CLI version and on the signed-in account, so every agent keeps
 * one list, on disk too, and starts its CLI only when that list is old:
 *
 *   under 5 min   served as is
 *   5 min to 1 h  served, and refreshed in the background for the next ask
 *   over 1 h      refreshed first; served if that fails or times out
 *
 * After a failed refresh the CLI is not started again for 5 min while a list is on hand, or for
 * 1 min with none (asks then fail at once). Nothing is asked before the first ask.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { getClaudeContextWindowOptions, type AgentModel, type ModelListingAgent } from 'happy-wire';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import { codexPackage } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { fetchQoderModels } from '@/qoder/models';
import { fetchAntigravityModels } from '@/antigravity/models';
import { createRefreshingCache } from '@/utils/refreshingCache';
import { withShortLivedProcess, type ShortLivedProcess } from '@/utils/shortLivedProcess';

const MINUTE_MS = 60_000;
/** Codex may first have to come through npx. */
const CLAUDE_LIST_TIMEOUT_MS = 60_000;
const CODEX_LIST_TIMEOUT_MS = 180_000;
const GEMINI_LIST_TIMEOUT_MS = 60_000;

/** Reads newline-delimited JSON messages from a child's stdout. */
function onJsonLines(child: ShortLivedProcess, onMessage: (message: any) => void): void {
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // Not a protocol line (some CLIs print notices)
      }
    }
  });
}

type ClaudeModelInfo = {
  value?: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportedEffortLevels?: string[];
};

/**
 * Claude Code's models from its `initialize` answer; `default` is Happy's own "CLI configured" option.
 * Claude Code does not say which context windows a model takes; its auto-compact window is offered by
 * Happy's own rule. A picked model starts on Medium, Claude Code's own default effort.
 */
export function parseClaudeModels(models: ClaudeModelInfo[]): AgentModel[] {
  const result: AgentModel[] = [];
  for (const model of models) {
    const code = model.resolvedModel ?? model.value;
    if (!code || model.value === 'default' || !model.displayName || result.some((listed) => listed.code === code)) continue;
    const efforts = model.supportedEffortLevels ?? [];
    const contextWindows = getClaudeContextWindowOptions(code);
    result.push({
      code,
      value: model.displayName,
      ...(model.description ? { description: model.description } : {}),
      ...(efforts.length ? { efforts: efforts.map((effort) => ({ code: effort })), defaultEffort: efforts.includes('medium') ? 'medium' : efforts[0] } : {}),
      ...(contextWindows ? {
        contextWindows: contextWindows.presets,
        defaultContextWindow: contextWindows.presets[0],
        contextWindowRange: { min: contextWindows.min, max: contextWindows.max },
      } : {}),
    });
  }
  return result;
}

function listClaudeModels(): Promise<AgentModel[]> {
  // The launcher picks the same Claude Code the sessions use (global install, else the bundled one).
  const args = [resolve(projectPath(), 'scripts', 'claude_remote_launcher.cjs'), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  return withShortLivedProcess(process.execPath, args, { cwd: homedir(), env: process.env, timeoutMs: CLAUDE_LIST_TIMEOUT_MS }, (child) =>
    new Promise<AgentModel[]>((resolveModels, reject) => {
      onJsonLines(child, (message) => {
        if (message.type !== 'control_response' || message.response?.request_id !== 'happy-list-models') return;
        if (message.response.subtype !== 'success') {
          reject(new Error(`Claude Code initialize failed: ${message.response.error ?? 'unknown error'}`));
          return;
        }
        const models = message.response.response?.models;
        if (!Array.isArray(models)) reject(new Error('This Claude Code does not list its models'));
        else resolveModels(parseClaudeModels(models));
      });
      child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'happy-list-models', request: { subtype: 'initialize' } })}\n`);
    }));
}

type CodexModelInfo = {
  id: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
  defaultReasoningEffort?: string;
};

export function parseCodexModels(models: CodexModelInfo[]): AgentModel[] {
  return models
    .filter((model) => !model.hidden)
    .map((model) => {
      const efforts = (model.supportedReasoningEfforts ?? []).map((effort) => ({ code: effort.reasoningEffort }));
      const defaultEffort = efforts.find((effort) => effort.code === model.defaultReasoningEffort)?.code ?? efforts[0]?.code;
      return {
        code: model.id,
        value: model.displayName || model.id,
        ...(model.description ? { description: model.description } : {}),
        ...(efforts.length ? { efforts, defaultEffort } : {}),
      };
    });
}

function listCodexModels(): Promise<AgentModel[]> {
  const { command, args } = resolveCodexRuntime(codexPackage(), ['app-server']);
  return withShortLivedProcess(command, args, { cwd: homedir(), env: process.env, timeoutMs: CODEX_LIST_TIMEOUT_MS }, (child) =>
    new Promise<AgentModel[]>((resolveModels, reject) => {
      const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const models: CodexModelInfo[] = [];
      let nextId = 1;
      const requestPage = (cursor?: string) => send({ method: 'model/list', id: nextId++, params: cursor ? { cursor } : {} });
      onJsonLines(child, (message) => {
        if (message.id === 0) {
          send({ method: 'initialized' });
          requestPage();
        } else if (typeof message.id === 'number' && message.id > 0) {
          if (message.error) {
            reject(new Error(`Codex model/list failed: ${JSON.stringify(message.error)}`));
            return;
          }
          models.push(...(message.result?.data ?? []));
          if (message.result?.nextCursor) requestPage(message.result.nextCursor);
          else resolveModels(parseCodexModels(models));
        }
      });
      send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'happy-model-list', version: '1' } } });
    }));
}

/**
 * Gemini's models from an ACP session, by their ids (Gemini names some models after another id);
 * `auto` lets Gemini route, which Happy's "CLI configured" option already covers.
 */
export function parseGeminiModels(models: Array<{ modelId: string }>): AgentModel[] {
  return models
    .filter((model) => model.modelId !== 'auto')
    .map((model) => ({ code: model.modelId, value: model.modelId }));
}

function listGeminiModels(): Promise<AgentModel[]> {
  const cwd = homedir();
  return withShortLivedProcess('gemini', ['--experimental-acp'], { cwd, env: process.env, timeoutMs: GEMINI_LIST_TIMEOUT_MS }, async (child) => {
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async () => {},
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
    // A session that never gets a prompt is not saved, so this leaves nothing in Gemini's history.
    const session = await connection.newSession({ cwd, mcpServers: [] });
    const available = session.models?.availableModels;
    if (!available) throw new Error('This Gemini CLI does not list its models');
    return parseGeminiModels(available);
  });
}

const FETCHERS: Record<ModelListingAgent, () => Promise<AgentModel[]>> = {
  claude: listClaudeModels,
  codex: listCodexModels,
  gemini: listGeminiModels,
  qoder: () => fetchQoderModels('intl'),
  qodercn: () => fetchQoderModels('cn'),
  antigravity: fetchAntigravityModels,
};

const caches = Object.fromEntries(Object.entries(FETCHERS).map(([agent, fetch]) => [agent, createRefreshingCache({
  file: join(configuration.happyHomeDir, 'models', `${agent}.json`),
  fetch: async () => {
    const models = await fetch();
    if (!models.length) throw new Error(`${agent} listed no models`);
    return models;
  },
  freshMs: 5 * MINUTE_MS,
  maxAgeMs: 60 * MINUTE_MS,
  failureCooldownMs: 5 * MINUTE_MS,
  emptyFailureCooldownMs: MINUTE_MS,
})])) as Record<ModelListingAgent, { get(): Promise<AgentModel[]> }>;

/** The models `agent` offers on this machine (see above for when its CLI is asked). */
export function listAgentModels(agent: ModelListingAgent): Promise<AgentModel[]> {
  return caches[agent].get();
}
