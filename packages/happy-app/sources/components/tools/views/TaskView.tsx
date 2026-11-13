import * as React from 'react';
import { ToolViewProps } from './_all';
import { Text, View, ActivityIndicator, StyleSheet, Platform, Pressable } from 'react-native';
import { knownTools } from '../../tools/knownTools';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface FilteredTool {
    tool: ToolCall;
    title: string;
    state: 'running' | 'completed' | 'error';
}

// Lists the tools a subagent ran: the last few, with a toggle that unfolds the rest in place.
// `showAll` (the detail page) lists every tool, with no toggle.
export const TaskView = React.memo<ToolViewProps & { showAll?: boolean }>(({ tool, metadata, messages, showAll = false }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const filtered: FilteredTool[] = [];

    for (let m of messages) {
        // SubagentHandback is how the subagent hands its report back, not work it did
        if (m.kind === 'tool-call' && m.tool.name !== 'SubagentHandback') {
            const knownTool = knownTools[m.tool.name as keyof typeof knownTools] as any;
            
            // Extract title using extractDescription if available, otherwise use title
            let title = m.tool.name;
            if (knownTool) {
                if ('extractDescription' in knownTool && typeof knownTool.extractDescription === 'function') {
                    title = knownTool.extractDescription({ tool: m.tool, metadata });
                } else if (knownTool.title) {
                    // Handle optional title and function type
                    if (typeof knownTool.title === 'function') {
                        title = knownTool.title({ tool: m.tool, metadata });
                    } else {
                        title = knownTool.title;
                    }
                }
            }

            if (m.tool.state === 'running' || m.tool.state === 'completed' || m.tool.state === 'error') {
                filtered.push({
                    tool: m.tool,
                    title,
                    state: m.tool.state
                });
            }
        }
    }

    const styles = StyleSheet.create({
        container: {
            paddingVertical: 4,
            paddingBottom: 12
        },
        toolItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 4,
            paddingLeft: 4,
            paddingRight: 2
        },
        toolTitle: {
            fontSize: 14,
            fontWeight: '500',
            color: theme.colors.textSecondary,
            fontFamily: 'monospace',
            flex: 1,
        },
        statusContainer: {
            marginLeft: 'auto',
            paddingLeft: 8,
        },
        loadingItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 8,
            paddingHorizontal: 4,
        },
        loadingText: {
            marginLeft: 8,
            fontSize: 14,
            color: theme.colors.textSecondary,
        },
        // Detail page: the same rounded, row-divided box as the input and output sections
        box: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 6,
            overflow: 'hidden',
        },
        boxRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 10,
        },
        boxRowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.modal.border,
        },
        boxTitle: {
            fontSize: 13,
            color: theme.colors.text,
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
            flex: 1,
        },
        toggle: {
            alignItems: 'center',
            paddingVertical: 8,
        },
        toggleText: {
            fontSize: 13,
            fontWeight: '600',
            color: theme.colors.textLink,
        },
    });

    if (filtered.length === 0) {
        return null;
    }

    // Up to 5 tools are all shown; past that the card shows the last 3 and a toggle for the rest.
    const foldable = !showAll && filtered.length > 5;
    const visibleTools = foldable && !expanded ? filtered.slice(-3) : filtered;

    return (
        <View style={showAll ? styles.box : styles.container}>
            {visibleTools.map((item, index) => (
                <View
                    key={`${item.tool.name}-${index}`}
                    style={showAll
                        ? [styles.boxRow, index < visibleTools.length - 1 && styles.boxRowBorder]
                        : styles.toolItem}
                >
                    <Text style={showAll ? styles.boxTitle : styles.toolTitle}>{item.title}</Text>
                    <View style={styles.statusContainer}>
                        {item.state === 'running' && (
                            <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={theme.colors.warning} />
                        )}
                        {item.state === 'completed' && (
                            <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                        )}
                        {item.state === 'error' && (
                            <Ionicons name="close-circle" size={16} color={theme.colors.textDestructive} />
                        )}
                    </View>
                </View>
            ))}
            {/* Same toggle as the plan card's: one way, across cards, to unfold what a card cut */}
            {foldable && (
                <Pressable
                    style={styles.toggle}
                    onPress={() => setExpanded((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                >
                    <Text style={styles.toggleText}>
                        {expanded ? t('tools.taskView.collapse') : t('tools.taskView.expand', { count: filtered.length })}
                    </Text>
                </Pressable>
            )}
        </View>
    );
});
