import type { AgentFlavor, PermissionMode } from 'happy-wire';
import { t } from '@/text';

export interface PermissionModeOption {
    value: PermissionMode;
    label: string;
    description: string;
    /** Ionicons name rendered beside the row. */
    icon: string;
}

/**
 * The approval modes each agent accepts, in the order the agent advertises them.
 *
 * Shared by the new-session wizard and the profile editor so the two cannot drift: the
 * mode ids are the ones the runners validate (see happy-wire's per-agent mode lists), and
 * `qoder` in particular has no `plan` tier — its `yolo` is the CLI's bypass mode.
 */
export function permissionModeOptionsForAgent(agentType: AgentFlavor): PermissionModeOption[] {
    switch (agentType) {
        case 'codex':
            return [
                { value: 'default', label: t('agentInput.codexPermissionMode.default'), description: t('wizard.permCodexDefaultDesc'), icon: 'shield-outline' },
                { value: 'read-only', label: t('agentInput.codexPermissionMode.readOnly'), description: t('wizard.permReadOnlyDesc'), icon: 'eye-outline' },
                { value: 'on-failure', label: t('agentInput.codexPermissionMode.onFailure'), description: t('wizard.permOnFailureDesc'), icon: 'shield-checkmark-outline' },
                { value: 'full-auto', label: t('agentInput.codexPermissionMode.fullAuto'), description: t('wizard.permFullAutoDesc'), icon: 'flash-outline' },
            ];
        case 'gemini':
            return [
                { value: 'default', label: t('agentInput.geminiPermissionMode.default'), description: t('wizard.permGeminiDefaultDesc'), icon: 'shield-outline' },
                { value: 'auto_edit', label: t('wizard.permAutoEdit'), description: t('wizard.permAutoEditDesc'), icon: 'create-outline' },
                { value: 'plan', label: t('agentInput.geminiPermissionMode.plan'), description: t('wizard.permGeminiPlanDesc'), icon: 'list-outline' },
                { value: 'yolo', label: t('wizard.permYolo'), description: t('wizard.permYoloDesc'), icon: 'warning-outline' },
            ];
        case 'qoder':
            return [
                { value: 'default', label: t('agentInput.qoderPermissionMode.default'), description: t('wizard.permQoderDefaultDesc'), icon: 'shield-outline' },
                { value: 'auto', label: t('agentInput.qoderPermissionMode.auto'), description: t('wizard.permQoderAutoDesc'), icon: 'sparkles-outline' },
                { value: 'acceptEdits', label: t('agentInput.qoderPermissionMode.acceptEdits'), description: t('wizard.permQoderAcceptEditsDesc'), icon: 'create-outline' },
                { value: 'dontAsk', label: t('agentInput.qoderPermissionMode.dontAsk'), description: t('wizard.permQoderDontAskDesc'), icon: 'help-circle-outline' },
                { value: 'yolo', label: t('agentInput.qoderPermissionMode.bypassPermissions'), description: t('wizard.permQoderBypassDesc'), icon: 'flash-outline' },
            ];
        default:
            return [
                { value: 'default', label: t('wizard.permDefault'), description: t('wizard.permDefaultDesc'), icon: 'shield-outline' },
                { value: 'acceptEdits', label: t('wizard.permAcceptEdits'), description: t('wizard.permAcceptEditsDesc'), icon: 'checkmark-outline' },
                { value: 'plan', label: t('wizard.permPlan'), description: t('wizard.permPlanDesc'), icon: 'list-outline' },
                { value: 'auto', label: t('wizard.permAuto'), description: t('wizard.permAutoDesc'), icon: 'sparkles-outline' },
                { value: 'bypassPermissions', label: t('wizard.permBypass'), description: t('wizard.permBypassDesc'), icon: 'flash-outline' },
            ];
    }
}
