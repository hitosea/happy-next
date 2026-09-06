import type { DooPushVendor } from 'doopush-react-native-sdk';

export type DooPushAndroidVendor = Exclude<DooPushVendor, 'apns'>;

const DOOPUSH_VENDORS = new Set<DooPushVendor>([
    'apns',
    'fcm',
    'hms',
    'honor',
    'xiaomi',
    'oppo',
    'vivo',
    'meizu',
]);

export function normalizeDooPushVendor(value: string | null | undefined): DooPushVendor | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.toLowerCase() as DooPushVendor;
    return DOOPUSH_VENDORS.has(normalized) ? normalized : null;
}

/**
 * Best-effort JS-side vendor inference for cached Android registrations and
 * logging. The native DooPush SDK remains the source of truth and performs the
 * actual channel selection and FCM fallback during registration.
 */
export function detectDooPushAndroidVendor(
    ...identities: Array<string | null | undefined>
): DooPushAndroidVendor {
    const identity = identities
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    if (identity.includes('honor')) {
        return 'honor';
    }

    if (identity.includes('huawei')) {
        return 'hms';
    }

    if (['xiaomi', 'redmi', 'poco', 'blackshark', 'black shark'].some((vendor) => identity.includes(vendor))) {
        return 'xiaomi';
    }

    if (['vivo', 'iqoo'].some((vendor) => identity.includes(vendor))) {
        return 'vivo';
    }

    if (['oppo', 'oneplus', 'realme'].some((vendor) => identity.includes(vendor))) {
        return 'oppo';
    }

    if (['meizu', 'mblu'].some((vendor) => identity.includes(vendor))) {
        return 'meizu';
    }

    return 'fcm';
}

/**
 * Resolve the channel this build can actually use. Brand detection alone is
 * insufficient because OEM credentials are optional and the native SDK falls
 * back to FCM when the matching vendor is not configured.
 */
export function resolveConfiguredDooPushAndroidVendor(
    detectedVendor: DooPushAndroidVendor,
    configuredVendors: readonly DooPushAndroidVendor[],
): DooPushAndroidVendor {
    return configuredVendors.includes(detectedVendor) ? detectedVendor : 'fcm';
}
