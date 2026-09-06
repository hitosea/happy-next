import { parseMarkdownBlock } from "./parseMarkdownBlock"

export type OptionItem = {
    title: string;
    destructive?: boolean;
}

export type MarkdownBlock = {
    type: 'text'
    content: MarkdownSpan[]
} | {
    type: 'header'
    level: 1 | 2 | 3 | 4 | 5 | 6
    content: MarkdownSpan[]
} | {
    type: 'list',
    items: { depth: number, spans: MarkdownSpan[] }[]
} | {
    type: 'numbered-list',
    items: { number: number, depth: number, spans: MarkdownSpan[] }[]
} | {
    type: 'code-block',
    language: string | null,
    content: string
} | {
    type: 'mermaid',
    content: string
} | {
    type: 'horizontal-rule'
} | {
    type: 'options',
    items: OptionItem[]
} | {
    type: 'table',
    headers: MarkdownSpan[][],
    rows: MarkdownSpan[][][]
} | {
    type: 'blockquote',
    content: { depth: number, spans: MarkdownSpan[], list?: 'bullet' }[]
} | {
    type: 'image',
    alt: string,
    url: string,
}

export type MarkdownSpan = {
    styles: ('italic' | 'bold' | 'semibold' | 'code' | 'strikethrough' | 'underline')[],
    text: string,
    url: string | null,
    imageUrl?: string,
}

export function parseMarkdown(markdown: string) {
    return parseMarkdownBlock(markdown);
}
