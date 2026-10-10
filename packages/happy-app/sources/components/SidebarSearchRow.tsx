import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { useSessionListScope } from '@/hooks/useSessionListScope';
import { useAddMachine } from '@/hooks/useAddMachine';
import { useSessionsCreateItems } from '@/hooks/useSessionsCreateItems';
import { useOpenCommandPalette } from './CommandPalette/CommandPaletteProvider';
import { DropdownMenu } from './DropdownMenu';

// The command palette's shortcut, shown in the search field where a keyboard is expected.
function getSearchShortcutLabel(): string | null {
    const desktopPlatform = getDesktopPlatform();
    if (desktopPlatform) return desktopPlatform === 'macos' ? '⌘K' : 'Ctrl K';
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
    return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

// Top of the sidebar's list column: a search field that opens the command palette, and a "+" with
// the session list's create choices (new session, add machine).
export const SidebarSearchRow = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const scope = useSessionListScope();
    const addMachine = useAddMachine();
    const createItems = useSessionsCreateItems(scope, addMachine);
    const shortcut = React.useMemo(getSearchShortcutLabel, []);
    const openCommandPalette = useOpenCommandPalette();

    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="search"
                accessibilityLabel={t('commandPalette.placeholder')}
                onPress={openCommandPalette}
                style={({ hovered, pressed }: any) => [styles.field, (hovered || pressed) && styles.fieldHovered]}
            >
                <Ionicons name="search-outline" size={15} color={theme.colors.textSecondary} />
                <Text style={styles.placeholder} numberOfLines={1}>{t('sessionScope.search')}</Text>
                {shortcut && <Text style={styles.shortcut}>{shortcut}</Text>}
            </Pressable>
            <DropdownMenu
                openOnHover
                placement="right"
                items={createItems}
                accessibilityLabel={t('sessionScope.addMenu')}
                style={styles.addButton}
                hoveredStyle={styles.fieldHovered}
            >
                <Ionicons name="add" size={20} color={theme.colors.text} />
            </DropdownMenu>
        </View>
    );
});

const FIELD_HEIGHT = 34;

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 10,
        paddingBottom: 6,
        paddingHorizontal: 12,
    },
    field: {
        flex: 1,
        height: FIELD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        // The dark surface is the sidebar's own color, so the field takes the next step up there.
        backgroundColor: theme.dark ? theme.colors.surfaceHighest : theme.colors.surface,
    },
    fieldHovered: {
        opacity: 0.85,
    },
    placeholder: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    shortcut: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        opacity: 0.8,
        ...Typography.default(),
    },
    addButton: {
        width: FIELD_HEIGHT,
        height: FIELD_HEIGHT,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.dark ? theme.colors.surfaceHighest : theme.colors.surface,
    },
}));
