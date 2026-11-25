import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicFileWrite } from '@/utils/fileAtomic';
import { logger } from '@/ui/logger';

export type RefreshingCacheOptions<T> = {
  /** Where the last value fetched is kept, so a restart starts from it. */
  file: string;
  /** Given the value on hand, if any, which a fetch may build on. */
  fetch: (previous: T | undefined) => Promise<T>;
  /** A value younger than this is served as is. */
  freshMs: number;
  /**
   * A value younger than this is served and refreshed in the background for the
   * next ask; an older one is refreshed first and served only if that fails.
   */
  maxAgeMs: number;
  /** After a failed fetch, how long a value on hand is served without fetching again. */
  failureCooldownMs: number;
  /** After a failed fetch with no value on hand, how long asks fail at once. */
  emptyFailureCooldownMs: number;
};

type Entry<T> = { value: T; fetchedAt: number };

/**
 * A value that is slow or costly to fetch. At most one fetch runs at a time, and
 * every ask made meanwhile waits on it; a failed fetch keeps the value on hand.
 */
export function createRefreshingCache<T>(options: RefreshingCacheOptions<T>): { get(): Promise<T> } {
  let entry: Entry<T> | null = null;
  let failure: { at: number; error: unknown } | null = null;
  let inflight: Promise<T> | null = null;
  let loading: Promise<void> | null = null;

  const load = () => {
    loading ??= readFile(options.file, 'utf8')
      .then((text) => {
        const saved = JSON.parse(text) as Entry<T>;
        // A fetch that finished while the file was read is newer
        if (typeof saved?.fetchedAt === 'number' && saved.value !== undefined) entry ??= saved;
      })
      .catch(() => {});
    return loading;
  };

  const refresh = () => {
    inflight ??= options.fetch(entry?.value)
      .then(async (value) => {
        entry = { value, fetchedAt: Date.now() };
        failure = null;
        await mkdir(dirname(options.file), { recursive: true })
          .then(() => atomicFileWrite(options.file, JSON.stringify(entry)))
          .catch((error) => logger.debug(`[RefreshingCache] Could not save ${options.file}`, error));
        return value;
      }, (error) => {
        failure = { at: Date.now(), error };
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    async get() {
      await load();
      const now = Date.now();
      const coolingFor = (ms: number) => failure !== null && now - failure.at < ms;
      if (!entry) {
        if (coolingFor(options.emptyFailureCooldownMs)) throw failure!.error;
        return refresh();
      }
      const { value, fetchedAt } = entry;
      const age = now - fetchedAt;
      if (age < options.freshMs || coolingFor(options.failureCooldownMs)) return value;
      if (age < options.maxAgeMs) {
        refresh().catch(() => {});
        return value;
      }
      return refresh().catch(() => value);
    },
  };
}
