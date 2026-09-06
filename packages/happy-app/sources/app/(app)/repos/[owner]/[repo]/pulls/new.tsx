import * as React from 'react';
import { View, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useGithubRepo } from '@/hooks/useGithubData';
import { createGithubPull } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
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
    branchSelector: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    branchLabel: {
        fontSize: 15,
        color: theme.colors.text,
        fontWeight: '500',
    },
    branchPlaceholder: {
        fontSize: 15,
        color: theme.colors.textSecondary,
    },
    arrowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 4,
    },
    arrowText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    hintText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 17,
    },
    sheetItem: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    sheetItemText: {
        fontSize: 15,
        color: theme.colors.text,
    },
    sheetItemSelected: {
        color: theme.colors.button.primary.background,
        fontWeight: '600',
    },
}));

export default function NewPullRequestScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const { credentials } = useAuth();
    const { data: repoInfo } = useGithubRepo(owner!, repoName!);

    const branches = repoInfo?.branches ?? [];
    const defaultBranch = repoInfo?.defaultBranch ?? 'main';

    const [title, setTitle] = React.useState('');
    const [titleError, setTitleError] = React.useState('');
    const [body, setBody] = React.useState('');
    const [headBranch, setHeadBranch] = React.useState('');
    const [baseBranch, setBaseBranch] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // Set base branch to default branch when repo loads
    React.useEffect(() => {
        if (defaultBranch && !baseBranch) setBaseBranch(defaultBranch);
    }, [defaultBranch]);

    const headSheetRef = React.useRef<BottomSheetModal>(null);
    const baseSheetRef = React.useRef<BottomSheetModal>(null);

    const handleSubmit = React.useCallback(() => {
        if (!title.trim()) {
            setTitleError('Title is required');
            return;
        }
        if (!headBranch) {
            Modal.alert('Error', 'Please select a source branch (head).');
            return;
        }
        if (!baseBranch) {
            Modal.alert('Error', 'Please select a target branch (base).');
            return;
        }
        if (headBranch === baseBranch) {
            Modal.alert('Error', 'Source and target branches must be different.');
            return;
        }
        setTitleError('');
        setIsSubmitting(true);

        if (credentials) {
            createGithubPull(credentials, owner!, repoName!, {
                title: title.trim(),
                body: body.trim() || undefined,
                head: headBranch,
                base: baseBranch,
            }).then(() => {
                router.back();
            }).catch((e) => {
                setIsSubmitting(false);
                console.warn('[create-pr] failed:', e);
                const code = (e as any)?.code;
                if (code === 'github_not_connected' || code === 'github_token_expired') {
                    Modal.alert('GitHub Error', 'Please reconnect your GitHub account with updated permissions.');
                } else {
                    Modal.alert('Error', e?.message ?? 'Failed to create pull request');
                }
            });
        }
    }, [title, body, headBranch, baseBranch, owner, repoName, credentials, router]);

    const renderBranchSheet = (sheetRef: React.RefObject<BottomSheetModal | null>, selected: string, onSelect: (b: string) => void) => (
        <BottomSheetModal
            ref={sheetRef}
            snapPoints={['50%']}
            enableDynamicSizing={false}
            backdropComponent={(props) => <BottomSheetBackdrop {...props} opacity={0.4} appearsOnIndex={0} disappearsOnIndex={-1} />}
            backgroundStyle={{ backgroundColor: theme.colors.surface }}
            handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
        >
            <BottomSheetFlatList
                data={branches}
                keyExtractor={(item: string) => item}
                renderItem={({ item }: { item: string }) => (
                    <Pressable
                        style={styles.sheetItem}
                        onPress={() => { onSelect(item); sheetRef.current?.dismiss(); }}
                    >
                        <Ionicons name="git-branch" size={16} color={item === selected ? theme.colors.button.primary.background : theme.colors.textSecondary} />
                        <Text style={[styles.sheetItemText, item === selected && styles.sheetItemSelected]}>{item}</Text>
                        {item === selected && <Ionicons name="checkmark" size={18} color={theme.colors.button.primary.background} style={{ marginLeft: 'auto' }} />}
                    </Pressable>
                )}
            />
        </BottomSheetModal>
    );

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: t('lab.newPullRequest') }} />

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
                        <Text style={styles.sectionLabel}>Branches</Text>
                        <Pressable style={styles.branchSelector} onPress={() => headSheetRef.current?.present()}>
                            <View>
                                <Text style={styles.hintText}>Head (source)</Text>
                                {headBranch ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                        <Ionicons name="git-branch" size={14} color={theme.colors.text} />
                                        <Text style={styles.branchLabel}>{headBranch}</Text>
                                    </View>
                                ) : (
                                    <Text style={[styles.branchPlaceholder, { marginTop: 2 }]}>Select source branch</Text>
                                )}
                            </View>
                            <Ionicons name="chevron-down" size={16} color={theme.colors.textSecondary} />
                        </Pressable>

                        <View style={styles.arrowRow}>
                            <Ionicons name="arrow-down" size={16} color={theme.colors.textSecondary} />
                            <Text style={styles.arrowText}>merge into</Text>
                            <Ionicons name="arrow-down" size={16} color={theme.colors.textSecondary} />
                        </View>

                        <Pressable style={styles.branchSelector} onPress={() => baseSheetRef.current?.present()}>
                            <View>
                                <Text style={styles.hintText}>Base (target)</Text>
                                {baseBranch ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                        <Ionicons name="git-branch" size={14} color={theme.colors.text} />
                                        <Text style={styles.branchLabel}>{baseBranch}</Text>
                                    </View>
                                ) : (
                                    <Text style={[styles.branchPlaceholder, { marginTop: 2 }]}>Select target branch</Text>
                                )}
                            </View>
                            <Ionicons name="chevron-down" size={16} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Title</Text>
                        <TextInput
                            style={[styles.titleInput, titleError ? styles.titleInputError : undefined]}
                            placeholder="Pull request title"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={title}
                            onChangeText={(text) => {
                                setTitle(text);
                                if (titleError) setTitleError('');
                            }}
                            maxLength={200}
                        />
                        {titleError ? <Text style={styles.titleError}>{titleError}</Text> : null}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>Description</Text>
                        <TextInput
                            style={[styles.bodyInput, { ...Typography.default('regular') }]}
                            placeholder="Describe the changes in this pull request..."
                            placeholderTextColor={theme.colors.textSecondary}
                            value={body}
                            onChangeText={setBody}
                            multiline
                            textAlignVertical="top"
                        />
                    </View>

                    <Pressable
                        onPress={handleSubmit}
                        disabled={isSubmitting || !title.trim() || !headBranch}
                        style={{
                            backgroundColor: title.trim() && headBranch && !isSubmitting
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
                                color: title.trim() && headBranch && !isSubmitting
                                    ? theme.colors.button.primary.tint
                                    : theme.colors.textSecondary,
                            }}
                        >
                            {isSubmitting ? t('github.creatingPullRequest') : t('github.createPullRequest')}
                        </Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>

            {renderBranchSheet(headSheetRef, headBranch, setHeadBranch)}
            {renderBranchSheet(baseSheetRef, baseBranch, setBaseBranch)}
        </View>
    );
}
