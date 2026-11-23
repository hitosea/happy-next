import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import type { PendingMessage } from '@/sync/storageTypes';

const sheet = vi.hoisted(() => ({ present: vi.fn(), dismiss: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Octicons: 'Icon', Ionicons: 'Icon' }));
vi.mock('@gorhom/bottom-sheet', () => ({
    BottomSheetView: 'SheetView', BottomSheetScrollView: 'SheetScroll', BottomSheetTextInput: 'Input',
}));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text',
    TextInput: 'Input', View: 'View', useWindowDimensions: () => ({ height: 800 }),
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: () => ({}) },
    useUnistyles: () => ({ theme: { dark: false, colors: { surface: '#fff', groupped: { background: '#eee' } } } }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@/components/AppBottomSheet', () => ({
    AppBottomSheet: React.forwardRef((props: { children: React.ReactNode }, ref) => {
        React.useImperativeHandle(ref, () => sheet);
        return React.createElement('Sheet', null, props.children);
    }),
}));
vi.mock('@/components/ScheduleMessageSheet', () => ({ ScheduleMessageSheet: 'ScheduleForm' }));
vi.mock('@/components/SelectableTextView', () => ({ SelectableTextView: 'Preview' }));
vi.mock('@/components/Toast', () => ({ showCopiedToast: vi.fn(), showToast: vi.fn() }));
vi.mock('@/components/haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('@/sync/storage', () => ({ useSessionPendingMessages: () => [] }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./glassSheet', () => ({ sheetFill: (color: string) => color, sheetSafeAreaBottom: () => 0 }));

import { PendingMessageDetailSheet } from './PendingMessageDetailSheet';

let renderer: ReturnType<typeof create>;
const message = {
    id: 'pending-1', previewText: 'hello', deliverAt: Date.now() + 60_000,
    pausedAt: null, steeringAt: null, imageCount: 0, fileCount: 0,
} as PendingMessage;

function render(start: 'view' | 'edit' | 'reschedule' = 'view', success = true) {
    const onReschedule = vi.fn().mockResolvedValue(success);
    act(() => {
        renderer = create(React.createElement(PendingMessageDetailSheet, {
            sessionId: 'session-1', message, canManage: true,
            initialMode: start,
            onSendNow: vi.fn(), onPin: vi.fn(), onDelete: vi.fn(), onPause: vi.fn(),
            onSaveEdit: vi.fn(), onReschedule, onClosed: vi.fn(),
        }));
    });
    return onReschedule;
}

function press(label: string) {
    const button = renderer.root.findAllByType('Pressable').find((node: any) =>
        node.findAllByType('Text').some((text: any) => text.props.children === label));
    expect(button).toBeDefined();
    act(() => { button.props.onPress(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { act(() => { renderer?.unmount(); }); });

describe('pending message edit navigation', () => {
    it.each(['edit', 'reschedule'] as const)('opens directly in %s without showing the menu', (mode) => {
        render(mode);
        expect(renderer.root.findAllByType('Preview')).toHaveLength(0);
        expect(renderer.root.findAllByType(mode === 'edit' ? 'Input' : 'ScheduleForm')).toHaveLength(1);
        expect(sheet.present).toHaveBeenCalledTimes(1);
        expect(sheet.dismiss).not.toHaveBeenCalled();
    });

    it('switches to time editing and cancels in the same mounted sheet', () => {
        render();
        const originalSheet = renderer.root.findByType('Sheet');
        press('pendingQueue.reschedule');
        expect(renderer.root.findAllByType('Preview')).toHaveLength(0);
        const form = renderer.root.findByType('ScheduleForm');
        expect(form.props.embedded).toBe(true);
        act(() => { form.props.onClose(); });
        expect(renderer.root.findAllByType('Preview')).toHaveLength(1);
        expect(renderer.root.findByType('Sheet')).toBe(originalSheet);
        expect(sheet.present).toHaveBeenCalledTimes(1);
        expect(sheet.dismiss).not.toHaveBeenCalled();
    });

    it.each([true, false])('returns to the menu only when saving succeeds (%s)', async (success) => {
        const onReschedule = render('reschedule', success);
        const deliverAt = Date.now() + 120_000;
        await act(async () => {
            await renderer.root.findByType('ScheduleForm').props.onSubmit('', deliverAt);
        });
        expect(onReschedule).toHaveBeenCalledWith(message.id, deliverAt);
        expect(renderer.root.findAllByType('Preview')).toHaveLength(success ? 1 : 0);
        expect(renderer.root.findAllByType('ScheduleForm')).toHaveLength(success ? 0 : 1);
        expect(sheet.dismiss).not.toHaveBeenCalled();
    });
});
