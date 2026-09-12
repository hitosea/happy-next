/**
 * DooTask Connect Page
 *
 * A form-based login screen for connecting a DooTask account.
 * Supports email/password login with optional captcha verification.
 * On success, saves the DooTask profile to storage and navigates back.
 */

import React from 'react';
import {
    View,
    Text,
    ScrollView,
    TextInput,
    Pressable,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Image,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { ItemGroup } from '@/components/ItemGroup';
import { QRCode } from '@/components/qr';
import { storage } from '@/sync/storage';
import { loadDooTaskLoginCache, saveDooTaskLoginCache } from '@/sync/persistence';
import { t } from '@/text';
import { dootaskLogin, dootaskGetTokenExpire, dootaskGetCaptcha, dootaskGetQrLoginStatus, syncDootaskToServer } from '@/sync/dootask/api';
import type { DooTaskProfile } from '@/sync/dootask/types';

function ensureHttpsPrefix(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
}

const SERVER_URL_PATTERN = /^(?:https:\/\/(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})|http:\/\/localhost)(?::\d{1,5})?(?:\/[^\s?#]*)?$/i;

function normalizeServerUrl(url: string): string {
    return ensureHttpsPrefix(url).replace(/\/+$/, '');
}

function isValidServerUrl(url: string): boolean {
    return SERVER_URL_PATTERN.test(normalizeServerUrl(url));
}

export default React.memo(function DooTaskConnectPage() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();

    // Form state
    const [loginCache] = React.useState(() => loadDooTaskLoginCache());
    const [serverUrl, setServerUrl] = React.useState(loginCache.serverUrl);
    const [serverUrlValid, setServerUrlValid] = React.useState(() => isValidServerUrl(loginCache.serverUrl));
    const [email, setEmail] = React.useState(loginCache.email);
    const [password, setPassword] = React.useState('');
    const [code, setCode] = React.useState('');
    const [codeNeed, setCodeNeed] = React.useState(false);
    const [codeKey, setCodeKey] = React.useState<string | null>(null);
    const [codeImg, setCodeImg] = React.useState<string | null>(null);
    const [codeLoading, setCodeLoading] = React.useState(false);
    const [loginMode, setLoginMode] = React.useState<'account' | 'qr'>('account');
    const [qrCode, setQrCode] = React.useState<string | null>(null);

    // UI state
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // Cache refs for unmount save (avoids stale closures)
    const serverUrlRef = React.useRef(serverUrl);
    const emailRef = React.useRef(email);
    React.useEffect(() => { serverUrlRef.current = serverUrl; }, [serverUrl]);
    React.useEffect(() => { emailRef.current = email; }, [email]);

    const updateServerUrl = React.useCallback((value: string) => {
        setServerUrl(value);
        setServerUrlValid(false);
        setError(null);
        // Persist every edit, including clearing the field.
        saveDooTaskLoginCache({ serverUrl: value, email: emailRef.current });
    }, []);

    const validateServerUrl = React.useCallback(() => {
        const normalized = normalizeServerUrl(serverUrl);
        if (normalized !== serverUrl) {
            setServerUrl(normalized);
            saveDooTaskLoginCache({ serverUrl: normalized, email: emailRef.current });
        }
        const valid = isValidServerUrl(normalized);
        setServerUrlValid(valid);
        setError(valid || !normalized ? null : t('dootask.errorInvalidUrl'));
        if (!valid) {
            setLoginMode('account');
            setQrCode(null);
        }
        return valid;
    }, [serverUrl]);

    React.useEffect(() => {
        return () => {
            saveDooTaskLoginCache({
                serverUrl: serverUrlRef.current,
                email: emailRef.current,
            });
        };
    }, []);

    const fetchCaptcha = React.useCallback(async () => {
        const trimmedUrl = serverUrl.trim().replace(/\/+$/, '');
        if (!trimmedUrl) return;
        setCodeLoading(true);
        try {
            const captcha = await dootaskGetCaptcha(trimmedUrl);
            setCodeKey(captcha.key);
            setCodeImg(captcha.img);
            setCode('');
        } catch {
            setCodeImg(null);
        } finally {
            setCodeLoading(false);
        }
    }, [serverUrl]);

    const canSubmit = React.useMemo(() => {
        return serverUrlValid && email.trim().length > 0 && password.length > 0;
    }, [serverUrlValid, email, password]);

    const finishLogin = React.useCallback(async (data: any) => {
        const userId = Number(data?.userid);
        if (!data?.token || !Number.isFinite(userId) || userId <= 0) {
            setError(t('dootask.loginFailed'));
            return;
        }
        const profile: DooTaskProfile = {
            serverUrl: normalizeServerUrl(serverUrl),
            token: data.token,
            userId,
            username: data.nickname || data.email || '',
            avatar: data.userimg || null,
            tokenExpiredAt: null,
            tokenRemainingSeconds: null,
            lastCheckedAt: new Date().toISOString(),
        };
        try {
            const expireRes = await dootaskGetTokenExpire(profile.serverUrl, profile.token);
            if (expireRes.ret === 1 && expireRes.data) {
                profile.tokenExpiredAt = expireRes.data.expired_at ?? null;
                profile.tokenRemainingSeconds = expireRes.data.remaining_seconds ?? null;
            }
        } catch {
            // Expiration metadata is optional.
        }
        storage.getState().setDootaskProfile(profile);
        await syncDootaskToServer({
            serverUrl: profile.serverUrl,
            token: profile.token,
            userId: profile.userId,
            username: profile.username,
            avatar: profile.avatar,
        }).catch(() => {});
        router.back();
    }, [router, serverUrl]);

    const handleLogin = React.useCallback(async () => {
        if (!canSubmit || loading || !validateServerUrl()) return;

        setError(null);
        setLoading(true);

        try {
            const result = await dootaskLogin({
                serverUrl: normalizeServerUrl(serverUrl),
                email: email.trim(),
                password,
                code: codeKey ? code : undefined,
                codeKey: codeKey ?? undefined,
            });

            switch (result.type) {
                case 'success': {
                    await finishLogin({ token: result.token, userid: result.userId, nickname: result.username, userimg: result.avatar });
                    break;
                }

                case 'captcha_required': {
                    setCodeNeed(true);
                    setError(result.message || t('dootask.captchaRequired'));
                    fetchCaptcha();
                    break;
                }

                case 'token_expired': {
                    setError(result.message || t('dootask.tokenExpired'));
                    break;
                }

                case 'error': {
                    setError(result.message || t('dootask.loginFailed'));
                    break;
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : t('errors.unknownError'));
        } finally {
            setLoading(false);
        }
    }, [canSubmit, loading, serverUrl, email, password, code, codeKey, fetchCaptcha, finishLogin, validateServerUrl]);

    const refreshQr = React.useCallback(() => {
        if (serverUrlValid) {
            setQrCode(randomUUID().replace(/-/g, ''));
            setError(null);
        }
    }, [serverUrlValid]);

    React.useEffect(() => {
        if (loginMode === 'qr' && serverUrlValid) refreshQr();
        else setQrCode(null);
    }, [loginMode, refreshQr, serverUrlValid]);

    React.useEffect(() => {
        if (loginMode !== 'qr' || !serverUrlValid || !qrCode) return;
        let cancelled = false;
        let polling = false;
        const poll = async () => {
            if (cancelled || polling) return;
            polling = true;
            try {
                const result = await dootaskGetQrLoginStatus(normalizeServerUrl(serverUrl), qrCode);
                if (!cancelled && result.ret === 1 && result.data?.token) {
                    await finishLogin(result.data);
                } else if (!cancelled && result.ret !== -1 && result.msg && result.msg !== 'No identity') {
                    setError(result.msg);
                }
            } catch {
                // Keep polling through transient network failures.
            } finally {
                polling = false;
            }
        };
        poll();
        const timer = setInterval(poll, 2000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [finishLogin, loginMode, qrCode, serverUrl, serverUrlValid]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? Constants.statusBarHeight + headerHeight : 0}
        >
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: safeArea.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
                <ItemGroup>
                    {/* Server URL */}
                    <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>{t('dootask.serverUrl')}</Text>
                        <TextInput
                            style={[styles.fieldInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0, outlineColor: 'transparent' } as any]}
                            value={serverUrl}
                            onChangeText={updateServerUrl}
                            onBlur={validateServerUrl}
                            onSubmitEditing={validateServerUrl}
                            placeholder="https://your-dootask-server.com"
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            textContentType="URL"
                            returnKeyType="done"
                        />
                    </View>
                </ItemGroup>

                {error && !serverUrlValid && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                {serverUrlValid && (
                <>
                    <View style={styles.loginHeader}>
                        <View>
                            <Text style={styles.loginTitle}>{loginMode === 'qr' ? t('dootask.qrLogin') : t('dootask.accountLogin')}</Text>
                            {loginMode === 'qr' && <Text style={styles.loginHint}>{t('dootask.qrLoginHint')}</Text>}
                        </View>
                        <Pressable onPress={() => setLoginMode(loginMode === 'qr' ? 'account' : 'qr')}>
                            <Text style={styles.modeToggle}>{loginMode === 'qr' ? t('dootask.switchToAccount') : t('dootask.switchToQr')}</Text>
                        </Pressable>
                    </View>
                    {loginMode === 'qr' ? (
                        qrCode ? (
                            <Pressable onPress={refreshQr} style={styles.qrContainer} accessibilityLabel={t('dootask.qrRefresh')}>
                                <QRCode data={normalizeServerUrl(serverUrl) + '/login?qrcode=' + qrCode} size={200} />
                            </Pressable>
                        ) : null
                    ) : (
                    <ItemGroup>
                    {/* Email */}
                    <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>{t('dootask.email')}</Text>
                        <TextInput
                            style={[styles.fieldInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0, outlineColor: 'transparent' } as any]}
                            value={email}
                            onChangeText={setEmail}
                            placeholder="your@email.com"
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            textContentType="emailAddress"
                            returnKeyType="next"
                        />
                    </View>
                    {/* Password */}
                    <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>{t('dootask.password')}</Text>
                        <TextInput
                            style={[styles.fieldInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0, outlineColor: 'transparent' } as any]}
                            value={password}
                            onChangeText={setPassword}
                            placeholder={t('dootask.password')}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry
                            textContentType="password"
                            returnKeyType={codeNeed ? 'next' : 'go'}
                            onSubmitEditing={codeNeed ? undefined : handleLogin}
                        />
                    </View>
                    {/* Captcha Code (conditional) */}
                    {codeNeed && (
                        <View style={styles.fieldRow}>
                            <Text style={styles.fieldLabel}>{t('dootask.captchaRequired')}</Text>
                            <View style={styles.captchaRow}>
                                <TextInput
                                    style={[styles.fieldInput, styles.captchaInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0, outlineColor: 'transparent' } as any]}
                                    value={code}
                                    onChangeText={setCode}
                                    placeholder={t('dootask.captchaPlaceholder')}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="default"
                                    returnKeyType="go"
                                    onSubmitEditing={handleLogin}
                                />
                                <Pressable onPress={fetchCaptcha} style={styles.captchaImageWrapper}>
                                    {codeLoading ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : codeImg ? (
                                        <Image source={{ uri: codeImg }} style={styles.captchaImage} resizeMode="contain" />
                                    ) : (
                                        <Text style={styles.captchaError}>{t('dootask.captchaLoadFailed')}</Text>
                                    )}
                                </Pressable>
                            </View>
                        </View>
                    )}
                </ItemGroup>
                    )}

                {/* Error Message */}
                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                {/* Submit Button */}
                <Pressable
                    style={[styles.submitButton, (!canSubmit || loading) && styles.submitButtonDisabled]}
                    onPress={handleLogin}
                    disabled={!canSubmit || loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.colors.button.primary.tint} />
                    ) : (
                        <Text style={styles.submitButtonText}>{t('dootask.connect')}</Text>
                    )}
                </Pressable>
                </>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    fieldRow: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    fieldLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 2,
        ...Typography.default('regular'),
    },
    fieldInput: {
        fontSize: 17,
        lineHeight: 22,
        color: theme.colors.text,
        paddingVertical: Platform.select({ ios: 4, default: 2 }),
        padding: 0,
        ...Typography.default(),
    },
    captchaRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    captchaInput: {
        flex: 1,
    },
    captchaImageWrapper: {
        height: 36,
        width: 100,
        marginLeft: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.groupped.background,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    captchaImage: {
        width: 100,
        height: 36,
    },
    captchaError: {
        fontSize: 11,
        color: theme.colors.textDestructive,
        ...Typography.default('regular'),
    },
    loginHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 25,
        paddingBottom: 8,
    },
    loginTitle: {
        color: theme.colors.text,
        fontSize: 18,
        ...Typography.default('semiBold'),
    },
    loginHint: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        marginTop: 4,
        ...Typography.default('regular'),
    },
    modeToggle: {
        color: theme.colors.textLink,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    qrContainer: {
        alignItems: 'center',
        paddingVertical: 16,
    },
    errorContainer: {
        marginHorizontal: 16,
        marginTop: 12,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.textDestructive,
        textAlign: 'center',
        ...Typography.default(),
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        marginHorizontal: 16,
        marginTop: 24,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        height: 50,
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 17,
        ...Typography.default('semiBold'),
    },
}));
