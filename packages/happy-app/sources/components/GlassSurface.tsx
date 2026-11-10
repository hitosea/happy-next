import * as React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useUnistyles } from 'react-native-unistyles';
import { isRunningOnMac } from '@/utils/platform';

/** Whether surfaces floating over content turn into Liquid Glass (iOS 26, not Catalyst). */
export const liquidGlassAvailable = Platform.OS === 'ios' && !isRunningOnMac() && isLiquidGlassAvailable();

type GlassSurfaceProps = ViewProps & {
    /** Liquid Glass behind the content (frosted glass on the web); otherwise a plain view painted `color`. */
    glass: boolean;
    /** The background used when `glass` is off. */
    color?: string;
    /** Tints the glass, for a surface that stands out as the primary action. */
    tint?: string;
    style?: StyleProp<ViewStyle>;
};

/**
 * A composer surface (input pill, round button, card) that turns into Liquid Glass when the composer
 * floats over the chat (see `floatingComposerAvailable`). The glass is a separate view behind the
 * content, as `AgentInput` does it, and takes the surface's corner radius so its shape matches.
 */
export const GlassSurface = React.memo(({ glass, color, tint, style, children, ...props }: GlassSurfaceProps) => {
    if (glass && Platform.OS === 'web') {
        return <FrostedSurface {...props} style={style}>{children}</FrostedSurface>;
    }
    if (!glass) {
        return (
            <View {...props} style={[style, color !== undefined && { backgroundColor: color }]}>
                {children}
            </View>
        );
    }
    const { borderRadius } = StyleSheet.flatten(style) ?? {};
    return (
        <View {...props} style={style}>
            <GlassView pointerEvents="none" glassEffectStyle="regular" tintColor={tint} style={[StyleSheet.absoluteFill, { borderRadius }]} />
            {children}
        </View>
    );
});
GlassSurface.displayName = 'GlassSurface';

/** The web's stand-in for Liquid Glass: a translucent, blurred surface with a hairline edge and a soft shadow. */
const FrostedSurface = React.memo(({ style, children, ...props }: ViewProps) => {
    const { theme } = useUnistyles();
    const frosted: ViewStyle & { backdropFilter: string; boxShadow: string } = theme.dark
        ? {
            backgroundColor: 'rgba(44, 44, 46, 0.72)',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: StyleSheet.hairlineWidth,
            backdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        }
        : {
            backgroundColor: 'rgba(255, 255, 255, 0.72)',
            borderColor: 'rgba(0, 0, 0, 0.08)',
            borderWidth: StyleSheet.hairlineWidth,
            backdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        };
    return (
        <View {...props} style={[style, frosted]}>
            {children}
        </View>
    );
});
FrostedSurface.displayName = 'FrostedSurface';
