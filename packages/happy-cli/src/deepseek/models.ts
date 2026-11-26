/**
 * DeepSeek Harness ACP model encoding/decoding and model-list discovery.
 *
 * `dsh --profile acp` encodes each model select value as `JSON.stringify([provider, model])`
 * (e.g. `["deepseek-official","deepseek-v4-pro"]`), which contains brackets, quotes and commas.
 * Happy's `ModelMode` format (`model[:effort][@contextWindow]`) uses clean identifiers, so we
 * map default `deepseek-official` routes to bare model ids (`deepseek-v4-pro`) and non-default
 * providers to `provider/model`, while keeping the exact raw value for round-tripping back to `dsh`.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { configuration } from '@/configuration';
import { listAcpModels, type AcpModel } from '@/agent/acp/listAcpModels';
import { resolveDeepSeekCommand } from '@/deepseek/constants';
import { withShortLivedProcess } from '@/utils/shortLivedProcess';

export const DEFAULT_DEEPSEEK_PROVIDER = 'deepseek-official';

const DEEPSEEK_LIST_TIMEOUT_MS = 60_000;

export type DecodedDeepSeekModel = {
  /** Clean model code exposed to Happy (`deepseek-v4-pro` or `provider/model`). */
  code: string;
  provider: string;
  model: string;
};

/**
 * Happy's `ModelMode` splits the effort on ':' and the context window on '@', and provider model ids
 * may contain both (e.g. OpenRouter's `deepseek/deepseek-chat-v3:free`). Codes percent-encode them
 * (and '%' itself) so a code always survives `parseModelMode` whole.
 */
function escapeModelCode(code: string): string {
  return code.replace(/[%:@]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function unescapeModelCode(code: string): string {
  return code.replace(/%(25|3A|40)/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function toModelCode(provider: string, model: string): string {
  return escapeModelCode(provider === DEFAULT_DEEPSEEK_PROVIDER ? model : `${provider}/${model}`);
}

/** Decodes a `dsh --profile acp` opaque model value (`JSON.stringify([provider, model])`) into a clean Happy model code. */
export function decodeDeepSeekModelValue(rawValue: string): DecodedDeepSeekModel {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
      && parsed[0].length > 0
      && parsed[1].length > 0
    ) {
      const [provider, model] = parsed;
      return { code: toModelCode(provider, model), provider, model };
    }
  } catch {
    // Already a plain model id or a (possibly escaped) Happy `provider/model` code
  }
  const plain = unescapeModelCode(rawValue);
  const slashIndex = plain.indexOf('/');
  if (slashIndex > 0 && slashIndex < plain.length - 1) {
    const provider = plain.slice(0, slashIndex);
    const model = plain.slice(slashIndex + 1);
    return { code: toModelCode(provider, model), provider, model };
  }
  return {
    code: toModelCode(DEFAULT_DEEPSEEK_PROVIDER, plain),
    provider: DEFAULT_DEEPSEEK_PROVIDER,
    model: plain,
  };
}

/** Encodes a Happy model code back to the exact `dsh --profile acp` select value. */
export function encodeDeepSeekModelValue(code: string, rawByCode?: ReadonlyMap<string, string>): string {
  const exact = rawByCode?.get(code);
  if (exact) return exact;
  // Already encoded JSON tuple
  try {
    const parsed: unknown = JSON.parse(code);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return code;
    }
  } catch {
    // Expected for clean Happy codes
  }
  const plain = unescapeModelCode(code);
  const slashIndex = plain.indexOf('/');
  if (slashIndex > 0 && slashIndex < plain.length - 1) {
    return JSON.stringify([plain.slice(0, slashIndex), plain.slice(slashIndex + 1)]);
  }
  return JSON.stringify([DEFAULT_DEEPSEEK_PROVIDER, plain]);
}

/** Converts raw ACP models returned by `dsh --profile acp` into Happy's clean `AcpModel[]`. */
export function normalizeDeepSeekAcpModels(models: AcpModel[]): AcpModel[] {
  const seen = new Set<string>();
  const result: AcpModel[] = [];
  for (const entry of models) {
    const { code } = decodeDeepSeekModelValue(entry.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push({
      ...entry,
      code,
    });
  }
  return result;
}

/**
 * Detects `dsh --profile acp`'s unauthenticated placeholder response without
 * hardcoding any specific model id. When no API key or DeepSeek account is
 * configured, `dsh`'s `discoverModels()` returns `[]` and `AcpModelControl`
 * falls back to inserting only the bare default model id on `deepseek-official`
 * (with `name === model` and no description).
 */
export function isUnauthenticatedDeepSeekFallback(rawModels: AcpModel[]): boolean {
  if (rawModels.length !== 1) return false;
  const decoded = decodeDeepSeekModelValue(rawModels[0].code);
  return decoded.provider === DEFAULT_DEEPSEEK_PROVIDER
    && rawModels[0].value === decoded.model
    && !rawModels[0].description;
}

/** Asks `dsh --profile acp` for the available models and their reasoning efforts. */
export async function fetchDeepSeekModels(): Promise<AcpModel[]> {
  const cwd = join(configuration.happyHomeDir, 'deepseek');
  await mkdir(cwd, { recursive: true });
  return withShortLivedProcess(
    resolveDeepSeekCommand(),
    ['--profile', 'acp'],
    { cwd, env: process.env, timeoutMs: DEEPSEEK_LIST_TIMEOUT_MS },
    async (child) => {
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
      const rawModels = await listAcpModels(connection, cwd);
      if (isUnauthenticatedDeepSeekFallback(rawModels)) {
        throw new Error('DeepSeek credentials not configured; model catalog unavailable');
      }
      const models = normalizeDeepSeekAcpModels(rawModels);
      if (!models.length) throw new Error('dsh listed no models');
      return models;
    },
  );
}
