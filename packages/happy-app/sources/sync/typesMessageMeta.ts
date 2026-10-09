import { z } from 'zod';
import { messageAttachmentSchema } from 'happy-wire';

// Shared message metadata schema
export const MessageMetaSchema = z.object({
    sentFrom: z.string().optional(), // Source identifier
    permissionMode: z.enum(['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan', 'read-only', 'on-failure', 'full-auto', 'auto_edit', 'yolo']).optional(), // Permission mode for this message
    model: z.string().nullable().optional(), // Model name for this message (null = reset)
    reasoningEffort: z.string().nullable().optional(), // Reasoning effort for this message (null = reset)
    fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
    customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
    appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
    allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
    disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
    displayText: z.string().optional(), // Optional text to display in UI instead of actual message text
    attachments: z.array(messageAttachmentSchema).optional(), // Files attached to a user message, already on the session's machine
    isCompactSummary: z.boolean().optional() // Claude Code's post-compaction summary record; the list shows it, the minimap leaves it off the rail
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;
