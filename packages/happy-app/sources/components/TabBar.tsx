import * as React from 'react';
import { View, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';

export type TabType = 'inbox' | 'sessions' | 'dootask' | 'github' | 'settings';

interface TabBarProps {
    activeTab: TabType;
    onTabPress: (tab: TabType) => void;
    inboxBadgeCount?: number;
    showDootaskTab?: boolean;
    showGithubTab?: boolean;
}

const styles = StyleSheet.create((theme) => ({
    outerContainer: {
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    innerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'flex-start',
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 4,
    },
    tabContent: {
        alignItems: 'center',
        position: 'relative',
    },
    label: {
        fontSize: 10,
        marginTop: 3,
        ...Typography.default(),
    },
    labelActive: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    labelInactive: {
        color: theme.colors.textSecondary,
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -8,
        backgroundColor: theme.colors.status.error,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        ...Typography.default('semiBold'),
    },
    indicatorDot: {
        position: 'absolute',
        top: 0,
        right: -2,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.text,
    },
}));

export const TabBar = React.memo(({ activeTab, onTabPress, inboxBadgeCount = 0, showDootaskTab = false, showGithubTab = false }: TabBarProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const inboxHasContent = useInboxHasContent();

    const tabs: { key: TabType; icon: any; label: string }[] = React.useMemo(() => {
        const items: { key: TabType; icon: any; label: string }[] = [
            { key: 'inbox', icon: require('@/assets/images/navigation/inbox.png'), label: t('tabs.inbox') },
            { key: 'sessions', icon: require('@/assets/images/navigation/session.png'), label: t('tabs.sessions') },
        ];
        if (showDootaskTab) {
            items.push({ key: 'dootask', icon: require('@/assets/images/navigation/todo.png'), label: t('tabs.dootask') });
        }
        if (showGithubTab) {
            items.push({ key: 'github', icon: require('@/assets/images/icon-github.png'), label: t('tabs.github') });
        }
        items.push({ key: 'settings', icon: require('@/assets/images/navigation/setting.png'), label: t('tabs.settings') });
        return items;
    }, [showDootaskTab, showGithubTab]);

    return (
        <View style={[styles.outerContainer, { paddingBottom: insets.bottom }]}>
            <View style={styles.innerContainer}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.key;
                    
                    return (
                        <Pressable
                            key={tab.key}
                            style={styles.tab}
                            onPress={() => onTabPress(tab.key)}
                            hitSlop={8}
                        >
                            <View style={styles.tabContent}>
                                {tab.key === 'github' ? (
                                    <Svg width={24} height={24} viewBox="0 0 1024 1024">
                                        <Path
                                            d="M436.906667 907.861333a32 32 0 1 0-20.48-60.629333l20.48 60.629333z m-322.730667-196.394666a32 32 0 0 0-57.685333 27.733333l57.685333-27.733333z m-57.685333 27.733333c38.954667 81.066667 92.586667 138.154667 159.317333 167.168 66.773333 29.098667 142.293333 28.117333 221.098667 1.493333l-20.48-60.629333c-67.456 22.784-126.08 21.76-175.104 0.426667-49.066667-21.333333-93.013333-65.066667-127.146667-136.192l-57.685333 27.733333z M434.218667 695.04l8.490666-30.890667-8.490666 30.848z m283.562666 0l-8.490666-30.890667 8.490666 30.848zM394.666667 938.666667a32 32 0 0 0 64 0h-64z m298.666666 0a32 32 0 0 0 64 0h-64z m-246.186666-206.08l-27.050667-17.066667 27.050667 17.066667z m257.706666 0l-27.093333 17.066666 27.093333-17.066666zM476.032 139.946667l7.722667 31.061333-7.68-31.061333zM258.048 275.029333l-26.154667-18.389333 26.154667 18.389333z m417.92-135.082666l7.68-31.018667-7.68 31.018667z m217.984 135.082666l-26.154667 18.432 26.154667-18.432z m-7.893333-42.112l31.061333 7.722667-31.061333-7.68z m-6.826667-146.346666l29.781333-11.648a32 32 0 0 0-19.882666-18.773334l-9.898667 30.378667z m-122.624 40.96l-16.938667-27.093334 16.938667 27.136z m-361.216 0l16.938667-27.093334-16.938667 27.136z m-122.624-40.96l-9.898667-30.464a32 32 0 0 0-19.882666 18.773333l29.781333 11.648z m-6.826667 146.346666l31.061334-7.68-31.061334 7.68z m616.533334 22.442667l-31.488 5.888 31.488-5.888zM718.890667 147.2l-5.034667-31.616 4.992 31.573333zM269.525333 255.36l-31.445333-5.888 31.445333 5.888z m163.584-108.202667l-4.992 31.573334 4.992-31.573334z m9.6 516.992C379.306667 646.741333 331.434667 625.493333 298.666667 589.696c-31.957333-34.901333-53.376-88.106667-53.376-178.133333h-64c0 100.309333 24.106667 171.008 70.144 221.312 45.226667 49.493333 107.776 74.709333 174.250666 93.013333l16.981334-61.738667z m463.957334-252.586666c0 90.026667-21.418667 143.232-53.333334 178.133333-32.768 35.754667-80.725333 57.045333-144.042666 74.453333l16.981333 61.738667c66.474667-18.304 128.981333-43.52 174.250667-93.013333 46.08-50.304 70.144-121.002667 70.144-221.312h-64z m-512 388.778666V938.666667h64v-138.325334h-64z m298.666666 0V938.666667h64v-138.325334h-64zM420.096 715.52c-15.274667 24.192-25.429333 52.224-25.429333 84.821333h64c0-18.474667 5.546667-34.816 15.573333-50.688l-54.144-34.133333z m257.706667 34.133333c9.984 15.872 15.530667 32.213333 15.530666 50.688h64c0-32.597333-10.154667-60.586667-25.429333-84.821333l-54.144 34.133333zM483.712 171.008A374.698667 374.698667 0 0 1 576 160v-64c-38.954667 0-73.813333 4.48-107.690667 12.928l15.445334 62.08zM245.333333 411.562667c0-42.24 13.781333-82.432 38.869334-118.101334l-52.309334-36.821333C199.978667 301.952 181.333333 354.816 181.333333 411.562667h64zM576 160c33.792 0 63.445333 3.84 92.245333 11.008l15.445334-62.08A438.656 438.656 0 0 0 576 96v64z m291.797333 133.461333c25.088 35.669333 38.869333 75.861333 38.869334 118.101334h64c0-56.746667-18.645333-109.610667-50.56-154.922667l-52.309334 36.821333z m-158.506666 370.688c-39.765333 10.965333-49.706667 56.704-31.530667 85.504l54.144-34.133333a5.546667 5.546667 0 0 1 0.64 4.778667 9.216 9.216 0 0 1-6.272 5.546666l-16.981333-61.696z m-283.562667 61.738667a9.216 9.216 0 0 1-6.272-5.546667 5.546667 5.546667 0 0 1 0.64-4.821333l54.144 34.133333c18.176-28.8 8.234667-74.538667-31.573333-85.504l-16.938667 61.738667zM917.12 240.64c13.354667-53.76 12.8-112.128-8.106667-165.717333l-59.605333 23.253333c15.317333 39.253333 16.341333 83.797333 5.589333 127.018667l62.122667 15.445333z m-37.888-154.112c9.898667-30.421333 9.856-30.421333 9.813333-30.421333l-0.128-0.085334a13.909333 13.909333 0 0 0-0.853333-0.213333 41.813333 41.813333 0 0 0-4.565333-1.109333 75.349333 75.349333 0 0 0-9.386667-1.152 124.245333 124.245333 0 0 0-29.909333 2.048c-24.832 4.48-59.306667 16.554667-104.533334 44.8l33.877334 54.314666c39.936-24.96 66.816-33.408 82.005333-36.138666a61.44 61.44 0 0 1 14.421333-1.152c1.109333 0.042667 1.536 0.128 1.408 0.128a11.306667 11.306667 0 0 1-1.28-0.341334l-0.341333-0.085333-0.213333-0.085333h-0.128l-0.042667-0.042667s-0.085333 0 9.813333-30.464z m-466.901333 13.909333c-45.226667-28.288-79.701333-40.362667-104.533334-44.8a124.288 124.288 0 0 0-29.866666-2.133333 75.349333 75.349333 0 0 0-14.592 2.432 40.618667 40.618667 0 0 0-0.341334 0.128h-0.085333s-0.042667 0.042667 9.856 30.464c9.941333 30.421333 9.898667 30.464 9.856 30.464h-0.042667l-0.128 0.042667-0.213333 0.085333a27.008 27.008 0 0 1-1.621333 0.426667 61.44 61.44 0 0 1 15.872 1.066666c15.146667 2.688 42.026667 11.136 81.92 36.096l33.92-54.272z m-169.386667-25.514666c-20.906667 53.589333-21.418667 112-8.064 165.717333l62.122667-15.445333c-10.752-43.221333-9.728-87.808 5.546666-127.018667l-59.562666-23.253333z m677.162667 181.717333a663.125333 663.125333 0 0 1-6.912-10.154667c-1.194667-1.92 0.085333-0.426667 0.725333 2.986667l-62.933333 11.776c1.493333 7.978667 4.949333 14.293333 7.552 18.517333 2.56 4.224 5.973333 9.002667 9.258666 13.696l52.309334-36.821333z m-65.109334-31.445333c-1.365333 5.546667-2.816 11.221333-3.669333 16.085333-0.853333 4.864-1.834667 11.989333-0.341333 19.968l62.933333-11.776c0.64 3.413333 0 5.290667 0.426667 3.072 0.128-0.938667 0.426667-2.304 0.896-4.394667l1.877333-7.509333-62.122667-15.445333z m-186.752-54.186667c11.050667 2.773333 20.736 5.205333 28.757334 6.656 7.936 1.450667 17.194667 2.602667 26.88 1.066667l-10.026667-63.189334c1.109333-0.170667 0.426667 0.213333-5.248-0.810666a476.586667 476.586667 0 0 1-24.917333-5.802667l-15.445334 62.08z m71.424-70.570667c-10.112 6.272-16.384 10.197333-21.248 12.8-4.821333 2.602667-5.632 2.474667-4.565333 2.304l10.026667 63.189334a78.506667 78.506667 0 0 0 25.002666-9.173334c7.04-3.84 15.317333-9.002667 24.661334-14.848l-33.877334-54.272zM284.16 293.461333c3.328-4.693333 6.698667-9.472 9.258667-13.653333 2.56-4.266667 6.058667-10.581333 7.552-18.56L238.08 249.472c0.64-3.413333 1.92-4.906667 0.725333-2.986667a639.616 639.616 0 0 1-6.912 10.112l52.309334 36.864zM234.88 240.64a643.413333 643.413333 0 0 1 2.816 11.904c0.384 2.218667-0.256 0.341333 0.426667-3.072l62.890666 11.776a54.997333 54.997333 0 0 0-0.341333-19.968c-0.853333-4.864-2.304-10.538667-3.669333-16.085333l-62.122667 15.445333z m233.429333-131.712c-11.818667 2.944-19.285333 4.778667-24.917333 5.802667-5.632 1.024-6.4 0.64-5.248 0.810666l-10.026667 63.189334c9.685333 1.536 18.944 0.426667 26.88-1.066667 8.021333-1.450667 17.706667-3.882667 28.757334-6.656l-15.445334-62.08zM378.453333 154.709333c9.386667 5.845333 17.664 11.050667 24.661334 14.848 7.04 3.797333 15.36 7.68 25.002666 9.173334l10.026667-63.189334c1.066667 0.170667 0.256 0.298667-4.565333-2.304a450.261333 450.261333 0 0 1-21.248-12.8L378.453333 154.709333z"
                                            fill={isActive ? theme.colors.text : theme.colors.textSecondary}
                                        />
                                    </Svg>
                                ) : (
                                    <Image
                                        source={tab.icon}
                                        contentFit="contain"
                                        style={[{ width: 24, height: 24 }]}
                                        tintColor={isActive ? theme.colors.text : theme.colors.textSecondary}
                                    />
                                )}
                                {tab.key === 'inbox' && inboxBadgeCount > 0 && (
                                    <View style={styles.badge}>
                                        <Text style={styles.badgeText}>
                                            {inboxBadgeCount > 99 ? '99+' : inboxBadgeCount}
                                        </Text>
                                    </View>
                                )}
                                {tab.key === 'inbox' && inboxHasContent && inboxBadgeCount === 0 && (
                                    <View style={styles.indicatorDot} />
                                )}
                            </View>
                            <Text style={[
                                styles.label,
                                isActive ? styles.labelActive : styles.labelInactive
                            ]}>
                                {tab.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
});