import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type TouchDiagnosticsNative = {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    exportReport(): Promise<string>;
};

/**
 * iOS touch diagnostics (`modules/touch-diagnostics`): while enabled, the native side keeps a short
 * log of every tap and which gesture recognizers took it, plus keyboard, text input and window
 * events, to catch taps that get swallowed. `null` on other platforms and in binaries built before it.
 */
export const touchDiagnostics: TouchDiagnosticsNative | null =
    Platform.OS === 'ios' ? requireOptionalNativeModule<TouchDiagnosticsNative>('TouchDiagnostics') : null;
