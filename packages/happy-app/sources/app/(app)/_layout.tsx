import { Stack, useRouter } from 'expo-router';
import 'react-native-reanimated';
import * as React from 'react';
import { Typography } from '@/constants/Typography';
import { createHeader } from '@/components/navigation/Header';
// Opt in per screen: transparent native headers require the page's scroll view to adjust its top inset.
import { softHeaderOptions } from '@/components/navigation/softHeader';
import { floatingComposerScreenOptions } from '@/components/floatingComposer';
import { Platform, TouchableOpacity, Text } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { useAuth } from '@/auth/AuthContext';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { isDedicatedTerminalWindow } from '@/terminal/terminalPopupWindow';

export const unstable_settings = {
    initialRouteName: 'index',
};

export default function RootLayout() {
    // Use custom header on Android and Mac Catalyst, native header on iOS (non-Catalyst)
    const shouldUseCustomHeader = Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web';
    const { theme } = useUnistyles();
    const router = useRouter();
    const isCustomServer = isUsingCustomServer();
    const { isAuthenticated } = useAuth();
    const hideUnauthenticatedWindowsHeader = getDesktopPlatform() === 'windows' && !isAuthenticated;
    // The terminal window already says what it is in its tab strip, and a header
    // would only push the tabs down. On a phone the same screen is a page in the
    // app, where the header is how you get back out.
    const inTerminalWindow = isDedicatedTerminalWindow();

    return (
        <Stack
            initialRouteName='index'
            screenOptions={{
                header: shouldUseCustomHeader ? createHeader : undefined,
                headerBackButtonDisplayMode: 'minimal',
                headerShadowVisible: false,
                contentStyle: {
                    backgroundColor: theme.colors.surface,
                },
                headerStyle: {
                    backgroundColor: theme.colors.header.background,
                },
                headerTintColor: theme.colors.header.tint,
                headerTitleStyle: {
                    color: theme.colors.header.tint,
                    ...Typography.default('semiBold'),
                },

            }}
        >
            <Stack.Screen
                name="index"
                options={{
                    headerShown: false,
                    headerTitle: ''
                }}
            />
            <Stack.Screen
                name="inbox/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('tabs.inbox'),
                }}
            />
            <Stack.Screen
                name="dootask/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('tabs.dootask'),
                }}
            />
            <Stack.Screen
                name="github/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('tabs.github'),
                }}
            />
            <Stack.Screen
                name="inbox/notice/[id]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('feed.noticeDetail'),
                }}
            />
            <Stack.Screen
                name="settings/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('settings.title'),
                    headerRight: isCustomServer
                        ? () => (
                            <TouchableOpacity
                                onPress={() => router.push('/server')}
                                style={{ paddingHorizontal: 16 }}
                            >
                                <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
                            </TouchableOpacity>
                        )
                        : undefined,
                }}
            />
            <Stack.Screen
                name="session/[id]"
                options={{
                    headerShown: true,
                }}
            />
            <Stack.Screen
                name="session/[id]/message/[messageId]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('common.message')
                }}
            />
            <Stack.Screen
                name="session/[id]/info"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('sessionInfo.title'),
                }}
            />
            <Stack.Screen
                name="session/[id]/files"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('files.statusTitle'),
                }}
            />
            <Stack.Screen
                name="session/[id]/file"
                options={{
                    headerShown: true,
                    headerTitle: t('common.fileViewer'),
                }}
            />
            <Stack.Screen
                name="session/[id]/browser"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('browser.title'),
                }}
            />
            <Stack.Screen
                name="session/[id]/commits"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('commits.title'),
                }}
            />
            <Stack.Screen
                name="session/[id]/commit"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('commits.title'),
                }}
            />
            <Stack.Screen
                name="session/[id]/status"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('status.title'),
                }}
            />
            <Stack.Screen
                name="session/[id]/edit"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('files.editFileTitle'),
                }}
            />
            <Stack.Screen
                name="session/[id]/preview"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('tools.names.previewHtml'),
                }}
            />
            <Stack.Screen
                name="session/[id]/tool-diff"
                options={{
                    headerShown: true,
                    headerTitle: t('common.fileViewer'),
                }}
            />
            <Stack.Screen
                name="session/[id]/sharing"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('session.sharing.title'),
                }}
            />
            <Stack.Screen
                name="settings/account"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settings.account'),
                }}
            />
            <Stack.Screen
                name="settings/appearance"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settings.appearance'),
                }}
            />
            <Stack.Screen
                name="settings/language"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settingsLanguage.title'),
                }}
            />
            <Stack.Screen
                name="settings/features"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settings.features'),
                }}
            />
            <Stack.Screen
                name="settings/notifications"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settingsNotifications.title'),
                }}
            />
            <Stack.Screen
                name="settings/software-update"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('desktopUpdate.title'),
                }}
            />
            <Stack.Screen
                name="settings/voice"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settings.voiceAssistant'),
                }}
            />
            <Stack.Screen
                name="settings/voice/language"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settingsVoice.preferredLanguage'),
                }}
            />
            <Stack.Screen
                name="settings/voice/voice"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settingsVoice.voiceSelectTitle'),
                }}
            />
            <Stack.Screen
                name="settings/voice/welcome-message"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settingsVoice.welcomeMessage'),
                }}
            />
            <Stack.Screen
                name="terminal/connect"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('navigation.connectTerminal'),
                }}
            />
            <Stack.Screen
                name="terminal/index"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('navigation.connectTerminal'),
                }}
            />
            <Stack.Screen
                name="restore/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: !hideUnauthenticatedWindowsHeader,
                    headerTitle: t('navigation.linkNewDevice'),
                }}
            />
            <Stack.Screen
                name="restore/manual"
                options={{
                    ...softHeaderOptions,
                    headerShown: !hideUnauthenticatedWindowsHeader,
                    headerTitle: t('navigation.restoreWithSecretKey'),
                }}
            />
            <Stack.Screen
                name="changelog"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('navigation.whatsNew'),
                }}
            />
            <Stack.Screen
                name="artifacts/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('artifacts.title'),
                }}
            />
            <Stack.Screen
                name="artifacts/[id]"
                options={{
                    ...softHeaderOptions,
                    headerShown: false, // We'll set header dynamically
                }}
            />
            <Stack.Screen
                name="artifacts/new"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('artifacts.new'),
                }}
            />
            <Stack.Screen
                name="artifacts/edit/[id]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('artifacts.edit'),
                }}
            />
            <Stack.Screen
                name="repos/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('lab.screenTitle'),
                    headerBackTitle: t('common.back'),
                }}
            />

            <Stack.Screen
                name="repos/[owner]/[repo]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="repos/[owner]/[repo]/issues"
                options={({ navigation }) => ({
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('github.issues'),
                    headerBackTitle: t('common.back'),
                    headerRight: () => (
                        <TouchableOpacity
                            onPress={() => navigation.navigate('repos/[owner]/[repo]/issue/new' as never)}
                            style={{ paddingHorizontal: 16 }}
                        >
                            <Text style={{ color: theme.colors.button.primary.tint, fontSize: 16 }}>
                                +
                            </Text>
                        </TouchableOpacity>
                    ),
                })}
            />
            <Stack.Screen
                name="repos/[owner]/[repo]/pulls"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('github.pullRequests'),
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="repos/[owner]/[repo]/pulls/[number]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="repos/[owner]/[repo]/issue/[number]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: '',
                    headerBackTitle: t('common.back'),
                }}
            />
            <Stack.Screen
                name="orchestrator/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('settings.orchestratorRuns'),
                }}
            />
            <Stack.Screen
                name="orchestrator/[runId]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('settings.orchestratorRunDetails'),
                }}
            />
            <Stack.Screen
                name="orchestrator/[runId]/task/[taskId]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('settings.orchestratorTaskDetails'),
                }}
            />
            <Stack.Screen
                name="text-selection"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('textSelection.title'),
                }}
            />
            <Stack.Screen
                name="friends/index"
                options={({ navigation }) => ({
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('navigation.friends'),
                    headerRight: () => (
                        <TouchableOpacity
                            onPress={() => navigation.navigate('friends/search' as never)}
                            style={{ paddingHorizontal: 16 }}
                        >
                            <Text style={{ color: theme.colors.button.primary.tint, fontSize: 16 }}>
                                {t('friends.addFriend')}
                            </Text>
                        </TouchableOpacity>
                    ),
                })}
            />
            <Stack.Screen
                name="friends/search"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('friends.addFriend'),
                }}
            />
            <Stack.Screen
                name="share/[token]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('session.sharing.sharedSession'),
                }}
            />
            <Stack.Screen
                name="user/[id]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="dev/index"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Developer Tools',
                }}
            />

            <Stack.Screen
                name="dev/list-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'List Components Demo',
                }}
            />
            <Stack.Screen
                name="dev/typography"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Typography',
                }}
            />
            <Stack.Screen
                name="dev/colors"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Colors',
                }}
            />
            <Stack.Screen
                name="dev/tools2"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Tool Views Demo',
                }}
            />
            <Stack.Screen
                name="dev/shimmer-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Shimmer View Demo',
                }}
            />
            <Stack.Screen
                name="dev/multi-text-input"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Multi Text Input',
                }}
            />
            <Stack.Screen
                name="dev/toast-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Toast Demo',
                }}
            />
            <Stack.Screen
                name="dev/legend-chat-header"
                options={{
                    ...softHeaderOptions,
                    ...floatingComposerScreenOptions,
                    headerTitle: 'Legend Chat Header',
                }}
            />
            <Stack.Screen
                name="dev/device-info"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Device Info',
                }}
            />
            <Stack.Screen
                name="dev/expo-constants"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Expo Constants',
                }}
            />
            <Stack.Screen
                name="dev/logs"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Logs',
                }}
            />
            <Stack.Screen
                name="dev/messages-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Message Demos',
                }}
            />
            <Stack.Screen
                name="dev/inverted-list"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Inverted List Test',
                }}
            />
            <Stack.Screen
                name="dev/input-styles"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Input Styles',
                }}
            />
            <Stack.Screen
                name="dev/modal-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Modal System',
                }}
            />
            <Stack.Screen
                name="dev/tests"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Unit Tests',
                }}
            />
            <Stack.Screen
                name="dev/unistyles-demo"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Unistyles Demo',
                }}
            />
            <Stack.Screen
                name="dev/qr-test"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'QR Code Test',
                }}
            />
            <Stack.Screen
                name="dev/terminal"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Terminal',
                }}
            />
            <Stack.Screen
                name="dev/terminal-harness"
                options={{
                    ...softHeaderOptions,
                    headerTitle: 'Terminal Harness',
                }}
            />
            <Stack.Screen
                name="settings/desktop-diagnostics"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('desktopDiagnostics.title'),
                }}
            />
            <Stack.Screen
                name="github-callback"
                options={{
                    ...softHeaderOptions,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="session/recent"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('sessionHistory.title'),
                }}
            />
            <Stack.Screen
                name="session/claude"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('claudeHistory.title'),
                }}
            />
            <Stack.Screen
                name="session/history"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('agentHistory.title'),
                }}
            />
            <Stack.Screen
                name="settings/connect/claude"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: 'Connect to Claude',
                    // headerStyle: {
                    //     backgroundColor: Platform.OS === 'web' ? theme.colors.header.background : '#1F1E1C',
                    // },
                    // headerTintColor: Platform.OS === 'web' ? theme.colors.header.tint : '#FFFFFF',
                    // headerTitleStyle: {
                    //     color: Platform.OS === 'web' ? theme.colors.header.tint : '#FFFFFF',
                    // },
                }}
            />
            <Stack.Screen
                name="settings/connect/dootask"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('settings.connectDootask'),
                }}
            />
            <Stack.Screen
                name="dootask/add-task"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('dootask.createTask'),
                }}
            />
            <Stack.Screen
                name="dootask/add-project"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('dootask.createProject'),
                }}
            />
            <Stack.Screen
                name="dootask/[taskId]"
                options={{
                    headerShown: true,
                    headerTitle: t('dootask.taskDetail'),
                }}
            />
            <Stack.Screen
                name="dootask/chat/[dialogId]"
                options={{
                    headerShown: true,
                    headerTitle: t('dootask.chatTitle'),
                }}
            />
            <Stack.Screen
                name="new/pick/machine"
                options={{
                    ...softHeaderOptions,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="new/pick/path"
                options={{
                    ...softHeaderOptions,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="new/index"
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('newSession.title'),
                }}
            />
            <Stack.Screen
                name="machine/[id]/repo/[repoId]"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: t('repoEdit.title'),
                }}
            />
            <Stack.Screen
                name="machine/[id]/repo/script-editor"
                options={{
                    ...softHeaderOptions,
                    headerShown: true,
                    headerTitle: '',
                }}
            />
            <Stack.Screen
                name="scanner"
                options={{
                    headerShown: false,
                    presentation: 'fullScreenModal',
                    animation: 'fade_from_bottom',
                }}
            />
            {/* Every machine's shells, one tab each. `/terminal` is a different
                feature — pairing a device — so this lives under the plural. */}
            <Stack.Screen
                name="terminals/index"
                options={{
                    ...softHeaderOptions,
                    headerShown: !inTerminalWindow,
                    headerTitle: t('terminalSession.title'),
                }}
            />
        </Stack>
    );
}
