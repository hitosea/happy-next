import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

/** Where a tooltip renders: above everything in the window, so containers that clip do not cut it. */
export function TooltipLayer({ children }: { children: React.ReactNode }) {
    return (
        <FullWindowOverlay>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {children}
            </View>
        </FullWindowOverlay>
    );
}
