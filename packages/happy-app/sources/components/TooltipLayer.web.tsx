import * as React from 'react';
import { createPortal } from 'react-dom';

/** Where a tooltip renders: on the page's body, so containers that clip or transform do not touch it. */
export function TooltipLayer({ children }: { children: React.ReactNode }) {
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' }}>
            {children}
        </div>,
        document.body,
    );
}
