import * as React from 'react';
import { Keyboard } from 'react-native';
import { useKeyboardController } from 'react-native-keyboard-controller';
import { Modal } from '@/modal';

// How long to wait for the prompt's keyboard to finish hiding before following keyboards again.
const KEYBOARD_HIDE_TIMEOUT_MS = 1000;

/**
 * `Modal.prompt` for a screen that follows the keyboard (the chat: its list's inset and, where the native
 * dock is missing, the composer). The prompt's own field raises the keyboard, and following it would lift
 * the screen behind the prompt and drop it again as the prompt closes: a jump of the whole screen. So
 * keyboard-controller stops following keyboards while the prompt is open, and starts again once the
 * prompt's keyboard is down. (The native composer dock lets go of keyboards it doesn't own by itself.)
 */
export function useKeyboardDetachedPrompt() {
    const { setEnabled } = useKeyboardController();
    return React.useCallback(async (...args: Parameters<typeof Modal.prompt>) => {
        setEnabled(false);
        try {
            return await Modal.prompt(...args);
        } finally {
            if (Keyboard.isVisible()) {
                await new Promise<void>((resolve) => {
                    const timeout = setTimeout(done, KEYBOARD_HIDE_TIMEOUT_MS);
                    const subscription = Keyboard.addListener('keyboardDidHide', done);
                    function done() {
                        clearTimeout(timeout);
                        subscription.remove();
                        resolve();
                    }
                });
            }
            setEnabled(true);
        }
    }, [setEnabled]);
}
