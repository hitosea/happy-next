import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { useUnistyles } from 'react-native-unistyles';
import { IssueIcon } from './IssueIcon';

export type RepoState = 'open' | 'closed' | 'merged' | 'draft';

interface StatePillProps {
    state: RepoState;
    variant?: 'filled' | 'outline' | 'icon-only';
    size?: 'sm' | 'md';
    label?: string;
}

const STATE_ICON: Record<Exclude<RepoState, 'open'>, React.ComponentProps<typeof Ionicons>['name']> = {
    closed: 'checkmark-circle-outline',
    merged: 'git-merge-outline',
    draft: 'ellipse-outline',
};

const STATE_LABEL: Record<RepoState, string> = {
    open: 'Open',
    closed: 'Closed',
    merged: 'Merged',
    draft: 'Draft',
};

function StateIcon({ state, size, color }: { state: RepoState; size: number; color: string }) {
    if (state === 'open') return <IssueIcon size={size} color={color} />;
    return <Ionicons name={STATE_ICON[state]} size={size} color={color} />;
}

export const StatePill = React.memo<StatePillProps>(({ state, variant = 'filled', size = 'md', label }) => {
    const { theme } = useUnistyles();
    const STATE_COLOR: Record<RepoState, string> = {
        open: theme.colors.repo.stateOpen,
        closed: theme.colors.repo.stateClosed,
        merged: theme.colors.repo.stateMerged,
        draft: theme.colors.repo.stateDraft,
    };
    const color = STATE_COLOR[state];

    const iconSize = size === 'sm' ? 12 : 14;
    const fontSize = size === 'sm' ? 11 : 12;
    const paddingH = size === 'sm' ? 8 : 10;
    const paddingV = size === 'sm' ? 2 : 3;

    if (variant === 'icon-only') {
        return <StateIcon state={state} size={iconSize + 4} color={color} />;
    }

    const bg = variant === 'filled' ? color : 'transparent';
    const fg = variant === 'filled' ? '#FFFFFF' : color;
    const borderColor = variant === 'outline' ? color : bg;

    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: paddingH,
            paddingVertical: paddingV,
            borderRadius: 999,
            backgroundColor: bg,
            borderWidth: variant === 'outline' ? 1 : 0,
            borderColor,
        }}>
            <StateIcon state={state} size={iconSize} color={fg} />
            <Text style={{ fontSize, fontWeight: '600', color: fg }}>{label ?? STATE_LABEL[state]}</Text>
        </View>
    );
});
StatePill.displayName = 'StatePill';
