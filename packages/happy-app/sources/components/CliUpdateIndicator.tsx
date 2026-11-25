import * as React from 'react';
import { ActivityIndicator, Platform, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { AgentCliUpdate, MachineUpdates } from '@/utils/cliUpdate';
import { StatusDot } from './StatusDot';
import { t } from '@/text';

type UpdateState = { state: MachineUpdates['state'] };

/**
 * What the indicator says, for its tooltip and accessibility label: about the CLI's update when it is
 * the most pressing, else about the agent CLIs in that state (with a newer CLI, how many agent CLIs
 * have one too). Empty with no update.
 */
export function cliUpdateLabel(updates: MachineUpdates): string {
    const { cli, agents } = updates;
    const inState = agents.filter((update) => update.state === updates.state);
    const names = inState.map((update: AgentCliUpdate) => t(`agentInput.agent.${update.agent}`)).join(t('cliUpdate.agentListSeparator'));
    switch (updates.state) {
        case 'available':
            if (cli.state !== 'available') return t('cliUpdate.agentBannerAvailable', { names });
            return inState.length
                ? t('cliUpdate.bannerAvailableWithAgents', { version: cli.version, count: inState.length })
                : t('cliUpdate.bannerAvailable', { version: cli.version });
        case 'installing':
            return cli.state === 'installing' ? t('cliUpdate.bannerInstalling', { version: cli.version }) : t('cliUpdate.agentBannerInstalling', { names });
        case 'failed':
            return cli.state === 'failed' ? t('cliUpdate.bannerFailed') : t('cliUpdate.agentBannerFailed', { names });
        default: return '';
    }
}

/** The color of an update: a new version, an install running, or one that failed. */
export function useCliUpdateColor(update: UpdateState): string {
    const { theme } = useUnistyles();
    return update.state === 'failed' ? theme.colors.box.error.text
        : update.state === 'available' ? theme.colors.box.warning.text
        : theme.colors.textSecondary;
}

/** A machine's updates as an icon: a new version, an install running, or one that failed. */
export const CliUpdateIcon = React.memo(({ update, size }: { update: UpdateState; size: number }) => {
    const color = useCliUpdateColor(update);
    switch (update.state) {
        case 'available':
            return <Ionicons name="arrow-up-circle-outline" size={size} color={color} />;
        case 'installing':
            return <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 16 as any} color={color} />;
        case 'failed':
            return <Ionicons name="alert-circle-outline" size={size} color={color} />;
        default:
            return null;
    }
});

/** The same update as a badge dot on another button, pulsing while the install runs. */
export const CliUpdateDot = React.memo(({ update, size = 8, style }: { update: UpdateState; size?: number; style?: ViewStyle }) => {
    const color = useCliUpdateColor(update);
    if (update.state === 'none') return null;
    return <StatusDot color={color} isPulsing={update.state === 'installing'} size={size} style={style} />;
});

/** A ref that shows `label` as the browser tooltip of the element (web only). */
export function webTitle(label: string) {
    return (element: any) => {
        if (Platform.OS === 'web' && element && typeof element === 'object') element.title = label;
    };
}
