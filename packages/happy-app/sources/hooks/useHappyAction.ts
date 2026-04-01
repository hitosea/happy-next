import * as React from 'react';
import { Modal } from '@/modal';
import { HappyError } from '@/utils/errors';

export function useHappyAction(action: () => Promise<void>, opts?: { timeoutMs?: number }) {
    const [loading, setLoading] = React.useState(false);
    const loadingRef = React.useRef(false);
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = React.useRef(false);
    // Default 60s timeout
    const timeoutMs = opts?.timeoutMs ?? 60_000;

    const cancel = React.useCallback(() => {
        abortRef.current = true;
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        loadingRef.current = false;
        setLoading(false);
    }, []);

    const doAction = React.useCallback(() => {
        if (loadingRef.current) {
            return;
        }
        loadingRef.current = true;
        abortRef.current = false;
        setLoading(true);

        timeoutRef.current = setTimeout(() => {
            abortRef.current = true;
            loadingRef.current = false;
            setLoading(false);
        }, timeoutMs);

        (async () => {
            try {
                while (true) {
                    try {
                        await action();
                        break;
                    } catch (e) {
                        if (abortRef.current) break;
                        if (e instanceof HappyError) {
                            // if (e.canTryAgain) {
                            //     Modal.alert('Error', e.message, [{ text: 'Try again' }, { text: 'Cancel', style: 'cancel' }]) 
                            //         break;
                            //     }
                            // } else {
                            //     await alert('Error', e.message, [{ text: 'OK', style: 'cancel' }]);
                            //     break;
                            // }
                            Modal.alert('Error', e.message, [{ text: 'OK', style: 'cancel' }]);
                            break;
                        } else {
                            const message = e instanceof Error ? e.message : 'Unknown error';
                            Modal.alert('Error', message, [{ text: 'OK', style: 'cancel' }]);
                            break;
                        }
                    }
                }
            } finally {
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                }
                loadingRef.current = false;
                setLoading(false);
            }
        })();
    }, [action, timeoutMs]);

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            abortRef.current = true;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            loadingRef.current = false;
            setLoading(false);
        };
    }, []);

    return [loading, doAction, cancel] as const;
}