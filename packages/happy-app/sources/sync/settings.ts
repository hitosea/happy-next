import * as z from 'zod';

//
// Settings Schema
//

// Current schema version for backward compatibility
export const SUPPORTED_SCHEMA_VERSION = 2;

export const SettingsSchema = z.object({
    // Schema version for compatibility detection
    schemaVersion: z.number().default(SUPPORTED_SCHEMA_VERSION).describe('Settings schema version for compatibility checks'),

    inferenceOpenAIKey: z.string().nullish().describe('OpenAI API key for inference'),
    showLineNumbersInToolViews: z.boolean().describe('Whether to show line numbers in tool view diffs'),
    wrapLinesInDiffs: z.boolean().describe('Whether to wrap long lines in diff views'),
    analyticsOptOut: z.boolean().describe('Whether to opt out of anonymous analytics'),
    experiments: z.boolean().describe('Whether to enable experimental features'),
    alwaysShowContextSize: z.boolean().describe('Always show context size in agent input'),
    agentInputEnterToSend: z.boolean().describe('Whether pressing Enter submits/sends in the agent input (web)'),
    avatarStyle: z.string().describe('Avatar display style'),
    showFlavorIcons: z.boolean().describe('Whether to show AI provider icons in avatars'),
    showThinkingMessages: z.boolean().describe('Whether to show AI thinking/reasoning messages'),
    foldTurnProcess: z.boolean().describe('Whether a turn starts with its tool calls folded into one line'),
    // Deprecated: kept for backward compatibility with older clients. Now split per platform.
    compactSessionView: z.boolean().describe('Deprecated: superseded by compactSessionViewMobile / compactSessionViewDesktop'),
    compactSessionViewMobile: z.boolean().describe('Whether to use compact view for active sessions on mobile (native iOS/Android app and phone/tablet browsers). Defaults to off'),
    compactSessionViewDesktop: z.boolean().describe('Whether to use compact view for active sessions on desktop (Tauri desktop app and desktop browsers). Defaults to on'),

    reviewPromptAnswered: z.boolean().describe('Whether the review prompt has been answered'),
    reviewPromptLikedApp: z.boolean().nullish().describe('Whether user liked the app when asked'),
    voiceAssistantLanguage: z.string().nullable().describe('Preferred language for voice assistant (null for auto-detect)'),
    voiceAssistantVoice: z.string().nullable().describe('Preferred voice/timbre (VoiceType) for voice assistant (null for default)'),
    voiceAssistantSpeechRate: z.number().min(-50).max(100).describe('Voice assistant speech rate (-50..100, 0 = normal)'),
    voiceAssistantActionConfirmation: z.boolean().describe('Whether to show a countdown confirmation before the voice assistant executes send/create/delete actions'),
    voiceAssistantActionConfirmationSpeed: z.enum(['fast', 'normal', 'slow']).describe('Countdown speed for the voice action confirmation prompt'),
    voiceAssistantWelcomeMessage: z.string().nullable().describe('Custom welcome message spoken when a voice session starts (null = gateway default)'),
    preferredLanguage: z.string().nullable().describe('Preferred UI language (null for auto-detect from device locale)'),
    recentMachinePaths: z.array(z.object({
        machineId: z.string(),
        path: z.string()
    })).describe('Last 10 machine-path combinations, ordered by most recent first'),
    lastUsedAgent: z.string().nullable().describe('Last selected agent type for new sessions'),
    // Favorite directories for quick path selection
    favoriteDirectories: z.array(z.string()).describe('User-defined favorite directories for quick access in path selection'),
    // Favorite machines for quick machine selection
    favoriteMachines: z.array(z.string()).describe('User-defined favorite machines (machine IDs) for quick access in machine selection'),
    // Machine order across the app's machine lists
    machineOrder: z.array(z.string()).describe('User-defined machine order (machine IDs); machines not listed follow in their default order'),
    showFullProjectPath: z.boolean().describe('Show project paths in session lists in full instead of by directory name'),
    hideIdleMachines: z.boolean().describe('Leave online machines without active sessions out of the sidebar machine rail and the machine switcher'),
    machineAvatars: z.record(z.string(), z.object({
        icon: z.string(),
        color: z.string(),
    })).describe('Preset avatar (icon and color keys) per machine ID; machines without one show their default look'),
});

//
// NOTE: Settings must be a flat object with no to minimal nesting, one field == one setting,
// you can name them with a prefix if you want to group them, but don't nest them.
// You can nest if value is a single value (like image with url and width and height)
// Settings are always merged with defaults and field by field.
// 
// This structure must be forward and backward compatible. Meaning that some versions of the app
// could be missing some fields or have a new fields. Everything must be preserved and client must 
// only touch the fields it knows about.
//

const SettingsSchemaPartial = SettingsSchema.partial();

export type Settings = z.infer<typeof SettingsSchema>;

//
// Defaults
//

export const settingsDefaults: Settings = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    inferenceOpenAIKey: null,
    showLineNumbersInToolViews: false,
    wrapLinesInDiffs: false,
    analyticsOptOut: false,
    experiments: false,
    alwaysShowContextSize: true,
    agentInputEnterToSend: true,
    avatarStyle: 'brutalist',
    showFlavorIcons: false,
    showThinkingMessages: false,
    foldTurnProcess: true,
    compactSessionView: false,
    compactSessionViewMobile: false,
    compactSessionViewDesktop: true,
    reviewPromptAnswered: false,
    reviewPromptLikedApp: null,
    voiceAssistantLanguage: null,
    voiceAssistantVoice: null,
    voiceAssistantSpeechRate: 0,
    voiceAssistantActionConfirmation: true,
    voiceAssistantActionConfirmationSpeed: 'normal',
    voiceAssistantWelcomeMessage: null,
    preferredLanguage: null,
    recentMachinePaths: [],
    lastUsedAgent: null,
    // Default favorite directories (real common directories on Unix-like systems)
    favoriteDirectories: ['~/src', '~/Desktop', '~/Documents'],
    // Favorite machines (empty by default)
    favoriteMachines: [],
    // Machine order (default order until the user reorders)
    machineOrder: [],
    showFullProjectPath: false,
    hideIdleMachines: false,
    machineAvatars: {},
};
Object.freeze(settingsDefaults);

//
// Resolving
//

export function settingsParse(settings: unknown): Settings {
    // Handle null/undefined/invalid inputs
    if (!settings || typeof settings !== 'object') {
        return { ...settingsDefaults };
    }

    const parsed = SettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        // For invalid settings, preserve unknown fields but use defaults for known fields
        const unknownFields = { ...(settings as any) };
        // Remove all known schema fields and retired fields from unknownFields
        const knownFields = Object.keys(SettingsSchema.shape);
        knownFields.forEach(key => delete unknownFields[key]);
        delete unknownFields.voiceAssistantGatewayUrl;
        delete unknownFields.voiceAssistantPublicKey;
        return { ...settingsDefaults, ...unknownFields };
    }

    // Migration: Convert old 'zh' language code to 'zh-Hans'
    if (parsed.data.preferredLanguage === 'zh') {
        console.log('[Settings Migration] Converting language code from "zh" to "zh-Hans"');
        parsed.data.preferredLanguage = 'zh-Hans';
    }

    // Migration: compactSessionView used to be a single platform-agnostic flag. It is now split
    // per platform (desktop = Tauri/browser, mobile = native app and phone/tablet browsers). The
    // legacy value carries over to desktop as-is — including an explicit "off", so upgrading never
    // turns the setting back on for someone who had turned it off. Mobile starts from its default.
    // Only applied while the new field is absent, so a choice made since the split is never
    // overwritten.
    if (parsed.data.compactSessionViewDesktop === undefined && parsed.data.compactSessionView !== undefined) {
        console.log(`[Settings Migration] Carrying compactSessionView (${parsed.data.compactSessionView}) over to compactSessionViewDesktop`);
        parsed.data.compactSessionViewDesktop = parsed.data.compactSessionView;
    }

    // Merge defaults, parsed settings, and preserve unknown fields
    const unknownFields = { ...(settings as any) };
    // Remove known fields from unknownFields to preserve only the unknown ones
    Object.keys(parsed.data).forEach(key => delete unknownFields[key]);
    delete unknownFields.voiceAssistantGatewayUrl;
    delete unknownFields.voiceAssistantPublicKey;

    return { ...settingsDefaults, ...parsed.data, ...unknownFields };
}

//
// Applying changes
// NOTE: May be something more sophisticated here around defaults and merging, but for now this is fine.
//

export function applySettings(settings: Settings, delta: Partial<Settings>): Settings {
    // Original behavior: start with settings, apply delta, fill in missing with defaults
    const result = { ...settings, ...delta };

    // Fill in any missing fields with defaults
    Object.keys(settingsDefaults).forEach(key => {
        if (!(key in result)) {
            (result as any)[key] = (settingsDefaults as any)[key];
        }
    });

    return result;
}
