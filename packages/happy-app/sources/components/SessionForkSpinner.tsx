import * as React from 'react';
import { ActivityIndicator, StyleProp, View, ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

// The platform's small spinner is about this big; `size` scales it down to sit beside an icon.
const NATIVE_SMALL_SIZE = 20;

/**
 * The mark a session row shows while it is being copied or resumed, drawn like the draft icon
 * beside which it sits. The caller decides when (`useSessionForking`) and where.
 */
export function SessionForkSpinner({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
    const { theme } = useUnistyles();
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('duplicate.duplicating')}
            style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
        >
            <ActivityIndicator
                size="small"
                color={theme.colors.textSecondary}
                style={{ transform: [{ scale: size / NATIVE_SMALL_SIZE }] }}
            />
        </View>
    );
}
