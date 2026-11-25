import * as React from 'react';
import { View, Pressable, type LayoutChangeEvent } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { SearchField } from '@/components/SearchField';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useSharedValue } from 'react-native-reanimated';
import { useSessionListScope } from '@/hooks/useSessionListScope';
import { createInitialScrollHandlersHook } from '@/hooks/bottomSheetInitialScroll';
import { SessionScopeDot } from './SessionScopeDot';
import { MACHINE_AVATAR_COLORS, MACHINE_AVATAR_ICONS, resolveMachineAvatar } from './MachineAvatar';
import { useMachine, useSetting } from '@/sync/storage';
import { getMachineUpdates } from '@/utils/cliUpdate';
import { CliUpdateIcon } from './CliUpdateIndicator';
import { liquidGlassAvailable } from './GlassSurface';
import { sheetFill, sheetSafeAreaBottom } from './glassSheet';
import { filterMachineGroups, type SessionListSelection, type SessionScopeDot as Dot } from './sessionListScope';


type SwitcherItemProps = {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    // A machine's avatar color: the tile takes it and the glyph turns white.
    tint?: string;
    name: string;
    meta: string;
    selected: boolean;
    online?: boolean;
    dot?: Dot;
    // A machine's row shows its CLI update, as the header does once it is picked
    machineId?: string;
    onPress: () => void;
    onLayout?: (event: LayoutChangeEvent) => void;
};

const SwitcherItem = React.memo(({ icon, tint, name, meta, selected, online, dot = 'none', machineId, onPress, onLayout }: SwitcherItemProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${name}, ${meta}`}
            onPress={onPress}
            onLayout={selected ? onLayout : undefined}
            style={({ pressed }) => [styles.item, (selected || pressed) && styles.itemSelected]}
        >
            <View style={[styles.itemIcon, tint !== undefined && { backgroundColor: tint }]}>
                <Ionicons name={icon} size={18} color={tint !== undefined ? '#FFFFFF' : theme.colors.textSecondary} />
                {online !== undefined && (
                    <View style={[styles.onlineDot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.textSecondary }]} />
                )}
            </View>
            <View style={styles.itemCopy}>
                <View style={styles.itemNameRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{name}</Text>
                    <SessionScopeDot dot={dot} size={7} />
                </View>
                <Text style={styles.itemMeta} numberOfLines={1}>{meta}</Text>
            </View>
            {machineId && <MachineCliUpdateIcon machineId={machineId} />}
            <View style={styles.itemCheck}>
                {selected && <Ionicons name="checkmark" size={18} color={theme.colors.status.connected} />}
            </View>
        </Pressable>
    );
});

const MachineCliUpdateIcon = React.memo(({ machineId }: { machineId: string }) => {
    const update = getMachineUpdates(useMachine(machineId));
    return <CliUpdateIcon update={update} size={20} />;
});

/**
 * The phone's machine switcher, opened from the session list's title: pick "All machines", one
 * machine, or a sharing view. Search shows once there is more than one machine; "Add machine" is
 * always there, so the sheet is also the way to connect the first or the next machine.
 */
export const MachineSwitcherSheet = React.memo(React.forwardRef<BottomSheetModal, { onAddMachine: () => void }>(({ onAddMachine }, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const scope = useSessionListScope();
    const [search, setSearch] = React.useState('');

    const machineAvatars = useSetting('machineAvatars');
    const machines = scope.groups.filter(group => !group.unknown);
    const filtered = filterMachineGroups(scope.groups, search);
    const keyword = search.trim();
    const onlineCount = machines.filter(group => group.online).length;
    const hasShares = scope.hasShared || scope.hasSharedByMe;
    const searchable = machines.length > 1;

    const dismiss = React.useCallback(() => {
        if (ref && typeof ref === 'object') ref.current?.dismiss();
    }, [ref]);
    const select = React.useCallback((selection: SessionListSelection) => {
        scope.setSelection(selection);
        dismiss();
    }, [scope.setSelection, dismiss]);
    const addMachine = React.useCallback(() => {
        dismiss();
        onAddMachine();
    }, [dismiss, onAddMachine]);

    // Opening the sheet brings the selected row into view, so a machine far down a long list is not
    // hidden below the fold. The sheet mounts its content on every present; as soon as both the
    // scroll viewport and the selected row are laid out — before the sheet has slid in — the list is
    // put there directly, with the bottom-sheet's scroll lock told to hold that offset.
    const viewportHeightRef = React.useRef(0);
    const selectedRowRef = React.useRef<{ y: number; height: number } | null>(null);
    const revealedRef = React.useRef(false);
    const initialOffsetY = useSharedValue(0);
    const scrollEventsHandlersHook = React.useMemo(() => createInitialScrollHandlersHook(initialOffsetY), [initialOffsetY]);
    const revealSelected = React.useCallback(() => {
        const row = selectedRowRef.current;
        const viewportHeight = viewportHeightRef.current;
        if (revealedRef.current || !row || viewportHeight <= 0) return;
        revealedRef.current = true;
        if (row.y + row.height <= viewportHeight) return;
        initialOffsetY.value = Math.max(0, row.y + row.height / 2 - viewportHeight / 2);
    }, [initialOffsetY]);
    const handleViewportLayout = React.useCallback((event: LayoutChangeEvent) => {
        viewportHeightRef.current = event.nativeEvent.layout.height;
        revealSelected();
    }, [revealSelected]);
    const handleSelectedLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        selectedRowRef.current = { y, height };
        revealSelected();
    }, [revealSelected]);
    const handleDismiss = React.useCallback(() => {
        setSearch('');
        revealedRef.current = false;
        selectedRowRef.current = null;
        viewportHeightRef.current = 0;
        initialOffsetY.value = 0;
    }, [initialOffsetY]);


    const sessionsMeta = (count: number) => t('sessionScope.sessionCount', { count });
    const summary = !machines.length
        ? t('sessionScope.noMachinesYet')
        : keyword
            ? t('sessionScope.searchSummary', { count: filtered.length, total: machines.length })
            : t('sessionScope.machineSummary', { total: machines.length, online: onlineCount });

    return (
        <AppBottomSheet
            ref={ref}
            snapPoints={[searchable || hasShares ? '70%' : '42%']}
            enableDynamicSizing={false}
            onDismiss={handleDismiss}
        >
            <View style={styles.container}>
                <View style={styles.heading}>
                    <Text style={styles.title}>{t('sessionScope.switchMachine')}</Text>
                    <Pressable
                        onPress={dismiss}
                        hitSlop={8}
                        style={styles.close}
                        accessibilityRole="button"
                        accessibilityLabel={t('sessionScope.close')}
                    >
                        <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

                {searchable && (
                    <SearchField
                        inSheet
                        value={search}
                        onChangeText={setSearch}
                        placeholder={t('sessionScope.searchMachines')}
                        style={styles.search}
                    />
                )}
                <Text style={styles.summary}>{summary}</Text>

                <BottomSheetScrollView
                    scrollEventsHandlersHook={scrollEventsHandlersHook}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.items}
                    onLayout={handleViewportLayout}
                >
                    {(scope.switchable && !keyword) && (
                        <SwitcherItem
                            onLayout={handleSelectedLayout}
                            icon="grid-outline"
                            name={t('sessionScope.allMachines')}
                            meta={t('sessionScope.allMachinesHint')}
                            selected={scope.selection === 'all'}
                            onPress={() => select('all')}
                        />
                    )}
                    {machines.length > 1 && filtered.length > 0 && !keyword && (
                        <Text style={styles.section}>{t('sessionScope.machinesSection')}</Text>
                    )}
                    {filtered.map(group => {
                        const avatar = resolveMachineAvatar(machineAvatars, group.id);
                        return (
                            <SwitcherItem
                                onLayout={handleSelectedLayout}
                                key={group.id}
                                icon={avatar ? MACHINE_AVATAR_ICONS[avatar.icon] : 'desktop-outline'}
                                tint={avatar ? MACHINE_AVATAR_COLORS[avatar.color] : undefined}
                                name={group.name}
                                meta={`${group.online ? t('status.online') : t('status.offline')} · ${sessionsMeta(group.sessions.length)}`}
                                online={group.online}
                                dot={group.dot}
                                machineId={group.id}
                                // With a single machine there is nothing to switch to; it is the whole list.
                                selected={scope.switchable ? scope.selection === group.id : true}
                                onPress={() => select(scope.switchable ? group.id : 'all')}
                            />
                        );
                    })}
                    {keyword && filtered.length === 0 && (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>{t('sessionScope.noMatchingMachines')}</Text>
                            <Pressable onPress={() => setSearch('')} hitSlop={8}>
                                <Text style={styles.emptyAction}>{t('sessionScope.clearSearch')}</Text>
                            </Pressable>
                        </View>
                    )}
                    {!keyword && machines.length === 0 && (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>{t('sessionScope.noMachinesYet')}</Text>
                            <Text style={styles.emptyText}>{t('sessionScope.noMachinesHint')}</Text>
                        </View>
                    )}
                    {!keyword && hasShares && (
                        <>
                            <Text style={styles.section}>{t('sessionScope.sharingSection')}</Text>
                            {scope.hasShared && (
                                <SwitcherItem
                                    onLayout={handleSelectedLayout}
                                    icon="people-outline"
                                    name={t('session.sharing.sharedWithMeSessions')}
                                    meta={sessionsMeta(scope.sharedSessions.length)}
                                    dot={scope.sharedDot}
                                    selected={scope.selection === 'shared'}
                                    onPress={() => select('shared')}
                                />
                            )}
                            {scope.hasSharedByMe && (
                                <SwitcherItem
                                    onLayout={handleSelectedLayout}
                                    icon="share-outline"
                                    name={t('session.sharing.sharedByMeSessions')}
                                    meta={sessionsMeta(scope.sharedByMeSessions.length)}
                                    dot={scope.sharedByMeDot}
                                    selected={scope.selection === 'sharedByMe'}
                                    onPress={() => select('sharedByMe')}
                                />
                            )}
                        </>
                    )}
                </BottomSheetScrollView>

                <View style={[styles.footer, { paddingBottom: Math.max(sheetSafeAreaBottom(safeArea.bottom), 12) }]}>
                    <Pressable
                        onPress={addMachine}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
                    >
                        <Ionicons name="add" size={18} color={theme.colors.text} />
                        <Text style={styles.addText}>{t('sessionScope.addMachine')}</Text>
                    </Pressable>
                </View>
            </View>
        </AppBottomSheet>
    );
}));

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingBottom: 12,
    },
    title: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    close: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: sheetFill(theme.colors.surface),
    },
    search: {
        marginHorizontal: 16,
        marginBottom: 8,
    },
    summary: {
        paddingHorizontal: 18,
        paddingBottom: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    items: {
        paddingBottom: 12,
    },
    section: {
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 62,
        paddingHorizontal: 18,
        paddingVertical: 10,
    },
    itemSelected: {
        backgroundColor: sheetFill(theme.colors.surface),
    },
    itemIcon: {
        width: 32,
        height: 32,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: sheetFill(theme.colors.surfaceHighest),
    },
    onlineDot: {
        position: 'absolute',
        right: -2,
        bottom: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        // The ring is the sheet's color, cut out of the tile; glass has no color to cut it in.
        borderWidth: liquidGlassAvailable ? 0 : 2,
        borderColor: theme.colors.groupped.background,
    },
    itemCopy: {
        flex: 1,
        minWidth: 0,
    },
    itemNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    itemName: {
        flexShrink: 1,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    itemMeta: {
        marginTop: 2,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    itemCheck: {
        width: 20,
        alignItems: 'center',
    },
    empty: {
        alignItems: 'center',
        paddingVertical: 32,
        paddingHorizontal: 24,
        gap: 6,
    },
    emptyTitle: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    emptyText: {
        fontSize: 13,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    emptyAction: {
        fontSize: 13,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
    footer: {
        paddingTop: 8,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 44,
        borderRadius: 12,
        backgroundColor: sheetFill(theme.colors.surface),
    },
    addText: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
}));
