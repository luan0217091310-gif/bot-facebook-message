import OpenAI, { toFile } from 'openai';

/** Định dạng âm thanh Gemini nhận trực tiếp; Messenger thường gửi tin thoại dạng audio/mp4 (AAC). */
function geminiMime(mime: string, name: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac') || /\.(mp4|m4a|aac)$/i.test(name)) return 'audio/aac';
  if (m.includes('mpeg') || m.includes('mp3') || /\.mp3$/i.test(name)) return 'audio/mp3';
  if (m.includes('ogg') || m.includes('opus')) return 'audio/ogg';
  if (m.includes('wav')) return 'audio/wav';
  if (m.includes('flac')) return 'audio/flac';
  return m.startsWith('audio/') ? m : 'audio/aac';
}

export interface SttOptions {
  baseUrl: string;
  apiKey: string;
  /** Model dùng để chép lời: Gemini dùng model chat (vd gemini-3.1-flash-lite), OpenAI dùng whisper-1. */
  model: string;
  fetchFn?: typeof fetch;
}

const PROMPT = 'Chép lại CHÍNH XÁC lời nói trong đoạn ghi âm, giữ nguyên ngôn ngữ gốc (Việt hoặc Anh), thêm dấu câu. '
  + 'Chỉ trả về phần văn bản đã chép, không giải thích, không trả lời nội dung. Nếu không nghe rõ lời nào, trả về chuỗi rỗng.';

/**
 * Chuyển giọng nói thành văn bản.
 * - Endpoint Gemini: gọi API gốc generateContent với audio inline (endpoint tương thích OpenAI không có /audio/transcriptions).
 * - Endpoint khác (OpenAI): dùng /audio/transcriptions (whisper).
 */
export async function transcribeAudio(bytes: Buffer, mime: string, name: string, o: SttOptions): Promise<string> {
  const url = new URL(o.baseUrl);
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`;
    const res = await (o.fetchFn ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: PROMPT },
          { inline_data: { mime_type: geminiMime(mime, name), data: bytes.toString('base64') } },
        ] }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
    if (!res.ok) throw new Error('Gemini STT lỗi HTTP ' + res.status + (body.error?.message ? ': ' + body.error.message.slice(0, 200) : ''));
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  }
  const client = new OpenAI({ baseURL: o.baseUrl, apiKey: o.apiKey, maxRetries: 1, timeout: 60000 });
  const file = await toFile(bytes, name.includes('.') ? name : 'voice.' + (mime.includes('ogg') ? 'ogg' : 'mp3'), { type: mime });
  const r = await client.audio.transcriptions.create({ file, model: o.model });
  return r.text.trim();
}
