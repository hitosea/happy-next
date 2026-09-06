const DEFAULT_DOOPUSH_BASE_URL = "https://doopush.com/api/v1";

function resolveBaseURL(env) {
    return (env.EXPO_PUBLIC_DOOPUSH_BASE_URL?.trim() || DEFAULT_DOOPUSH_BASE_URL).replace(/\/+$/, "");
}

function createVendorConfig({ servicesFile, servicesFileKey = "servicesFile", credentials }) {
    if (servicesFile) {
        return { [servicesFileKey]: servicesFile };
    }

    if (credentials && Object.values(credentials).every(Boolean)) {
        return credentials;
    }

    return undefined;
}

function createHonorConfig(env) {
    const servicesFile = env.DOOPUSH_HONOR_MCS_SERVICES_FILE;
    if (servicesFile) {
        return { mcsServicesFile: servicesFile };
    }

    if (env.DOOPUSH_HONOR_APP_ID && env.DOOPUSH_HONOR_DEVELOPER_ID) {
        return {
            appId: env.DOOPUSH_HONOR_APP_ID,
            developerId: env.DOOPUSH_HONOR_DEVELOPER_ID,
        };
    }

    if (env.DOOPUSH_HONOR_CLIENT_ID && env.DOOPUSH_HONOR_CLIENT_SECRET) {
        return {
            clientId: env.DOOPUSH_HONOR_CLIENT_ID,
            clientSecret: env.DOOPUSH_HONOR_CLIENT_SECRET,
        };
    }

    return undefined;
}

function createAndroidVendors(env) {
    const optionalVendors = {
        hms: env.DOOPUSH_HMS_AGCONNECT_SERVICES_FILE
            ? { agconnectServicesFile: env.DOOPUSH_HMS_AGCONNECT_SERVICES_FILE }
            : undefined,
        honor: createHonorConfig(env),
        xiaomi: createVendorConfig({
            servicesFile: env.DOOPUSH_XIAOMI_SERVICES_FILE,
            credentials: {
                appId: env.DOOPUSH_XIAOMI_APP_ID,
                appKey: env.DOOPUSH_XIAOMI_APP_KEY,
            },
        }),
        oppo: createVendorConfig({
            servicesFile: env.DOOPUSH_OPPO_SERVICES_FILE,
            credentials: {
                appKey: env.DOOPUSH_OPPO_APP_KEY,
                appSecret: env.DOOPUSH_OPPO_APP_SECRET,
            },
        }),
        vivo: createVendorConfig({
            servicesFile: env.DOOPUSH_VIVO_SERVICES_FILE,
            credentials: {
                appId: env.DOOPUSH_VIVO_APP_ID,
                apiKey: env.DOOPUSH_VIVO_API_KEY,
            },
        }),
        meizu: createVendorConfig({
            servicesFile: env.DOOPUSH_MEIZU_SERVICES_FILE,
            credentials: {
                appId: env.DOOPUSH_MEIZU_APP_ID,
                appKey: env.DOOPUSH_MEIZU_APP_KEY,
            },
        }),
    };

    return {
        fcm: {
            googleServicesFile: env.DOOPUSH_FCM_GOOGLE_SERVICES_FILE || "./google-services.json",
        },
        ...Object.fromEntries(
            Object.entries(optionalVendors).filter(([, config]) => config)
        ),
    };
}

function resolveIosMode(env, variant) {
    const defaultMode = env.EAS_BUILD_PROFILE
        ? (env.EAS_BUILD_PROFILE === "development" ? "development" : "production")
        : (variant === "development" ? "development" : "production");
    const mode = env.DOOPUSH_IOS_MODE || defaultMode;

    if (mode !== "development" && mode !== "production") {
        throw new Error("DOOPUSH_IOS_MODE must be either development or production");
    }

    return mode;
}

function createDooPushConfig({ env, variant }) {
    const appId = env.EXPO_PUBLIC_DOOPUSH_APP_ID;
    const appKey = env.EXPO_PUBLIC_DOOPUSH_APP_KEY;
    const baseURL = resolveBaseURL(env);
    const androidVendors = createAndroidVendors(env);

    return {
        enabled: Boolean(appId && appKey),
        pluginOptions: {
            appId,
            appKey,
            baseURL,
            ios: {
                mode: resolveIosMode(env, variant),
            },
            android: {
                vendors: androidVendors,
            },
        },
        runtimeConfig: {
            appId,
            appKey,
            baseURL,
            androidVendors: Object.keys(androidVendors),
        },
    };
}

module.exports = {
    createDooPushConfig,
};
