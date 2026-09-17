import { describe, expect, it } from 'vitest';
import { sendFailureKey } from './sendFailure';

describe('sendFailureKey', () => {
    it('blames the image only when the image upload actually failed', () => {
        expect(sendFailureKey('image-upload')).toBe('errors.imageUploadFailed');
    });

    it('reports an unavailable session rather than a network problem', () => {
        // The bug this guards: a 404 for a session whose share was revoked used to
        // surface as "image upload failed, check your connection".
        expect(sendFailureKey('no-access')).toBe('errors.sessionUnavailable');
    });

    it('falls back to a plain send failure for network and server rejections', () => {
        expect(sendFailureKey('network')).toBe('errors.messageSendFailed');
        expect(sendFailureKey('send')).toBe('errors.messageSendFailed');
    });
});
