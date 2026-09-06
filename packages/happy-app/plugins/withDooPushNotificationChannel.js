const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const FIREBASE_DEFAULT_NOTIFICATION_CHANNEL =
    'com.google.firebase.messaging.default_notification_channel_id';
const DOOPUSH_DEFAULT_NOTIFICATION_CHANNEL = 'doopush_default_channel';

/**
 * Both expo-notifications and the DooPush Android SDK declare Firebase's
 * default notification channel metadata. Keep the host application's channel
 * authoritative so Android's manifest merger does not reject the two values.
 */
module.exports = function withDooPushNotificationChannel(config, options = {}) {
    return withAndroidManifest(config, (cfg) => {
        if (options.enabled !== true) {
            return cfg;
        }
        const application = AndroidConfig.Manifest.getMainApplication(cfg.modResults);
        if (!application) {
            return cfg;
        }

        const metadata = application['meta-data'] ?? [];
        let defaultChannel = metadata.find(
            (entry) => entry.$?.['android:name'] === FIREBASE_DEFAULT_NOTIFICATION_CHANNEL,
        );

        if (!defaultChannel) {
            defaultChannel = {
                $: {
                    'android:name': FIREBASE_DEFAULT_NOTIFICATION_CHANNEL,
                    'android:value': DOOPUSH_DEFAULT_NOTIFICATION_CHANNEL,
                },
            };
            metadata.push(defaultChannel);
            application['meta-data'] = metadata;
        } else {
            defaultChannel.$['android:value'] = DOOPUSH_DEFAULT_NOTIFICATION_CHANNEL;
        }

        AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
        defaultChannel.$['tools:replace'] = 'android:value';
        return cfg;
    });
};
