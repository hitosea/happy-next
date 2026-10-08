import React from 'react';
import { Text, View, Platform, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { CommandPaletteInput } from './CommandPaletteInput';
import { CommandPaletteResults } from './CommandPaletteResults';
import { useCommandPalette } from './useCommandPalette';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

interface CommandPaletteProps {
    commands: Command[];
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>;
    onClose: () => void;
}

export function CommandPalette({ commands, searchCachedMessages, onClose }: CommandPaletteProps) {
    const { height } = useWindowDimensions();
    const {
        searchQuery,
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
        executingCommandId,
        isSearchingMessages,
    } = useCommandPalette(commands, onClose, searchCachedMessages);

    const resultCount = React.useMemo(
        () => filteredCategories.reduce((count, category) => count + category.commands.length, 0),
        [filteredCategories],
    );

    return (
        <View style={[styles.container, Platform.OS !== 'web' && { maxHeight: height * 0.65 }]}>
            <CommandPaletteInput
                value={searchQuery}
                onChangeText={handleSearchChange}
                onKeyPress={handleKeyPress}
                inputRef={inputRef}
            />
            <CommandPaletteResults
                categories={filteredCategories}
                selectedIndex={selectedIndex}
                onSelectCommand={handleSelectCommand}
                onSelectionChange={setSelectedIndex}
                executingCommandId={executingCommandId}
                searchQuery={searchQuery}
            />
            <View style={styles.footer}>
                <Text style={[styles.footerText, Typography.default()]}>
                    {isSearchingMessages
                        ? t('commandPalette.searchingMessages')
                        : t('commandPalette.resultCount', { count: resultCount })}
                </Text>
                {Platform.OS === 'web' && <View style={styles.footerHints}>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.navigateHint')}</Text>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.selectHint')}</Text>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.closeHint')}</Text>
                </View>}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        width: '100%',
        maxWidth: 800, // Increased from 640 for wider input
        // Use viewport-based height for better layout
        ...(Platform.OS === 'web' ? {
            maxHeight: '60vh', // Takes up to 60% of viewport height
        } as any : {
            maxHeight: 500, // Fallback for native
        }),
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: {
            width: 0,
            height: 20,
        },
        shadowOpacity: theme.dark ? 0.55 : 0.25,
        shadowRadius: 40,
        elevation: 20,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    footer: {
        minHeight: 38,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHigh,
    },
    footerHints: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    footerText: {
        color: theme.colors.textSecondary,
        fontSize: 11,
    },
}));
