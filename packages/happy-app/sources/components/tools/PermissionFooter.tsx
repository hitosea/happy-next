import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { useUnistyles } from 'react-native-unistyles';
import { storage, getSession } from '@/sync/storage';
import { t } from '@/text';
import { SHELL_TOOLS, bashAllowPrefixes, shellCommandOf } from 'happy-wire';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';

// Tools that offer "allow all edits this session" instead of "don't ask again for this tool".
// `edit` is the ACP edit tool (Gemini, Qoder).
const ALLOW_ALL_EDITS_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'exit_plan_mode', 'ExitPlanMode', 'edit']);

interface PermissionFooterProps {
    permission: {
        id: string;
        status: "pending" | "approved" | "denied" | "canceled";
        reason?: string;
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    };
    sessionId: string;
    toolName: string;
    toolInput?: any;
    metadata?: any;
}

export const PermissionFooter: React.FC<PermissionFooterProps> = ({ permission, sessionId, toolName, toolInput, metadata }) => {
    const { theme } = useUnistyles();
    const [loadingButton, setLoadingButton] = useState<'allow' | 'deny' | 'abort' | null>(null);
    const [loadingAllEdits, setLoadingAllEdits] = useState(false);
    const [loadingForSession, setLoadingForSession] = useState(false);
    const [ruleMenuVisible, setRuleMenuVisible] = useState(false);
    
    // Check if this is a Codex session - check both metadata.flavor and tool name prefix
    const isCodex = metadata?.flavor === 'codex' || toolName.startsWith('Codex');
    // DeepSeek Harness only supports one-shot allow/reject (no allow_always or acceptEdits)
    const isDeepSeek = metadata?.flavor === 'deepseek';
    // Gemini calls its accept-edits mode auto_edit; Claude and Qoder call it acceptEdits
    const acceptEditsMode = metadata?.flavor === 'gemini' ? 'auto_edit' : 'acceptEdits';
    const offersAllowAllEdits = !isDeepSeek && ALLOW_ALL_EDITS_TOOLS.has(toolName);
    const shellCommand = SHELL_TOOLS.has(toolName) ? shellCommandOf(toolInput) : null;
    // Codex offers its own prefix (e.g. `npm test`) to add to its execpolicy. It comes with the approval
    // request, while the card can show the input of the command item Codex started before asking.
    const proposal = getSession(sessionId)?.agentState?.requests?.[permission.id]?.arguments?.proposedExecpolicyAmendment
        ?? toolInput?.proposedExecpolicyAmendment;
    const proposedPrefix: string[] = Array.isArray(proposal) ? proposal : [];
    const getCurrentClaudeMode = (): 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan' | undefined => {
        const mode = getSession(sessionId)?.permissionMode;
        if (mode === 'default' || mode === 'acceptEdits' || mode === 'auto' || mode === 'bypassPermissions' || mode === 'plan') {
            return mode;
        }
        return undefined;
    };

    const handleApprove = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingForSession) return;

        setLoadingButton('allow');
        try {
            const modeForExitPlan = !isDeepSeek && (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode')
                ? getCurrentClaudeMode()
                : undefined;
            await sessionAllow(sessionId, permission.id, modeForExitPlan);
        } catch (error) {
            console.error('Failed to approve permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };

    const handleApproveAllEdits = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingForSession) return;

        setLoadingAllEdits(true);
        try {
            await sessionAllow(sessionId, permission.id, acceptEditsMode);
            // Switch the session to the agent's accept-edits mode for future permissions
            storage.getState().updateSessionPermissionMode(sessionId, acceptEditsMode);
        } catch (error) {
            console.error('Failed to approve all edits:', error);
        } finally {
            setLoadingAllEdits(false);
        }
    };

    const handleApproveForSession = async (allowRules: string[]) => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingForSession || !toolName) return;

        setLoadingForSession(true);
        try {
            // The CLI keeps shell rules (Claude, Gemini, Qoder); for other tools ACP agents take the decision as their own "always allow"
            await sessionAllow(sessionId, permission.id, undefined, allowRules, 'approved_for_session');
        } catch (error) {
            console.error('Failed to approve for session:', error);
        } finally {
            setLoadingForSession(false);
        }
    };

    const handleDeny = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingForSession) return;

        setLoadingButton('deny');
        try {
            await sessionDeny(sessionId, permission.id);
        } catch (error) {
            console.error('Failed to deny permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };
    
    // Codex-specific handlers
    const handleCodexApprove = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingButton('allow');
        try {
            await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved');
        } catch (error) {
            console.error('Failed to approve permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };
    
    const handleCodexApproveForSession = async (execpolicyAmendment?: string[]) => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingForSession(true);
        try {
            await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved_for_session', undefined, execpolicyAmendment);
        } catch (error) {
            console.error('Failed to approve for session:', error);
        } finally {
            setLoadingForSession(false);
        }
    };
    
    const handleCodexAbort = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingButton('abort');
        try {
            await sessionDeny(sessionId, permission.id, undefined, undefined, 'abort');
        } catch (error) {
            console.error('Failed to abort permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };

    // "Don't ask again" on a shell command asks what it covers: the programs the line runs, their
    // subcommands (`git status`), or only this command. Codex asks whether to allow its proposed prefix.
    const ruleMenuItems: ActionMenuItem[] = isCodex
        ? (proposedPrefix.length ? [
            { label: t('codex.permissions.alwaysAllowPrefix', { prefix: proposedPrefix.join(' ') }), onPress: () => handleCodexApproveForSession(proposedPrefix) },
            { label: t('codex.permissions.forSessionOnly'), onPress: () => handleCodexApproveForSession() },
        ] : [])
        : (shellCommand ? [
            ...bashAllowPrefixes(shellCommand).map((prefixes) => ({
                label: t('claude.permissions.allCommandsOf', { commands: prefixes }),
                onPress: () => handleApproveForSession(prefixes.map((prefix) => `Bash(${prefix}:*)`)),
            })),
            { label: t('claude.permissions.onlyThisCommand'), onPress: () => handleApproveForSession([`Bash(${shellCommand})`]) },
        ] : []);
    const ruleScope = isCodex ? t('codex.permissions.prefixScope')
        : metadata?.flavor === 'gemini' || metadata?.flavor === 'antigravity' ? t('claude.permissions.rulesUntilRestart')
        : t('claude.permissions.rulesSavedTo', { file: metadata?.flavor === 'qoder' ? '.qoder/settings.local.json' : '.claude/settings.local.json' });
    const handlePressForSession = () => ruleMenuItems.length > 1
        ? setRuleMenuVisible(true)
        : isCodex ? handleCodexApproveForSession() : handleApproveForSession(shellCommand ? [`Bash(${shellCommand})`] : [toolName]);

    const isApproved = permission.status === 'approved';
    const isDenied = permission.status === 'denied';
    const isPending = permission.status === 'pending';

    // Detect which button was used: mode for "all edits"; decision (ACP agents) or the stored rules (shell commands, Claude) for "don't ask again"
    const isApprovedViaAllEdits = isApproved && (permission.mode === 'acceptEdits' || permission.mode === 'auto_edit');
    const isApprovedForSession = isApproved && !isApprovedViaAllEdits && (
        permission.decision === 'approved_for_session' || !!permission.allowedTools?.length
    );
    // The shell commands "don't ask again" now covers, as `git status *` or the exact command
    const allowedCommands = (permission.allowedTools ?? [])
        .filter((rule) => rule.startsWith('Bash('))
        .map((rule) => rule.slice(5, -1).replace(/:\*$/, ' *'));
    const isApprovedViaAllow = isApproved && !isApprovedViaAllEdits && !isApprovedForSession;
    
    // Codex-specific status detection with fallback
    const isCodexApproved = isCodex && isApproved && (permission.decision === 'approved' || !permission.decision);
    const isCodexApprovedForSession = isCodex && isApproved && permission.decision === 'approved_for_session';
    const isCodexAborted = isCodex && isDenied && permission.decision === 'abort';

    const styles = StyleSheet.create({
        container: {
            paddingHorizontal: 12,
            paddingVertical: 8,
            justifyContent: 'center',
        },
        buttonContainer: {
            flexDirection: 'column',
            gap: 4,
            alignItems: 'flex-start',
        },
        button: {
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 1,
            backgroundColor: 'transparent',
            alignItems: 'flex-start',
            justifyContent: 'center',
            minHeight: 32,
            borderLeftWidth: 3,
            borderLeftColor: 'transparent',
            alignSelf: 'stretch',
        },
        buttonAllow: {
            backgroundColor: 'transparent',
        },
        buttonDeny: {
            backgroundColor: 'transparent',
        },
        buttonAllowAll: {
            backgroundColor: 'transparent',
        },
        buttonSelected: {
            backgroundColor: 'transparent',
            borderLeftColor: theme.colors.text,
        },
        buttonInactive: {
            opacity: 0.3,
        },
        buttonContent: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: 20,
        },
        icon: {
            marginRight: 2,
        },
        buttonText: {
            fontSize: 14,
            fontWeight: '400',
            color: theme.colors.textSecondary,
        },
        buttonTextAllow: {
            color: theme.colors.permissionButton.allow.background,
            fontWeight: '500',
        },
        buttonTextDeny: {
            color: theme.colors.permissionButton.deny.background,
            fontWeight: '500',
        },
        buttonTextAllowAll: {
            color: theme.colors.permissionButton.allowAll.background,
            fontWeight: '500',
        },
        buttonTextSelected: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        buttonForSession: {
            backgroundColor: 'transparent',
        },
        buttonTextForSession: {
            color: theme.colors.permissionButton.allowAll.background,
            fontWeight: '500',
        },
        loadingIndicatorAllow: {
            color: theme.colors.permissionButton.allow.background,
        },
        loadingIndicatorDeny: {
            color: theme.colors.permissionButton.deny.background,
        },
        loadingIndicatorAllowAll: {
            color: theme.colors.permissionButton.allowAll.background,
        },
        loadingIndicatorForSession: {
            color: theme.colors.permissionButton.allowAll.background,
        },
        iconApproved: {
            color: theme.colors.permissionButton.allow.background,
        },
        iconDenied: {
            color: theme.colors.permissionButton.deny.background,
        },
        allowedCommands: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            paddingHorizontal: 15,
        },
        ruleScope: {
            fontSize: 13,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            paddingVertical: 12,
            paddingHorizontal: 20,
        },
    });

    const ruleMenu = (
        <ActionMenuModal
            visible={ruleMenuVisible}
            title={t('claude.permissions.dontAskAgainFor')}
            items={ruleMenuItems}
            footerContent={<Text style={styles.ruleScope}>{ruleScope}</Text>}
            onClose={() => setRuleMenuVisible(false)}
        />
    );

    // Render Codex buttons if this is a Codex session
    if (isCodex) {
        return (
            <View style={styles.container}>
                {ruleMenu}
                <View style={styles.buttonContainer}>
                    {/* Codex: Yes button */}
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isPending && styles.buttonAllow,
                            isCodexApproved && styles.buttonSelected,
                            (isCodexAborted || isCodexApprovedForSession) && styles.buttonInactive
                        ]}
                        onPress={handleCodexApprove}
                        disabled={!isPending || loadingButton !== null || loadingForSession}
                        activeOpacity={isPending ? 0.7 : 1}
                    >
                        {loadingButton === 'allow' && isPending ? (
                            <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                                <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorAllow.color} />
                            </View>
                        ) : (
                            <View style={styles.buttonContent}>
                                <Text style={[
                                    styles.buttonText,
                                    isPending && styles.buttonTextAllow,
                                    isCodexApproved && styles.buttonTextSelected
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {t('common.yes')}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>

                    {/* Codex: Yes, and don't ask for a session button */}
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isPending && styles.buttonForSession,
                            isCodexApprovedForSession && styles.buttonSelected,
                            (isCodexAborted || isCodexApproved) && styles.buttonInactive
                        ]}
                        onPress={handlePressForSession}
                        disabled={!isPending || loadingButton !== null || loadingForSession}
                        activeOpacity={isPending ? 0.7 : 1}
                    >
                        {loadingForSession && isPending ? (
                            <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                                <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorForSession.color} />
                            </View>
                        ) : (
                            <View style={styles.buttonContent}>
                                <Text style={[
                                    styles.buttonText,
                                    isPending && styles.buttonTextForSession,
                                    isCodexApprovedForSession && styles.buttonTextSelected
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {t('codex.permissions.yesForSession')}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>

                    {/* Codex: Stop, and explain what to do button */}
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isPending && styles.buttonDeny,
                            isCodexAborted && styles.buttonSelected,
                            (isCodexApproved || isCodexApprovedForSession) && styles.buttonInactive
                        ]}
                        onPress={handleCodexAbort}
                        disabled={!isPending || loadingButton !== null || loadingForSession}
                        activeOpacity={isPending ? 0.7 : 1}
                    >
                        {loadingButton === 'abort' && isPending ? (
                            <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                                <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorDeny.color} />
                            </View>
                        ) : (
                            <View style={styles.buttonContent}>
                                <Text style={[
                                    styles.buttonText,
                                    isPending && styles.buttonTextDeny,
                                    isCodexAborted && styles.buttonTextSelected
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {t('codex.permissions.stopAndExplain')}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // Render Claude buttons (existing behavior)
    return (
        <View style={styles.container}>
            {ruleMenu}
            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={[
                        styles.button,
                        isPending && styles.buttonAllow,
                        isApprovedViaAllow && styles.buttonSelected,
                        (isDenied || isApprovedViaAllEdits || isApprovedForSession) && styles.buttonInactive
                    ]}
                    onPress={handleApprove}
                    disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
                    activeOpacity={isPending ? 0.7 : 1}
                >
                    {loadingButton === 'allow' && isPending ? (
                        <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                            <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorAllow.color} />
                        </View>
                    ) : (
                        <View style={styles.buttonContent}>
                            <Text style={[
                                styles.buttonText,
                                isPending && styles.buttonTextAllow,
                                isApprovedViaAllow && styles.buttonTextSelected
                            ]} numberOfLines={1} ellipsizeMode="tail">
                                {t('common.yes')}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                {/* Allow All Edits button - only show for file edit and exit-plan tools */}
                {offersAllowAllEdits && (
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isPending && styles.buttonAllowAll,
                            isApprovedViaAllEdits && styles.buttonSelected,
                            (isDenied || isApprovedViaAllow || isApprovedForSession) && styles.buttonInactive
                        ]}
                        onPress={handleApproveAllEdits}
                        disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
                        activeOpacity={isPending ? 0.7 : 1}
                    >
                        {loadingAllEdits && isPending ? (
                            <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                                <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorAllowAll.color} />
                            </View>
                        ) : (
                            <View style={styles.buttonContent}>
                                <Text style={[
                                    styles.buttonText,
                                    isPending && styles.buttonTextAllowAll,
                                    isApprovedViaAllEdits && styles.buttonTextSelected
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {t('claude.permissions.yesAllowAllEdits')}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                )}

                {/* Allow for session button - only show for non-edit, non-exit-plan tools when agent supports session rules */}
                {!isDeepSeek && toolName && !offersAllowAllEdits && (
                    <TouchableOpacity
                        style={[
                            styles.button,
                            isPending && styles.buttonForSession,
                            isApprovedForSession && styles.buttonSelected,
                            (isDenied || isApprovedViaAllow || isApprovedViaAllEdits) && styles.buttonInactive
                        ]}
                        onPress={handlePressForSession}
                        disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
                        activeOpacity={isPending ? 0.7 : 1}
                    >
                        {loadingForSession && isPending ? (
                            <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                                <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorForSession.color} />
                            </View>
                        ) : (
                            <View style={styles.buttonContent}>
                                <Text style={[
                                    styles.buttonText,
                                    isPending && styles.buttonTextForSession,
                                    isApprovedForSession && styles.buttonTextSelected
                                ]} numberOfLines={1} ellipsizeMode="tail">
                                    {shellCommand ? t('claude.permissions.yesForCommands') : t('claude.permissions.yesForTool')}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                )}
                {isApprovedForSession && allowedCommands.length > 0 && (
                    <Text style={styles.allowedCommands} numberOfLines={2}>
                        {t('claude.permissions.allowedCommands', { commands: allowedCommands })}
                    </Text>
                )}

                <TouchableOpacity
                    style={[
                        styles.button,
                        isPending && styles.buttonDeny,
                        isDenied && styles.buttonSelected,
                        (isApproved) && styles.buttonInactive
                    ]}
                    onPress={handleDeny}
                    disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
                    activeOpacity={isPending ? 0.7 : 1}
                >
                    {loadingButton === 'deny' && isPending ? (
                        <View style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}>
                            <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={styles.loadingIndicatorDeny.color} />
                        </View>
                    ) : (
                        <View style={styles.buttonContent}>
                            <Text style={[
                                styles.buttonText,
                                isPending && styles.buttonTextDeny,
                                isDenied && styles.buttonTextSelected
                            ]} numberOfLines={1} ellipsizeMode="tail">
                                {t('claude.permissions.noTellClaude')}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
};
