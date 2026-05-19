import type { ImageContent, PermissionMode } from '@/api/types';

export interface OpenCodeMode {
  permissionMode: PermissionMode;
  model?: string;
  originalUserMessage?: string;
  images?: ImageContent[];
}

export interface OpenCodeMessagePayload {
  type: 'message';
  message: string;
  id: string;
  options?: string[];
}
