import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { createOpenAiLlm } from '../src/core/llm.js';

describe('AI adapter', () => {
  it('sends a Gemini-compatible request without the unsupported store field', async () => {
    let request: Record<string, unknown> = {};
    const client = new OpenAI({
      apiKey: 'test-key', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      fetch: async (_url, init) => {
        request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Xin chào' } }] }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const result = await createOpenAiLlm(client, 'gemini-3.1-flash-lite', 600)
      .complete([{ role: 'user', content: 'hello' }], new AbortController().signal);
    expect(request).not.toHaveProperty('store');
    expect(request).toMatchObject({ model: 'gemini-3.1-flash-lite', max_completion_tokens: 600 });
    expect(result.text).toBe('Xin chào');
  });
  it('passes model, token cap and abort signal, without tools or stored responses', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: ' xin chào ' } }], usage: { total_tokens: 42 } });
    const llm = createOpenAiLlm({ chat: { completions: { create } } } as unknown as Pick<OpenAI, 'chat'>, 'configured-model', 600);
    const signal = new AbortController().signal;
    const messages = [{ role: 'user' as const, content: 'hello' }];
    expect(await llm.complete(messages, signal)).toEqual({ text: 'xin chào', tokens: 42 });
    expect(create).toHaveBeenCalledWith({ model: 'configured-model', messages, max_completion_tokens: 600, store: false }, { signal });
  });
  it('handles empty replies and refusals', async () => {
    const create = vi.fn().mockResolvedValueOnce({ choices: [] }).mockResolvedValueOnce({ choices: [{ message: { refusal: 'Không thể hỗ trợ.' } }] });
    const llm = createOpenAiLlm({ chat: { completions: { create } } } as unknown as Pick<OpenAI, 'chat'>, 'm', 10);
    const signal = new AbortController().signal;
    expect((await llm.complete([], signal)).text).toContain('hỏi lại');
    expect((await llm.complete([], signal)).text).toBe('Không thể hỗ trợ.');
  });
});
