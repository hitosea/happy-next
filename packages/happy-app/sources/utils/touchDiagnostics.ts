import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type TouchDiagnosticsNative = {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    exportReport(): Promise<string>;
    /** Missing from a binary built before it was added. */
    log?(message: string): void;
};

/**
 * iOS touch diagnostics (`modules/touch-diagnostics`): while enabled, the native side keeps a short
 * log of every tap and which gesture recognizers took it, plus keyboard, text input and window
 * events, to catch taps that get swallowed. `null` on other platforms and in binaries built before it.
 */
export const touchDiagnostics: TouchDiagnosticsNative | null =
    Platform.OS === 'ios' ? requireOptionalNativeModule<TouchDiagnosticsNative>('TouchDiagnostics') : null;

/**
 * Our patch of React Native's Pressability reports each press (who was asked, granted, every state
 * change, the measured region, moves read as outside it, onPress) to `global.__happyPressLog` when
 * it is set, so the export shows where a swallowed tap is lost on the JS side.
 */
export function syncTouchDiagnosticsPressLog(enabled: boolean): void {
    const native = touchDiagnostics;
    const g = globalThis as { __happyPressLog?: (message: string) => void };
    if (enabled && native && typeof native.log === 'function') {
        g.__happyPressLog = (message: string) => native.log?.(message);
    } else {
        delete g.__happyPressLog;
    }
}

syncTouchDiagnosticsPressLog(touchDiagnostics?.isEnabled() ?? false);
