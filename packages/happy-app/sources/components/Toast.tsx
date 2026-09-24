import * as React from 'react';
import { Animated, Text, StyleSheet, Platform, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';

/** Leading icon name, or `null` for a plain info toast with no icon. */
type ToastIcon = keyof typeof Ionicons.glyphMap | null;

const DEFAULT_ICON: ToastIcon = 'checkmark-circle';

let _show: ((message?: string, icon?: ToastIcon) => void) | null = null;

/**
 * Show a brief toast. Defaults to a checkmark icon and "Copied" text.
 * Pass `{ icon: null }` for a plain info toast with no leading icon.
 */
export function showToast(message?: string, options?: { icon?: ToastIcon }) {
    _show?.(message, options?.icon === undefined ? DEFAULT_ICON : options.icon);
}

/** Shorthand: show the "Copied" toast. */
export function showCopiedToast() {
    _show?.();
}

/**
 * Mount this component once at the app root.
 * It renders an absolutely-positioned toast that auto-fades.
 */
const BASE_BOTTOM = Platform.OS === 'ios' ? 100 : 80;

export function ToastHost() {
    const opacity = React.useRef(new Animated.Value(0)).current;
    const keyboardTranslation = React.useRef(new Animated.Value(0)).current;
    const timeout = React.useRef<ReturnType<typeof setTimeout>>(undefined);
    const [message, setMessage] = React.useState('');
    const [icon, setIcon] = React.useState<ToastIcon>(DEFAULT_ICON);
    const [visible, setVisible] = React.useState(false);

    React.useEffect(() => {
        if (Platform.OS !== 'ios' || !visible) return;
        const keyboardHeight = Keyboard.metrics()?.height ?? 0;
        keyboardTranslation.setValue(keyboardHeight > 0 ? BASE_BOTTOM - keyboardHeight - 20 : 0);
        const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
            // Avoid a React layout commit during the keyboard animation.
            keyboardTranslation.setValue(BASE_BOTTOM - e.endCoordinates.height - 20);
        });
        const hideSub = Keyboard.addListener('keyboardWillHide', () => {
            keyboardTranslation.setValue(0);
        });
        return () => { showSub.remove(); hideSub.remove(); };
    }, [keyboardTranslation, visible]);

    const show = React.useCallback((msg?: string, nextIcon: ToastIcon = DEFAULT_ICON) => {
        if (timeout.current) clearTimeout(timeout.current);
        setMessage(msg ?? t('common.copied'));
        setIcon(nextIcon);
        setVisible(true);
        opacity.stopAnimation();
        opacity.setValue(1);
        timeout.current = setTimeout(() => {
            Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true })
                .start(({ finished }) => { if (finished) setVisible(false); });
        }, 1200);
    }, [opacity]);

    React.useEffect(() => {
        _show = show;
        return () => {
            _show = null;
            if (timeout.current) clearTimeout(timeout.current);
        };
    }, [show]);

    if (!visible) return null;

    return (
        <Animated.View pointerEvents="none" style={[toastStyles.container, { opacity, transform: [{ translateY: keyboardTranslation }] }]}>
            {icon ? <Ionicons name={icon} size={16} color="#fff" style={{ marginRight: 6 }} /> : null}
            <Text style={toastStyles.text}>{message}</Text>
        </Animated.View>
    );
}

const toastStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: BASE_BOTTOM,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        zIndex: 9999,
    },
    text: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
});
