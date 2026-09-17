import type { SendFailureReason } from '@/sync/sync';
import type { TranslationKey } from '@/text';

/**
 * i18n key for a failed send.
 *
 * The message names the step that actually failed. This used to be chosen by
 * checking whether images were attached, which blamed the image for every
 * non-image failure: a 404 from a revoked share surfaced as "image upload
 * failed, check your connection", pointing the user — and anyone debugging the
 * report — at the network instead of at the real cause.
 */
export function sendFailureKey(reason: SendFailureReason): TranslationKey {
    switch (reason) {
        case 'image-upload':
            return 'errors.imageUploadFailed';
        case 'no-access':
            return 'errors.sessionUnavailable';
        default:
            // 'network' and 'send' both reach the user as a plain send failure,
            // and retrying is the right advice for either.
            return 'errors.messageSendFailed';
    }
}
