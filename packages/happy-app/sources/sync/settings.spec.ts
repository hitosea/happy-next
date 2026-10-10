import { describe, it, expect } from 'vitest';
import { settingsParse, applySettings, settingsDefaults, type Settings } from './settings';

describe('settings', () => {
    describe('settingsParse', () => {
        it('should return defaults when given invalid input', () => {
            expect(settingsParse(null)).toEqual(settingsDefaults);
            expect(settingsParse(undefined)).toEqual(settingsDefaults);
            expect(settingsParse('invalid')).toEqual(settingsDefaults);
            expect(settingsParse(123)).toEqual(settingsDefaults);
            expect(settingsParse([])).toEqual(settingsDefaults);
        });

        it('should return defaults when given empty object', () => {
            expect(settingsParse({})).toEqual(settingsDefaults);
        });

        it('should parse valid settings object', () => {
            const validSettings = {
                wrapLinesInDiffs: true
            };
            expect(settingsParse(validSettings)).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: true
            });
        });

        it('should ignore invalid field types and use defaults', () => {
            const invalidSettings = {
                wrapLinesInDiffs: 'not a boolean'
            };
            expect(settingsParse(invalidSettings)).toEqual(settingsDefaults);
        });

        it('should carry the legacy compactSessionView over to the desktop setting', () => {
            const result = settingsParse({ compactSessionView: true });
            expect(result.compactSessionViewDesktop).toBe(true);
            // The legacy flag seeded desktop only; mobile starts from its default.
            expect(result.compactSessionViewMobile).toBe(false);
        });

        it('should not touch the desktop setting when it is already present', () => {
            const result = settingsParse({ compactSessionView: true, compactSessionViewDesktop: false });
            expect(result.compactSessionViewDesktop).toBe(false);
        });

        it('should carry an explicit legacy "off" over to the desktop setting', () => {
            // Desktop defaults to on, but an explicit legacy value wins — upgrading must not turn
            // the setting back on for someone who had turned it off.
            const result = settingsParse({ compactSessionView: false });
            expect(result.compactSessionViewDesktop).toBe(false);
            expect(result.compactSessionViewMobile).toBe(false);
        });

        it('should default desktop on and mobile off for settings without the legacy flag', () => {
            const result = settingsParse({});
            expect(result.compactSessionViewDesktop).toBe(true);
            expect(result.compactSessionViewMobile).toBe(false);
        });

        it('should keep the two platform settings independent', () => {
            const result = settingsParse({ compactSessionViewMobile: true, compactSessionViewDesktop: false });
            expect(result.compactSessionViewMobile).toBe(true);
            expect(result.compactSessionViewDesktop).toBe(false);
        });

        it('should preserve unknown fields (loose schema)', () => {
            const settingsWithExtra = {
                wrapLinesInDiffs: true,
                unknownField: 'some value',
                anotherField: 123
            };
            const result = settingsParse(settingsWithExtra);
            expect(result).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: true,
                unknownField: 'some value',
                anotherField: 123
            });
        });

        it('should handle partial settings and merge with defaults', () => {
            const partialSettings = {
                wrapLinesInDiffs: true
            };
            expect(settingsParse(partialSettings)).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: true
            });
        });

        it('should handle settings with null/undefined values', () => {
            const settingsWithNull = {
                wrapLinesInDiffs: null,
                someOtherField: undefined
            };
            expect(settingsParse(settingsWithNull)).toEqual({
                ...settingsDefaults,
                someOtherField: undefined
            });
        });

        it('should handle nested objects as extra fields', () => {
            const settingsWithNested = {
                wrapLinesInDiffs: false,
                image: {
                    url: 'http://example.com',
                    width: 100,
                    height: 200
                }
            };
            const result = settingsParse(settingsWithNested);
            expect(result).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: false,
                image: {
                    url: 'http://example.com',
                    width: 100,
                    height: 200
                }
            });
        });
    });

    describe('applySettings', () => {
        it('should apply delta to existing settings', () => {
            const currentSettings: Settings = {
                schemaVersion: 1,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: false,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            };
            const delta: Partial<Settings> = {
                wrapLinesInDiffs: true
            };
            expect(applySettings(currentSettings, delta)).toEqual({
                schemaVersion: 1, // Preserved from currentSettings
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: true,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient', // This should be preserved from currentSettings
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            });
        });

        it('should merge with defaults', () => {
            const currentSettings: Settings = {
                schemaVersion: 1,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: true,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            };
            const delta: Partial<Settings> = {};
            expect(applySettings(currentSettings, delta)).toEqual(currentSettings);
        });

        it('should override existing values with delta', () => {
            const currentSettings: Settings = {
                schemaVersion: 1,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: true,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            };
            const delta: Partial<Settings> = {
                wrapLinesInDiffs: false
            };
            expect(applySettings(currentSettings, delta)).toEqual({
                ...currentSettings,
                wrapLinesInDiffs: false
            });
        });

        it('should handle empty delta', () => {
            const currentSettings: Settings = {
                schemaVersion: 1,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: true,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            };
            expect(applySettings(currentSettings, {})).toEqual(currentSettings);
        });

        it('should handle extra fields in current settings', () => {
            const currentSettings: any = {
                wrapLinesInDiffs: true,
                extraField: 'value'
            };
            const delta: Partial<Settings> = {
                wrapLinesInDiffs: false
            };
            expect(applySettings(currentSettings, delta)).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: false,
                extraField: 'value'
            });
        });

        it('should handle extra fields in delta', () => {
            const currentSettings: Settings = {
                schemaVersion: 1,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: true,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                agentInputEnterToSend: true,
                avatarStyle: 'gradient',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: false,
                showThinkingMessages: true,
                foldTurnProcess: true,

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
                favoriteDirectories: [],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
            };
            const delta: any = {
                wrapLinesInDiffs: false,
                newField: 'new value'
            };
            expect(applySettings(currentSettings, delta)).toEqual({
                ...currentSettings,
                wrapLinesInDiffs: false,
                newField: 'new value'
            });
        });

        it('should preserve unknown fields from both current and delta', () => {
            const currentSettings: any = {
                wrapLinesInDiffs: true,
                existingExtra: 'keep me'
            };
            const delta: any = {
                wrapLinesInDiffs: false,
                newExtra: 'add me'
            };
            expect(applySettings(currentSettings, delta)).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: false,
                existingExtra: 'keep me',
                newExtra: 'add me'
            });
        });
    });

    describe('settingsDefaults', () => {
        it('should have correct default values', () => {
            expect(settingsDefaults).toEqual({
                schemaVersion: 2,
                showLineNumbersInToolViews: false,
                wrapLinesInDiffs: false,
                analyticsOptOut: false,
                inferenceOpenAIKey: null,
                experiments: false,
                alwaysShowContextSize: true,
                avatarStyle: 'brutalist',
                showFlavorIcons: false,
                compactSessionView: false,
                compactSessionViewMobile: false,
                compactSessionViewDesktop: true,
                agentInputEnterToSend: true,

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
                favoriteDirectories: ['~/src', '~/Desktop', '~/Documents'],
                favoriteMachines: [],
                machineOrder: [],
                showFullProjectPath: false,
                hideIdleMachines: false,
                machineAvatars: {},
                showThinkingMessages: false,
                foldTurnProcess: true,
            });
        });

        it('should be a valid Settings object', () => {
            const parsed = settingsParse(settingsDefaults);
            expect(parsed).toEqual(settingsDefaults);
        });
    });

    describe('forward/backward compatibility', () => {
        it('should handle settings from older version (missing new fields)', () => {
            const oldVersionSettings = {};
            const parsed = settingsParse(oldVersionSettings);
            expect(parsed).toEqual(settingsDefaults);
        });

        it('should handle settings from newer version (extra fields)', () => {
            const newVersionSettings = {
                wrapLinesInDiffs: true,
                futureFeature: 'some value',
                anotherNewField: { complex: 'object' }
            };
            const parsed = settingsParse(newVersionSettings);
            expect(parsed.wrapLinesInDiffs).toBe(true);
            expect((parsed as any).futureFeature).toBe('some value');
            expect((parsed as any).anotherNewField).toEqual({ complex: 'object' });
        });

        it('should preserve unknown fields when applying changes', () => {
            const settingsWithFutureFields: any = {
                wrapLinesInDiffs: false,
                futureField1: 'value1',
                futureField2: 42
            };
            const delta: Partial<Settings> = {
                wrapLinesInDiffs: true
            };
            const result = applySettings(settingsWithFutureFields, delta);
            expect(result).toEqual({
                ...settingsDefaults,
                wrapLinesInDiffs: true,
                futureField1: 'value1',
                futureField2: 42
            });
        });
    });

    describe('edge cases', () => {
        it('should handle circular references gracefully', () => {
            const circular: any = { wrapLinesInDiffs: true };
            circular.self = circular;

            // Should not throw and should return defaults due to parse error
            expect(() => settingsParse(circular)).not.toThrow();
        });

        it('should handle very large objects', () => {
            const largeSettings: any = { wrapLinesInDiffs: true };
            for (let i = 0; i < 1000; i++) {
                largeSettings[`field${i}`] = `value${i}`;
            }
            const parsed = settingsParse(largeSettings);
            expect(parsed.wrapLinesInDiffs).toBe(true);
            expect(Object.keys(parsed).length).toBeGreaterThan(1000);
        });

        it('should handle settings with prototype pollution attempts', () => {
            const maliciousSettings = {
                wrapLinesInDiffs: true,
                '__proto__': { evil: true },
                'constructor': { prototype: { evil: true } }
            };
            const parsed = settingsParse(maliciousSettings);
            expect(parsed.wrapLinesInDiffs).toBe(true);
            // Zod's loose() mode doesn't preserve __proto__ as a regular property
            // which is actually good for security
            expect((parsed as any).__proto__).not.toEqual({ evil: true });
            // Constructor property is preserved as a regular property
            expect((parsed as any).constructor).toEqual({ prototype: { evil: true } });
            // Verify no prototype pollution occurred
            expect(({} as any).evil).toBeUndefined();
        });
    });

    describe('version-mismatch scenario (bug fix)', () => {
        it('should preserve pending changes when merging server settings', () => {
            // Simulates the bug scenario:
            // 1. User enables showFullProjectPath (local change)
            // 2. Version-mismatch occurs (server has newer version from another device)
            // 3. Server settings don't have the flag (it was added by this device)
            // 4. Merge should preserve the pending change

            const serverSettings: Partial<Settings> = {
                // Server settings from another device (version 11)
                // Missing showFullProjectPath because other device doesn't have it
                wrapLinesInDiffs: true,
                machineOrder: ['server-machine']
            };

            const pendingChanges: Partial<Settings> = {
                // User's local changes that haven't synced yet
                showFullProjectPath: true,
                machineOrder: ['local-machine']
            };

            // Parse server settings (fills in defaults for missing fields)
            const parsedServerSettings = settingsParse(serverSettings);

            // Verify server settings default showFullProjectPath to false
            expect(parsedServerSettings.showFullProjectPath).toBe(false);

            // Apply pending changes on top of server settings
            const mergedSettings = applySettings(parsedServerSettings, pendingChanges);

            // CRITICAL: Pending changes should override defaults
            expect(mergedSettings.showFullProjectPath).toBe(true);
            expect(mergedSettings.machineOrder).toEqual(pendingChanges.machineOrder);
            expect(mergedSettings.wrapLinesInDiffs).toBe(true); // Preserved from server
        });

        it('should handle multiple pending changes during version-mismatch', () => {
            const serverSettings = settingsParse({
                wrapLinesInDiffs: false,
                experiments: false
            });

            const pendingChanges: Partial<Settings> = {
                showFullProjectPath: true,
                experiments: true,
                machineOrder: []
            };

            const merged = applySettings(serverSettings, pendingChanges);

            expect(merged.showFullProjectPath).toBe(true);
            expect(merged.experiments).toBe(true);
            expect(merged.wrapLinesInDiffs).toBe(false); // From server
        });

        it('should handle empty server settings (server reset scenario)', () => {
            const serverSettings = settingsParse({});  // Server has no settings

            const pendingChanges: Partial<Settings> = {
                showFullProjectPath: true
            };

            const merged = applySettings(serverSettings, pendingChanges);

            // Pending change should override default
            expect(merged.showFullProjectPath).toBe(true);
            // Other fields use defaults
            expect(merged.wrapLinesInDiffs).toBe(false);
        });

        it('should preserve user flag when server lacks field', () => {
            // Exact bug scenario:
            // Server has old settings without showFullProjectPath
            const serverSettings = settingsParse({
                schemaVersion: 1,
                wrapLinesInDiffs: false,
                // showFullProjectPath: NOT PRESENT
            });

            // User enabled flag locally (in pending)
            const pendingChanges: Partial<Settings> = {
                showFullProjectPath: true
            };

            // Merge for version-mismatch retry
            const merged = applySettings(serverSettings, pendingChanges);

            // BUG WOULD BE: merged.showFullProjectPath = false (from defaults)
            // FIX IS: merged.showFullProjectPath = true (from pending)
            expect(merged.showFullProjectPath).toBe(true);
        });

        it('should handle accumulating pending changes across syncs', () => {
            // Scenario: User makes multiple changes before sync completes

            // Initial state from server
            const serverSettings = settingsParse({
                wrapLinesInDiffs: false,
                experiments: false
            });

            // First pending change
            const pending1: Partial<Settings> = {
                showFullProjectPath: true
            };

            // Accumulate second change (simulates line 298: this.pendingSettings = { ...this.pendingSettings, ...delta })
            const pending2: Partial<Settings> = {
                ...pending1,
                machineOrder: ['test-machine']
            };

            // Merge with server settings
            const merged = applySettings(serverSettings, pending2);

            // Both pending changes preserved
            expect(merged.showFullProjectPath).toBe(true);
            expect(merged.machineOrder).toHaveLength(1);
            expect(merged.machineOrder[0]).toBe('test-machine');
            // Server settings preserved
            expect(merged.wrapLinesInDiffs).toBe(false);
            expect(merged.experiments).toBe(false);
        });

        it('should handle multi-device conflict: Device A flag + Device B machine order', () => {
            // Device A and B both at version 10
            // Device A enables flag, Device B reorders machines
            // Both POST to server simultaneously
            // One wins (becomes v11), other gets version-mismatch

            // Server accepted Device B's change first (v11)
            const serverSettingsV11 = settingsParse({
                machineOrder: ['device-b-machine']
            });

            // Device A's pending change
            const deviceAPending: Partial<Settings> = {
                showFullProjectPath: true
            };

            // Device A merges and retries
            const merged = applySettings(serverSettingsV11, deviceAPending);

            // Device A's flag preserved
            expect(merged.showFullProjectPath).toBe(true);
            // Device B's machine order preserved
            expect(merged.machineOrder).toHaveLength(1);
            expect(merged.machineOrder[0]).toBe('device-b-machine');
        });

        it('should handle Device A and B both changing same field', () => {
            // Device A sets flag to true
            // Device B sets flag to false
            // One POSTs first, other gets version-mismatch

            const serverSettings = settingsParse({
                showFullProjectPath: false  // Device B won
            });

            const deviceAPending: Partial<Settings> = {
                showFullProjectPath: true  // Device A's conflicting change
            };

            // Device A merges (its pending overrides server)
            const merged = applySettings(serverSettings, deviceAPending);

            // Device A's value wins (last-write-wins for pending changes)
            expect(merged.showFullProjectPath).toBe(true);
        });

        it('should handle server settings with extra fields + pending changes', () => {
            // Server has newer schema version with new fields
            const serverSettings = settingsParse({
                wrapLinesInDiffs: true,
                futureFeature: 'some value',  // Field this device doesn't know about
                anotherNewField: 123
            });

            const pendingChanges: Partial<Settings> = {
                showFullProjectPath: true,
                experiments: true
            };

            const merged = applySettings(serverSettings, pendingChanges);

            // Pending changes applied
            expect(merged.showFullProjectPath).toBe(true);
            expect(merged.experiments).toBe(true);
            // Server fields preserved
            expect(merged.wrapLinesInDiffs).toBe(true);
            expect((merged as any).futureFeature).toBe('some value');
            expect((merged as any).anotherNewField).toBe(123);
        });

        it('should handle empty pending (no local changes)', () => {
            const serverSettings = settingsParse({
                showFullProjectPath: true,
                wrapLinesInDiffs: true
            });

            const pendingChanges: Partial<Settings> = {};

            const merged = applySettings(serverSettings, pendingChanges);

            // Server settings unchanged
            expect(merged).toEqual(serverSettings);
        });

        it('should handle delta overriding multiple server fields', () => {
            const serverSettings = settingsParse({
                wrapLinesInDiffs: false,
                experiments: false,
                analyticsOptOut: false
            });

            const pendingChanges: Partial<Settings> = {
                wrapLinesInDiffs: true,
                showFullProjectPath: true,
                analyticsOptOut: true
            };

            const merged = applySettings(serverSettings, pendingChanges);

            // All pending changes applied
            expect(merged.wrapLinesInDiffs).toBe(true);
            expect(merged.showFullProjectPath).toBe(true);
            expect(merged.analyticsOptOut).toBe(true);
            // Un-changed field from server
            expect(merged.experiments).toBe(false);
        });

        it('should preserve complex nested structures during merge', () => {
            const serverSettings = settingsParse({
                machineOrder: ['server-machine-1'],
                machineAvatars: {
                    'machine-1': { icon: 'server', color: 'blue' }
                }
            });

            const pendingChanges: Partial<Settings> = {
                showFullProjectPath: true,
                machineOrder: ['local-machine-1'],
                machineAvatars: {
                    'machine-2': { icon: 'laptop', color: 'green' }
                }
            };

            const merged = applySettings(serverSettings, pendingChanges);

            // Pending changes completely override (not deep merge)
            expect(merged.showFullProjectPath).toBe(true);
            expect(merged.machineOrder).toEqual(pendingChanges.machineOrder);
            expect(merged.machineAvatars).toEqual(pendingChanges.machineAvatars);
        });
    });
});
