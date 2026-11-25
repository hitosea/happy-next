import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { showCopiedToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { useMachineAgentClis, type MachineAgentCli } from '@/hooks/useMachineAgentClis';
import { Modal } from '@/modal';
import type { Machine } from '@/sync/storageTypes';
import { agentCliHasUpdate } from '@/utils/cliUpdate';
import { t } from '@/text';

/** What went wrong, or that the daemon cannot update this CLI, with the command to run instead (copied from the dialog). */
function showManualUpdate(cli: MachineAgentCli) {
    const failed = cli.state === 'failed';
    const lines = [
        failed ? cli.error || t('cliUpdate.failed') : t('cliUpdate.agentUnsupported'),
        ...(cli.manualCommand ? ['', t('cliUpdate.manualCommand'), cli.manualCommand] : []),
    ];
    Modal.alert(t(`agentInput.agent.${cli.agent}`), lines.join('\n'), [
        ...(cli.manualCommand ? [{
            text: t('common.copy'),
            onPress: async () => {
                await Clipboard.setStringAsync(cli.manualCommand!);
                showCopiedToast();
            },
        }] : []),
        { text: t('common.ok') },
    ]);
}

/**
 * The machine page's CLI versions: the happy CLI's row (`children`, the page's) first, then each
 * installed agent CLI with its version, the newer one when known and
 * the way to it (an update button, or the command to run when the daemon cannot install it), and an
 * "update all" for when several have one. A CLI with nothing to do offers to check the versions again,
 * as the happy CLI's row does: one check looks every CLI up.
 */
type MachineCliGroupProps = {
    machine: Machine;
    highlighted: boolean;
    /** Looks every CLI up again (the happy CLI's check) */
    onCheck: () => void;
    checking: boolean;
    children?: React.ReactNode;
};

export const MachineCliGroup = React.memo(({ machine, highlighted, onCheck, checking, children }: MachineCliGroupProps) => {
    const { theme } = useUnistyles();
    const { clis, pending, update } = useMachineAgentClis(machine);
    if (!children && !clis.length) return null;

    const online = machine.active;
    const installing = !!pending || clis.some((cli) => cli.state === 'installing');
    const updatable = clis.filter((cli) => cli.updatable && agentCliHasUpdate(cli));
    const spinner = <ActivityIndicator size={Platform.OS === 'ios' ? 'small' : 16 as any} color={theme.colors.textSecondary} />;

    return (
        <ItemGroup
            title={t('cliUpdate.clis')}
            headerAction={online && !installing && updatable.length > 1 ? { label: t('cliUpdate.updateAll'), onPress: () => void update() } : undefined}
        >
            {children}
            {clis.map((cli) => {
                const hasUpdate = agentCliHasUpdate(cli);
                const isInstalling = cli.state === 'installing' || pending === cli.agent || (pending === 'all' && hasUpdate && !!cli.updatable);
                const needsHand = cli.state === 'failed' || (hasUpdate && !cli.updatable);
                let right: React.ReactNode = null;
                if (isInstalling) {
                    right = <View style={styles.status}>{spinner}<Text style={styles.statusText}>{t('cliUpdate.installing')}</Text></View>;
                } else if (cli.state === 'failed') {
                    right = (
                        <View style={styles.status}>
                            <Ionicons name="alert-circle" size={18} color={theme.colors.textDestructive} />
                            <Text style={[styles.statusText, styles.statusFailed]}>{t('cliUpdate.failed')}</Text>
                        </View>
                    );
                } else if (hasUpdate && cli.updatable) {
                    right = online ? (
                        <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => void update(cli.agent)} disabled={installing} hitSlop={6}>
                            <Text style={[styles.buttonText, styles.buttonPrimaryText]}>{t('cliUpdate.itemUpdate')}</Text>
                        </Pressable>
                    ) : null;
                } else if (hasUpdate) {
                    right = <Text style={styles.statusText}>{t('cliUpdate.agentManual')}</Text>;
                } else if (online) {
                    right = (
                        <Pressable style={styles.button} onPress={onCheck} disabled={checking} hitSlop={6}>
                            {checking ? spinner : <Text style={styles.buttonText}>{t('cliUpdate.check')}</Text>}
                        </Pressable>
                    );
                }
                return (
                    <Item
                        key={cli.agent}
                        title={t(`agentInput.agent.${cli.agent}`)}
                        subtitle={hasUpdate ? `${cli.version} → ${cli.latestVersion}` : cli.version ?? t('cliUpdate.agentVersionUnknown')}
                        showChevron={false}
                        onPress={needsHand && !isInstalling ? () => showManualUpdate(cli) : undefined}
                        style={highlighted && (hasUpdate || cli.state !== 'idle') ? styles.highlight : undefined}
                        rightElement={right}
                    />
                );
            })}
        </ItemGroup>
    );
});

const styles = StyleSheet.create((theme) => ({
    highlight: {
        backgroundColor: theme.colors.box.warning.background,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    statusFailed: {
        color: theme.colors.textDestructive,
    },
    button: {
        minWidth: 64,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: theme.colors.surfaceHighest,
    },
    buttonPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonText: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    buttonPrimaryText: {
        color: theme.colors.button.primary.tint,
    },
}));
