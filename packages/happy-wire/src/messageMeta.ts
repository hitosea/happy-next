import * as z from 'zod';
import { PermissionModeSchema } from './permissionModes';
import { messageAttachmentSchema } from './fileUpload';

export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  model: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  displayText: z.string().optional(),
  attachments: z.array(messageAttachmentSchema).optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;
