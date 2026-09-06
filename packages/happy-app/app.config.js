const { createDooPushConfig } = require('./doopush.config');

const variant = process.env.APP_ENV || 'development';
const dooPushConfig = createDooPushConfig({ env: process.env, variant });
const abiFilters = process.env.ABI_FILTERS
    ? process.env.ABI_FILTERS.split(',').map(s => s.trim())
    : undefined;
const name = {
    development: "Happy Next (dev)",
    preview: "Happy Next (pre)",
    production: "Happy Next"
}[variant];
const bundleId = {
    development: "com.hitosea.happy.dev",
    preview: "com.hitosea.happy.preview",
    production: "com.hitosea.happy"
}[variant];

export default {
    expo: {
        name,
        slug: "happy",
        version: (process.env.APP_VERSION || "2.0.0").replace(/^v/, ''),
        runtimeVersion: "18",
        orientation: "default",
        icon: "./sources/assets/images/icon.png",
        scheme: "happy",
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
        notification: {
            icon: "./sources/assets/images/icon-notification.png",
            iosDisplayInForeground: true
        },
        ios: {
            supportsTablet: true,
            bundleIdentifier: bundleId,
            config: {
                usesNonExemptEncryption: false
            },
            infoPlist: {
                // App UI text is localized in JS; declare supported native locales
                // so iOS system menus (Copy/Look Up/Translate) can render in Chinese.
                CFBundleAllowMixedLocalizations: true,
                CFBundleLocalizations: ["en", "zh-Hans", "zh-Hant", "ja"],
                NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations with AI.",
                NSLocalNetworkUsageDescription: "Allow $(PRODUCT_NAME) to find and connect to local devices on your network.",
                NSBonjourServices: ["_http._tcp", "_https._tcp"]
            },
            associatedDomains: ["applinks:app.happy-next.com"]
        },
        android: {
            ...(dooPushConfig.enabled && {
                // Match the DooPush SDK manifest only in builds that link the SDK.
                allowBackup: false,
            }),
            adaptiveIcon: {
                foregroundImage: "./sources/assets/images/icon-adaptive.png",
                monochromeImage: "./sources/assets/images/icon-monochrome.png",
                backgroundColor: "#18171C"
            },
            permissions: [
                "android.permission.RECORD_AUDIO",
                "android.permission.MODIFY_AUDIO_SETTINGS",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.POST_NOTIFICATIONS",
                ...(dooPushConfig.enabled ? [
                    "android.permission.INTERNET",
                    "android.permission.WAKE_LOCK",
                    "android.permission.VIBRATE",
                    "android.permission.RECEIVE_BOOT_COMPLETED",
                    "com.oppo.launcher.permission.READ_SETTINGS",
                    "com.oppo.launcher.permission.WRITE_SETTINGS",
                ] : []),
            ],
            blockedPermissions: [
                "android.permission.ACTIVITY_RECOGNITION",
                "android.permission.QUERY_ALL_PACKAGES",
            ],
            edgeToEdgeEnabled: true,
            package: bundleId,
            googleServicesFile: "./google-services.json",
            intentFilters: [
                {
                    "action": "VIEW",
                    "autoVerify": true,
                    "data": [
                        {
                            "scheme": "https",
                            "host": "app.happy-next.com",
                            "pathPrefix": "/"
                        }
                    ],
                    "category": ["BROWSABLE", "DEFAULT"]
                }
            ]
        },
        web: {
            bundler: "metro",
            output: "single",
            favicon: "./sources/assets/images/favicon.png"
        },
        plugins: [
            require("./plugins/withCIGradleMemory.js"),
            require("./plugins/withEinkCompatibility.js"),
            require("./plugins/withVolcEngineAndroidMaven.js"),
            require("./plugins/withVolcEnginePodsSource.js"),
            require("./plugins/withRNAudioAPIIosFFmpeg.js"),
            [
                require("./plugins/withDooPushAutolinking.js"),
                { enabled: dooPushConfig.enabled },
            ],
            [
                require("./plugins/withDooPushNotificationChannel.js"),
                { enabled: dooPushConfig.enabled },
            ],
            [
                "expo-build-properties",
                {
                    android: {
                        ...(abiFilters && { buildArchs: abiFilters })
                    },
                    ios: {
                        // Disable Expo 54's prebuilt React Native (React.xcframework) so the
                        // Pods target compiles RN core from source. This is what allows the
                        // patch in patches/react-native+0.81.4.patch (RCTEnhancedScrollView.mm)
                        // to actually land in the binary. Trade-off: first iOS build after
                        // pod install is significantly slower; incremental builds are similar.
                        // Workaround for facebook/react-native#54181 (iOS 26 Liquid Glass
                        // scroll-edge fade with inverted FlatList). Remove this once that
                        // upstream issue is fixed and the patch is no longer needed.
                        buildReactNativeFromSource: true
                    }
                }
            ],
            [
                "expo-router",
                {
                    root: "./sources/app"
                }
            ],
            "expo-updates",
            "expo-asset",
            "expo-localization",
            "expo-mail-composer",
            "expo-secure-store",
            "expo-web-browser",
            [
                "react-native-vision-camera",
                {
                    "enableCodeScanner": true
                }
            ],
            "@more-tech/react-native-libsodium",
            "react-native-audio-api",
            "@livekit/react-native-expo-plugin",
            "@config-plugins/react-native-webrtc",
            "react-native-bottom-tabs",
            [
                "expo-audio",
                {
                    microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations."
                }
            ],
            [
                "expo-location",
                {
                    locationAlwaysAndWhenInUsePermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location.",
                    locationAlwaysPermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location.",
                    locationWhenInUsePermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location."
                }
            ],
            [
                "expo-calendar",
                {
                    "calendarPermission": "Allow $(PRODUCT_NAME) to access your calendar to improve AI quality."
                }
            ],
            [
                "expo-camera",
                {
                    cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to scan QR codes and share photos with AI.",
                    microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations.",
                    recordAudioAndroid: true
                }
            ],
            [
                "expo-notifications",
                {
                    "enableBackgroundRemoteNotifications": true,
                    ...(dooPushConfig.enabled && {
                        // This writes Android's native Firebase default-channel
                        // metadata. It does not route delivery through Expo Push.
                        "defaultChannel": "doopush_default_channel",
                    }),
                }
            ],
            ...(dooPushConfig.enabled ? [
                [
                    "doopush-react-native-sdk",
                    dooPushConfig.pluginOptions,
                ],
            ] : []),
            [
                'expo-splash-screen',
                {
                    ios: {
                        image: "./sources/assets/images/splash-ios-light.png",
                        backgroundColor: "#F2F2F7",
                        dark: {
                            image: "./sources/assets/images/splash-ios-dark.png",
                            backgroundColor: "#1C1C1E",
                        }
                    },
                    android: {
                        image: "./sources/assets/images/splash-android-light.png",
                        backgroundColor: "#F5F5F5",
                        dark: {
                            image: "./sources/assets/images/splash-android-dark.png",
                            backgroundColor: "#1e1e1e",
                        }
                    }
                }
            ]
        ],
        updates: {
            url: "https://u.expo.dev/c25469ee-cbd3-483f-b673-d3538c469d9e",
            requestHeaders: {
                "expo-channel-name": "production"
            }
        },
        experiments: {
            typedRoutes: true
        },
        extra: {
            router: {
                root: "./sources/app"
            },
            eas: {
                projectId: "c25469ee-cbd3-483f-b673-d3538c469d9e"
            },
            app: {
                postHogKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY
            },
            doopush: dooPushConfig.runtimeConfig
        },
        owner: "hitosea"
    }
};
