import { Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { isRunningOnMac } from '@/utils/platform';

/**
 * Puts the page's header over its scroll content and lets iOS 26 paint the "soft" scroll-edge
 * effect where the content slides underneath it. Only iOS (not Catalyst) has that effect, so the
 * fragment is empty on the other platforms — they keep their header untouched (they render the
 * custom JS header from `@/components/navigation/Header` anyway).
 *
 * `headerStyle` has to be repeated here: the root layout's `screenOptions.headerStyle` is opaque
 * and wins over the transparent default that `headerTransparent` would otherwise imply.
 *
 * A page can only opt in while its `headerTitle` is a plain string: UIKit drops both the effect
 * and the subtitle as soon as a custom title view is set (`headerTitle` as a function). Its scroll
 * view must also inset its content (React Native defaults `contentInsetAdjustmentBehavior` to
 * "never", which would leave the first rows hidden behind the header — `ItemList` already handles
 * this, raw `ScrollView`/`FlatList` need `contentInsetAdjustmentBehavior="automatic"`).
 */
export const softHeaderOptions = Platform.OS === 'ios' && !isRunningOnMac()
    ? ({
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        scrollEdgeEffects: { top: 'soft', bottom: 'hidden' },
    } as const)
    : {};

/**
 * How far a page's own fixed rows (filter bars, search fields, toolbars) have to be pushed down
 * from the top so they clear the header once `softHeaderOptions` put it over the content. Zero
 * wherever the header is not over the content.
 *
 * Pages whose whole body is a single scroll view do not need this — UIKit insets the scroll view
 * itself when `contentInsetAdjustmentBehavior` is "automatic".
 */
export function useSoftHeaderInset(): number {
    const headerHeight = useHeaderHeight();
    return Platform.OS === 'ios' && !isRunningOnMac() ? headerHeight : 0;
}
