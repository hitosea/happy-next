import { describe, expect, it } from 'vitest';
import { isPermissionModeForAgent, PermissionModeSchema } from './permissionModes';

describe('qoder permission modes', () => {
    it('accepts the modes qodercli offers over ACP', () => {
        for (const mode of ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo']) {
            expect(isPermissionModeForAgent('qoder', mode)).toBe(true);
        }
        expect(isPermissionModeForAgent('qoder', 'plan')).toBe(false);
        expect(isPermissionModeForAgent('claude', 'dontAsk')).toBe(false);
        expect(PermissionModeSchema.safeParse('dontAsk').success).toBe(true);
    });
});
