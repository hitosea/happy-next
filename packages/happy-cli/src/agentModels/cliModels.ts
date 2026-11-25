/**
 * Claude, Codex and Gemini models as the agent CLIs installed on this machine list them.
 *
 * Each list comes from a short-lived CLI process: Claude Code's `initialize` control answer,
 * Codex app-server's `model/list` and Gemini CLI's ACP `session/new`. Lists are cached in
 * `~/.happy-next/cli-models.json`, keyed by CLI version, so a list is only asked for again when
 * the CLI changes or the cached one has aged (the signed-in account can change what is offered).
 *
 * Every CLI process applies the cached lists to the model catalog at startup, so the modes the
 * app sends for these models resolve in sessions too.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import {
  applyCliModels,
  BUNDLED_MODEL_CATALOG,
  CLI_LISTED_AGENTS,
  CliModelSchema,
  setModelCatalog,
  type CliListedAgent,
  type CliModel,
  type CliModelList,
} from 'happy-wire';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import { codexPackage } from '@/codex/package';
import { localCodexVersion, resolveCodexRuntime } from '@/codex/codexRuntime';
import { logger } from '@/ui/logger';
import { withShortLivedProcess, type ShortLivedProcess } from '@/utils/shortLivedProcess';

/** A cached list is asked for again after this long, even when the CLI version is unchanged. */
const CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
/** Codex may first have to come through npx. */
const LIST_TIMEOUT_MS: Record<CliListedAgent, number> = { claude: 60_000, codex: 180_000, gemini: 60_000 };
const VERSION_TIMEOUT_MS = 15_000;
const VERSION_PATTERN = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/;

type CacheEntry = { version: string | null; fetchedAt: number; models: CliModel[] };
type CacheFile = Partial<Record<CliListedAgent, CacheEntry>>;

function cacheFile(): string {
  return join(configuration.happyHomeDir, 'cli-models.json');
}

function readCache(): CacheFile {
  try {
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf-8')) as Record<string, unknown>;
    const cache: CacheFile = {};
    for (const agent of CLI_LISTED_AGENTS) {
      const entry = raw[agent] as Partial<CacheEntry> | undefined;
      const models = CliModelSchema.array().safeParse(entry?.models);
      if (!entry || !models.success || typeof entry.fetchedAt !== 'number') continue;
      cache[agent] = { version: typeof entry.version === 'string' ? entry.version : null, fetchedAt: entry.fetchedAt, models: models.data };
    }
    return cache;
  } catch {
    return {};
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/** Store one agent's list and apply every cached list to this process's catalog. */
function storeList(agent: CliListedAgent, entry: CacheEntry): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const cache = { ...readCache(), [agent]: entry };
    const file = cacheFile();
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, file);
    applyCache(cache);
  }).catch((error) => logger.debug('[cliModels] Failed to store the model list', error));
  return writeQueue;
}

function applyCache(cache: CacheFile): void {
  setModelCatalog(applyCliModels(BUNDLED_MODEL_CATALOG, {
    claude: cache.claude?.models,
    codex: cache.codex?.models,
    gemini: cache.gemini?.models,
  }));
}

/** Apply the cached lists to the model catalog (every CLI process, at startup). */
export function loadCachedCliModels(): void {
  applyCache(readCache());
}

// ─── CLI commands and versions ─────────────────────────────────

const claudeLauncher = () => resolve(projectPath(), 'scripts', 'claude_remote_launcher.cjs');

/** The command each agent runs with, as sessions start it. */
function cliCommand(agent: CliListedAgent, args: string[]): { command: string; args: string[] } {
  switch (agent) {
    // The launcher picks the same Claude Code the sessions use (global install, else the bundled one).
    case 'claude': return { command: process.execPath, args: [claudeLauncher(), ...args] };
    case 'codex': return resolveCodexRuntime(codexPackage(), args);
    case 'gemini': return { command: 'gemini', args };
  }
}

/** Whether the agent's CLI is installed, so asking it costs no download. Claude always is (bundled). */
export function isCliInstalled(agent: CliListedAgent): Promise<boolean> {
  if (agent === 'claude') return Promise.resolve(true);
  if (agent === 'codex') return Promise.resolve(localCodexVersion() !== null);
  return cliVersion('gemini').then((version) => version !== null);
}

/** The CLI's version, or null when it is not installed or does not say. */
export function cliVersion(agent: CliListedAgent): Promise<string | null> {
  if (agent === 'codex' && localCodexVersion() === null) return Promise.resolve(null);
  const { command, args } = cliCommand(agent, ['--version']);
  return new Promise((resolveVersion) => {
    execFile(command, args, { timeout: VERSION_TIMEOUT_MS, encoding: 'utf-8', windowsHide: true, shell: process.platform === 'win32' && agent !== 'claude' }, (error, stdout) => {
      resolveVersion(error ? null : stdout.match(VERSION_PATTERN)?.[1] ?? null);
    });
  });
}

// ─── Listing ───────────────────────────────────────────────────

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
  supportsFastMode?: boolean;
};

/** Claude Code's models from its `initialize` answer; `default` is Happy's own "CLI configured" option. */
export function parseClaudeModels(models: ClaudeModelInfo[]): CliModel[] {
  const result: CliModel[] = [];
  for (const model of models) {
    const id = model.resolvedModel ?? model.value;
    if (!id || model.value === 'default' || !model.displayName) continue;
    result.push({
      id,
      label: model.displayName,
      description: model.description,
      efforts: model.supportedEffortLevels ?? [],
      fastMode: model.supportsFastMode === true,
    });
  }
  return result;
}

function listClaudeModels(): Promise<CliModel[]> {
  const { command, args } = cliCommand('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  return withShortLivedProcess(command, args, { cwd: homedir(), env: process.env, timeoutMs: LIST_TIMEOUT_MS.claude }, (child) =>
    new Promise<CliModel[]>((resolveModels, reject) => {
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
};

export function parseCodexModels(models: CodexModelInfo[]): CliModel[] {
  return models
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: model.id,
      label: model.displayName || model.id,
      description: model.description,
      efforts: (model.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort),
    }));
}

function listCodexModels(): Promise<CliModel[]> {
  const { command, args } = cliCommand('codex', ['app-server']);
  return withShortLivedProcess(command, args, { cwd: homedir(), env: process.env, timeoutMs: LIST_TIMEOUT_MS.codex }, (child) =>
    new Promise<CliModel[]>((resolveModels, reject) => {
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

/** Gemini's models from an ACP session; `auto` lets Gemini route, which Happy's "CLI configured" option already covers. */
export function parseGeminiModels(models: Array<{ modelId: string; name?: string; description?: string | null }>): CliModel[] {
  return models
    .filter((model) => model.modelId !== 'auto')
    .map((model) => ({ id: model.modelId, label: model.name || model.modelId, description: model.description ?? undefined, efforts: [] }));
}

function listGeminiModels(): Promise<CliModel[]> {
  const { command, args } = cliCommand('gemini', ['--experimental-acp']);
  const cwd = homedir();
  return withShortLivedProcess(command, args, { cwd, env: process.env, timeoutMs: LIST_TIMEOUT_MS.gemini }, async (child) => {
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

const LISTERS: Record<CliListedAgent, () => Promise<CliModel[]>> = {
  claude: listClaudeModels,
  codex: listCodexModels,
  gemini: listGeminiModels,
};

const inFlight = new Map<CliListedAgent, Promise<CliModelList>>();

/**
 * The models the agent's CLI offers. A cached list answers while the CLI version is unchanged
 * and the list is younger than six hours, unless `refresh` asks the CLI again. When asking
 * fails, a cached list (of any age) answers instead; with none the error is thrown.
 */
export function listCliModels(agent: CliListedAgent, options: { refresh?: boolean } = {}): Promise<CliModelList> {
  const pending = inFlight.get(agent);
  if (pending) return pending;
  const request = (async (): Promise<CliModelList> => {
    const version = await cliVersion(agent);
    const cached = readCache()[agent];
    const fresh = cached && cached.version === version && Date.now() - cached.fetchedAt < CACHE_MAX_AGE_MS;
    if (cached && fresh && !options.refresh) return { agent, version, models: cached.models };
    try {
      const models = await LISTERS[agent]();
      if (models.length === 0) throw new Error(`${agent} listed no models`);
      await storeList(agent, { version, fetchedAt: Date.now(), models });
      logger.debug(`[cliModels] ${agent} ${version ?? '(unknown version)'} lists ${models.length} models`);
      return { agent, version, models };
    } catch (error) {
      logger.debug(`[cliModels] Listing ${agent} models failed`, error);
      if (cached) return { agent, version: cached.version, models: cached.models };
      throw error;
    }
  })().finally(() => inFlight.delete(agent));
  inFlight.set(agent, request);
  return request;
}

/** Refresh the lists of the installed CLIs, one after another (used by the daemon at startup). */
export async function refreshInstalledCliModels(): Promise<void> {
  for (const agent of CLI_LISTED_AGENTS) {
    if (!(await isCliInstalled(agent))) continue;
    await listCliModels(agent).catch(() => {});
  }
}
