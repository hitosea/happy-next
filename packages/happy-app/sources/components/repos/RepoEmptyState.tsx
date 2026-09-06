import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { useUnistyles } from 'react-native-unistyles';
import { RoundButton } from '@/components/RoundButton';
import { Typography } from '@/constants/Typography';

interface RepoEmptyStateProps {
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    iconElement?: React.ReactNode;
    title: string;
    subtitle?: string;
    ctaTitle?: string;
    onCtaPress?: () => void;
    ctaLoading?: boolean;
    tone?: 'neutral' | 'danger';
}

export const RepoEmptyState = React.memo<RepoEmptyStateProps>(({ icon = 'folder-open-outline', iconElement, title, subtitle, ctaTitle, onCtaPress, ctaLoading, tone = 'neutral' }) => {
    const { theme } = useUnistyles();
    const color = tone === 'danger' ? theme.colors.textDestructive : theme.colors.textSecondary;
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}>
            <View style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceHighest,
                marginBottom: 14,
            }}>
                {iconElement ?? <Ionicons name={icon} size={24} color={color} allowFontScaling={false} />}
            </View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text, textAlign: 'center', ...Typography.default('semiBold') }}>
                {title}
            </Text>
            {subtitle ? (
                <Text style={{ marginTop: 6, fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 18, maxWidth: 320 }}>
                    {subtitle}
                </Text>
            ) : null}
            {ctaTitle && onCtaPress ? (
                <View style={{ marginTop: 18 }}>
                    <RoundButton title={ctaTitle} onPress={onCtaPress} loading={ctaLoading} size="normal" />
                </View>
            ) : null}
        </View>
    );
});
RepoEmptyState.displayName = 'RepoEmptyState';
