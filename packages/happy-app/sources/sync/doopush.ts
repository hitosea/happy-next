import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { DooPushRegisterResult, DooPushVendor } from 'doopush-react-native-sdk';
import {
    detectDooPushAndroidVendor,
    normalizeDooPushVendor,
    resolveConfiguredDooPushAndroidVendor,
    type DooPushAndroidVendor,
} from './doopushVendor';
import {
    acknowledgeReplacedDooPushRegistrationTokens,
    getDooPushRegistrationScope,
    getReplacedDooPushRegistrationTokens,
    isDooPushRegistrationCurrent,
    markDooPushRegistrationCurrent,
} from './doopushRegistrationState';
import { setupDooPushForegroundNotifications } from './doopushForegroundNotifications';

interface RuntimeDooPushConfig {
    appId?: string;
    appKey?: string;
    baseURL?: string;
    androidVendors?: DooPushAndroidVendor[];
}

export interface HappyDooPushRegisterResult extends DooPushRegisterResult {
    replacedTokens?: string[];
}

type DooPushApi = typeof import('doopush-react-native-sdk').DooPush;

let configuredFingerprint: string | null = null;
let dooPushApiPromise: Promise<DooPushApi> | null = null;
let registrationInFlight: Promise<HappyDooPushRegisterResult> | null = null;

function getRuntimeConfig(): RuntimeDooPushConfig {
    return (Constants.expoConfig?.extra?.doopush ?? {}) as RuntimeDooPushConfig;
}

async function getDooPushApi(): Promise<DooPushApi> {
    dooPushApiPromise ??= import('doopush-react-native-sdk').then((module) => module.DooPush);
    return dooPushApiPromise;
}

function isAndroidDevice(): boolean {
    return Device.osName?.toLowerCase() === 'android' || Constants.platform?.android != null;
}

function isIosDevice(): boolean {
    return Device.osName?.toLowerCase() === 'ios' || Constants.platform?.ios != null;
}

function isMobileDevice(): boolean {
    return isAndroidDevice() || isIosDevice();
}

export function getDooPushAndroidVendor(): DooPushAndroidVendor | null {
    if (!isAndroidDevice()) {
        return null;
    }

    return detectDooPushAndroidVendor(Device.brand, Device.manufacturer, Device.modelName);
}

async function configureDooPush(): Promise<{ api: DooPushApi; registrationScope: string } | null> {
    if (!isMobileDevice()) {
        return null;
    }

    const { appId, appKey, baseURL } = getRuntimeConfig();
    if (!appId || !appKey) {
        return null;
    }

    const dooPush = await getDooPushApi();
    const fingerprint = JSON.stringify({ appId, appKey, baseURL: baseURL ?? null });
    if (configuredFingerprint !== fingerprint) {
        dooPush.configure({ appId, appKey, baseURL });
        configuredFingerprint = fingerprint;
    }
    if (isAndroidDevice()) {
        setupDooPushForegroundNotifications(dooPush);
    }
    return {
        api: dooPush,
        registrationScope: getDooPushRegistrationScope(appId, baseURL),
    };
}

/**
 * Register mobile devices through DooPush. iOS uses APNs. On Android, the
 * native SDK selects the best configured OEM channel
 * (HMS/Honor/Xiaomi/OPPO/VIVO/Meizu) and falls back to FCM.
 */
export async function registerDooPushIfSupported(): Promise<HappyDooPushRegisterResult | null> {
    if (!isMobileDevice()) {
        return null;
    }

    const configuredDooPush = await configureDooPush();
    if (!configuredDooPush) {
        return null;
    }
    const { api: dooPush, registrationScope } = configuredDooPush;

    if (registrationInFlight) {
        return registrationInFlight;
    }

    registrationInFlight = (async () => {
        const [cachedToken, cachedDeviceId, nativeDeviceInfo] = await Promise.all([
            dooPush.getDeviceToken().catch(() => null),
            dooPush.getDeviceId().catch(() => null),
            dooPush.getDeviceInfo().catch(() => null),
        ]);

        if (cachedToken && cachedDeviceId) {
            const nativeVendor = normalizeDooPushVendor(nativeDeviceInfo?.channel);
            const configuredVendors = getRuntimeConfig().androidVendors ?? ['fcm'];
            const detectedVendor = getDooPushAndroidVendor() ?? 'fcm';
            const expectedVendor: DooPushVendor = isIosDevice()
                ? 'apns'
                : resolveConfiguredDooPushAndroidVendor(detectedVendor, configuredVendors);

            // Native registration data survives upgrades and token refreshes.
            // Reuse it only when Happy previously synchronized this exact token,
            // device, vendor, and DooPush server/app scope. Otherwise register
            // again so DooPush cannot remain bound to a stale token or app.
            const cachedVendor = nativeVendor ?? expectedVendor;
            if (
                (isIosDevice() || nativeVendor === expectedVendor)
                && isDooPushRegistrationCurrent({
                    scope: registrationScope,
                    token: cachedToken,
                    deviceId: cachedDeviceId,
                    vendor: cachedVendor,
                })
            ) {
                // Persisted state proves only that this installation registered
                // successfully in the past. Reconfirm it with DooPush because an
                // operator may have deleted the server-side device since then.
                const verifiedRegistration = await dooPush.registerWithToken(
                    cachedToken,
                    cachedVendor,
                );
                const registration: DooPushRegisterResult = {
                    token: cachedToken,
                    deviceId: verifiedRegistration.deviceId,
                    vendor: cachedVendor,
                };
                markDooPushRegistrationCurrent({
                    scope: registrationScope,
                    ...registration,
                });
                const replacedTokens = getReplacedDooPushRegistrationTokens(cachedToken);
                return {
                    ...registration,
                    ...(replacedTokens.length > 0 ? { replacedTokens } : {}),
                };
            }
        }

        const registration = await dooPush.register();
        markDooPushRegistrationCurrent({
            scope: registrationScope,
            token: registration.token,
            deviceId: registration.deviceId,
            vendor: registration.vendor,
        }, cachedToken ? [cachedToken] : []);
        const replacedTokens = getReplacedDooPushRegistrationTokens(registration.token);
        return {
            ...registration,
            ...(replacedTokens.length > 0 ? { replacedTokens } : {}),
        };
    })();

    try {
        return await registrationInFlight;
    } finally {
        registrationInFlight = null;
    }
}

export function acknowledgeDooPushTokenCleanup(
    currentToken: string,
    replacedTokens: readonly string[],
): void {
    acknowledgeReplacedDooPushRegistrationTokens(currentToken, replacedTokens);
}
