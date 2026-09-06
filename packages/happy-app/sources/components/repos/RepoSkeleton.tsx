import * as React from 'react';
import { View, ViewStyle, StyleProp, Platform } from 'react-native';
import { ShimmerView } from '@/components/ShimmerView';
import { useUnistyles } from 'react-native-unistyles';

interface SkeletonBlockProps {
    w?: number | `${number}%`;
    h?: number;
    radius?: number;
    mt?: number;
    style?: StyleProp<ViewStyle>;
}

export const SkeletonBlock = React.memo<SkeletonBlockProps>(({ w = '100%', h = 12, radius = 4, mt, style }) => {
    const { theme } = useUnistyles();
    return (
        <View
            style={[
                {
                    width: w as any,
                    height: h,
                    borderRadius: radius,
                    backgroundColor: theme.colors.divider,
                    marginTop: mt,
                },
                style,
            ]}
        />
    );
});
SkeletonBlock.displayName = 'SkeletonBlock';

interface RepoListSkeletonProps {
    count?: number;
}

export const RepoListSkeleton = React.memo<RepoListSkeletonProps>(({ count = 4 }) => {
    const { theme } = useUnistyles();
    return (
        <ShimmerView>
            <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                overflow: 'hidden',
            }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }), borderBottomColor: theme.colors.divider }}>
                    <SkeletonBlock w={100} h={13} />
                </View>
                {Array.from({ length: count }).map((_, i) => (
                    <View key={i}>
                        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <SkeletonBlock w={'55%'} h={15} />
                                <View style={{ flex: 1 }} />
                                <SkeletonBlock w={48} h={20} radius={10} />
                            </View>
                            <SkeletonBlock w={'80%'} h={13} mt={4} />
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 }}>
                                <SkeletonBlock w={56} h={12} />
                                <SkeletonBlock w={36} h={12} />
                                <SkeletonBlock w={36} h={12} />
                                <View style={{ flex: 1 }} />
                                <SkeletonBlock w={60} h={12} />
                            </View>
                        </View>
                        {i < count - 1 ? (
                            <View style={{ height: Platform.select({ ios: 0.33, default: 1 }), backgroundColor: theme.colors.divider }} />
                        ) : null}
                    </View>
                ))}
            </View>
        </ShimmerView>
    );
});
RepoListSkeleton.displayName = 'RepoListSkeleton';

export const IssueListSkeleton = React.memo<{ count?: number; variant?: 'card' | 'plain' }>(({ count = 6, variant = 'card' }) => {
    const { theme } = useUnistyles();
    const isCard = variant === 'card';
    const inner = (
        <>
            {Array.from({ length: count }).map((_, i) => (
                <View
                    key={i}
                    style={{
                        padding: 14,
                        borderBottomWidth: i === count - 1 ? 0 : 1,
                        borderBottomColor: theme.colors.divider,
                    }}
                >
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                        <SkeletonBlock w={isCard ? 18 : 10} h={isCard ? 18 : 10} radius={isCard ? 9 : 5} />
                        <View style={{ flex: 1 }}>
                            <SkeletonBlock w={'85%'} h={14} />
                            <SkeletonBlock w={'55%'} h={isCard ? 11 : 12} mt={isCard ? 6 : 4} />
                        </View>
                        {isCard && <SkeletonBlock w={60} h={18} radius={9} />}
                    </View>
                </View>
            ))}
        </>
    );
    return (
        <ShimmerView>
            {isCard ? (
                <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, overflow: 'hidden', marginHorizontal: 16 }}>
                    {inner}
                </View>
            ) : (
                <View style={{ paddingHorizontal: 16 }}>
                    {inner}
                </View>
            )}
        </ShimmerView>
    );
});
IssueListSkeleton.displayName = 'IssueListSkeleton';

export const RepoDetailSkeleton = React.memo(() => {
    const { theme } = useUnistyles();
    return (
        <ShimmerView>
            <View>
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                    <View
                        style={{
                            backgroundColor: theme.colors.surface,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                            padding: 16,
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <SkeletonBlock w={56} h={56} radius={28} />
                            <View style={{ flex: 1, gap: 8 }}>
                                <SkeletonBlock w={'50%'} h={12} />
                                <SkeletonBlock w={'80%'} h={20} />
                            </View>
                        </View>
                        <SkeletonBlock w={'95%'} h={13} mt={14} />
                        <SkeletonBlock w={'70%'} h={13} mt={6} />
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                            <SkeletonBlock w={70} h={24} radius={12} />
                            <SkeletonBlock w={54} h={24} radius={12} />
                            <SkeletonBlock w={54} h={24} radius={12} />
                            <View style={{ flex: 1 }} />
                            <SkeletonBlock w={90} h={14} />
                        </View>
                    </View>
                </View>
                {[1, 2].map((i) => (
                    <View key={i} style={{ paddingHorizontal: 16, marginTop: 20 }}>
                        <SkeletonBlock w={80} h={12} />
                        <View
                            style={{
                                marginTop: 8,
                                backgroundColor: theme.colors.surface,
                                borderRadius: 14,
                                borderWidth: 1,
                                borderColor: theme.colors.divider,
                                overflow: 'hidden',
                            }}
                        >
                            {[1, 2, 3].map((j) => (
                                <View
                                    key={j}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        paddingHorizontal: 14,
                                        paddingVertical: 12,
                                        gap: 12,
                                        borderBottomWidth: j === 3 ? 0 : 1,
                                        borderBottomColor: theme.colors.divider,
                                    }}
                                >
                                    <SkeletonBlock w={29} h={29} radius={15} />
                                    <SkeletonBlock w={'55%'} h={14} />
                                    <View style={{ flex: 1 }} />
                                    <SkeletonBlock w={16} h={16} radius={8} />
                                </View>
                            ))}
                        </View>
                    </View>
                ))}
            </View>
        </ShimmerView>
    );
});
RepoDetailSkeleton.displayName = 'RepoDetailSkeleton';
