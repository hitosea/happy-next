import { describe, expect, it } from 'vitest';

const { createDooPushConfig } = require('../../doopush.config.js') as {
    createDooPushConfig: (options: {
        env: Record<string, string | undefined>;
        variant: string;
    }) => {
        enabled: boolean;
        pluginOptions: { appKey?: string; baseURL: string };
        runtimeConfig: { appKey?: string; baseURL: string };
    };
};
const {
    configureAndroidAutolinking,
    configureIosAutolinking,
    DOOPUSH_PACKAGE,
} = require('../../plugins/withDooPushAutolinking.js') as {
    configureAndroidAutolinking: (contents: string, enabled: boolean) => string;
    configureIosAutolinking: (contents: string, enabled: boolean) => string;
    DOOPUSH_PACKAGE: string;
};

describe('DooPush build config', () => {
    it('uses the public self-hosted base URL for native and runtime config', () => {
        const config = createDooPushConfig({
            env: { EXPO_PUBLIC_DOOPUSH_BASE_URL: ' https://push.example.com/api/v1/// ' },
            variant: 'production',
        });

        expect(config.pluginOptions.baseURL).toBe('https://push.example.com/api/v1');
        expect(config.runtimeConfig.baseURL).toBe('https://push.example.com/api/v1');
    });

    it('defaults to the DooPush cloud API', () => {
        const config = createDooPushConfig({ env: {}, variant: 'production' });
        expect(config.runtimeConfig.baseURL).toBe('https://doopush.com/api/v1');
    });

    it('uses the public App Key and enables the native integration only with both identifiers', () => {
        const config = createDooPushConfig({
            env: {
                EXPO_PUBLIC_DOOPUSH_APP_ID: 'app-1',
                EXPO_PUBLIC_DOOPUSH_APP_KEY: 'dp_ak_test',
            },
            variant: 'production',
        });

        expect(config.enabled).toBe(true);
        expect(config.pluginOptions.appKey).toBe('dp_ak_test');
        expect(config.runtimeConfig.appKey).toBe('dp_ak_test');
    });

    it('excludes the native module from Android autolinking when disabled', () => {
        const settings = 'plugins {}\nexpoAutolinking.useExpoModules()\n';
        const disabled = configureAndroidAutolinking(settings, false);

        expect(disabled).toContain(`expoAutolinking.exclude = ['${DOOPUSH_PACKAGE}']`);
        expect(configureAndroidAutolinking(disabled, false)).toBe(disabled);
        expect(configureAndroidAutolinking(disabled, true)).toBe(settings);
    });

    it('excludes the native module from iOS autolinking when disabled', () => {
        const podfile = "target 'HappyNext' do\n  use_expo_modules!\nend\n";
        const disabled = configureIosAutolinking(podfile, false);

        expect(disabled).toContain(`use_expo_modules!(exclude: ['${DOOPUSH_PACKAGE}'])`);
        expect(configureIosAutolinking(disabled, false)).toBe(disabled);
        expect(configureIosAutolinking(disabled, true)).toBe(podfile);
    });
});
