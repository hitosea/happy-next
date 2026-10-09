import * as React from 'react';
import { Platform } from 'react-native';

/**
 * Dragging one of a column of evenly spaced items into a new place with the mouse, web only: the
 * sidebar's machine rail, where reordering is a right-click option and there is no touch to serve.
 *
 * The items stay laid out in their order; while a drag is on, `offsetOf` gives each one its shift —
 * the dragged item follows the pointer, the ones it passes step one place back to make room — and
 * the drop reports the whole new order once, if it changed. Places come from `pitch`, an item plus
 * the gap after it, so nothing has to be measured.
 */

export type MouseReorderDrag = { id: string; from: number; to: number; dy: number };

type PointerDownEvent = {
    preventDefault: () => void;
    nativeEvent: { button?: number; clientY?: number; pageY: number };
};

export function useMouseReorder(ids: readonly string[], pitch: number, onReorder: (ids: string[]) => void) {
    const [drag, setDrag] = React.useState<MouseReorderDrag | null>(null);
    const latest = React.useRef({ ids, onReorder });
    latest.current = { ids, onReorder };
    // Ends a drag left running when the rail unmounts mid-drag.
    const stopRef = React.useRef<(() => void) | null>(null);
    React.useEffect(() => () => stopRef.current?.(), []);

    const start = React.useCallback((id: string, event: PointerDownEvent) => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || (event.nativeEvent.button ?? 0) !== 0) return;
        // The order as it was when grabbed; a machine coming or going mid-drag waits for the drop.
        const order = [...latest.current.ids];
        const from = order.indexOf(id);
        if (from < 0) return;
        // No text selection while dragging.
        event.preventDefault();
        const startY = event.nativeEvent.clientY ?? event.nativeEvent.pageY;
        const at = (clientY: number): MouseReorderDrag => {
            const dy = clientY - startY;
            const to = Math.min(order.length - 1, Math.max(0, Math.round(from + dy / pitch)));
            return { id, from, to, dy };
        };

        const handleMove = (moveEvent: PointerEvent) => setDrag(at(moveEvent.clientY));
        const handleUp = (upEvent: PointerEvent) => {
            stop();
            const { to } = at(upEvent.clientY);
            if (to === from) return;
            const next = [...order];
            next.splice(from, 1);
            next.splice(to, 0, id);
            latest.current.onReorder(next);
        };
        const handleKeyDown = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === 'Escape') stop();
        };
        const stop = () => {
            window.removeEventListener('pointermove', handleMove, true);
            window.removeEventListener('pointerup', handleUp, true);
            window.removeEventListener('pointercancel', stop, true);
            window.removeEventListener('keydown', handleKeyDown, true);
            stopRef.current = null;
            setDrag(null);
        };

        stopRef.current?.();
        stopRef.current = stop;
        window.addEventListener('pointermove', handleMove, true);
        window.addEventListener('pointerup', handleUp, true);
        window.addEventListener('pointercancel', stop, true);
        window.addEventListener('keydown', handleKeyDown, true);
        setDrag(at(startY));
    }, [pitch]);

    // How far the item at `index` is shifted from its laid-out place right now.
    const offsetOf = (id: string, index: number): number => {
        if (!drag) return 0;
        if (id === drag.id) return drag.dy;
        if (drag.from < drag.to && index > drag.from && index <= drag.to) return -pitch;
        if (drag.to < drag.from && index >= drag.to && index < drag.from) return pitch;
        return 0;
    };

    return { drag, start, offsetOf };
}
