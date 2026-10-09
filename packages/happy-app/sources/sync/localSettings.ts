import * as z from 'zod';

//
// Schema
//

export const LocalSettingsSchema = z.object({
    // Developer settings (device-specific)
    debugMode: z.boolean().describe('Enable debug logging'),
    devModeEnabled: z.boolean().describe('Enable developer menu in settings'),
    themePreference: z.enum(['light', 'dark', 'adaptive']).describe('Theme preference: light, dark, or adaptive (follows system)'),
    hideNotificationsWhenActive: z.boolean().describe('Hide all notifications while the app is active'),
    hideSessionNotificationsWhenActive: z.boolean().describe('Hide notifications for the currently open session while the app is active'),
    desktopCloseToTray: z.boolean().describe('Hide the desktop window to the system tray when it is closed'),
    desktopNotificationsEnabled: z.boolean().describe('Show native desktop notifications for new messages'),
    desktopAutostartEnabled: z.boolean().describe('Launch the desktop app when the user signs in'),
    desktopGlobalShortcutEnabled: z.boolean().describe('Enable the global show/hide desktop shortcut'),
    // CLI version acknowledgments - keyed by machineId
    acknowledgedCliVersions: z.record(z.string(), z.string()).describe('Acknowledged CLI versions per machine'),
    // Session list UI state (device-specific)
    sessionListSelectedTab: z.string().nullable().describe('Persisted selected tab in the session list ("all" / "shared" / "sharedByMe" / a machineId)'),
    machineNameCache: z.record(z.string(), z.string()).describe('Cached machineId -> display name, so machine tabs keep their names before machines sync on restart'),
    collapsedSessionProjectGroups: z.record(z.string(), z.boolean()).describe('Collapsed project paths in the active session list'),
    webSidebarWidth: z.number().finite().nullable().describe('Persisted web sidebar width in pixels'),
    // Terminal UI state (device-specific)
    terminalTabOrder: z.array(z.string()).describe('Order the terminal tabs were dragged into, by terminalTabKey'),
    terminalTabNames: z.record(z.string(), z.string()).describe('Names given to terminal tabs by hand, by terminalTabKey'),
    terminalNewTarget: z.object({ machineId: z.string(), cwd: z.string() }).nullable().describe('Machine and directory chosen the last time a terminal was started'),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
    debugMode: false,
    devModeEnabled: false,
    themePreference: 'adaptive',
    hideNotificationsWhenActive: false,
    hideSessionNotificationsWhenActive: false,
    desktopCloseToTray: true,
    desktopNotificationsEnabled: true,
    desktopAutostartEnabled: false,
    desktopGlobalShortcutEnabled: true,
    acknowledgedCliVersions: {},
    sessionListSelectedTab: null,
    machineNameCache: {},
    collapsedSessionProjectGroups: {},
    webSidebarWidth: null,
    terminalTabOrder: [],
    terminalTabNames: {},
    terminalNewTarget: null,
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
    const parsed = LocalSettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        return { ...localSettingsDefaults };
    }
    return { ...localSettingsDefaults, ...parsed.data };
}

//
// Applying changes
//

export function applyLocalSettings(settings: LocalSettings, delta: Partial<LocalSettings>): LocalSettings {
    return { ...localSettingsDefaults, ...settings, ...delta };
}
