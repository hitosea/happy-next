import type { MarkdownBlock, MarkdownSpan, OptionItem } from "./parseMarkdown";
import { parseMarkdownSpans } from "./parseMarkdownSpans";

const EMPTY_TABLE_CELL_PLACEHOLDER = '\u200B';

function parseTableCell(cell: string) {
    const spans = parseMarkdownSpans(cell, false);
    if (spans.length > 0) {
        return spans;
    }
    return [{ styles: [], text: EMPTY_TABLE_CELL_PLACEHOLDER, url: null }];
}

// Split a table row by '|', stripping leading/trailing pipes but preserving empty cells in between
export function splitTableRow(line: string): string[] {
    // Remove leading/trailing pipe and whitespace
    let s = line;
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    // If nothing left after stripping pipes, no cells
    if (s.trim().length === 0 && !line.includes('|')) return [];
    return s.split('|').map(cell => cell.trim());
}

function parseTable(lines: string[], startIndex: number): { table: MarkdownBlock | null; nextIndex: number } {
    let index = startIndex;
    const tableLines: string[] = [];

    // Collect consecutive lines that contain pipe characters to identify potential table rows
    while (index < lines.length && lines[index].includes('|')) {
        tableLines.push(lines[index]);
        index++;
    }

    if (tableLines.length < 2) {
        return { table: null, nextIndex: startIndex };
    }

    // Validate that the second line is a separator containing dashes, which distinguishes tables from plain text
    const separatorLine = tableLines[1].trim();
    const isSeparator = /^[|\s\-:=]*$/.test(separatorLine) && separatorLine.includes('-');

    if (!isSeparator) {
        return { table: null, nextIndex: startIndex };
    }

    // Extract header cells from the first line, stripping leading/trailing pipes but preserving empty cells
    const headerLine = tableLines[0].trim();
    const headerStrings = splitTableRow(headerLine);

    if (headerStrings.length === 0) {
        return { table: null, nextIndex: startIndex };
    }

    // Parse inline markdown for headers
    const headers = headerStrings.map(parseTableCell);

    // Extract data rows from remaining lines (skipping the separator line), preserving valid cell content
    const rows: ReturnType<typeof parseMarkdownSpans>[][] = [];
    for (let i = 2; i < tableLines.length; i++) {
        const rowLine = tableLines[i].trim();
        if (rowLine.includes('|')) {
            const rowCells = splitTableRow(rowLine);

            // Include rows that contain at least one cell
            if (rowCells.length > 0) {
                // Parse inline markdown for each cell
                rows.push(rowCells.map(parseTableCell));
            }
        }
    }

    const table: MarkdownBlock = {
        type: 'table',
        headers,
        rows
    };

    return { table, nextIndex: index };
}


function getListIndentDepth(indent: string): number {
    let columns = 0;
    for (const char of indent) {
        columns += char === '\t' ? 4 : 1;
    }
    return Math.floor(columns / 2);
}

function parseBlockquoteLine(line: string): { depth: number, content: string } | null {
    const match = line.match(/^\s*(>+)\s?(.*)$/);
    if (!match) return null;
    return {
        depth: match[1].length,
        content: match[2],
    };
}

function shouldOpenAnonymousNestedFence(lines: string[], fenceIndex: number): boolean {
    for (let i = fenceIndex + 1; i < lines.length - 1; i++) {
        if (lines[i].trim().startsWith('```')) {
            if (i === fenceIndex + 1) {
                return false;
            }
            return lines[i].trim() === '```' && lines[i + 1].trim() === '```';
        }
    }
    return false;
}

export function parseMarkdownBlock(markdown: string) {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let index = 0;
    outer: while (index < lines.length) {
        const line = lines[index];
        index++;

        // Headers
        for (let i = 1; i <= 6; i++) {
            if (line.startsWith(`${'#'.repeat(i)} `)) {
                blocks.push({ type: 'header', level: i as 1 | 2 | 3 | 4 | 5 | 6, content: parseMarkdownSpans(line.slice(i + 1).trim(), true) });
                continue outer;
            }
        }

        // Trim
        let trimmed = line.trim();

        // Code block - CommonMark backtick fence. An opening fence is >=3 backticks;
        // the closing fence must be at least as long, on its own line, with only
        // whitespace. The info string after the opening fence must not contain backticks.
        const fenceMatch = trimmed.charCodeAt(0) === 96 ? trimmed.match(/^(`{3,})([^`]*)$/) : null;
        if (fenceMatch) {
            const openFenceLen = fenceMatch[1].length;
            const language = fenceMatch[2].trim() || null;
            let content: string[] = [];
            if (openFenceLen >= 4) {
                while (index < lines.length) {
                    const nextLine = lines[index];
                    const nextTrimmed = nextLine.trim();
                    const closeMatch = nextTrimmed.charCodeAt(0) === 96 ? nextTrimmed.match(/^(`{3,})$/) : null;
                    if (closeMatch && closeMatch[1].length >= openFenceLen) {
                        index++;
                        break;
                    }
                    content.push(nextLine);
                    index++;
                }
            } else {
                // Legacy 3-backtick handling with anonymous-nested-fence heuristics.
                const supportsNestedFences = language === null || language === 'md' || language === 'markdown';
                let nestedFenceDepth = 0;
                while (index < lines.length) {
                    const nextLine = lines[index];
                    const nextTrimmed = nextLine.trim();
                    if (nextTrimmed.startsWith('```')) {
                        if (supportsNestedFences) {
                            if (nextTrimmed === '```') {
                                if (nestedFenceDepth === 0) {
                                    if (shouldOpenAnonymousNestedFence(lines, index)) {
                                        nestedFenceDepth++;
                                        content.push(nextLine);
                                        index++;
                                        continue;
                                    }
                                    index++;
                                    break;
                                }
                                nestedFenceDepth--;
                                content.push(nextLine);
                                index++;
                                continue;
                            }
                            nestedFenceDepth++;
                            content.push(nextLine);
                            index++;
                            continue;
                        }

                        if (nextTrimmed === '```') {
                            index++;
                            break;
                        }
                    }
                    content.push(nextLine);
                    index++;
                }
            }
            const contentString = content.join('\n');

            // Detect mermaid diagram language and route to appropriate block type
            if (language === 'mermaid') {
                blocks.push({ type: 'mermaid', content: contentString });
            } else {
                blocks.push({ type: 'code-block', language, content: contentString });
            }
            continue;
        }

        // Horizontal rule
        if (trimmed === '---') {
            blocks.push({ type: 'horizontal-rule' });
            continue;
        }

        // Options block
        if (trimmed.startsWith('<options>')) {
            let items: OptionItem[] = [];
            while (index < lines.length) {
                const nextLine = lines[index];
                if (nextLine.trim() === '</options>') {
                    index++;
                    break;
                }
                // Extract content and attributes from <option> tags
                const optionMatch = nextLine.match(/<option(\s[^>]*)?>(.+?)<\/option>/);
                if (optionMatch) {
                    const attrs = optionMatch[1] || '';
                    const title = optionMatch[2].trim();
                    if (title) {
                        items.push({
                            title,
                            destructive: /\bdestructive\b/.test(attrs),
                        });
                    }
                }
                index++;
            }
            if (items.length > 0) {
                blocks.push({ type: 'options', items });
            }
            continue;
        }

        // Blockquote
        const blockquoteLine = parseBlockquoteLine(line);
        if (blockquoteLine) {
            let allLines = [blockquoteLine];
            while (index < lines.length) {
                const nextBlockquoteLine = parseBlockquoteLine(lines[index]);
                if (nextBlockquoteLine) {
                    allLines.push(nextBlockquoteLine);
                    index++;
                } else {
                    break;
                }
            }
            const paragraphs: { depth: number, spans: MarkdownSpan[], list?: 'bullet' }[] = [];
            let currentParagraph: { depth: number, lines: string[] } | null = null;
            const flushCurrentParagraph = () => {
                if (currentParagraph && currentParagraph.lines.length > 0) {
                    paragraphs.push({ depth: currentParagraph.depth, spans: parseMarkdownSpans(currentParagraph.lines.join(' '), false) });
                    currentParagraph = null;
                }
            };
            for (const l of allLines) {
                if (l.content === '') {
                    flushCurrentParagraph();
                } else if (l.content.match(/^[-*+]\s+/)) {
                    flushCurrentParagraph();
                    paragraphs.push({ depth: l.depth, list: 'bullet', spans: parseMarkdownSpans(l.content.replace(/^[-*+]\s+/, ''), false) });
                } else if (!currentParagraph || currentParagraph.depth !== l.depth) {
                    flushCurrentParagraph();
                    currentParagraph = { depth: l.depth, lines: [l.content] };
                } else {
                    currentParagraph.lines.push(l.content);
                }
            }
            flushCurrentParagraph();
            if (paragraphs.length > 0) {
                blocks.push({ type: 'blockquote', content: paragraphs });
            }
            continue;
        }

        // If it is a numbered list. Keep leading indentation so nested
        // markdown list levels render with their original visual hierarchy.
        const numberedListMatch = line.match(/^(\s*)(\d+)\.\s/);
        if (numberedListMatch) {
            let allLines = [{
                depth: getListIndentDepth(numberedListMatch[1]),
                number: parseInt(numberedListMatch[2]),
                content: line.slice(numberedListMatch[0].length).trim(),
            }];
            while (index < lines.length) {
                const nextLine = lines[index];
                const nextMatch = nextLine.match(/^(\s*)(\d+)\.\s/);
                if (!nextMatch) break;
                allLines.push({
                    depth: getListIndentDepth(nextMatch[1]),
                    number: parseInt(nextMatch[2]),
                    content: nextLine.slice(nextMatch[0].length).trim(),
                });
                index++;
            }
            blocks.push({ type: 'numbered-list', items: allLines.map((l) => ({ number: l.number, depth: l.depth, spans: parseMarkdownSpans(l.content, false) })) });
            continue;
        }

        // If it is a list. Keep leading indentation so nested markdown list
        // levels render with their original visual hierarchy.
        const listMatch = line.match(/^(\s*)-\s/);
        if (listMatch) {
            let allLines = [{
                depth: getListIndentDepth(listMatch[1]),
                content: line.slice(listMatch[0].length).trim(),
            }];
            while (index < lines.length) {
                const nextLine = lines[index];
                const nextMatch = nextLine.match(/^(\s*)-\s/);
                if (!nextMatch) break;
                allLines.push({
                    depth: getListIndentDepth(nextMatch[1]),
                    content: nextLine.slice(nextMatch[0].length).trim(),
                });
                index++;
            }
            blocks.push({ type: 'list', items: allLines.map((l) => ({ depth: l.depth, spans: parseMarkdownSpans(l.content, false) })) });
            continue;
        }

        // Check for table
        if (trimmed.includes('|') && !trimmed.startsWith('```')) {
            const { table, nextIndex } = parseTable(lines, index - 1);
            if (table) {
                blocks.push(table);
                index = nextIndex;
                continue outer;
            }
        }

        // Standalone image: ![alt](url)
        const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(((?:[^()]+|\([^()]*\))*)\)$/);
        if (imageMatch) {
            blocks.push({ type: 'image', alt: imageMatch[1], url: imageMatch[2].trim() });
            continue;
        }

        // HTML <img> tag (GitHub often generates these for pasted images)
        const imgTagMatch = trimmed.match(/^<img\s[^>]*\/?>/i);
        if (imgTagMatch) {
            const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
            const altMatch = trimmed.match(/alt=["']([^"']+)["']/i);
            if (srcMatch) {
                blocks.push({ type: 'image', alt: altMatch?.[1] ?? '', url: srcMatch[1] });
                continue;
            }
        }

        // Fallback
        if (trimmed.length > 0) {
            blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false) });
        }
    }
    return blocks;
}
