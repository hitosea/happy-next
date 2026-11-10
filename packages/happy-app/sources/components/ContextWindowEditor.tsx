import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';

// The overlay takes 220ms to shrink to the editor (`AnimatedHeight`); the keyboard comes up after it, so
// the two movements don't happen at once and shake the overlay.
const FOCUS_DELAY_MS = 260;

type ContextWindowEditorProps = {
    /** What the field starts with, in thousands of tokens: the size the session already has, or empty. */
    initialValue: string;
    /** The sizes it takes, in thousands of tokens. */
    range: { min: number; max: number };
    /** Takes the typed thousands; false when it is not a size in range, and the editor says so. */
    onSubmit: (thousands: number) => boolean;
    onCancel: () => void;
};

/**
 * A context window typed in place of the settings list, for a size that is none of the presets. It is part
 * of the settings overlay rather than a system prompt: a prompt's window takes the keyboard over from the
 * screen and gives it back as it closes, and the screen behind it blanks for a moment as it does.
 */
export function ContextWindowEditor({ initialValue, range, onSubmit, onCancel }: ContextWindowEditorProps) {
    const { theme } = useUnistyles();
    const [text, setText] = React.useState(initialValue);
    const [invalid, setInvalid] = React.useState(false);
    const inputRef = React.useRef<TextInput>(null);
    React.useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    const limits = { min: String(range.min), max: String(range.max) };
    const submit = () => setInvalid(!text || !onSubmit(Number(text)));

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('agentInput.model.contextWindow')}</Text>
            <View style={styles.row}>
                <View style={[styles.field, invalid && styles.fieldInvalid]}>
                    <TextInput
                        ref={inputRef}
                        style={styles.input}
                        value={text}
                        onChangeText={(next) => { setText(next.replace(/\D/g, '')); setInvalid(false); }}
                        onSubmitEditing={submit}
                        selectTextOnFocus
                        keyboardType="number-pad"
                        maxLength={4}
                        accessibilityLabel={t('agentInput.model.contextWindow')}
                    />
                    <Text style={styles.unit}>K</Text>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    hitSlop={6}
                    onPress={() => { hapticsLight(); onCancel(); }}
                    style={styles.button}
                >
                    <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.ok')}
                    hitSlop={6}
                    onPress={() => { hapticsLight(); submit(); }}
                    style={styles.button}
                >
                    <Ionicons name="checkmark" size={20} color={theme.colors.text} />
                </Pressable>
            </View>
            <Text style={[styles.hint, invalid && styles.hintInvalid]}>
                {invalid ? t('agentInput.model.customContextWindowInvalid', limits) : t('agentInput.model.customContextWindowMessage', limits)}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 8,
    },
    title: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    // The K sits inside the field's background, after what is typed.
    field: {
        flex: 1,
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        gap: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
    },
    fieldInvalid: {
        borderColor: theme.colors.warningCritical,
    },
    input: {
        flex: 1,
        height: 36,
        padding: 0,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
    },
    unit: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    button: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
    },
    hint: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    hintInvalid: {
        color: theme.colors.warningCritical,
    },
}));
