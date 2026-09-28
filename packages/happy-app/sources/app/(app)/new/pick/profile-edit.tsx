import React from 'react';
import { View, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useUnistyles } from 'react-native-unistyles';
import { useHeaderHeight } from '@react-navigation/elements';
import Constants from 'expo-constants';
import { t } from '@/text';
import { ProfileEditForm } from '@/components/ProfileEditForm';
import { AIBackendProfile } from '@/sync/settings';
import { layout } from '@/components/layout';
import { callbacks } from '../index';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions } from '@/components/navigation/softHeader';

export default function ProfileEditScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const params = useLocalSearchParams<{ profileData?: string; machineId?: string }>();
    const screenWidth = useWindowDimensions().width;
    const headerHeight = useHeaderHeight();
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();

    // Deserialize profile from URL params
    const profile: AIBackendProfile = React.useMemo(() => {
        if (params.profileData) {
            try {
                return JSON.parse(decodeURIComponent(params.profileData));
            } catch (error) {
                console.error('Failed to parse profile data:', error);
            }
        }
        // Return empty profile for new profile creation
        return {
            id: '',
            name: '',
            anthropicConfig: {},
            environmentVariables: [],
            compatibility: { claude: true, codex: true, gemini: true, qoder: true },
            isBuiltIn: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: '1.0.0',
        };
    }, [params.profileData]);

    const handleSave = (savedProfile: AIBackendProfile) => {
        // Call the callback to notify wizard of saved profile
        callbacks.onProfileSaved(savedProfile);
        router.back();
    };

    const handleCancel = () => {
        router.back();
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? Constants.statusBarHeight + headerHeight : 0}
            enabled={!useNativeSoftHeader}
            style={profileEditScreenStyles.container}
        >
            <Stack.Screen
                options={{
                    ...softHeaderOptions,
                    headerTitle: profile.name ? t('profiles.editProfile') : t('profiles.addProfile'),
                }}
            />
            <View style={[
                { flex: 1, paddingHorizontal: screenWidth > 700 ? 16 : 8 }
            ]}>
                <View style={[
                    { maxWidth: layout.maxWidth, flex: 1, width: '100%', alignSelf: 'center' }
                ]}>
                    <ProfileEditForm
                        profile={profile}
                        machineId={params.machineId || null}
                        onSave={handleSave}
                        onCancel={handleCancel}
                        nativeScrollInsets={useNativeSoftHeader}
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

const profileEditScreenStyles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        paddingTop: Platform.OS === 'web' ? rt.insets.top : 0,
        paddingBottom: rt.insets.bottom,
    },
}));
