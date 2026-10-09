import { Platform } from 'react-native';
import { shouldDismissSessionMenuOnScroll, type ScrollTarget } from './sessionContextMenuScroll';

// After a click, how long before the card shows again — and only once the pointer has moved since.
const REOPEN_DELAY = 500;

export type HoverAnchorRect = { top: number; bottom: number; left: number; right: number };

export type HoverCardState = {
    owner: object;
    sessionId: string;
    anchor: HoverAnchorRect;
};

type HoveredRow = {
    owner: object;
    sessionId: string;
    getElement: () => ScrollTarget | null;
};

let shown: (HoverCardState & { getElement: () => ScrollTarget | null }) | null = null;
let snapshot: HoverCardState | null = null;
let hoveredRow: HoveredRow | null = null;
let overCard = false;
let editing = false;
let blocked = false;
let enabled = false;
let waitForMove = false;
let lastPointerDownAt = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let cardElement: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit() {
    snapshot = shown && { owner: shown.owner, sessionId: shown.sessionId, anchor: shown.anchor };
    listeners.forEach(listener => listener());
}

function clearShowTimer() {
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = null;
}

function clearHideTimer() {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
}

function close() {
    clearShowTimer();
    clearHideTimer();
    overCard = false;
    editing = false;
    if (shown === null) return;
    shown = null;
    emit();
}

// Moves the one card to the hovered row — a new position and session, never a second card.
function reveal() {
    showTimer = null;
    if (hoveredRow === null || blocked || !enabled) return;
    const element = hoveredRow.getElement() as unknown as Element | null;
    if (!element?.getBoundingClientRect) return;
    const rect = element.getBoundingClientRect();
    clearHideTimer();
    shown = {
        owner: hoveredRow.owner,
        sessionId: hoveredRow.sessionId,
        getElement: hoveredRow.getElement,
        anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    };
    emit();
}

function requestShow() {
    clearShowTimer();
    // Mid-edit, the card stays with the session being renamed.
    if (editing && shown !== null && shown.owner !== hoveredRow?.owner) return;
    const wait = lastPointerDownAt + REOPEN_DELAY - Date.now();
    if (wait > 0) {
        showTimer = setTimeout(reveal, wait);
    } else {
        reveal();
    }
}

// Hides as soon as the pointer is on neither the row nor the card. Deferred only to the end of the
// event: leaving one row (or the card) and entering the next arrive together, and the card should
// move there rather than close and reopen.
function scheduleHide() {
    if (editing || hideTimer !== null) return;
    hideTimer = setTimeout(() => {
        hideTimer = null;
        if (hoveredRow === null && !overCard && !editing) close();
    }, 0);
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (event) => {
        lastPointerDownAt = Date.now();
        if (event.target instanceof Node && cardElement?.contains(event.target)) return;
        close();
        waitForMove = hoveredRow !== null;
    }, true);
    window.addEventListener('scroll', (event) => {
        if (shown !== null && shouldDismissSessionMenuOnScroll(event.target as ScrollTarget, shown.getElement())) close();
    }, true);
}

/**
 * The session hover card's one shared state (web): which session it shows and where. Rows report
 * the pointer; the card shows as soon as it enters a row, follows it from row to row, and hides as
 * soon as the pointer is on neither the row nor the card. A click outside the card hides it until the pointer
 * moves again, and no sooner than half a second after the click.
 */
export const sessionHoverCard = {
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,

    rowEnter(row: HoveredRow) {
        hoveredRow = row;
        waitForMove = false;
        requestShow();
    },
    rowMove(owner: object) {
        if (!waitForMove || hoveredRow?.owner !== owner) return;
        waitForMove = false;
        requestShow();
    },
    rowLeave(owner: object) {
        if (hoveredRow?.owner !== owner) return;
        hoveredRow = null;
        waitForMove = false;
        clearShowTimer();
        scheduleHide();
    },
    // The row's own menu takes the card's place.
    dismiss(owner: object) {
        if (hoveredRow?.owner === owner) clearShowTimer();
        if (shown?.owner === owner) close();
    },
    // Only the wide layout, with the machine rail beside the list, has hover cards.
    setEnabled(value: boolean) {
        enabled = value;
        if (!value) close();
    },
    // While a row's menu is open, no card shows over it.
    setBlocked(value: boolean) {
        blocked = value;
        if (value) close();
    },

    setCardElement(element: HTMLElement | null) {
        cardElement = element;
    },
    cardEnter() {
        overCard = true;
        clearHideTimer();
    },
    cardLeave() {
        overCard = false;
        scheduleHide();
    },
    setEditing(value: boolean) {
        editing = value;
        if (value) return;
        if (hoveredRow !== null && hoveredRow.owner !== shown?.owner) {
            requestShow();
        } else if (hoveredRow === null && !overCard) {
            scheduleHide();
        }
    },
};
