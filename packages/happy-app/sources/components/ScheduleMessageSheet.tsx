import * as React from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { FullWindowOverlay } from 'react-native-screens';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { DatePicker } from './dootask/DatePicker';
import { liquidGlassAvailable } from './GlassSurface';
import { GLASS_SHEET_FILL, GLASS_SHEET_MARGIN, GLASS_SHEET_RADIUS, glassSheetFramePadding } from './glassSheet';

export type ScheduleMessageSheetProps = {
    visible: boolean;
    /** `create` edits the text to schedule; `reschedule` only changes the time of an existing message. */
    mode: 'create' | 'reschedule';
    /** Text prefilled into the editor (create mode). */
    initialText?: string;
    /** Images that go out with the message; they count as content when the text is empty. */
    imageCount?: number;
    fileCount?: number;
    /** Time preselected when the sheet opens (reschedule mode), epoch ms. */
    initialDeliverAt?: number | null;
    /** Epoch seconds at which the provider usage limit resets; offers a one-tap option. */
    limitEndsAt?: number | null;
    /** Focus the editor (create mode) when the sheet opens, e.g. when the composer had the cursor. */
    autoFocus?: boolean;
    onClose: () => void;
    /** Resolve once the message is saved; the sheet stays disabled until then. */
    onSubmit: (text: string, deliverAt: number) => void | Promise<void>;
};

// The selected send time. The relative ones count from the moment of confirming, as their
// subtitles show; `custom` is the time picked by hand (or a reschedule's existing time).
type TimeOption = 'limit' | 'in30' | 'in60' | 'custom';

const RELATIVE_MINUTES = { in30: 30, in60: 60 } as const;

const ANIMATION_DURATION = 250;
const isIOS = Platform.OS === 'ios';

const backdropFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

function formatDateTime(date: Date): string {
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Just the time when it is today, otherwise with the date. */
function formatSendTime(date: Date): string {
    if (date.toDateString() === new Date().toDateString()) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return formatDateTime(date);
}

/** The custom option's starting time: half an hour out, rounded up to the next half hour. */
function defaultCustomDate(): Date {
    const next = new Date(Date.now() + 30 * 60_000);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + (30 - (next.getMinutes() % 30)));
    return next;
}

export function ScheduleMessageSheet({
    visible,
    mode,
    initialText = '',
    imageCount = 0,
    fileCount = 0,
    initialDeliverAt,
    limitEndsAt,
    autoFocus = false,
    onClose,
    onSubmit,
}: ScheduleMessageSheetProps) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    // Keyboard height as it animates, negative upwards.
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
    const [text, setText] = React.useState(initialText);
    const [customDate, setCustomDate] = React.useState(defaultCustomDate);
    // Ticks so the relative options' times stay current while the sheet is open.
    const [now, setNow] = React.useState(Date.now);
    const [selectedOption, setSelectedOption] = React.useState<TimeOption>('in30');
    const [showDatePicker, setShowDatePicker] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);

    // The container itself has no animation: the backdrop only fades while the sheet slides up,
    // so the dimmed layer never travels with it. `mounted` keeps it up for the exit.
    const [mounted, setMounted] = React.useState(false);
    const progress = useSharedValue(0);
    const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
    const restingBottom = liquidGlassAvailable
        ? glassSheetFramePadding(safeArea.bottom).paddingBottom
        : Math.max(18, safeArea.bottom + 12);
    const sheetAnimatedStyle = useAnimatedStyle(() => {
        const slide = { transform: [{ translateY: (1 - progress.value) * windowHeight }] };
        if (!isIOS) {
            return slide;
        }
        // iOS follows the keyboard frame by frame instead of through a KeyboardAvoidingView, so
        // the sheet's bottom never dips below its resting place over the home indicator while the
        // keyboard goes away (and then jumps back up once it is gone): it is whichever is higher
        // of resting there and sitting just above the keyboard.
        const lift = -keyboardHeight.value;
        return liquidGlassAvailable
            ? { ...slide, marginBottom: Math.max(lift + GLASS_SHEET_MARGIN, restingBottom) }
            : { ...slide, marginBottom: lift, paddingBottom: Math.max(18, restingBottom - lift) };
    }, [windowHeight, restingBottom]);

    const limitDate = limitEndsAt && limitEndsAt * 1000 > Date.now() ? new Date(limitEndsAt * 1000) : null;

    // Reset every time the sheet opens, not on each prop change while it is open.
    React.useEffect(() => {
        if (visible) {
            setText(initialText);
            setNow(Date.now());
            if (initialDeliverAt && initialDeliverAt > Date.now()) {
                setCustomDate(new Date(initialDeliverAt));
                setSelectedOption('custom');
            } else {
                setCustomDate(defaultCustomDate());
                setSelectedOption(limitDate ? 'limit' : 'in30');
            }
            setShowDatePicker(false);
            setSubmitting(false);

            setMounted(true);
            progress.value = 0;
            progress.value = withTiming(1, { duration: ANIMATION_DURATION });
        } else if (mounted) {
            progress.value = withTiming(0, { duration: ANIMATION_DURATION }, (finished) => {
                if (finished) {
                    runOnJS(setMounted)(false);
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    React.useEffect(() => {
        if (!mounted) return;
        const timer = setInterval(() => setNow(Date.now()), 10_000);
        return () => clearInterval(timer);
    }, [mounted]);

    const chooseOption = React.useCallback((option: TimeOption) => {
        setSelectedOption(option);
        setShowDatePicker(false);
    }, []);

    const handleCustomDateChange = React.useCallback((next: Date) => {
        setCustomDate(next);
        setSelectedOption('custom');
    }, []);

    const deliverAtFor = (option: TimeOption, from: number): number | null => {
        switch (option) {
            case 'in30':
            case 'in60':
                return from + RELATIVE_MINUTES[option] * 60_000;
            case 'limit':
                return limitDate?.getTime() ?? null;
            case 'custom':
                return customDate.getTime();
        }
    };

    const selectedDeliverAt = deliverAtFor(selectedOption, now);
    const hasContent = mode === 'reschedule' || text.trim().length > 0 || imageCount > 0 || fileCount > 0;
    const canSubmit = hasContent && selectedDeliverAt !== null && selectedDeliverAt > now && !submitting;

    const submit = async () => {
        // Relative times count from this moment, not from when the option was tapped.
        const deliverAt = deliverAtFor(selectedOption, Date.now());
        if (!canSubmit || deliverAt === null || deliverAt <= Date.now()) return;
        setSubmitting(true);
        try {
            await onSubmit(text.trim(), deliverAt);
        } finally {
            setSubmitting(false);
        }
    };

    if (!mounted) {
        return null;
    }

    // On iOS 26 the keyboard is a floating rounded panel, so the sheet floats too: a Liquid Glass
    // card with the system sheets' corners, clear of the screen's sides and of the keyboard by a
    // margin, like the other bottom sheets (see `glassSheet`).
    const sheetFrame = liquidGlassAvailable
        ? [styles.sheetFloating, { marginHorizontal: GLASS_SHEET_MARGIN }]
        : Platform.OS === 'ios' ? null : { paddingBottom: restingBottom };

    const content = (
        <View style={styles.container}>
            <Animated.View style={[backdropFill, backdropStyle]} pointerEvents="none">
                {Platform.OS === 'ios' ? (
                    <BlurView intensity={30} tint="dark" style={backdropFill} />
                ) : (
                    <View style={[backdropFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
                )}
            </Animated.View>
            <Pressable style={backdropFill} onPress={onClose} />
            <KeyboardAvoidingView
                style={styles.keyboardContainer}
                behavior="height"
                enabled={Platform.OS !== 'ios'}
                pointerEvents="box-none"
            >
                <Animated.View style={[styles.sheet, sheetFrame, sheetAnimatedStyle]}>
                    {/* The glass sits behind the content as `GlassSurface` does it; the sheet is a
                        single view so it can follow the keyboard and the slide together. */}
                    {liquidGlassAvailable && (
                        <GlassView pointerEvents="none" glassEffectStyle="regular" style={styles.sheetGlass} />
                    )}
                    <View style={styles.header}>
                        <Text style={styles.title}>
                            {mode === 'create' ? t('scheduleMessage.title') : t('scheduleMessage.rescheduleTitle')}
                        </Text>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {mode === 'create' && (
                        <>
                            <TextInput
                                autoFocus={autoFocus}
                                multiline
                                value={text}
                                onChangeText={setText}
                                placeholder={t('scheduleMessage.placeholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                style={styles.editor}
                            />
                            {imageCount > 0 && (
                                <Text style={styles.sectionTitle}>{t('scheduleMessage.imagesAttached', { count: imageCount })}</Text>
                            )}
                            {fileCount > 0 && (
                                <Text style={styles.sectionTitle}>{t('scheduleMessage.filesAttached', { count: fileCount })}</Text>
                            )}
                        </>
                    )}

                    <Text style={styles.sectionTitle}>{t('scheduleMessage.sendTime')}</Text>
                    {/* `handled`: picking a quick time keeps the editor focused and the keyboard up. */}
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={styles.options}
                    >
                        {limitDate && (
                            <Pressable
                                style={[styles.option, selectedOption === 'limit' && styles.optionSelected]}
                                onPress={() => chooseOption('limit')}
                            >
                                <Text style={styles.optionTitle}>{t('scheduleMessage.afterLimitReset')}</Text>
                                <Text style={styles.optionSubtitle}>{formatSendTime(limitDate)}</Text>
                            </Pressable>
                        )}
                        <Pressable style={[styles.option, selectedOption === 'in30' && styles.optionSelected]} onPress={() => chooseOption('in30')}>
                            <Text style={styles.optionTitle}>{t('scheduleMessage.in30Minutes')}</Text>
                            <Text style={styles.optionSubtitle}>{formatSendTime(new Date(now + 30 * 60_000))}</Text>
                        </Pressable>
                        <Pressable style={[styles.option, selectedOption === 'in60' && styles.optionSelected]} onPress={() => chooseOption('in60')}>
                            <Text style={styles.optionTitle}>{t('scheduleMessage.in1Hour')}</Text>
                            <Text style={styles.optionSubtitle}>{formatSendTime(new Date(now + 60 * 60_000))}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.option, selectedOption === 'custom' && styles.optionSelected]}
                            onPress={() => {
                                setSelectedOption('custom');
                                // The date picker needs the room the keyboard takes.
                                if (!showDatePicker) Keyboard.dismiss();
                                setShowDatePicker((value) => !value);
                            }}
                        >
                            <Text style={styles.optionTitle}>{t('scheduleMessage.custom')}</Text>
                            <Text style={styles.optionSubtitle}>{formatDateTime(customDate)}</Text>
                        </Pressable>
                    </ScrollView>
                    {showDatePicker && (
                        <DatePicker date={customDate} onChange={handleCustomDateChange} minDate={new Date(Date.now() + 60_000)} timePicker />
                    )}

                    <Pressable
                        onPress={() => void submit()}
                        disabled={!canSubmit}
                        style={[styles.submit, !canSubmit && styles.submitDisabled]}
                    >
                        <Text style={styles.submitText}>
                            {mode === 'create' ? t('scheduleMessage.confirm') : t('scheduleMessage.save')}
                        </Text>
                    </Pressable>
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );

    // On iOS a transparent RN Modal opened over the session (with the composer's keyboard up)
    // comes up as an opaque screen, hiding the dim and blur; the other sheets use an overlay too.
    if (Platform.OS === 'ios') {
        return <FullWindowOverlay>{content}</FullWindowOverlay>;
    }

    return (
        <Modal
            visible
            transparent
            animationType="none"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onClose}
        >
            {content}
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    keyboardContainer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        padding: 18,
        gap: 12,
        maxHeight: '100%',
    },
    sheetFloating: {
        borderRadius: GLASS_SHEET_RADIUS,
        borderCurve: 'continuous',
        padding: 22,
        backgroundColor: 'transparent',
    },
    sheetGlass: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: GLASS_SHEET_RADIUS,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    editor: {
        minHeight: 100,
        maxHeight: 180,
        borderRadius: 10,
        padding: 12,
        textAlignVertical: 'top',
        fontSize: 16,
        color: theme.colors.text,
        // A solid fill would cover the glass; this only tints it.
        backgroundColor: liquidGlassAvailable ? GLASS_SHEET_FILL : theme.colors.input.background,
    },
    sectionTitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    options: {
        gap: 8,
        paddingBottom: 2,
    },
    option: {
        minWidth: 105,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    optionSelected: {
        borderColor: theme.colors.button.primary.background,
        backgroundColor: liquidGlassAvailable ? GLASS_SHEET_FILL : theme.colors.surfaceHigh,
    },
    optionTitle: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    optionSubtitle: {
        fontSize: 12,
        marginTop: 2,
        color: theme.colors.textSecondary,
    },
    submit: {
        alignItems: 'center',
        borderRadius: 10,
        paddingVertical: 13,
        backgroundColor: theme.colors.button.primary.background,
    },
    submitDisabled: {
        opacity: 0.45,
    },
    submitText: {
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
}));
