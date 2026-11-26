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
 *
 * Claude Code answers with one of two lists, its choice from one launch to the next: the full one
 * (every model the account may pick, older generations too) or a short one of its aliases alone
 * (Opus, Sonnet, Fable, Haiku). A short list does not replace a full one; see mergeClaudeListing.
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
import { fetchAntigravityModels } from '@/antigravity/models';
import { fetchDeepSeekModels } from '@/deepseek/models';
import { fetchQoderModels } from '@/qoder/models';
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

export type ClaudeModelInfo = {
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
 *
 * Some lists name models by family alone ("Opus") and put the version first in the description
 * ("Opus 5.5 · For complex work"); the versioned name is then the model's name.
 */
export function parseClaudeModels(models: ClaudeModelInfo[]): AgentModel[] {
  const result: AgentModel[] = [];
  for (const model of models) {
    const code = model.resolvedModel ?? model.value;
    if (!code || model.value === 'default' || !model.displayName || result.some((listed) => listed.code === code)) continue;
    const efforts = model.supportedEffortLevels ?? [];
    const contextWindows = getClaudeContextWindowOptions(code);
    const versioned = model.description?.match(/^(.+?)\s+·\s+(.*)$/);
    const named = versioned?.[1].startsWith(`${model.displayName} `) ? { value: versioned[1], description: versioned[2] } : { value: model.displayName, description: model.description };
    result.push({
      code,
      value: named.value,
      ...(named.description ? { description: named.description } : {}),
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

/** Claude's kept list, and when Claude Code last gave its full list (null: not within the limit). */
export type ClaudeListing = { models: AgentModel[]; fullListAt: number | null };

/** How long the last full list stands while Claude Code gives only short ones. */
const CLAUDE_FULL_LIST_KEEP_MS = 30 * 24 * 60 * MINUTE_MS;

/**
 * The list to keep after Claude Code answered with `models`. A short list is one whose every model is
 * named by an alias (its `value` is not the id it resolves to); a full one names the older models by
 * id. A full list replaces what was kept. A short one only refreshes the models it has and adds those
 * the kept list lacks (a new release), as long as a full list came within 30 days; past that, Claude
 * Code is taken to list the short one alone, and it replaces what was kept.
 */
export function mergeClaudeListing(models: ClaudeModelInfo[], previous: ClaudeListing | undefined, now: number): ClaudeListing {
  const parsed = parseClaudeModels(models);
  const short = models.every((model) => model.value === 'default' || (model.resolvedModel !== undefined && model.value !== model.resolvedModel));
  if (!short) return { models: parsed, fullListAt: now };
  const fullListAt = previous?.fullListAt ?? null;
  if (!previous || fullListAt === null || now - fullListAt > CLAUDE_FULL_LIST_KEEP_MS) return { models: parsed, fullListAt: null };
  const fresh = new Map(parsed.map((model) => [model.code, model]));
  const added = parsed.filter((model) => !previous.models.some((kept) => kept.code === model.code));
  return { models: [...added, ...previous.models.map((kept) => fresh.get(kept.code) ?? kept)], fullListAt };
}

function listClaudeModels(previous: ClaudeListing | undefined): Promise<ClaudeListing> {
  // The launcher picks the same Claude Code the sessions use (global install, else the bundled one).
  const args = [resolve(projectPath(), 'scripts', 'claude_remote_launcher.cjs'), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  return withShortLivedProcess(process.execPath, args, { cwd: homedir(), env: process.env, timeoutMs: CLAUDE_LIST_TIMEOUT_MS }, (child) =>
    new Promise<ClaudeListing>((resolveModels, reject) => {
      onJsonLines(child, (message) => {
        if (message.type !== 'control_response' || message.response?.request_id !== 'happy-list-models') return;
        if (message.response.subtype !== 'success') {
          reject(new Error(`Claude Code initialize failed: ${message.response.error ?? 'unknown error'}`));
          return;
        }
        const models = message.response.response?.models;
        if (!Array.isArray(models)) reject(new Error('This Claude Code does not list its models'));
        else resolveModels(mergeClaudeListing(models, previous, Date.now()));
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

const FETCHERS: Record<Exclude<ModelListingAgent, 'claude'>, () => Promise<AgentModel[]>> = {
  codex: listCodexModels,
  gemini: listGeminiModels,
  qoder: () => fetchQoderModels('intl'),
  qodercn: () => fetchQoderModels('cn'),
  antigravity: fetchAntigravityModels,
  deepseek: fetchDeepSeekModels,
};

function cacheFor<T>(agent: ModelListingAgent, fetch: (previous: T | undefined) => Promise<T>, models: (value: T) => AgentModel[]) {
  return createRefreshingCache<T>({
    file: join(configuration.happyHomeDir, 'models', `${agent}.json`),
    fetch: async (previous) => {
      const value = await fetch(previous);
      if (!models(value).length) throw new Error(`${agent} listed no models`);
      return value;
    },
    freshMs: 5 * MINUTE_MS,
    maxAgeMs: 60 * MINUTE_MS,
    failureCooldownMs: 5 * MINUTE_MS,
    emptyFailureCooldownMs: MINUTE_MS,
  });
}

// Claude keeps its list with when the full one came (see mergeClaudeListing); every other agent keeps the
// list its CLI gave last.
const claudeCache = cacheFor<ClaudeListing>('claude', listClaudeModels, (listing) => listing.models);
const caches = Object.fromEntries(Object.entries(FETCHERS).map(([agent, fetch]) => [
  agent,
  cacheFor<AgentModel[]>(agent as ModelListingAgent, fetch, (models) => models),
])) as Record<Exclude<ModelListingAgent, 'claude'>, { get(): Promise<AgentModel[]>; markStale(): void }>;

/** The models `agent` offers on this machine (see above for when its CLI is asked). */
export async function listAgentModels(agent: ModelListingAgent): Promise<AgentModel[]> {
  return agent === 'claude' ? (await claudeCache.get()).models : caches[agent].get();
}

/** `agent`'s CLI changed version: its list is asked again before it is next served. */
export function markAgentModelsStale(agent: ModelListingAgent): void {
  (agent === 'claude' ? claudeCache : caches[agent]).markStale();
}
