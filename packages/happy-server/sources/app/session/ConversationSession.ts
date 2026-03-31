import { log } from "@/utils/log";

/**
 * Conversation state types for tracking session lifecycle.
 * Used to determine when push notifications are safe to send.
 */
export type ConversationStatus = 'idle' | 'thinking' | 'executing_tool' | 'completed';

export interface ConversationState {
    conversationId: string;
    status: ConversationStatus;
    isThinking: boolean;
    toolsInProgress: string[];
    lastActivityTime: number;
    messageCount: number;
    toolsCompleted: number;
    timeoutDetected: boolean;
}

/**
 * ConversationSession tracks the state of a conversation for notification stability.
 * 
 * It monitors:
 * - isThinking: whether the AI model is currently processing
 * - toolsInProgress: tools that are currently being executed
 * - lastActivityTime: timestamp of the last activity
 * - status: current status of the conversation
 * 
 * The session is considered "ready for notification" when:
 * - isThinking === false
 * - toolsInProgress is empty
 * - lastActivityTime is > 2 seconds ago (stability window)
 * - status is 'completed' or 'idle'
 * - timeoutDetected is false
 */
export class ConversationSession {
    private state: {
        conversationId: string;
        isThinking: boolean;
        toolsInProgress: Map<string, boolean>;
        lastActivityTime: number;
        status: ConversationStatus;
        messageCount: number;
        toolsCompleted: number;
    };

    private readonly TIMEOUT_THRESHOLD_MS = 30_000; // 30 seconds
    private readonly STABILITY_THRESHOLD_MS = 2_000; // 2 seconds

    constructor(conversationId: string) {
        this.state = {
            conversationId,
            isThinking: false,
            toolsInProgress: new Map(),
            lastActivityTime: Date.now(),
            status: 'idle',
            messageCount: 0,
            toolsCompleted: 0,
        };
    }

    /**
     * Mark when the model starts thinking
     */
    onModelThinkingStart(): void {
        this.state.isThinking = true;
        this.state.status = 'thinking';
        this.state.lastActivityTime = Date.now();
        log({ module: 'conversation-session', sessionId: this.state.conversationId }, 
            `[会话 ${this.state.conversationId}] 模型开始思考`);
    }

    /**
     * Mark when the model finishes thinking
     */
    onModelThinkingEnd(): void {
        this.state.isThinking = false;
        this.state.lastActivityTime = Date.now();
        log({ module: 'conversation-session', sessionId: this.state.conversationId }, 
            `[会话 ${this.state.conversationId}] 模型思考完成`);
    }

    /**
     * Mark when a tool starts executing
     */
    onToolStart(toolId: string): void {
        this.state.toolsInProgress.set(toolId, true);
        this.state.status = 'executing_tool';
        this.state.lastActivityTime = Date.now();
        log({ module: 'conversation-session', sessionId: this.state.conversationId }, 
            `[会话 ${this.state.conversationId}] 工具启动: ${toolId}`);
    }

    /**
     * Mark when a tool finishes executing (or fails)
     */
    onToolEnd(toolId: string): void {
        this.state.toolsInProgress.delete(toolId);
        this.state.toolsCompleted++;
        this.state.lastActivityTime = Date.now();
        
        if (this.state.toolsInProgress.size === 0 && !this.state.isThinking) {
            this.state.status = 'completed';
        }
        
        log({ module: 'conversation-session', sessionId: this.state.conversationId }, 
            `[会话 ${this.state.conversationId}] 工具完成: ${toolId}, 剩余: ${this.state.toolsInProgress.size}`);
    }

    /**
     * Mark when a new message is received/sent
     */
    onNewMessage(): void {
        this.state.messageCount++;
        this.state.lastActivityTime = Date.now();
    }

    /**
     * Mark session as idle (no pending work)
     */
    onIdle(): void {
        this.state.status = 'idle';
        this.state.isThinking = false;
        this.state.toolsInProgress.clear();
        this.state.lastActivityTime = Date.now();
    }

    /**
     * Get the current state of the conversation
     */
    getState(): ConversationState {
        const timeSinceActivity = Date.now() - this.state.lastActivityTime;
        const timeoutDetected = timeSinceActivity > this.TIMEOUT_THRESHOLD_MS;

        return {
            conversationId: this.state.conversationId,
            status: this.state.status,
            isThinking: this.state.isThinking,
            toolsInProgress: Array.from(this.state.toolsInProgress.keys()),
            lastActivityTime: this.state.lastActivityTime,
            messageCount: this.state.messageCount,
            toolsCompleted: this.state.toolsCompleted,
            timeoutDetected,
        };
    }

    /**
     * Get stability threshold for notification timing
     */
    getStabilityThresholdMs(): number {
        return this.STABILITY_THRESHOLD_MS;
    }

    /**
     * Check if enough time has passed since last activity for stability
     */
    isTimeStable(): boolean {
        const timeSinceLastActivity = Date.now() - this.state.lastActivityTime;
        return timeSinceLastActivity > this.STABILITY_THRESHOLD_MS;
    }

    /**
     * Get time since last activity in ms
     */
    getTimeSinceLastActivity(): number {
        return Date.now() - this.state.lastActivityTime;
    }
}

// Global registry of conversation sessions (in-memory)
// In production, this could be backed by Redis or similar
const conversationSessions = new Map<string, ConversationSession>();

/**
 * Get or create a conversation session
 */
export function getOrCreateSession(conversationId: string): ConversationSession {
    let session = conversationSessions.get(conversationId);
    if (!session) {
        session = new ConversationSession(conversationId);
        conversationSessions.set(conversationId, session);
    }
    return session;
}

/**
 * Get an existing session (returns undefined if not found)
 */
export function getSession(conversationId: string): ConversationSession | undefined {
    return conversationSessions.get(conversationId);
}

/**
 * Remove a session (e.g., when session is deleted)
 */
export function removeSession(conversationId: string): void {
    conversationSessions.delete(conversationId);
}
