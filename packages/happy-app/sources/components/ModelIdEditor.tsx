import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';

// Same as ContextWindowEditor: the keyboard comes up once the overlay has shrunk to the editor.
const FOCUS_DELAY_MS = 260;

type ModelIdEditorProps = {
    /** What the field starts with: the typed model in use, or empty. */
    initialValue: string;
    /** Takes the trimmed id; false when it is not one, and the editor says so. */
    onSubmit: (id: string) => boolean;
    onCancel: () => void;
};

/**
 * A model id typed in place of the model lists, for a model the CLI takes but does not list (an older one,
 * say). Part of the settings overlay for the same reason as ContextWindowEditor.
 */
export function ModelIdEditor({ initialValue, onSubmit, onCancel }: ModelIdEditorProps) {
    const { theme } = useUnistyles();
    const [text, setText] = React.useState(initialValue);
    const [invalid, setInvalid] = React.useState(false);
    const inputRef = React.useRef<TextInput>(null);
    React.useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    const submit = () => setInvalid(!onSubmit(text.trim()));

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('agentInput.model.customModel')}</Text>
            <View style={styles.row}>
                <TextInput
                    ref={inputRef}
                    style={[styles.input, invalid && styles.inputInvalid]}
                    value={text}
                    onChangeText={(next) => { setText(next); setInvalid(false); }}
                    onSubmitEditing={submit}
                    selectTextOnFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    placeholderTextColor={theme.colors.textSecondary}
                    accessibilityLabel={t('agentInput.model.customModel')}
                />
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
                {invalid ? t('agentInput.model.customModelInvalid') : t('agentInput.model.customModelMessage')}
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
    input: {
        flex: 1,
        // A web input is as wide as its size attribute unless allowed to shrink.
        minWidth: 0,
        height: 36,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
    },
    inputInvalid: {
        borderColor: theme.colors.warningCritical,
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
