export interface FileAttachment { kind: 'photo' | 'document' | 'audio' | 'video' | 'sticker'; fileId: string; mimeType?: string; fileName?: string }

export interface IncomingMessage {
  threadId: string;
  senderId: string;
  senderName?: string;
  text: string;
  attachments?: FileAttachment[];
  isGroup: boolean;
  msgId: string;
  replyTo?: string;
  topicId?: number;
  replyText?: string;
  replySenderId?: string;
  mentionsBot: boolean; // mở rộng so với spec: true khi @tag bot hoặc @biệt danh
}
