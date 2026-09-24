import { memo, useCallback, useMemo } from 'react';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { MessageView } from '@/components/MessageView';
import { usePublicShareSession } from '@/hooks/usePublicShareSession';
import { Message } from '@/sync/typesMessage';
import { getShareUserDisplayName } from '@/sync/sharingTypes';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';

/** Room under the header above the shared-by card, and the hints LegendList needs for the first frame. */
const LIST_TOP_GAP = 16;
const OWNER_CARD_HEIGHT = 57;
const ESTIMATED_MESSAGE_SIZE = 120;

function OwnerCard({ owner, floating }: { owner: { username: string | null; firstName: string | null; lastName: string | null }; floating?: boolean }) {
    const { theme } = useUnistyles();
    const name = getShareUserDisplayName(owner) || 'Unknown';

    return (
        <View style={[styles.ownerCard, floating && styles.ownerCardFloating, { backgroundColor: theme.colors.groupped.background }]}>
            <Ionicons name="person-circle-outline" size={32} color={theme.colors.textSecondary} />
            <View style={styles.ownerInfo}>
                <Text style={[styles.ownerLabel, { color: theme.colors.textSecondary }]}>
                    {t('session.sharing.sharedBy')}
                </Text>
                <Text style={[styles.ownerName, { color: theme.colors.text }]}>
                    {name}
                </Text>
            </View>
        </View>
    );
}

export default memo(function PublicShareScreen() {
    const { token } = useLocalSearchParams<{ token: string }>();
    const { theme } = useUnistyles();
    const { state, messages, metadata, owner, sessionId, hasMore, isLoadingMore, loadMore, giveConsent } = usePublicShareSession(token);

    const softHeaderInset = useSoftHeaderInset();

    // Newest-first is what the API hands back; the list runs oldest-first so its end is the newest
    // message, which is what keeps the viewport pinned there and lets the content scroll under the
    // transparent header.
    const listData = useMemo(() => messages.slice().reverse(), [messages]);

    const keyExtractor = useCallback((item: Message) => item.id, []);
    const renderItem = useCallback(({ item }: LegendListRenderItemProps<Message>) => (
        <MessageView
            message={item}
            metadata={metadata}
            sessionId={sessionId || ''}
            readOnly
        />
    ), [metadata, sessionId]);

    // The list is no longer inverted, so older messages arrive at the start.
    const onStartReached = useCallback(() => {
        if (hasMore) {
            loadMore();
        }
    }, [hasMore, loadMore]);

    // The oldest end: the header the content scrolls under, the shared-by card, and the spinner
    // while older messages are still paging in.
    const listHeader = useCallback(() => (
        <View>
            <View style={{ height: softHeaderInset + LIST_TOP_GAP }} />
            {owner && <OwnerCard owner={owner} />}
            {isLoadingMore && (
                <View style={styles.loadingMore}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            )}
        </View>
    ), [softHeaderInset, owner, isLoadingMore, theme.colors.textSecondary]);

    // Loading
    if (state === 'loading') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <ActivityIndicator size="large" color={theme.colors.textSecondary} />
            </View>
        );
    }

    // Not found
    if (state === 'not-found') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <Ionicons name="link-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.statusText, { color: theme.colors.text }]}>
                    {t('session.sharing.shareNotFound')}
                </Text>
            </View>
        );
    }

    // Error / decrypt failed
    if (state === 'error') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <Ionicons name="lock-closed-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.statusText, { color: theme.colors.text }]}>
                    {t('session.sharing.failedToDecrypt')}
                </Text>
            </View>
        );
    }

    // Consent required
    if (state === 'consent-required') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                {owner && <OwnerCard owner={owner} floating />}
                <Ionicons name="shield-checkmark-outline" size={48} color={theme.colors.textSecondary} style={{ marginTop: 24 }} />
                <Text style={[styles.consentTitle, { color: theme.colors.text }]}>
                    {t('session.sharing.consentTitle')}
                </Text>
                <Text style={[styles.consentMessage, { color: theme.colors.textSecondary }]}>
                    {t('session.sharing.consentMessage')}
                </Text>
                <Pressable
                    onPress={giveConsent}
                    style={[styles.consentButton, { backgroundColor: theme.colors.button.primary.background }]}
                >
                    <Text style={[styles.consentButtonText, { color: theme.colors.button.primary.tint }]}>
                        {t('session.sharing.consentAccept')}
                    </Text>
                </Pressable>
            </View>
        );
    }

    // Loaded
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {messages.length === 0 ? (
                <View style={[styles.center, { paddingTop: softHeaderInset }]}>
                    <Ionicons name="chatbubble-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                        {t('session.sharing.noMessages')}
                    </Text>
                </View>
            ) : (
                <LegendList<Message>
                    data={listData}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    // Bottom-aligned and pinned to the newest message — what replaced `inverted`.
                    // flex:1 bounds the list as its own scroll container, matching ChatList.
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    alignItemsAtEnd
                    initialScrollAtEnd
                    maintainVisibleContentPosition
                    maintainScrollAtEnd
                    estimatedItemSize={ESTIMATED_MESSAGE_SIZE}
                    estimatedHeaderSize={softHeaderInset + LIST_TOP_GAP + (owner ? OWNER_CARD_HEIGHT : 0)}
                    onStartReached={onStartReached}
                    onStartReachedThreshold={0.5}
                    ListHeaderComponent={listHeader}
                />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    statusText: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        marginTop: 16,
        textAlign: 'center',
    },
    ownerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    ownerCardFloating: {
        borderBottomWidth: 0,
        borderRadius: 12,
    },
    ownerInfo: {
        marginLeft: 12,
    },
    ownerLabel: {
        fontSize: 12,
    },
    ownerName: {
        ...Typography.default('semiBold'),
        fontSize: 15,
    },
    consentTitle: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        marginTop: 16,
        textAlign: 'center',
    },
    consentMessage: {
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
        lineHeight: 22,
    },
    consentButton: {
        marginTop: 24,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 10,
    },
    consentButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 17,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingVertical: 8,
    },
    loadingMore: {
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
