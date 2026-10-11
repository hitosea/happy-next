import { loadRecentSuggestions, saveRecentSuggestions } from './persistence';

/**
 * Slash commands and `$` skills the user sent, per agent and newest first, for ordering
 * autocomplete. Entries keep their prefix (`/goal`, `$pdf`) so commands and skills share one
 * timeline and can be ranked together under `/`.
 *
 * Kept per agent because the same name can mean different things (Codex's and Qoder's
 * `/goal`), and only on this device. A name counts once a message using it is sent; picking it
 * in the popup and deleting it again does not. A command counts when the message starts with
 * it, a skill wherever `$name` appears (a later mention counts as more recent). Anything shaped
 * like that is recorded, but only names the agent still offers are ever ranked by it.
 */
const MAX_RECENT = 30;

let recent: Record<string, string[]> | null = null;

export function getRecentSuggestions(agent: string): string[] {
    recent ??= loadRecentSuggestions();
    return recent[agent] ?? [];
}

export function rememberSentSuggestions(agent: string, text: string) {
    const sent = [
        ...(text.trim().match(/^\/\S+/) ?? []),
        ...[...text.matchAll(/(?:^|\s)(\$[^\s$]+)/g)].map((match) => match[1]),
    ].reverse();
    if (!sent.length) return;
    recent = { ...recent, [agent]: [...new Set([...sent, ...getRecentSuggestions(agent)])].slice(0, MAX_RECENT) };
    saveRecentSuggestions(recent);
}
