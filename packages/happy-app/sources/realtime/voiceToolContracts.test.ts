import { describe, expect, it } from 'vitest';
import {
    getVoicePermissionModesForAgent,
    isVoicePermissionModeForAgent,
    resolveVoicePermissionAgent,
} from './voiceToolContracts';

describe('voice permission mode contracts', () => {
    it('resolves unknown or missing flavors to Claude', () => {
        expect(resolveVoicePermissionAgent(undefined)).toBe('claude');
        expect(resolveVoicePermissionAgent(null)).toBe('claude');
        expect(resolveVoicePermissionAgent('claude')).toBe('claude');
        expect(resolveVoicePermissionAgent('unknown')).toBe('claude');
    });

    it('returns agent-specific permission modes', () => {
        expect(getVoicePermissionModesForAgent('claude')).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
        expect(getVoicePermissionModesForAgent('codex')).toEqual(['default', 'read-only', 'on-failure', 'full-auto']);
        expect(getVoicePermissionModesForAgent('gemini')).toEqual(['default', 'auto_edit', 'plan', 'yolo']);
        expect(getVoicePermissionModesForAgent('qoder')).toEqual(['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo']);
    });

    it('validates modes against the active agent only', () => {
        expect(isVoicePermissionModeForAgent('claude', 'bypassPermissions')).toBe(true);
        expect(isVoicePermissionModeForAgent('claude', 'yolo')).toBe(false);
        expect(isVoicePermissionModeForAgent('codex', 'full-auto')).toBe(true);
        expect(isVoicePermissionModeForAgent('codex', 'acceptEdits')).toBe(false);
        expect(isVoicePermissionModeForAgent('gemini', 'auto_edit')).toBe(true);
        expect(isVoicePermissionModeForAgent('gemini', 'read-only')).toBe(false);
        expect(isVoicePermissionModeForAgent('qoder', 'dontAsk')).toBe(true);
        expect(isVoicePermissionModeForAgent('qoder', 'plan')).toBe(false);
    });
});
