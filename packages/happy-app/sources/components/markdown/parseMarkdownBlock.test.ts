import { describe, expect, it } from 'vitest';
import { parseMarkdownBlock } from './parseMarkdownBlock';

describe('parseMarkdownBlock', () => {
    it('preserves indentation depth for nested bullet and numbered lists', () => {
        const markdown = [
            '- parent',
            '  - child',
            '    - grandchild',
            '',
            '1. first',
            '  2. second',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(2);

        const bulletList = blocks[0];
        expect(bulletList.type).toBe('list');
        if (bulletList.type !== 'list') throw new Error('Expected list block');
        expect(bulletList.items.map(item => item.depth)).toEqual([0, 1, 2]);
        expect(bulletList.items.map(item => item.spans[0]?.text)).toEqual(['parent', 'child', 'grandchild']);

        const numberedList = blocks[1];
        expect(numberedList.type).toBe('numbered-list');
        if (numberedList.type !== 'numbered-list') throw new Error('Expected numbered-list block');
        expect(numberedList.items.map(item => item.depth)).toEqual([0, 1]);
        expect(numberedList.items.map(item => item.number)).toEqual([1, 2]);
        expect(numberedList.items.map(item => item.spans[0]?.text)).toEqual(['first', 'second']);
    });

    it('preserves depth for nested blockquotes', () => {
        const markdown = [
            '> 一级引用',
            '>> 二级引用',
            '>>> 三级引用',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const quote = blocks[0];
        expect(quote.type).toBe('blockquote');
        if (quote.type !== 'blockquote') throw new Error('Expected blockquote block');
        expect(quote.content.map(item => item.depth)).toEqual([1, 2, 3]);
        expect(quote.content.map(item => item.spans[0]?.text)).toEqual(['一级引用', '二级引用', '三级引用']);
    });

    it('preserves bullet lists inside blockquotes', () => {
        const markdown = [
            '> 引用里的说明',
            '> - 引用里的列表项 A',
            '> - 引用里的列表项 B',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const quote = blocks[0];
        expect(quote.type).toBe('blockquote');
        if (quote.type !== 'blockquote') throw new Error('Expected blockquote block');
        expect(quote.content.map(item => item.list ?? null)).toEqual([null, 'bullet', 'bullet']);
        expect(quote.content.map(item => item.spans[0]?.text)).toEqual(['引用里的说明', '引用里的列表项 A', '引用里的列表项 B']);
    });

    it('keeps an empty first header cell renderable in markdown tables', () => {
        const markdown = [
            '| | 场景 A | 场景 B |',
            '|---|---|---|',
            '| **用户位置** | 手机/远程 | 终端前 |',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('table');

        const table = blocks[0];
        if (table.type !== 'table') throw new Error('Expected table block');

        expect(table.headers[0]).toEqual([
            { styles: [], text: '\u200B', url: null },
        ]);
    });

    it('keeps nested markdown fences with an explicit inner language', () => {
        const markdown = [
            '```md',
            '```ts',
            'const value = 1;',
            '```',
            '```',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.language).toBe('md');
        expect(first.content).toBe([
            '```ts',
            'const value = 1;',
            '```',
        ].join('\n'));
    });

    it('keeps anonymous nested fences inside plain triple-backtick wrappers', () => {
        const markdown = [
            '```',
            '第一层内容',
            '```',
            '第二层内容',
            '```',
            '```',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.content).toBe([
            '第一层内容',
            '```',
            '第二层内容',
            '```',
        ].join('\n'));
    });

    it('does not swallow a later separate anonymous fenced block', () => {
        const markdown = [
            '```',
            '第一段代码',
            '```',
            '普通文本',
            '```',
            '第二段代码',
            '```',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(3);
        expect(blocks[0].type).toBe('code-block');
        expect(blocks[1].type).toBe('text');
        expect(blocks[2].type).toBe('code-block');

        const secondBlock = blocks[2];
        if (secondBlock.type !== 'code-block') throw new Error('Expected second code-block');
        expect(secondBlock.content).toBe('第二段代码');
    });

    it('does not swallow a later separate language fenced block', () => {
        const markdown = [
            '```',
            '第一段代码',
            '```',
            '普通文本',
            '```ts',
            'const x = 1;',
            '```',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(3);
        expect(blocks[0].type).toBe('code-block');
        expect(blocks[1].type).toBe('text');
        expect(blocks[2].type).toBe('code-block');
    });

    it('handles three consecutive anonymous fences with close-then-open semantics', () => {
        const markdown = [
            '```',
            'first',
            '```',
            '```',
            '```',
            'tail',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(3);
        expect(blocks[0].type).toBe('code-block');
        expect(blocks[1].type).toBe('code-block');
        expect(blocks[2].type).toBe('text');
    });

    it('treats a four-backtick fence as a code block containing three-backtick fences', () => {
        const markdown = [
            '````',
            '```ts',
            'const x = 1;',
            '```',
            '````',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.language).toBe(null);
        expect(first.content).toBe([
            '```ts',
            'const x = 1;',
            '```',
        ].join('\n'));
    });

    it('keeps the info string on a four-backtick fence', () => {
        const markdown = [
            '````md',
            '```ts',
            'const x = 1;',
            '```',
            '````',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.language).toBe('md');
        expect(first.content).toBe([
            '```ts',
            'const x = 1;',
            '```',
        ].join('\n'));
    });

    it('does not close a four-backtick fence with a three-backtick line', () => {
        const markdown = [
            '````',
            'before',
            '```',
            'middle',
            '```',
            'after',
            '````',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.content).toBe([
            'before',
            '```',
            'middle',
            '```',
            'after',
        ].join('\n'));
    });

    it('parses HTML <img> tag as image block', () => {
        const markdown = '<img width="536" height="354" alt="Image" src="https://github.com/user-attachments/assets/bac39ded-f1f7-4430-a417-55d47a39e97f" />';
        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
            type: 'image',
            alt: 'Image',
            url: 'https://github.com/user-attachments/assets/bac39ded-f1f7-4430-a417-55d47a39e97f',
        });
    });

    it('parses HTML <img> tag without alt', () => {
        const markdown = '<img src="https://example.com/img.png" />';
        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
            type: 'image',
            alt: '',
            url: 'https://example.com/img.png',
        });
    });

    it('closes a four-backtick fence with a five-backtick line (longer fence allowed)', () => {
        const markdown = [
            '````',
            'hello',
            '`````',
            'tail',
        ].join('\n');

        const blocks = parseMarkdownBlock(markdown);

        expect(blocks).toHaveLength(2);
        const first = blocks[0];
        expect(first.type).toBe('code-block');
        if (first.type !== 'code-block') throw new Error('Expected code-block');
        expect(first.content).toBe('hello');
        expect(blocks[1].type).toBe('text');
    });
});
