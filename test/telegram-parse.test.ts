import { describe, it, expect } from 'vitest';
import type { Message } from 'node-telegram-bot-api';
import { parseTelegramMessage } from '../src/adapters/telegram/parse.js';

const m = (o: object) => o as unknown as Message;
const priv = { id: 42, type: 'private' };
const group = { id: -100, type: 'supergroup' };

describe('parseTelegramMessage', () => {
  it('retains topic and quoted reply context', () => {
    const r = parseTelegramMessage(m({
      message_id: 10, chat: group, from: { id: 7 }, text: 'giải thích thêm', message_thread_id: 12,
      reply_to_message: { message_id: 9, from: { id: 42, is_bot: true }, text: 'câu trả lời trước' },
    }), 'HieuBot', []);
    expect(r).toMatchObject({ topicId: 12, replyTo: '9', replySenderId: '42', replyText: 'câu trả lời trước' });
  });
  it('ignores channel and anonymous sender-chat messages', () => {
    expect(parseTelegramMessage(m({ message_id: 1, chat: { id: -10, type: 'channel' }, from: { id: 7 }, text: 'x' }), 'HieuBot', [])).toBeNull();
    expect(parseTelegramMessage(m({ message_id: 1, chat: group, from: { id: 7 }, sender_chat: group, text: 'x' }), 'HieuBot', [])).toBeNull();
  });
  it('uses from.id as senderId even when name says Admin', () => {
    const r = parseTelegramMessage(m({ message_id: 1, chat: priv, from: { id: 7, first_name: 'Admin' }, text: 'hi' }), 'HieuBot', []);
    expect(r?.senderId).toBe('7');
    expect(r?.senderName).toBe('Admin');
  });
  it('private chat', () => {
    const r = parseTelegramMessage(m({ message_id: 10, chat: priv, from: { id: 7, first_name: 'A' }, text: 'hi' }), 'HieuBot', []);
    expect(r).toMatchObject({ threadId: '42', isGroup: false, msgId: '42:10', mentionsBot: false });
  });
  it('group mention entity is case-insensitive and stripped', () => {
    const r = parseTelegramMessage(m({
      message_id: 1, chat: group, from: { id: 7, first_name: 'A' }, text: '@hieubot giá vàng?',
      entities: [{ type: 'mention', offset: 0, length: 8 }],
    }), 'HieuBot', []);
    expect(r).toMatchObject({ isGroup: true, mentionsBot: true, text: 'giá vàng?' });
  });
  it('alias counts as mention', () => {
    const r = parseTelegramMessage(m({ message_id: 1, chat: group, from: { id: 7, first_name: 'A' }, text: '@Goblin hi' }), 'HieuBot', ['goblin']);
    expect(r).toMatchObject({ mentionsBot: true, text: 'hi' });
  });
  it('unicode alias matches as a whole token only', () => {
    const ok = parseTelegramMessage(m({ message_id: 1, chat: group, from: { id: 7, first_name: 'A' }, text: 'chào @bé nhé' }), 'HieuBot', ['bé']);
    expect(ok).toMatchObject({ mentionsBot: true, text: 'chào nhé' });
    const no = parseTelegramMessage(m({ message_id: 1, chat: group, from: { id: 7, first_name: 'A' }, text: 'chào @bép nhé' }), 'HieuBot', ['bé']);
    expect(no?.mentionsBot).toBe(false);
  });
  it('empty alias never counts as a mention', () => {
    const r = parseTelegramMessage(m({ message_id: 1, chat: group, from: { id: 7, first_name: 'A' }, text: 'hello @ there @' }), 'HieuBot', ['']);
    expect(r).toMatchObject({ mentionsBot: false, text: 'hello @ there @' });
  });
  it('reply to bot without tag is not a mention', () => {
    const r = parseTelegramMessage(m({
      message_id: 9, chat: group, from: { id: 7, first_name: 'A' }, text: 'ok',
      reply_to_message: { message_id: 5, from: { id: 1, is_bot: true } },
    }), 'HieuBot', []);
    expect(r).toMatchObject({ mentionsBot: false, replyTo: '5' });
  });
  it('ignores bots and empty messages', () => {
    expect(parseTelegramMessage(m({ message_id: 1, chat: priv, from: { id: 7, is_bot: true, first_name: 'B' }, text: 'x' }), 'HieuBot', [])).toBeNull();
    expect(parseTelegramMessage(m({ message_id: 1, chat: priv, from: { id: 7, first_name: 'A' } }), 'HieuBot', [])).toBeNull();
    expect(parseTelegramMessage(m({ message_id: 1, chat: priv, text: 'x' }), 'HieuBot', [])).toBeNull();
  });
  it('photo caption becomes text', () => {
    const r = parseTelegramMessage(m({
      message_id: 1, chat: priv, from: { id: 7, first_name: 'A' }, caption: 'xem ảnh',
      photo: [{ file_id: 'small' }, { file_id: 'big' }],
    }), 'HieuBot', []);
    expect(r?.text).toBe('xem ảnh');
    expect(r?.attachments?.[0]).toMatchObject({ kind: 'photo', fileId: 'big' });
  });
});
