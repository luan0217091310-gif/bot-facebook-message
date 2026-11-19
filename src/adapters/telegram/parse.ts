import type { Message } from 'node-telegram-bot-api';
import type { FileAttachment, IncomingMessage } from '../../types.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseTelegramMessage(
  msg: Message,
  botUsername: string,
  aliases: string[],
): IncomingMessage | null {
  const from = msg.from;
  if (!from || from.is_bot || msg.sender_chat) return null;
  if (!['private', 'group', 'supergroup'].includes(msg.chat.type)) return null;

  let text = msg.text ?? msg.caption ?? '';
  const entities = (msg.text !== undefined ? msg.entities : msg.caption_entities) ?? [];

  const attachments: FileAttachment[] = [];
  if (msg.photo && msg.photo.length > 0) {
    attachments.push({ kind: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id });
  }
  if (msg.document) {
    attachments.push({
      kind: 'document',
      fileId: msg.document.file_id,
      mimeType: msg.document.mime_type,
      fileName: msg.document.file_name,
    });
  }

  let mentionsBot = false;

  // @username entities, stripped from the end so earlier offsets stay valid.
  const tag = `@${botUsername}`.toLowerCase();
  const matched = entities
    .filter((e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length).toLowerCase() === tag)
    .sort((a, b) => b.offset - a.offset);
  for (const e of matched) {
    mentionsBot = true;
    text = text.slice(0, e.offset) + ' ' + text.slice(e.offset + e.length);
  }

  // @alias as a whole token (Unicode-aware); empty aliases are ignored.
  for (const alias of aliases) {
    if (!alias) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])@${escapeRe(alias)}(?![\\p{L}\\p{N}_])`, 'giu');
    if (re.test(text)) {
      mentionsBot = true;
      text = text.replace(re, ' ');
    }
  }

  text = text.replace(/[ \t]{2,}/g, ' ').trim();

  if (!text && attachments.length === 0) return null;

  const result: IncomingMessage = {
    threadId: String(msg.chat.id),
    senderId: String(from.id),
    text,
    isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
    msgId: `${msg.chat.id}:${msg.message_id}`,
    mentionsBot,
  };
  if (from.first_name) result.senderName = from.first_name;
  if (attachments.length > 0) result.attachments = attachments;
  if (msg.reply_to_message) result.replyTo = String(msg.reply_to_message.message_id);
  if (msg.reply_to_message) {
    result.replyText = (msg.reply_to_message.text ?? msg.reply_to_message.caption ?? '').slice(0, 2000);
    if (msg.reply_to_message.from) result.replySenderId = String(msg.reply_to_message.from.id);
  }
  if (msg.message_thread_id !== undefined) result.topicId = msg.message_thread_id;
  return result;
}
