import type OpenAI from 'openai';

export type ChatMessage = OpenAI.ChatCompletionMessageParam;
export interface LlmResult { text: string; tokens: number }
export interface LlmClient {
  complete(messages: ChatMessage[], signal: AbortSignal): Promise<LlmResult>;
}

export function createOpenAiLlm(
  client: Pick<OpenAI, 'chat'> & Partial<Pick<OpenAI, 'baseURL'>>,
  model: string,
  maxOutputTokens: number,
): LlmClient {
  // Google's compatibility endpoint rejects the OpenAI-only store field.
  const isGemini = client.baseURL !== undefined
    && new URL(client.baseURL).hostname === 'generativelanguage.googleapis.com';
  return {
    async complete(messages, signal) {
      const response = await client.chat.completions.create({
        model, messages, max_completion_tokens: maxOutputTokens,
        ...(!isGemini ? { store: false } : {}),
      }, { signal });
      const message = response.choices[0]?.message;
      return {
        text: message?.content?.trim() || message?.refusal?.trim() || 'Mình chưa có câu trả lời, bạn hỏi lại giúp mình nhé.',
        tokens: response.usage?.total_tokens ?? 0,
      };
    },
  };
}
