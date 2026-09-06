import { randomUUID } from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';

const installationStorage = new MMKV({ id: 'push-installation' });
const INSTALLATION_ID_KEY = 'id';

export function getPushInstallationId(): string {
    const storedId = installationStorage.getString(INSTALLATION_ID_KEY);
    if (storedId) {
        return storedId;
    }

    const installationId = randomUUID();
    installationStorage.set(INSTALLATION_ID_KEY, installationId);
    return installationId;
}
