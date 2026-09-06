import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('Avatar session icon presets', () => {
    test('uses the dedicated full GitHub icon for GitHub session badges', () => {
        const source = readFileSync(join(__dirname, 'Avatar.tsx'), 'utf8');

        expect(source).toContain("github: require('@/assets/images/icon-github-session.png')");
        expect(existsSync(join(__dirname, '../assets/images/icon-github-session.png'))).toBe(true);
    });
});
