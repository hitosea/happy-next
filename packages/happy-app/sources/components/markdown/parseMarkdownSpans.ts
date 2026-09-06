import type { MarkdownSpan } from "./parseMarkdown";

// Supports bold/italic/strikethrough/underline/code and markdown links.
// Link URL pattern allows balanced single-level parentheses inside URLs
// so paths like /(app)/session/[id]/file.tsx are parsed correctly.
const patternSource = /(`(.*?)(?:`|$))|(<u>(.*?)<\/u>)|(\*\*\*(.*?)(?:\*\*\*|$))|(\*\*(.*?)(?:\*\*|$))|(~~(.*?)(?:~~|$))|(\*(.*?)(?:\*|$))|(\[([^\]]+)\](?:\(((?:[^()]+|\([^()]*\))*)\))?)/g.source;

function normalizeMarkdownLinkUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    // CommonMark supports angle-bracket link destinations: [text](<url>)
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

export function parseMarkdownSpans(markdown: string, header: boolean) {
    return parseMarkdownSpansWithInheritedStyles(markdown, header, []);
}

function parseMarkdownSpansWithInheritedStyles(markdown: string, header: boolean, inheritedStyles: MarkdownSpan['styles']): MarkdownSpan[] {
    const spans: MarkdownSpan[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const pattern = new RegExp(patternSource, 'g');

    while ((match = pattern.exec(markdown)) !== null) {
        // Capture the text between the end of the last match and the start of this match as plain text
        const plainText = markdown.slice(lastIndex, match.index);
        if (plainText) {
            spans.push({ styles: [...inheritedStyles], text: plainText, url: null });
        }

        if (match[1]) {
            // Inline code
            spans.push({ styles: [...inheritedStyles, 'code'], text: match[2], url: null });
        } else if (match[3]) {
            // Underline
            spans.push(...parseMarkdownSpansWithInheritedStyles(match[4], header, [...inheritedStyles, 'underline']));
        } else if (match[5]) {
            // Bold + italic
            if (header) {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[6], header, inheritedStyles));
            } else {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[6], header, [...inheritedStyles, 'bold', 'italic']));
            }
        } else if (match[7]) {
            // Bold
            if (header) {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[8], header, inheritedStyles));
            } else {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[8], header, [...inheritedStyles, 'bold']));
            }
        } else if (match[9]) {
            // Strikethrough
            spans.push(...parseMarkdownSpansWithInheritedStyles(match[10], header, [...inheritedStyles, 'strikethrough']));
        } else if (match[11]) {
            // Italic
            if (header) {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[12], header, inheritedStyles));
            } else {
                spans.push(...parseMarkdownSpansWithInheritedStyles(match[12], header, [...inheritedStyles, 'italic']));
            }
        } else if (match[13]) {
            // Link or image - check if preceded by ! (image syntax)
            const isImage = match.index > 0 && markdown[match.index - 1] === '!';
            if (isImage) {
                // Remove the trailing '!' from the last plain text span
                const prev = spans[spans.length - 1];
                if (prev && !prev.url && !prev.imageUrl && prev.text.endsWith('!')) {
                    prev.text = prev.text.slice(0, -1);
                    if (prev.text.length === 0) spans.pop();
                }
            }

            // Link or image - handle incomplete links (no URL part)
            if (match[15]) {
                const normalizedUrl = normalizeMarkdownLinkUrl(match[15]);
                if (normalizedUrl) {
                    if (isImage) {
                        spans.push({ styles: [...inheritedStyles], text: match[14], url: null, imageUrl: normalizedUrl });
                    } else {
                        spans.push({ styles: [...inheritedStyles], text: match[14], url: normalizedUrl });
                    }
                } else {
                    spans.push({ styles: [...inheritedStyles], text: isImage ? `![${match[14]}]` : `[${match[14]}]`, url: null });
                }
            } else {
                // If no URL part, treat as plain text with brackets
                spans.push({ styles: [...inheritedStyles], text: isImage ? `![${match[14]}]` : `[${match[14]}]`, url: null });
            }
        }

        lastIndex = pattern.lastIndex;
    }

    // If there's any text remaining after the last match, treat it as plain
    if (lastIndex < markdown.length) {
        spans.push({ styles: [...inheritedStyles], text: markdown.slice(lastIndex), url: null });
    }

    return spans;
}
