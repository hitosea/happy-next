import { describe, expect, it } from 'vitest';
import { enhancedModeQueueHash, enhancedModeRestartHash } from './enhancedModeHash';
import type { EnhancedMode } from '@/claude/loop';

describe('enhancedModeHash decision logic', () => {
    const base: EnhancedMode = { permissionMode: 'default', model: 'claude-haiku-4-5-20251001', reasoningEffort: 'medium' };

    it('model-only change: different queue hash, same restart hash (hot swap via set_model)', () => {
        const next: EnhancedMode = { ...base, model: 'claude-sonnet-4-6' };
        expect(enhancedModeQueueHash(next)).not.toBe(enhancedModeQueueHash(base));
        expect(enhancedModeRestartHash(next)).toBe(enhancedModeRestartHash(base));
    });

    it('plan flip: different queue hash (no cross-batching), same restart hash (hot swap via set_permission_mode)', () => {
        const next: EnhancedMode = { ...base, permissionMode: 'plan' };
        expect(enhancedModeQueueHash(next)).not.toBe(enhancedModeQueueHash(base));
        expect(enhancedModeRestartHash(next)).toBe(enhancedModeRestartHash(base));
    });

    it('non-plan permission mode change: same queue hash (batched, forwarded live)', () => {
        const next: EnhancedMode = { ...base, permissionMode: 'acceptEdits' };
        expect(enhancedModeQueueHash(next)).toBe(enhancedModeQueueHash(base));
    });

    it('effort change: different restart hash (cold restart)', () => {
        const next: EnhancedMode = { ...base, reasoningEffort: 'high' };
        expect(enhancedModeRestartHash(next)).not.toBe(enhancedModeRestartHash(base));
    });

    it('context window change: different restart hash (cold restart with --autocompact)', () => {
        const next: EnhancedMode = { ...base, contextWindow: 400_000 };
        expect(enhancedModeRestartHash(next)).not.toBe(enhancedModeRestartHash(base));
    });

    it('model + plan together: still same restart hash (hot swap)', () => {
        const next: EnhancedMode = { ...base, model: 'claude-sonnet-4-6', permissionMode: 'plan' };
        expect(enhancedModeRestartHash(next)).toBe(enhancedModeRestartHash(base));
    });
});
