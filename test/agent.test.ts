import { describe, it, expect, vi } from 'vitest';
import { resumeAfterConfirm, runAgent } from '../src/core/agent.js';
import type { ChatMessage, LlmClient, LlmResult, ToolSchema } from '../src/core/llm.js';
import type { Tool, ToolContext } from '../src/tools/types.js';

function createFakeLlm(responses: LlmResult[]) {
  const calls: Array<{ messages: ChatMessage[]; tools?: ToolSchema[] }> = [];
  let idx = 0;
  const llm: LlmClient = {
    async complete(messages, _signal, tools) {
      calls.push({ messages: [...messages], tools });
      const res = responses[idx++];
      if (!res) throw new Error('Out of fake LLM responses');
      return res;
    },
  };
  return { llm, calls };
}

const adminCtx: ToolContext = {
  threadId: '6864517458',
  senderId: '6864517458',
  isAdmin: true,
  isGroup: false,
};

const guestCtx: ToolContext = {
  threadId: '-5185817080',
  senderId: '999',
  isAdmin: false,
  isGroup: true,
};

describe('Safe Agent Loop', () => {
  it('returns final content when no tool calls', async () => {
    const { llm } = createFakeLlm([{ text: 'Xin chào Hữu Luân!', tokens: 12 }]);
    const res = await runAgent([{ role: 'user', content: 'hi' }], [], adminCtx, { llm, maxRounds: 5 });
    expect(res).toEqual({ kind: 'reply', text: 'Xin chào Hữu Luân!', tokens: 12, toolsUsed: [] });
  });

  it('runs tool and feeds result back to the model', async () => {
    const { llm, calls } = createFakeLlm([
      { text: '', tokens: 10, toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: '{"msg":"ok"}' }] },
      { text: 'Kết quả là: ok', tokens: 15 },
    ]);
    const tool: Tool = {
      name: 'echo_tool',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      access: 'public',
      readOnly: true,
      run: async (args) => `echo:${(args as { msg: string }).msg}`,
    };
    const res = await runAgent([{ role: 'user', content: 'test' }], [tool], adminCtx, { llm, maxRounds: 5 });
    expect(res).toEqual({ kind: 'reply', text: 'Kết quả là: ok', tokens: 25, toolsUsed: ['echo_tool'] });
    expect(calls[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'c1', content: 'echo:ok' });
  });

  it('blocks admin tool for guest even if model hallucinated its name', async () => {
    const adminRun = vi.fn(async () => 'secret');
    const adminTool: Tool = {
      name: 'admin_only',
      description: 'admin',
      parameters: { type: 'object', properties: {} },
      access: 'admin',
      readOnly: false,
      run: adminRun,
    };
    const { llm, calls } = createFakeLlm([
      { text: '', tokens: 10, toolCalls: [{ id: 'c1', name: 'admin_only', arguments: '{}' }] },
      { text: 'Không có quyền', tokens: 10 },
    ]);
    await runAgent([{ role: 'user', content: 'hack' }], [adminTool], guestCtx, { llm, maxRounds: 5 });
    expect(adminRun).not.toHaveBeenCalled();
    expect(calls[0].tools).toBeUndefined();
    const toolMsg = calls[1].messages.find((m) => m.role === 'tool' && 'tool_call_id' in m && m.tool_call_id === 'c1');
    expect(toolMsg && 'content' in toolMsg ? toolMsg.content : '').toMatch(/không có quyền/);
  });

  it('pauses for confirmation without running anything, and resumes on approval or cancels on rejection', async () => {
    const runFn = vi.fn(async () => 'Đã xoá');
    const dangerTool: Tool = {
      name: 'danger',
      description: 'danger',
      parameters: { type: 'object', properties: {} },
      access: 'admin',
      readOnly: false,
      confirm: () => 'Bạn có chắc muốn xoá X?',
      run: runFn,
    };
    const { llm } = createFakeLlm([
      { text: '', tokens: 10, toolCalls: [{ id: 'c1', name: 'danger', arguments: '{}' }] },
      { text: 'Đã hoàn tất xoá X.', tokens: 12 },
    ]);
    const step1 = await runAgent([{ role: 'user', content: 'xoá X' }], [dangerTool], adminCtx, { llm, maxRounds: 5 });
    expect(step1.kind).toBe('needs_confirm');
    expect(runFn).not.toHaveBeenCalled();
    if (step1.kind !== 'needs_confirm') throw new Error('expected needs_confirm');

    const rejected = await resumeAfterConfirm(step1.pending, false, { llm, maxRounds: 5 });
    expect(rejected).toEqual({ kind: 'reply', text: 'Đã huỷ thao tác.', tokens: 0, toolsUsed: [] });
    expect(runFn).not.toHaveBeenCalled();

    const approved = await resumeAfterConfirm(step1.pending, true, { llm, maxRounds: 5 });
    expect(runFn).toHaveBeenCalledOnce();
    expect(approved).toEqual({ kind: 'reply', text: 'Đã hoàn tất xoá X.', tokens: 12, toolsUsed: ['danger'] });
  });
});
