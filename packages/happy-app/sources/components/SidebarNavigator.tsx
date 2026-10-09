import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { Drawer } from 'expo-router/drawer';
import { useIsTablet } from '@/utils/responsive';
import { sessionHoverCard } from './sessionHoverCardController';
import { SidebarView } from './SidebarView';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useLocalSettingMutable } from '@/sync/storage';
import { isDedicatedTerminalWindow } from '@/terminal/terminalPopupWindow';

const MIN_WEB_SIDEBAR_WIDTH = 250;
const MAX_WEB_SIDEBAR_WIDTH = 800;
const MIN_WEB_MAIN_WIDTH = 480;

function clampSidebarWidth(width: number, windowWidth: number): number {
    const maxWidth = Math.min(MAX_WEB_SIDEBAR_WIDTH, Math.max(MIN_WEB_SIDEBAR_WIDTH, windowWidth - MIN_WEB_MAIN_WIDTH));
    return Math.min(Math.max(Math.round(width), MIN_WEB_SIDEBAR_WIDTH), maxWidth);
}

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    // A terminal window is a shell onto a machine, not somewhere to read
    // conversations, so it carries no session list even where one would fit.
    const showPermanentDrawer = auth.isAuthenticated && isTablet && !isDedicatedTerminalWindow();
    React.useEffect(() => {
        sessionHoverCard.setEnabled(showPermanentDrawer);
        return () => sessionHoverCard.setEnabled(false);
    }, [showPermanentDrawer]);
    const { width: windowWidth } = useWindowDimensions();
    const isWeb = Platform.OS === 'web';
    const [persistedWebSidebarWidth, setPersistedWebSidebarWidth] = useLocalSettingMutable('webSidebarWidth');
    const [liveWebSidebarWidth, setLiveWebSidebarWidth] = React.useState<number | null>(null);
    const drawerWidthRef = React.useRef<number>(280);
    const dragStartWidthRef = React.useRef<number | null>(null);
    const dragStartXRef = React.useRef<number | null>(null);
    const isResizingRef = React.useRef(false);

    const defaultDrawerWidth = React.useMemo(() => {
        return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
    }, [windowWidth]);

    // Calculate drawer width only when needed
    const drawerWidth = React.useMemo(() => {
        if (!showPermanentDrawer) return 280; // Default width for hidden drawer
        if (!isWeb) return defaultDrawerWidth;
        return clampSidebarWidth(liveWebSidebarWidth ?? persistedWebSidebarWidth ?? defaultDrawerWidth, windowWidth);
    }, [defaultDrawerWidth, isWeb, liveWebSidebarWidth, persistedWebSidebarWidth, showPermanentDrawer, windowWidth]);

    React.useEffect(() => {
        drawerWidthRef.current = drawerWidth;
    }, [drawerWidth]);

    const startWebResize = React.useCallback((clientX: number) => {
        if (!isWeb || !showPermanentDrawer || isResizingRef.current) {
            return;
        }

        isResizingRef.current = true;
        dragStartWidthRef.current = drawerWidthRef.current;
        dragStartXRef.current = clientX;

        const handleMove = (event: PointerEvent | MouseEvent) => {
            const startWidth = dragStartWidthRef.current;
            const startX = dragStartXRef.current;
            if (startWidth === null || startX === null) {
                return;
            }
            setLiveWebSidebarWidth(clampSidebarWidth(startWidth + event.clientX - startX, windowWidth));
        };

        const handleEnd = (event: PointerEvent | MouseEvent) => {
            const startWidth = dragStartWidthRef.current;
            const startX = dragStartXRef.current;
            if (startWidth !== null && startX !== null) {
                setPersistedWebSidebarWidth(clampSidebarWidth(startWidth + event.clientX - startX, windowWidth));
            }
            setLiveWebSidebarWidth(null);
            dragStartWidthRef.current = null;
            dragStartXRef.current = null;
            isResizingRef.current = false;

            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleEnd);
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleEnd);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleEnd, { once: true });
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd, { once: true });
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [isWeb, setPersistedWebSidebarWidth, showPermanentDrawer, windowWidth]);

    React.useEffect(() => {
        return () => {
            if (Platform.OS === 'web') {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
            isResizingRef.current = false;
        };
    }, []);

    const drawerNavigationOptions = React.useMemo(() => {
        if (!showPermanentDrawer) {
            // When drawer is hidden, use minimal configuration
            return {
                lazy: false,
                headerShown: false,
                drawerType: 'front' as const,
                swipeEnabled: false,
                drawerStyle: {
                    width: 0,
                    display: 'none' as const,
                },
            };
        }
        
        // When drawer is permanent
        return {
            lazy: false,
            headerShown: false,
            drawerType: 'permanent' as const,
            drawerStyle: {
                // Transparent so the desktop's rounded panel clips its own background, not a white edge.
                backgroundColor: 'transparent',
                borderRightWidth: 0,
                width: drawerWidth,
            },
            swipeEnabled: false,
            drawerActiveTintColor: 'transparent',
            drawerInactiveTintColor: 'transparent',
            drawerItemStyle: { display: 'none' as const },
            drawerLabelStyle: { display: 'none' as const },
        };
    }, [showPermanentDrawer, drawerWidth]);

    // Always render SidebarView but hide it when not needed
    const drawerContent = React.useCallback(
        () => (
            <View style={{ flex: 1 }}>
                <SidebarView sidebarWidth={drawerWidth} />
                {isWeb && (
                    <View
                        {...({
                            onPointerDown: (event: React.PointerEvent) => {
                                event.preventDefault();
                                startWebResize(event.clientX);
                            },
                            onMouseDown: (event: React.MouseEvent) => {
                                event.preventDefault();
                                startWebResize(event.clientX);
                            },
                        } as any)}
                        style={{
                            position: 'absolute',
                            top: 0,
                            right: -4,
                            bottom: 0,
                            width: 8,
                            cursor: 'col-resize',
                            zIndex: 10,
                        } as any}
                    />
                )}
            </View>
        ),
        [drawerWidth, isWeb, startWebResize]
    );

    return (
        <Drawer
            screenOptions={drawerNavigationOptions}
            drawerContent={showPermanentDrawer ? drawerContent : undefined}
        />
    )
});
