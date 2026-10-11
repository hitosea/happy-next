import Fuse, { type FuseOptionKey } from 'fuse.js';

// With nothing typed after the prefix, this many recently sent items lead the list.
const RECENT_SHOWN_FIRST = 3;

// Names starting with a symbol (`_draft`, `.local`) are usually internal, so they go last.
const startsWithSymbol = (name: string) => /^[^\p{L}\p{N}]/u.test(name);

/**
 * How a name matches the query, best first: the exact name, a name that starts with it, a word
 * in the name that starts with it (`creator` → `skill-creator`), a name that contains it, then
 * other text (descriptions) that contains it. Null when none of these hold.
 */
function matchTier(name: string, otherText: (string | undefined)[], query: string): number | null {
    const lower = name.toLowerCase();
    const tier = [
        lower === query,
        lower.startsWith(query),
        lower.split(/[-_:.\s/]+/).some((word) => word.startsWith(query)),
        lower.includes(query),
        otherText.some((text) => text?.toLowerCase().includes(query)),
    ].indexOf(true);
    return tier === -1 ? null : tier;
}

/**
 * Orders `/` commands and `$` skills for autocomplete, separately or mixed together.
 *
 * With no query, up to RECENT_SHOWN_FIRST recently sent names come first and the rest follow
 * alphabetically, so most of the list stays put. With a query, items rank by match tier, then
 * recent use, then shorter name and alphabet; fuzzy matches (typos) only follow every direct
 * match. Names starting with a symbol sort after the others they tie with.
 */
export function rankSuggestions<T>(
    items: T[],
    query: string,
    options: {
        name: (item: T) => string;
        /** How the item appears in the recent list (`/goal`, `$pdf`). */
        recentKey: (item: T) => string;
        otherText: (item: T) => (string | undefined)[];
        fuzzyKeys: FuseOptionKey<T>[];
        recent: string[];
        threshold: number;
        limit?: number;
    },
): T[] {
    const { name, recentKey, otherText, fuzzyKeys, recent, threshold, limit } = options;
    const recency = (item: T) => {
        const index = recent.indexOf(recentKey(item));
        return index === -1 ? recent.length : index;
    };
    const alphabetical = (a: T, b: T) =>
        Number(startsWithSymbol(name(a))) - Number(startsWithSymbol(name(b))) || name(a).localeCompare(name(b));
    const normalized = query.trim().toLowerCase();

    let ranked: T[];
    if (!normalized) {
        const first = items
            .filter((item) => recency(item) < recent.length)
            .sort((a, b) => recency(a) - recency(b))
            .slice(0, RECENT_SHOWN_FIRST);
        ranked = [...first, ...items.filter((item) => !first.includes(item)).sort(alphabetical)];
    } else {
        const tiers = new Map(items.map((item) => [item, matchTier(name(item), otherText(item), normalized)]));
        const direct = items
            .filter((item) => tiers.get(item) !== null)
            .sort((a, b) =>
                tiers.get(a)! - tiers.get(b)!
                || recency(a) - recency(b)
                || Number(startsWithSymbol(name(a))) - Number(startsWithSymbol(name(b)))
                || name(a).length - name(b).length
                || alphabetical(a, b));
        const fuzzy = new Fuse(items.filter((item) => tiers.get(item) === null), { keys: fuzzyKeys, threshold, ignoreLocation: true })
            .search(normalized)
            .map((result) => result.item);
        ranked = [...direct, ...fuzzy];
    }
    return limit ? ranked.slice(0, limit) : ranked;
}
