import * as React from 'react';
import { View, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { type RepoIssue } from '@/data/mockRepos';
import { useGithubIssues } from '@/hooks/useGithubData';
import { createGithubIssue } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        paddingBottom: 40,
        gap: 20,
    },
    section: {
        gap: 8,
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    titleInput: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    titleInputError: {
        borderColor: theme.colors.textDestructive,
    },
    titleError: {
        fontSize: 12,
        color: theme.colors.textDestructive,
        marginTop: 4,
    },
    bodyInput: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        color: theme.colors.text,
        minHeight: 160,
        textAlignVertical: 'top',
    },
    labelsSection: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
    },
    labelsTitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 12,
    },
    labelsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    labelChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    labelChipSelected: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    labelChipText: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.text,
    },
    labelChipTextSelected: {
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
    },
    labelChipTextUnselected: {
        color: theme.colors.textSecondary,
    },
    addLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    addLabelInput: {
        flex: 1,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 13,
        color: theme.colors.text,
    },
    previewCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
        gap: 10,
    },
    previewTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    previewMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    previewMetaText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    previewBody: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        lineHeight: 20,
    },
    previewLabels: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    labelPillSmall: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
    },
    labelTextSmall: {
        fontSize: 11,
        fontWeight: '600',
    },
    hintText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 17,
    },
}));

export default function NewIssueScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const { credentials } = useAuth();
    const { data: existingIssues } = useGithubIssues(owner!, repoName!);

    // Derive available labels from repo's existing issues
    const availableLabels = React.useMemo(() => {
        const labelSet = new Set<string>();
        existingIssues.forEach((issue) => {
            issue.labels.forEach((l) => labelSet.add(l.name));
        });
        return Array.from(labelSet).sort();
    }, [existingIssues]);

    const [title, setTitle] = React.useState('');
    const [titleError, setTitleError] = React.useState('');
    const [body, setBody] = React.useState('');
    const [selectedLabels, setSelectedLabels] = React.useState<Set<string>>(new Set());
    const [newLabelInput, setNewLabelInput] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    const labelColorMap = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const issue of existingIssues) {
            for (const label of issue.labels) {
                if (!map.has(label.name)) map.set(label.name, `#${label.color}`);
            }
        }
        return map;
    }, [existingIssues]);

    const getLabelColor = (labelName: string): string =>
        labelColorMap.get(labelName) ?? theme.colors.button.primary.background;

    const toggleLabel = (label: string) => {
        setSelectedLabels((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
        });
    };

    const handleAddNewLabel = () => {
        const trimmed = newLabelInput.trim().toLowerCase().replace(/\s+/g, '-');
        if (!trimmed) return;
        setSelectedLabels((prev) => new Set([...prev, trimmed]));
        setNewLabelInput('');
    };

    const handleSubmit = React.useCallback(() => {
        if (!title.trim()) {
            setTitleError('Title is required');
            return;
        }
        if (title.trim().length < 5) {
            setTitleError('Title must be at least 5 characters');
            return;
        }
        setTitleError('');
        setIsSubmitting(true);

        // Create the issue via GitHub API
        if (credentials) {
            createGithubIssue(credentials, owner!, repoName!, {
                title: title.trim(),
                body: body.trim(),
                labels: Array.from(selectedLabels),
            }).then(() => {
                router.back();
            }).catch((e) => {
                setIsSubmitting(false);
                console.warn('[create-issue] failed:', e);
                const code = (e as any)?.code;
                if (code === 'github_not_connected' || code === 'github_token_expired') {
                    Modal.alert('GitHub Error', 'Please reconnect your GitHub account with updated permissions.');
                } else {
                    Modal.alert('Error', e?.message ?? 'Failed to create issue');
                }
            });
        }
    }, [title, body, selectedLabels, owner, repoName, credentials, router]);

    const selectedLabelsList = Array.from(selectedLabels);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: t('lab.newIssue') }} />

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={88}
            >
                <ScrollView
                    contentContainerStyle={[
                        styles.content,
                        { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                    ]}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Title</Text>
                        <TextInput
                            style={[styles.titleInput, titleError ? styles.titleInputError : undefined]}
                            placeholder="Issue title"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={title}
                            onChangeText={(text) => {
                                setTitle(text);
                                if (titleError) setTitleError('');
                            }}
                            maxLength={200}
                            autoFocus
                        />
                        {titleError ? <Text style={styles.titleError}>{titleError}</Text> : null}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Description</Text>
                        <TextInput
                            style={[styles.bodyInput, { ...Typography.default('regular') }]}
                            placeholder="Describe the issue in detail. What happened? What should happen? How can it be reproduced?"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={body}
                            onChangeText={setBody}
                            multiline
                            textAlignVertical="top"
                        />
                        <Text style={styles.hintText}>
                            Tip: The more context you provide, the better Auto Pilot can understand and fix this issue.
                        </Text>
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Labels</Text>
                        <View style={styles.labelsSection}>
                            {availableLabels.length > 0 && (
                                <>
                                    <Text style={styles.labelsTitle}>Suggested labels from this repository</Text>
                                    <View style={styles.labelsContainer}>
                                        {availableLabels.map((label) => {
                                            const isSelected = selectedLabels.has(label);
                                            const color = getLabelColor(label);
                                            return (
                                                <Pressable
                                                    key={label}
                                                    style={[
                                                        styles.labelChip,
                                                        isSelected && {
                                                            backgroundColor: `${color}18`,
                                                            borderColor: color,
                                                        },
                                                    ]}
                                                    onPress={() => toggleLabel(label)}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.labelChipText,
                                                            isSelected
                                                                ? { color }
                                                                : styles.labelChipTextUnselected,
                                                        ]}
                                                    >
                                                        {label}
                                                    </Text>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </>
                            )}

                            {/* Add custom label */}
                            <View style={styles.addLabelRow}>
                                <TextInput
                                    style={[styles.addLabelInput, { color: theme.colors.text }]}
                                    placeholder="Add custom label"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={newLabelInput}
                                    onChangeText={setNewLabelInput}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onSubmitEditing={handleAddNewLabel}
                                    returnKeyType="done"
                                />
                                <Pressable
                                    onPress={handleAddNewLabel}
                                    disabled={!newLabelInput.trim()}
                                    style={{ opacity: newLabelInput.trim() ? 1 : 0.5 }}
                                >
                                    <Ionicons name="add-circle" size={24} color={theme.colors.button.primary.background} />
                                </Pressable>
                            </View>

                            {/* Selected custom labels */}
                            {selectedLabelsList.length > 0 && (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={[styles.labelsTitle, { marginBottom: 8 }]}>Selected labels</Text>
                                    <View style={styles.previewLabels}>
                                        {selectedLabelsList.map((label) => {
                                            const isFromRepo = availableLabels.includes(label);
                                            const color = isFromRepo ? getLabelColor(label) : theme.colors.button.primary.background;
                                            return (
                                                <Pressable
                                                    key={label}
                                                    onPress={() => toggleLabel(label)}
                                                    style={[styles.labelChip, { backgroundColor: `${color}18`, borderColor: color }]}
                                                >
                                                    <Text style={[styles.labelTextSmall, { color }]}>{label}</Text>
                                                    <Ionicons name="close" size={10} color={color} style={{ marginLeft: 4 }} />
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>

                    {(title.trim() || body.trim()) && (
                        <View style={styles.section}>
                            <Text style={styles.sectionLabel}>Preview</Text>
                            <View style={styles.previewCard}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <View style={{ backgroundColor: `${theme.colors.repo.stateOpen}15`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.repo.stateOpen }}>{t('github.open')}</Text>
                                    </View>
                                    <Text style={styles.previewMetaText}>#new</Text>
                                    <Text style={styles.previewMetaText}>·</Text>
                                    <Text style={styles.previewMetaText}>@you</Text>
                                </View>
                                <Text style={styles.previewTitle}>{title.trim() || 'Issue title'}</Text>
                                {body.trim() ? (
                                    <Text style={styles.previewBody} numberOfLines={3}>{body.trim()}</Text>
                                ) : (
                                    <Text style={[styles.previewBody, { fontStyle: 'italic' }]}>No description provided</Text>
                                )}
                                {selectedLabelsList.length > 0 && (
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                        {selectedLabelsList.map((label) => {
                                            const isFromRepo = availableLabels.includes(label);
                                            const color = isFromRepo ? getLabelColor(label) : theme.colors.button.primary.background;
                                            return (
                                                <View key={label} style={[styles.labelPillSmall, { backgroundColor: `${color}18` }]}>
                                                    <Text style={[styles.labelTextSmall, { color }]}>{label}</Text>
                                                </View>
                                            );
                                        })}
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    <Pressable
                        onPress={handleSubmit}
                        disabled={isSubmitting || !title.trim()}
                        style={{
                            backgroundColor: title.trim() && !isSubmitting
                                ? theme.colors.button.primary.background
                                : theme.colors.surfaceHighest,
                            borderRadius: 10,
                            paddingVertical: 15,
                            alignItems: 'center',
                            opacity: isSubmitting ? 0.7 : 1,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 16,
                                fontWeight: '600',
                                color: title.trim() && !isSubmitting
                                    ? theme.colors.button.primary.tint
                                    : theme.colors.textSecondary,
                            }}
                        >
                            {isSubmitting ? t('github.creatingIssue') : t('github.createIssue')}
                        </Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}
