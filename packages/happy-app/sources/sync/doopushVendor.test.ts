import { describe, expect, it } from 'vitest';
import {
    detectDooPushAndroidVendor,
    normalizeDooPushVendor,
    resolveConfiguredDooPushAndroidVendor,
} from './doopushVendor';

describe('detectDooPushAndroidVendor', () => {
    it.each([
        ['HUAWEI', 'Huawei', 'hms'],
        ['HONOR', 'Honor', 'honor'],
        ['Xiaomi', 'Xiaomi', 'xiaomi'],
        ['Redmi', 'Xiaomi', 'xiaomi'],
        ['POCO', 'Xiaomi', 'xiaomi'],
        ['vivo', 'vivo', 'vivo'],
        ['iQOO', 'vivo', 'vivo'],
        ['OPPO', 'OPPO', 'oppo'],
        ['OnePlus', 'OnePlus', 'oppo'],
        ['realme', 'realme', 'oppo'],
        ['MEIZU', 'Meizu', 'meizu'],
        ['mblu', 'Meizu', 'meizu'],
        ['Google', 'Google', 'fcm'],
        ['Samsung', 'Samsung', 'fcm'],
    ] as const)('maps %s/%s to %s', (brand, manufacturer, expected) => {
        expect(detectDooPushAndroidVendor(brand, manufacturer)).toBe(expected);
    });

    it('falls back to FCM when manufacturer information is unavailable', () => {
        expect(detectDooPushAndroidVendor(null, undefined)).toBe('fcm');
    });
});

describe('normalizeDooPushVendor', () => {
    it.each(['apns', 'fcm', 'hms', 'honor', 'xiaomi', 'oppo', 'vivo', 'meizu'] as const)(
        'accepts %s',
        (vendor) => {
            expect(normalizeDooPushVendor(vendor)).toBe(vendor);
        },
    );

    it('normalizes case and rejects unknown channels', () => {
        expect(normalizeDooPushVendor('APNS')).toBe('apns');
        expect(normalizeDooPushVendor('unknown')).toBeNull();
        expect(normalizeDooPushVendor(undefined)).toBeNull();
    });
});

describe('resolveConfiguredDooPushAndroidVendor', () => {
    it('uses the detected OEM channel when this build configured it', () => {
        expect(resolveConfiguredDooPushAndroidVendor('honor', ['fcm', 'honor'])).toBe('honor');
    });

    it('falls back to FCM when the detected OEM channel is not configured', () => {
        expect(resolveConfiguredDooPushAndroidVendor('hms', ['fcm', 'oppo'])).toBe('fcm');
    });
});
