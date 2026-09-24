import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/tauri';

/** Which of the three "don't show again" targets the user picked. */
export type CliBannerDismissTarget = 'temporary' | 'machine' | 'global';

export interface CliNotDetectedBannerProps {
    /** Agent name as the user sees it, e.g. 'Claude'. */
    name: string;
    /** Already-translated install line, e.g. 'Install: npm install -g …'. */
    installHint: string;
    /** Already-translated label for the documentation link. */
    docsLabel: string;
    docsUrl: string;
    onDismiss: (target: CliBannerDismissTarget) => void;
}

/**
 * "This CLI is not installed on the selected machine" warning, with the two dismissal
 * scopes plus a close button.
 *
 * One component for every agent: the four hand-written copies it replaces differed only in
 * the agent name, the install line and the documentation link, which are props here.
 */
export const CliNotDetectedBanner = React.memo(({
    name,
    installHint,
    docsLabel,
    docsUrl,
    onDismiss,
}: CliNotDetectedBannerProps) => {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <View style={styles.titleRow}>
                    <Ionicons name="warning" size={16} color={theme.colors.warning} />
                    <Text style={styles.title}>
                        {t('wizard.cliNotDetected', { name })}
                    </Text>
                    <View style={styles.titleSpacer} />
                    <Text style={styles.dismissLabel}>
                        {t('wizard.dontShowFor')}
                    </Text>
                    <Pressable onPress={() => onDismiss('machine')} style={styles.dismissButton}>
                        <Text style={styles.dismissLabel}>
                            {t('wizard.thisMachine')}
                        </Text>
                    </Pressable>
                    <Pressable onPress={() => onDismiss('global')} style={styles.dismissButton}>
                        <Text style={styles.dismissLabel}>
                            {t('wizard.anyMachine')}
                        </Text>
                    </Pressable>
                </View>
                <Pressable
                    onPress={() => onDismiss('temporary')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
            <View style={styles.footerRow}>
                <Text style={styles.installHint}>
                    {installHint} •
                </Text>
                <Pressable onPress={() => openExternalUrl(docsUrl)}>
                    <Text style={styles.docsLink}>
                        {docsLabel}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.box.warning.background,
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: theme.colors.box.warning.border,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    titleRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginRight: 16,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    titleSpacer: {
        flex: 1,
        minWidth: 20,
    },
    dismissLabel: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    dismissButton: {
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.textSecondary,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
    },
    installHint: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    docsLink: {
        fontSize: 11,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
}));
