import { describe, expect, it } from 'vitest';
import { isPermissionModeForAgent, PermissionModeSchema } from './permissionModes';

describe('qoder permission modes', () => {
    it('accepts the qodercli modes Happy offers', () => {
        for (const mode of ['default', 'acceptEdits', 'auto', 'yolo']) {
            expect(isPermissionModeForAgent('qoder', mode)).toBe(true);
        }
        expect(isPermissionModeForAgent('qoder', 'plan')).toBe(false);
        expect(isPermissionModeForAgent('qoder', 'dontAsk')).toBe(false);
        expect(PermissionModeSchema.safeParse('dontAsk').success).toBe(false);
    });
});

describe('antigravity permission modes', () => {
    it('accepts the agy modes Happy offers', () => {
        for (const mode of ['default', 'acceptEdits', 'auto', 'plan', 'yolo']) {
            expect(isPermissionModeForAgent('antigravity', mode)).toBe(true);
        }
        expect(isPermissionModeForAgent('antigravity', 'bypassPermissions')).toBe(false);
    });
});

describe('deepseek permission modes', () => {
    it('accepts the dsh modes Happy offers', () => {
        for (const mode of ['default', 'read-only', 'plan', 'yolo']) {
            expect(isPermissionModeForAgent('deepseek', mode)).toBe(true);
        }
        expect(isPermissionModeForAgent('deepseek', 'acceptEdits')).toBe(false);
        expect(isPermissionModeForAgent('deepseek', 'bypassPermissions')).toBe(false);
    });
});
