import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GitHubListView main tab bottom padding', () => {
    test('uses the shared main tab bottom padding for scrollable issue and PR lists', () => {
        const source = readFileSync(join(__dirname, 'GitHubListView.tsx'), 'utf8');

        expect(source).toContain("import { useMainTabBottomPadding } from '@/hooks/useMainTabBottomPadding';");
        expect(source).toContain('const tabBottomPadding = useMainTabBottomPadding();');
        expect(source).toContain('paddingBottom: tabBottomPadding');
    });
});
