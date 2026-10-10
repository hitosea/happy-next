import * as React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolSectionView } from '../../tools/ToolSectionView';
import { ToolViewProps } from './_all';
import { CodeView } from '@/components/CodeView';
import { t } from '@/text';
import { useRouter } from 'expo-router';

// The chat shows only the head of a long command; the whole one is a tap away on the message page
const INLINE_PREVIEW_MAX_LINES = 10;

/**
 * Extract execute command info from Gemini's nested input format.
 */
export function extractExecuteInfo(input: any): { command: string; description: string; cwd: string } {
    let command = '';
    let description = '';
    let cwd = '';
    
    // Try to get title from toolCall.title
    // Format: "rm file.txt [current working directory /path] (description)"
    if (input?.toolCall?.title) {
        const fullTitle = input.toolCall.title;
        
        // Extract command (before [)
        const bracketIdx = fullTitle.indexOf(' [');
        if (bracketIdx > 0) {
            command = fullTitle.substring(0, bracketIdx);
        } else {
            command = fullTitle;
        }
        
        // Extract cwd from [current working directory /path]
        const cwdMatch = fullTitle.match(/\[current working directory ([^\]]+)\]/);
        if (cwdMatch) {
            cwd = cwdMatch[1];
        }
        
        // Extract description from (...)
        const descMatch = fullTitle.match(/\(([^)]+)\)$/);
        if (descMatch) {
            description = descMatch[1];
        }
    }

    // Without toolCall.title (Qoder), the command arrives as a plain field. Its description is
    // already the card's subtitle, so it isn't repeated here.
    if (!command) {
        if (typeof input?.command === 'string') {
            command = input.command.trim();
        } else if (Array.isArray(input?.command)) {
            command = input.command.filter((part: any) => typeof part === 'string').join(' ').trim();
        }
    }

    return { command, description, cwd };
}

/**
 * Gemini Execute View
 * 
 * Displays shell/terminal commands from Gemini's execute tool.
 */
export const GeminiExecuteView = React.memo<ToolViewProps>(({ tool, sessionId, messageId }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { command, description, cwd } = extractExecuteInfo(tool.input);

    if (!command) {
        return null;
    }

    const commandLines = command.split('\n');
    const hiddenLines = Math.max(0, commandLines.length - INLINE_PREVIEW_MAX_LINES);
    const previewCommand = hiddenLines > 0
        ? commandLines.slice(0, INLINE_PREVIEW_MAX_LINES).join('\n')
        : command;

    return (
        <>
            <ToolSectionView fullWidth>
                <CodeView code={previewCommand} />
                {hiddenLines > 0 && (sessionId && messageId ? (
                    <TouchableOpacity
                        style={styles.moreLinesRow}
                        onPress={() => router.push(`/session/${sessionId}/message/${messageId}`)}
                        activeOpacity={0.6}
                    >
                        <Text style={styles.moreLinesText}>{t('toolView.moreLines', { count: hiddenLines })}</Text>
                        <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.moreLinesRow}>
                        <Text style={styles.moreLinesText}>{t('toolView.moreLines', { count: hiddenLines })}</Text>
                    </View>
                ))}
            </ToolSectionView>
            {!!(description || cwd) && (
                <View style={styles.infoContainer}>
                    {!!cwd && (
                        <Text style={styles.cwdText}>📁 {cwd}</Text>
                    )}
                    {!!description && (
                        <Text style={styles.descriptionText}>{description}</Text>
                    )}
                </View>
            )}
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    infoContainer: {
        paddingHorizontal: 12,
        paddingBottom: 8,
    },
    cwdText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 4,
    },
    descriptionText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
    },
    moreLinesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingTop: 6,
    },
    moreLinesText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
