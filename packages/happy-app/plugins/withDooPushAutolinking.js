const { withDangerousMod, withSettingsGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DOOPUSH_PACKAGE = 'doopush-react-native-sdk';
const ANDROID_EXCLUDE_LINE = `expoAutolinking.exclude = ['${DOOPUSH_PACKAGE}']`;
const IOS_DEFAULT_CALL = 'use_expo_modules!';
const IOS_EXCLUDED_CALL = `use_expo_modules!(exclude: ['${DOOPUSH_PACKAGE}'])`;

function configureAndroidAutolinking(contents, enabled) {
    const withoutExclude = contents
        .replace(new RegExp(`\\n?\\s*${ANDROID_EXCLUDE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n?`, 'g'), '\n');

    if (enabled) {
        return withoutExclude;
    }

    return withoutExclude.replace(
        /(^|\n)(\s*)expoAutolinking\.useExpoModules\(\)/,
        `$1$2${ANDROID_EXCLUDE_LINE}\n$2expoAutolinking.useExpoModules()`,
    );
}

function configureIosAutolinking(contents, enabled) {
    if (enabled) {
        return contents.replace(IOS_EXCLUDED_CALL, IOS_DEFAULT_CALL);
    }
    return contents.replace(
        new RegExp(`(^|\\n)(\\s*)${IOS_DEFAULT_CALL.replace('!', '\\!')}(?!\\()`),
        `$1$2${IOS_EXCLUDED_CALL}`,
    );
}

module.exports = function withDooPushAutolinking(config, options = {}) {
    const enabled = options.enabled === true;

    config = withSettingsGradle(config, (cfg) => {
        cfg.modResults.contents = configureAndroidAutolinking(cfg.modResults.contents, enabled);
        return cfg;
    });

    return withDangerousMod(config, [
        'ios',
        async (cfg) => {
            const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
            const contents = await fs.promises.readFile(podfilePath, 'utf8');
            const updated = configureIosAutolinking(contents, enabled);
            if (updated !== contents) {
                await fs.promises.writeFile(podfilePath, updated);
            }
            return cfg;
        },
    ]);
};

module.exports.configureAndroidAutolinking = configureAndroidAutolinking;
module.exports.configureIosAutolinking = configureIosAutolinking;
module.exports.DOOPUSH_PACKAGE = DOOPUSH_PACKAGE;
