import type OpenAI from 'openai';

export type ChatMessage = OpenAI.ChatCompletionMessageParam;
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  extra_content?: unknown;
}
export interface LlmResult {
  text: string;
  tokens: number;
  toolCalls?: ToolCall[];
  rawMessage?: ChatMessage;
}
export interface LlmClient {
  complete(messages: ChatMessage[], signal: AbortSignal, tools?: ToolSchema[]): Promise<LlmResult>;
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
    async complete(messages, signal, tools) {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxOutputTokens,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(!isGemini ? { store: false } : {}),
      }, { signal });
      const message = response.choices[0]?.message;
      const fnCalls = (message?.tool_calls ?? [])
        .filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          ...('extra_content' in tc ? { extra_content: (tc as unknown as { extra_content: unknown }).extra_content } : {}),
        }));
      if (fnCalls.length > 0) {
        return {
          text: message?.content?.trim() || '',
          tokens: response.usage?.total_tokens ?? 0,
          toolCalls: fnCalls,
          rawMessage: message as unknown as ChatMessage,
        };
      }
      return {
        text: message?.content?.trim() || message?.refusal?.trim() || 'Mình chưa có câu trả lời, bạn hỏi lại giúp mình nhé.',
        tokens: response.usage?.total_tokens ?? 0,
      };
    },
  };
}
