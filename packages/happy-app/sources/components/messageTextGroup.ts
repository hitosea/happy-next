import type { Message } from '@/sync/typesMessage';
import { shouldHideMessageInChatList } from './chatListVisibility';

function isGroupText(message: Message): boolean {
    return message.kind === 'agent-text' && !message.isThinking;
}

/**
 * The text of the run of agent texts a message sits in, oldest first and joined by a blank line.
 *
 * An agent reply arrives as one row per content block, so a reply the reader sees as one can be
 * several rows standing next to each other. Copying, reading aloud and long-press selection take the
 * run whole. Rows the list hides (thinking, when it is turned off) are skipped, so two texts that
 * look adjacent are adjacent; anything else on screen — a step, thinking, a notice, a prompt — ends
 * the run.
 *
 * Resolved when the reader acts rather than on every render, so a list that changes with each
 * streamed token pays nothing for it. `messages` is newest first, the order the store keeps them in.
 * Returns null when the message is not in `messages` or is not such a text.
 */
export function textGroupAround(messages: readonly Message[], messageId: string, showThinkingMessages: boolean): string | null {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || !isGroupText(messages[index])) return null;

    const texts: string[] = [];
    const collect = (from: number, step: 1 | -1) => {
        for (let i = from; i >= 0 && i < messages.length; i += step) {
            const message = messages[i];
            if (shouldHideMessageInChatList(message, showThinkingMessages)) continue;
            if (!isGroupText(message)) break;
            texts.push((message as { text: string }).text);
        }
    };
    // Older rows first (higher indices), then this row and the newer ones.
    collect(index + 1, 1);
    texts.reverse();
    collect(index, -1);
    return texts.join('\n\n');
}
