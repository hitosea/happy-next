import { isAskUserQuestionToolCall, isPreviewHtmlToolCall, Message, MinimapMessage } from '@/sync/typesMessage';

const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/;

// Claude Code emits a text-only companion for every image attachment. The image itself rides in
// the `mixed` message that carries the prompt the user actually typed, so this companion is noise.
const IMAGE_PLACEHOLDER_PATTERN = /^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]$/;

function isCompactionMarkerText(text: string): boolean {
    return LOCAL_COMMAND_STDOUT_PATTERN.test(text.trim());
}

function isImagePlaceholderText(text: string): boolean {
    return IMAGE_PLACEHOLDER_PATTERN.test(text.trim());
}

// Rows hidden here are dropped from the list entirely rather than rendered as null. Both lists
// size rows from measured heights (the web one from a persisted height model), so a row whose
// content collapses but whose element survives keeps the height it was once given — the gap this
// guard exists to prevent. Shared by ChatList.tsx and ChatList.web.tsx.
export function shouldHideMessageInChatList(message: Message, showThinkingMessages: boolean): boolean {
    if (message.kind === 'agent-text' && message.isThinking && !showThinkingMessages) {
        return true;
    }
    if (message.kind !== 'user-text') {
        return false;
    }
    // Never hide a message that actually carries images or files — only the text companion is noise.
    if (message.images?.length || message.meta?.attachments?.length) {
        return false;
    }
    const text = message.displayText ?? message.text;
    return isCompactionMarkerText(text) || isImagePlaceholderText(text);
}

/**
 * A row the conversation rail draws a mark for: a question card, or an inline HTML preview.
 *
 * These are landmarks rather than working-out. The rail jumps to them, and a question is a row the
 * reader is the one who answers — so anything that hides rows has to keep them, on top of the jump
 * staying able to land. Folding a turn's process is the caller this exists for.
 *
 * A plan proposal is deliberately not one. It is a request like any other — see
 * `isPendingPermissionRow` — and the rail has no mark for it either, so nothing here outlives the
 * answer the reader gives it.
 */
export function isMinimapLandmarkRow(message: Message): boolean {
    return isAskUserQuestionToolCall(message) || isPreviewHtmlToolCall(message);
}

/**
 * A row the reader still has to act on: a tool call whose permission request has not been answered.
 *
 * It is not a landmark — the rail has no reason to mark it, and once it is answered it is a step like
 * any other — but while the request stands, that row is the only thing between the agent and its
 * next move, and nothing about it is working-out to be folded away. Once decided it folds like the
 * rest of the process: the reader has had their say and the row has nothing left to ask.
 *
 * A plan proposal is the same kind of row: the card is the request, the reader approves or rejects it
 * through the same footer, and the fold keeps it for exactly as long as the request stands.
 */
export function isPendingPermissionRow(message: Message): boolean {
    return message.kind === 'tool-call' && message.tool.permission?.status === 'pending';
}

/**
 * A one-line notice the CLI wrote into the conversation: a new title, a mode switch, a usage limit, a
 * compaction.
 *
 * It is not working-out, and it is the only trace of the thing it reports — the title change has no
 * other row, the usage limit has no other explanation for why the turn stopped — so a fold has no
 * business taking it. It is not a landmark either: the rail has nothing to jump to, and the notice
 * says what it has to say where it stands.
 */
export function isAgentEventRow(message: Message): boolean {
    return message.kind === 'agent-event';
}

/**
 * A row nothing that hides rows may take: a landmark the rail marks, a request still waiting on the
 * reader, or a notice the CLI wrote.
 *
 * The three are kept for one reason — none of them is working-out — which is why every caller that
 * hides rows asks this and not the landmark question alone. The rail's own marks stay on
 * `isMinimapLandmarkRow`: a permission request is not a landmark, and the rail points at rows the
 * reader wrote into the conversation, not at every step that wants an answer. A plan proposal is such
 * a request and is kept by that half alone, so it is kept only until the reader decides it; a notice
 * is kept by the last half alone and never marks the rail.
 */
export function foldMustKeepMessage(message: Message): boolean {
    return isMinimapLandmarkRow(message) || isPendingPermissionRow(message) || isAgentEventRow(message);
}

/**
 * Whether the conversation minimap should leave this landmark off its rail.
 *
 * The rail only ever points at rows the list actually renders — a marker for a row the list hides
 * would jump nowhere — so everything `shouldHideMessageInChatList` drops is dropped here too. On
 * top of that the minimap hides post-compaction summaries: the list keeps them (they are the only
 * record of what was dropped), but they are not a landmark the user wrote, and a summary can be
 * thousands of words of prose that would swamp every real prompt around it on the rail.
 *
 * `meta.isCompactSummary` is the structural signal — Claude Code stamps it on the summary record
 * itself and the CLI forwards it — so this never has to pattern-match the summary's wording.
 */
export function shouldHideMessageInMinimap(message: MinimapMessage): boolean {
    // Tool-call landmarks are never dropped by the list filter below (it only looks at user rows),
    // so they are kept unconditionally.
    if (message.kind === 'ask-user-question' || message.kind === 'preview-html') {
        return false;
    }
    if (message.meta?.isCompactSummary === true) {
        return true;
    }
    // Thinking rows are never user rows, so the setting cannot matter here.
    return shouldHideMessageInChatList(message, true);
}

/** One landmark row: the id the rail keys its mark by, and its index in the list's newest-first order. */
export type LandmarkRow = {
    id: string;
    index: number;
};

/**
 * The rows the rail draws marks for, in the list's own order (newest first), each carrying the index it
 * has there.
 *
 * `railIds` is what the rail carries, and a row counts only if it is one of them. The two sets have to
 * be the same set: the list reports the reader's place as an id, and the rail lights the mark with that
 * id — so an id the rail has no mark for leaves *every* mark dark. A compaction summary is the everyday
 * case (the rail hides those on purpose, the list still renders them) and a tool call whose card does
 * not exist yet is another; either is enough to blank the rail for the whole stretch the reader is in,
 * whenever it is the last landmark they have been through.
 */
export function railLandmarkRows(messages: readonly Message[], railIds: ReadonlySet<string>): LandmarkRow[] {
    const rows: LandmarkRow[] = [];
    messages.forEach((message, index) => {
        if (railIds.has(message.id)) rows.push({ id: message.id, index });
    });
    return rows;
}

/**
 * The landmark the reader is on, out of the landmark rows the list holds, or null when the list has
 * nothing to go on — no landmark row loaded, or no row measured at all, which happens while the list
 * settles and leaves the rail on its last answer.
 *
 * The answer is the newest landmark the reader has reached: the newest one whose row is not below the
 * viewport. Rows above the bottom edge of the screen have been read and rows below it have not, so a
 * landmark there is one the reader has been through — on screen or not. Off screen is the ordinary case
 * for the landmark that ends a conversation, since the reply after it usually runs past a screen; asking
 * for the nearest prompt instead lights up the message *before* it, and so does taking the oldest
 * landmark on screen, which is what made a preview or a question in the middle of a conversation
 * unreachable whenever the prompt above it shared the screen.
 *
 * With no landmark above the bottom edge the reader is at the very top of the conversation, ahead of the
 * first one, and that first landmark is the one they are about to reach.
 *
 * `landmarks` is newest first and `visibleIndexes` are indexes into that same order, so a larger index
 * is an older row.
 */
export function currentLandmark(landmarks: readonly LandmarkRow[], visibleIndexes: readonly number[]): string | null {
    if (landmarks.length === 0 || visibleIndexes.length === 0) return null;

    let bottom = visibleIndexes[0];
    for (const index of visibleIndexes) {
        if (index < bottom) bottom = index;
    }

    for (const landmark of landmarks) {
        if (landmark.index >= bottom) return landmark.id;
    }
    return landmarks[landmarks.length - 1].id;
}
