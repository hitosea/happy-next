// On Android, openAuthSessionAsync does not fully intercept the redirect URL
// at the OS level (unlike iOS's ASWebAuthenticationSession). The deep link is
// delivered to both the auth session handler AND Expo Router simultaneously.
//
// By placing this file inside the (app) group, it shares the same Stack
// navigator as the Settings page. When Expo Router pushes this screen on top
// of [Home, Settings], router.back() correctly pops back to Settings.
//
// On iOS this route is never reached.

import { useRouter } from 'expo-router';
import { useEffect } from 'react';

export default function GitHubCallback() {
    const router = useRouter();
    useEffect(() => {
        router.back();
    }, []);
    return null;
}
