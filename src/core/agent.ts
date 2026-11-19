import type { ChatMessage, LlmClient, ToolCall } from './llm.js';
import { toToolSchemas, visibleTools } from '../tools/index.js';
import type { Tool, ToolContext } from '../tools/types.js';

export interface AgentDeps {
  llm: LlmClient;
  maxRounds: number;
}

export interface PendingAction {
  convo: ChatMessage[];
  toolCalls: ToolCall[];
  assistantMsg: ChatMessage;
  tools: Tool[];
  ctx: ToolContext;
  question: string;
  tokensSoFar: number;
  toolsUsedSoFar: string[];
}

export type AgentResult =
  | { kind: 'reply'; text: string; tokens: number; toolsUsed: string[] }
  | { kind: 'needs_confirm'; question: string; tokens: number; pending: PendingAction };

interface CallValidation {
  call: ToolCall;
  tool?: Tool;
  parsedArgs?: unknown;
  error?: string;
  confirmQuestion?: string;
}

function validateCalls(toolCalls: ToolCall[], allTools: Tool[], ctx: ToolContext): CallValidation[] {
  const byName = new Map(allTools.map((t) => [t.name, t]));
  return toolCalls.map((call) => {
    const tool = byName.get(call.name);
    if (!tool) return { call, error: `Lỗi: công cụ ${call.name} không tồn tại` };
    if (tool.access === 'admin' && !ctx.isAdmin) {
      return { call, error: `Lỗi: không có quyền dùng ${call.name}` };
    }
    if (tool.dmOnly && ctx.isGroup) {
      return { call, error: `Lỗi: ${call.name} chỉ dùng trong chat riêng` };
    }
    let parsedArgs: unknown = {};
    try {
      parsedArgs = call.arguments?.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      return { call, error: 'Lỗi: tham số không phải JSON hợp lệ' };
    }
    let confirmQuestion: string | undefined;
    if (tool.confirm) {
      try {
        const q = tool.confirm(parsedArgs, ctx);
        if (q) confirmQuestion = q;
      } catch (err) {
        return { call, error: `Lỗi: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { call, tool, parsedArgs, confirmQuestion };
  });
}

async function executeValidatedCalls(
  validations: CallValidation[],
  ctx: ToolContext,
  toolsUsed: string[],
): Promise<Array<{ id: string; output: string }>> {
  const outputs = new Map<string, string>();
  const readOnlyTasks: Promise<void>[] = [];
  const writeItems: CallValidation[] = [];

  for (const v of validations) {
    if (v.error || !v.tool) {
      outputs.set(v.call.id, v.error ?? 'Lỗi: không xác định');
      continue;
    }
    if (v.tool.readOnly) {
      const tool = v.tool;
      const args = v.parsedArgs;
      const id = v.call.id;
      readOnlyTasks.push(
        tool.run(args, ctx).then(
          (res) => { outputs.set(id, res); toolsUsed.push(tool.name); },
          (err) => { outputs.set(id, `Lỗi: ${err instanceof Error ? err.message : String(err)}`); },
        ),
      );
    } else {
      writeItems.push(v);
    }
  }

  await Promise.all(readOnlyTasks);

  for (const v of writeItems) {
    try {
      const res = await v.tool!.run(v.parsedArgs, ctx);
      outputs.set(v.call.id, res);
      toolsUsed.push(v.tool!.name);
    } catch (err) {
      outputs.set(v.call.id, `Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return validations.map((v) => ({
    id: v.call.id,
    output: outputs.get(v.call.id) ?? 'Lỗi: không có kết quả',
  }));
}

function buildAssistantToolCallMessage(toolCalls: ToolCall[], rawMessage?: ChatMessage): ChatMessage {
  if (rawMessage) return rawMessage;
  return {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
      ...(tc.extra_content !== undefined ? { extra_content: tc.extra_content } : {}),
    })),
  };
}

async function loop(
  convo: ChatMessage[],
  allTools: Tool[],
  ctx: ToolContext,
  deps: AgentDeps,
  startRound: number,
  initialTokens: number,
  toolsUsed: string[],
): Promise<AgentResult> {
  let totalTokens = initialTokens;
  const schemas = toToolSchemas(visibleTools(allTools, ctx));

  for (let round = startRound; round < deps.maxRounds; round++) {
    if (ctx.signal?.aborted) throw new Error('Tác vụ đã bị người dùng dừng lại.');
    const signal = ctx.signal ?? new AbortController().signal;
    const response = schemas.length > 0
      ? await deps.llm.complete(convo, signal, schemas)
      : await deps.llm.complete(convo, signal);
    totalTokens += response.tokens;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        kind: 'reply',
        text: response.text?.trim() || 'Mình chưa có câu trả lời, bạn hỏi lại giúp mình nhé.',
        tokens: totalTokens,
        toolsUsed,
      };
    }

    const validations = validateCalls(response.toolCalls, allTools, ctx);
    const questions = validations.map((v) => v.confirmQuestion).filter((q): q is string => Boolean(q));
    const assistantMsg = buildAssistantToolCallMessage(response.toolCalls, response.rawMessage);

    if (questions.length > 0) {
      const question = questions.join('\n');
      return {
        kind: 'needs_confirm',
        question,
        tokens: totalTokens,
        pending: {
          convo: [...convo],
          toolCalls: response.toolCalls,
          assistantMsg,
          tools: allTools,
          ctx,
          question,
          tokensSoFar: totalTokens,
          toolsUsedSoFar: [...toolsUsed],
        },
      };
    }

    const results = await executeValidatedCalls(validations, ctx, toolsUsed);
    convo.push(assistantMsg);
    for (const r of results) {
      convo.push({ role: 'tool', tool_call_id: r.id, content: r.output });
    }
  }

  throw new Error('Vượt quá số vòng lặp tối đa cho phép.');
}

export async function runAgent(
  convo: ChatMessage[],
  allTools: Tool[],
  ctx: ToolContext,
  deps: AgentDeps,
): Promise<AgentResult> {
  return loop([...convo], allTools, ctx, deps, 0, 0, []);
}

export async function resumeAfterConfirm(
  pending: PendingAction,
  approved: boolean,
  deps: AgentDeps,
  signal?: AbortSignal,
): Promise<AgentResult> {
  if (!approved) {
    return { kind: 'reply', text: 'Đã huỷ thao tác.', tokens: 0, toolsUsed: [] };
  }
  const ctx: ToolContext = { ...pending.ctx, ...(signal ? { signal } : {}) };
  const validations = validateCalls(pending.toolCalls, pending.tools, ctx).map((v) => ({
    ...v,
    confirmQuestion: undefined,
  }));
  const toolsUsed = [...pending.toolsUsedSoFar];
  const results = await executeValidatedCalls(validations, ctx, toolsUsed);
  const convo: ChatMessage[] = [...pending.convo, pending.assistantMsg];
  for (const r of results) {
    convo.push({ role: 'tool', tool_call_id: r.id, content: r.output });
  }
  return loop(convo, pending.tools, ctx, deps, 1, 0, toolsUsed);
}
