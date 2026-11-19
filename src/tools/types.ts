export interface ToolContext {
  threadId: string;
  topicId?: number;
  senderId: string;
  senderName?: string;
  isAdmin: boolean;
  isGroup: boolean;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  access: 'public' | 'admin';
  readOnly: boolean;
  dmOnly?: boolean;
  confirm?: (args: unknown, ctx: ToolContext) => string | null;
  run: (args: unknown, ctx: ToolContext) => Promise<string>;
}
