import type { FileAttachment, IncomingMessage } from './types.js';

export type Channel = 'telegram' | 'messenger';
export interface Address { channel: Channel; conversationId: string; userId: string; topicId?: number }
export interface Choice { title: string; payload: string }
export interface ChannelAdapter {
  channel: Channel;
  maxText: number;
  split(text: string): string[];
  send(msg: IncomingMessage, text: string, signal?: AbortSignal): Promise<void>;
  notify(conversationId: string, text: string, topicId?: number): Promise<void>;
  media(conversationId: string, type: 'image' | 'file', url: string): Promise<void>;
  choices(msg: IncomingMessage, text: string, options: Choice[]): Promise<void>;
  typing(msg: IncomingMessage, signal: AbortSignal): Promise<void>;
  downloadImage(attachment: FileAttachment, signal?: AbortSignal): Promise<string | null>;
  start(receive: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): void;
  close(): Promise<void>;
}
export function address(channel: Channel, msg: IncomingMessage): Address {
  return {channel, conversationId: msg.threadId, userId: msg.senderId, topicId: msg.topicId};
}
export function enabledChannels(raw = 'telegram'): Channel[] {
  const names = [...new Set(raw.split(',').map(s => s.trim()))];
  if (!names.every((v): v is Channel => v === 'telegram' || v === 'messenger')) {
    throw new Error('ENABLED_CHANNELS chỉ nhận telegram hoặc messenger.');
  }
  return names;
}
