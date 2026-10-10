/**
 * Qoder's own model descriptions for the app's model picker.
 *
 * ACP only describes a model with tags ("Reasoning · Vision · 0.50x Credit"). The
 * sentences qodercli's `/model` shows come from Qoder's text bundle: a public
 * `/ide-text/latest` endpoint names the current bundle on OSS, and qodercli keeps
 * the model texts it last downloaded in `<config dir>/.auth/dynamic-texts.json`.
 * Both are only read here; Qoder's files are never written.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { logger } from '@/ui/logger';
import { resolveQoderCommand } from '@/qoder/constants';

/** Model code → description, per language the bundle carries. */
export type QoderModelDescriptions = { version: string; en: Record<string, string>; zh: Record<string, string> };

const QODER_TEXT_SOURCES = {
  intl: { configDir: '.qoder', latestUrl: 'https://center.qoder.sh/ide-text/latest?namespace=qoder-ide' },
  cn: { configDir: '.qoder-cn', latestUrl: 'https://gateway.qoder.com.cn/ide-text/latest?namespace=qoder-ide' },
};
const DESCRIPTION_KEY = /^modelSelector\.item\.(.+)\.description$/;
const FETCH_TIMEOUT_MS = 10_000;

// The bundle only changes with its version, so the daemon downloads each version once.
let latestDescriptions: QoderModelDescriptions | null = null;

function textSource() {
  return basename(resolveQoderCommand()) === 'qoderclicn' ? QODER_TEXT_SOURCES.cn : QODER_TEXT_SOURCES.intl;
}

function pickDescriptions(texts: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(texts ?? {}).flatMap(([key, text]) => {
    const code = key.match(DESCRIPTION_KEY)?.[1];
    return code && text ? [[code, text]] : [];
  }));
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The descriptions qodercli last cached, or null when it never opened `/model`. */
export async function readCachedQoderModelDescriptions(): Promise<QoderModelDescriptions | null> {
  const file = join(homedir(), textSource().configDir, '.auth', 'dynamic-texts.json');
  try {
    const cache = JSON.parse(await readFile(file, 'utf8'));
    return { version: String(cache.version ?? ''), en: pickDescriptions(cache.locales?.en), zh: pickDescriptions(cache.locales?.['zh-CN']) };
  } catch (error) {
    logger.debug(`[Qoder] No cached model texts at ${file}`, error);
    return null;
  }
}

/** The descriptions in Qoder's current text bundle. */
export async function fetchLatestQoderModelDescriptions(): Promise<QoderModelDescriptions> {
  const latest = await fetchJson(textSource().latestUrl);
  const { version, ossUrl } = latest?.data ?? {};
  if (!ossUrl) throw new Error('Qoder text bundle has no download URL');
  if (latestDescriptions && latestDescriptions.version === version) return latestDescriptions;

  const bundle = await fetchJson(ossUrl);
  latestDescriptions = { version: String(version), en: pickDescriptions(bundle.en), zh: pickDescriptions(bundle.zh) };
  return latestDescriptions;
}
