import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { OrchestratorExecutionStatus, OrchestratorRunStatus, OrchestratorTaskStatus } from '@/sync/apiOrchestrator';
import { getStatusColor } from './status';

type AnyStatus = OrchestratorRunStatus | OrchestratorTaskStatus | OrchestratorExecutionStatus;

const RAIL_WIDTH = 20;
const RAIL_LINE_LEFT = (RAIL_WIDTH - 2) / 2;

// Queued and cancelled are rings: the rail reads as "this happened, nothing is beating"
const FILLED_STATUSES = new Set<AnyStatus>([
    'running',
    'dispatching',
    'completed',
    'failed',
    'timeout',
    'dependency_failed',
    'canceling',
]);

const stylesheet = StyleSheet.create((theme) => ({
    // The dot is a flex sibling of the row's title, so it centers on that line without measuring it
    gutter: {
        width: RAIL_WIDTH,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dotSlot: {
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    halo: {
        position: 'absolute',
        width: 18,
        height: 18,
        borderRadius: 9,
        opacity: 0.16,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        backgroundColor: theme.colors.groupped.background,
    },
    // Absolute segments: one reaches from the row's top down to the dot's top edge, one from the
    // dot's bottom edge to the header's bottom, so the first paint is already final and the rail
    // never draws over the dot.
    line: {
        position: 'absolute',
        left: RAIL_LINE_LEFT,
        width: 2,
        borderRadius: 1,
        backgroundColor: theme.colors.divider,
    },
    lineAbove: {
        top: -14,
        bottom: '50%',
        marginBottom: 5,
    },
    lineBelow: {
        top: '50%',
        bottom: 0,
        marginTop: 5,
    },
    lineHidden: {
        backgroundColor: 'transparent',
    },
    // The rail alone, for the block below a header (the rest of a row, or expanded details)
    rail: {
        width: RAIL_WIDTH,
        alignItems: 'center',
    },
    railLine: {
        width: 2,
        flex: 1,
        borderRadius: 1,
        backgroundColor: theme.colors.divider,
    },
}));

/** The rail's node for a row, centered by the header row it belongs to. */
export function OrchestratorTimelineDot({ status }: { status: AnyStatus; }) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const color = getStatusColor(theme, status);
    const live = status === 'running' || status === 'dispatching';

    return (
        <View style={styles.gutter}>
            <View style={styles.dotSlot}>
                {live && <View style={[styles.halo, { backgroundColor: color }]} />}
                <View style={[styles.dot, { borderColor: color }, FILLED_STATUSES.has(status) && { backgroundColor: color }]} />
            </View>
        </View>
    );
}

/** The two segments a header draws outside itself: up to the row top, down to its own bottom. */
export function OrchestratorTimelineHeaderLines({ above, below }: { above: boolean; below: boolean; }) {
    const styles = stylesheet;
    return (
        <>
            <View style={[styles.line, styles.lineAbove, !above && styles.lineHidden]} />
            <View style={[styles.line, styles.lineBelow, !below && styles.lineHidden]} />
        </>
    );
}

/** The rail alone, for a block that sits under an attempt's dot. */
export function OrchestratorTimelineLine({ visible = true }: { visible?: boolean; }) {
    const styles = stylesheet;
    return (
        <View style={styles.rail}>
            <View style={[styles.railLine, !visible && styles.lineHidden]} />
        </View>
    );
}
