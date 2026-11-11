# Kế hoạch 1 — Bot Telegram lõi (GĐ 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Telegram AI Agent chạy được: có vòng lặp Tool Calling, tra web, trí nhớ phân tầng, phân quyền Admin/Khách và duyệt "ok" trước thao tác rủi ro.

**Architecture:** 5 lớp theo spec Mục 3 (Adapter → Dispatcher → Agent → Tools / Memory). Mọi phụ thuộc bên ngoài (Telegram, LLM, fetch, đồng hồ, file) được tiêm qua tham số để test bằng fake, không gọi mạng thật trong test. Lõi không biết gì về Telegram — chỉ làm việc với `IncomingMessage`.

**Tech Stack:** Node 22, TypeScript (ESM, `module: NodeNext`, `strict`), `node-telegram-bot-api`, `openai` SDK (endpoint OpenAI-compatible), `zod` (kiểm tra tham số tool), `dotenv`, `vitest`, `tsx` (chạy dev).

**Spec:** `HUONG-DAN-XAY-BOT.md` (các mục 1–3, 5.6–5.12, 7 GĐ 1–3, 8, 9). Lộ trình: `docs/superpowers/plans/2026-11-11-lo-trinh-tong-the.md`.

## Global Constraints

- Phân quyền Admin **chỉ** so khớp `senderId` (chuỗi số do nền tảng cấp), không bao giờ dùng tên hiển thị (spec 3.1).
- Khách tuyệt đối không nhìn thấy tool `access: 'admin'` trong schema gửi model, và backend phải chặn lại nếu model vẫn gọi (spec 3.4).
- Backend phải tự kiểm tra tham số tool, không tin schema phía model (spec 3.4) — dùng `zod` trong `run`.
- Group: chỉ trả lời khi `@tag` đích danh hoặc biệt danh; reply/gọi tên không tag → chỉ lưu ambient context (spec 2.5).
- Lọc quyền trí nhớ **tại thời điểm thu thập**: fact nói trong DM có `visibility: 'private'`, do code đặt chứ không do model chọn (spec 5.7).
- Fact quá 90 ngày, hoặc fact biến động quá 14 ngày → gắn cờ để bot hỏi lại (spec 3.5).
- History lưu JSONL tại `data/threads/<threadId>/history.jsonl` (spec 3.5, 8).
- Persona tại `config/persona.prompt.md`, không hard-code trong TS; mặc định trả lời 1–3 câu, đáp án lên đầu (spec 5.8, 5.10).
- Web search: `search_depth: 'basic'`, `include_raw_content: true`, cache RAM 10 phút (spec 5.9).
- Quét API key/token/mật khẩu khỏi mọi văn bản gửi ra chat và log (spec 3.2.7).
- `.env`, `data/`, `.secrets/`, `*.session`, `node_modules/`, `dist/` nằm trong `.gitignore`.
- Chỉ chạy bot ở MỘT nơi tại một thời điểm (spec 5.1).
- Ưu tiên viết test cho logic an toàn, không test nội dung câu văn của model (spec 5.12).

## Review Focus

1. **Mạo danh bằng tên hiển thị** — khách đổi tên thành "Hiếu (Admin)" vẫn phải là khách. Test: Task 2 (`senderId` lấy từ `from.id`), Task 11 (`spoofed name stays guest`).
2. **Model gọi tool admin theo tên dù không có trong schema** — phải bị chặn, `run` không được gọi. Test: Task 5 (`blocks admin tool for guest even if model names it`).
3. **Người không phải admin gõ "ok"** khi đang có thao tác chờ duyệt — không được duyệt. Test: Task 11 (`non-admin ok does not approve`).
4. **Câu trả lời dài hơn 4096 ký tự** (giới hạn Telegram) — phải chia nhỏ, không văng lỗi. Test: Task 2 (`splitMessage`).
5. **Bí mật lọt qua đường lỗi** — exception chứa token/API key không được xuất hiện trong chat hay log. Test: Task 11 (`llm error is redacted in chat and log`).

---

## Cấu trúc file

```
src/
  index.ts                     # nạp env, dựng deps, khởi động Telegram
  config.ts                    # loadConfig(env) -> Config
  types.ts                     # IncomingMessage, FileAttachment
  adapters/telegram/
    parse.ts                   # Telegram.Message -> IncomingMessage | null
    split.ts                   # splitMessage(text, max)
    client.ts                  # startTelegram(cfg, onMessage) -> { send }
  core/
    persona.ts                 # createPersona(path) -> { get() }
    llm.ts                     # LlmClient + createOpenAiLlm()
    agent.ts                   # runAgent(), resumeAfterConfirm()
    confirm.ts                 # classifyReply(), PendingConfirmations
    memory.ts                  # ThreadHistory (JSONL)
    facts.ts                   # FactStore, renderMemoryForPrompt()
    redact.ts                  # redact(text, secrets)
    dispatcher.ts              # createDispatcher(deps) -> { handle(msg) }
  tools/
    types.ts                   # Tool, ToolContext
    index.ts                   # visibleTools(), toToolSchemas()
    time.ts                    # get_current_time
    web.ts                     # web_search (Tavily)
    memoryTools.ts             # remember_fact, forget_fact
config/persona.prompt.md
test/                          # một file *.test.ts cho mỗi module ở trên
.env.example  .gitignore  package.json  tsconfig.json
```

---

### Task 1: Khởi tạo dự án & cấu hình

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Config {
  telegramToken: string; botUsername: string; botAliases: string[];   // aliases viết thường, không có '@'
  adminIds: Set<string>; allowedGroups: Set<string>; dmPolicy: 'admin' | 'open';
  aiBaseUrl: string; aiApiKey: string; aiModel: string; maxRounds: number;
  tavilyApiKey?: string; dataDir: string; personaPath: string;
}
export function loadConfig(env: Record<string, string | undefined>): Config;
```
Env → field: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `BOT_ALIASES` (phẩy), `ADMIN_TELEGRAM_IDS` (phẩy), `ALLOWED_GROUPS` (phẩy), `DM_POLICY`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `MAX_ROUNDS`, `TAVILY_API_KEY`, `DATA_DIR`, `PERSONA_PATH`.

- [ ] **Step 1:** `git init`; tạo `package.json` (`"type": "module"`, scripts `dev: tsx src/index.ts`, `build: tsc`, `start: node dist/index.js`, `test: vitest run`, `typecheck: tsc --noEmit`), cài `node-telegram-bot-api openai zod dotenv` và dev `typescript tsx vitest @types/node @types/node-telegram-bot-api`. `tsconfig.json`: `strict`, `module/moduleResolution: NodeNext`, `target: ES2022`, `outDir: dist`, `rootDir: src`. `.gitignore` theo Global Constraints. `.env.example` liệt kê mọi biến ở trên với giá trị rỗng/mặc định.

- [ ] **Step 2: Viết test thất bại**
```ts
const base = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: 'HieuBot', AI_API_KEY: 'k', ADMIN_TELEGRAM_IDS: ' 111, 222 ' };
it('throws listing every missing required var', () => {
  expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_BOT_USERNAME[\s\S]*AI_API_KEY[\s\S]*ADMIN_TELEGRAM_IDS/);
});
it('parses lists and applies defaults', () => {
  const c = loadConfig({ ...base, ALLOWED_GROUPS: '-100,-200', BOT_ALIASES: '@Goblin, bé' });
  expect([...c.adminIds]).toEqual(['111', '222']);
  expect(c.allowedGroups.has('-200')).toBe(true);
  expect(c.botAliases).toEqual(['goblin', 'bé']);
  expect(c).toMatchObject({ aiBaseUrl: 'https://api.openai.com/v1', aiModel: 'gpt-4o-mini', maxRounds: 5,
    dmPolicy: 'admin', dataDir: 'data', personaPath: 'config/persona.prompt.md' });
  expect(c.tavilyApiKey).toBeUndefined();
});
it('rejects invalid DM_POLICY and non-positive MAX_ROUNDS', () => {
  expect(() => loadConfig({ ...base, DM_POLICY: 'everyone' })).toThrow(/DM_POLICY/);
  expect(() => loadConfig({ ...base, MAX_ROUNDS: '0' })).toThrow(/MAX_ROUNDS/);
});
```
- [ ] **Step 3:** `npx vitest run test/config.test.ts` → FAIL (module không tồn tại).
- [ ] **Step 4:** Implement `loadConfig` trong `src/config.ts` (gom tất cả biến thiếu vào một lỗi).
- [ ] **Step 5:** `npx vitest run test/config.test.ts` → PASS; `npm run typecheck` → không lỗi.
- [ ] **Step 6:** `git add -A && git commit -m "chore: scaffold project and config loader"`

---

### Task 2: Adapter Telegram — chuẩn hoá tin nhắn & chia tin dài

**Files:**
- Create: `src/types.ts`, `src/adapters/telegram/parse.ts`, `src/adapters/telegram/split.ts`
- Test: `test/telegram-parse.test.ts`, `test/split.test.ts`

**Interfaces:**
- Produces:
```ts
// src/types.ts
export interface FileAttachment { kind: 'photo' | 'document'; fileId: string; mimeType?: string; fileName?: string }
export interface IncomingMessage {
  threadId: string; senderId: string; senderName?: string; text: string;
  attachments?: FileAttachment[]; isGroup: boolean; msgId: string; replyTo?: string;
  mentionsBot: boolean;   // mở rộng so với spec: true khi @tag bot hoặc @biệt danh
}
// parse.ts
export function parseTelegramMessage(msg: TelegramBot.Message, botUsername: string, aliases: string[]): IncomingMessage | null;
// split.ts
export function splitMessage(text: string, max = 4000): string[];
```
Quy tắc: `threadId = String(chat.id)`; `senderId = String(from.id)`; `msgId = \`${chat.id}:${message_id}\``; `isGroup` khi `chat.type` là `group`/`supergroup`; `text = msg.text ?? msg.caption ?? ''`, đã bỏ phần `@tag` và trim; photo → lấy phần tử cuối của `msg.photo`; `replyTo = String(reply_to_message.message_id)`. Trả `null` khi `from` vắng, `from.is_bot`, hoặc không có text lẫn attachment. Reply vào tin của bot mà không tag → `mentionsBot: false`.

- [ ] **Step 1: Viết test thất bại** (dựng `Message` giả bằng object literal ép kiểu):
  - `uses from.id as senderId even when name says Admin` — `from: {id: 7, first_name: 'Admin'}` → `senderId === '7'`, `senderName === 'Admin'`.
  - `private chat` → `{ threadId: '42', isGroup: false, msgId: '42:10', mentionsBot: false }`.
  - `group mention entity is case-insensitive and stripped` — text `'@hieubot giá vàng?'` + entity `mention` offset 0 length 8 → `mentionsBot: true`, `text: 'giá vàng?'`.
  - `alias counts as mention` — aliases `['goblin']`, text `'@Goblin hi'` → `mentionsBot: true`, `text: 'hi'`.
  - `reply to bot without tag is not a mention` → `mentionsBot: false`, `replyTo: '5'`.
  - `ignores bots and empty messages` → `null`.
  - `photo caption becomes text` → `text: 'xem ảnh'`, `attachments[0]` là `{ kind: 'photo', fileId: <id lớn nhất> }`.
  - `splitMessage`: 9000 ký tự → mọi phần `length <= 4000` và `parts.join('') === input`; khi có `\n` trong 4000 ký tự đầu thì cắt ngay sau `\n` cuối cùng; chuỗi ngắn → `[input]`; chuỗi rỗng → `[]`.
- [ ] **Step 2:** `npx vitest run test/telegram-parse.test.ts test/split.test.ts` → FAIL.
- [ ] **Step 3:** Implement `parseTelegramMessage` và `splitMessage`.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** `git commit -am "feat: telegram message parsing and splitting"` (nhớ `git add` file mới).

---

### Task 3: Persona, LLM client & bot GĐ1 chạy thật

**Files:**
- Create: `config/persona.prompt.md`, `src/core/persona.ts`, `src/core/llm.ts`, `src/adapters/telegram/client.ts`, `src/index.ts`
- Test: `test/persona.test.ts`, `test/llm.test.ts`

**Interfaces:**
- Consumes: `Config`, `IncomingMessage`, `parseTelegramMessage`, `splitMessage`.
- Produces:
```ts
// persona.ts — đọc lại file khi mtime đổi, không cần build lại
export function createPersona(path: string): { get(): string };
// llm.ts
export type ChatMessage = OpenAI.ChatCompletionMessageParam;
export interface ToolSchema { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ToolCall { id: string; name: string; arguments: string }
export interface LlmResponse { content: string | null; toolCalls: ToolCall[] }
export interface LlmClient {
  complete(messages: ChatMessage[], tools: ToolSchema[], opts: { model: string; signal?: AbortSignal }): Promise<LlmResponse>;
}
export function createOpenAiLlm(client: Pick<OpenAI, 'chat'>): LlmClient;  // nhận instance để test được
// client.ts
export function startTelegram(cfg: Config, onMessage: (m: IncomingMessage) => void): { send(threadId: string, text: string): Promise<void> };
```
`complete` không gửi trường `tools` khi mảng rỗng. `send` gọi `sendMessage` tuần tự cho từng phần của `splitMessage`. `startTelegram` dùng long-polling, gửi `typing` trước khi gọi `onMessage`.

`config/persona.prompt.md` (bản đầu, chỉnh tự do sau): xưng hô thân thiện; **trả lời 1–3 câu, đáp án/số liệu lên đầu, bỏ rào đón; chỉ viết dài khi được yêu cầu "giải thích chi tiết"**; không bịa đã làm xong việc khi chưa gọi công cụ; khi thông tin trí nhớ bị gắn "(cũ, cần hỏi lại)" thì hỏi lại thay vì khẳng định.

- [ ] **Step 1: Viết test thất bại**
  - `persona reloads when file changes` — ghi file tạm `'A'`, `get() === 'A'`; ghi `'B'` và `fs.utimesSync` đẩy mtime +5s → `get() === 'B'`.
  - `maps tool_calls` — fake `client.chat.completions.create` trả `{choices:[{message:{content:null, tool_calls:[{id:'c1',type:'function',function:{name:'x',arguments:'{}'}}]}}]}` → `{ content: null, toolCalls: [{ id: 'c1', name: 'x', arguments: '{}' }] }`.
  - `omits tools param when empty and passes model + signal` — kiểm tra đối số mà fake nhận được.
- [ ] **Step 2:** Chạy 2 file test → FAIL.
- [ ] **Step 3:** Implement `persona.ts`, `llm.ts`, `client.ts`. `src/index.ts` (tạm thời cho GĐ1): `dotenv/config` → `loadConfig(process.env)` → `startTelegram`, mỗi tin: `llm.complete([{role:'system', content: persona.get()}, {role:'user', content: m.text}], [], {model})` rồi `send`.
- [ ] **Step 4:** Test → PASS; `npm run typecheck` → không lỗi.
- [ ] **Step 5: Kiểm chứng thật:** tạo bot qua `@BotFather`, điền `.env`, `npm run dev`, nhắn "chào" ở DM → bot trả lời ngắn. Sửa persona (vd. thêm "luôn kết câu bằng 🐸"), nhắn lại → giọng đổi mà không restart.
- [ ] **Step 6:** Commit `feat: telegram bot replies via LLM with file-based persona`.

---

### Task 4: Hợp đồng Tool, bộ lọc quyền & `get_current_time`

**Files:**
- Create: `src/tools/types.ts`, `src/tools/index.ts`, `src/tools/time.ts`
- Test: `test/tools-registry.test.ts`

**Interfaces:**
- Consumes: `ToolSchema` (Task 3).
- Produces:
```ts
export interface ToolContext { threadId: string; senderId: string; isAdmin: boolean; isGroup: boolean; signal?: AbortSignal }
export interface Tool {   // đúng spec 3.4
  name: string; description: string; parameters: Record<string, unknown>;
  access: 'public' | 'admin'; readOnly: boolean; dmOnly?: boolean;
  confirm?: (args: unknown) => string | null;
  run: (args: unknown, ctx: ToolContext) => Promise<string>;
}
export function visibleTools(all: Tool[], ctx: ToolContext): Tool[];   // bỏ admin nếu !isAdmin, bỏ dmOnly nếu isGroup
export function toToolSchemas(tools: Tool[]): ToolSchema[];
export function createTimeTool(now?: () => Date): Tool;   // name 'get_current_time', public, readOnly
```
- [ ] **Step 1: Viết test thất bại**
  - `guest never sees admin tools` — `visibleTools([pub, adm], guestCtx).map(t => t.name)` → `['pub']`; với admin → cả hai.
  - `dmOnly tools hidden in groups` — có trong DM, không có khi `isGroup: true`.
  - `toToolSchemas shape` → `[{ type: 'function', function: { name, description, parameters } }]`.
  - `time tool uses Asia/Ho_Chi_Minh` — `now = () => new Date('2026-11-11T01:00:00Z')` → kết quả chứa `'08:00'` và `'11/11/2026'`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (`toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })`) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: tool contract, permission filter, time tool`.

---

### Task 5: Vòng lặp Agent an toàn

**Files:**
- Create: `src/core/agent.ts`
- Test: `test/agent.test.ts` (dùng `FakeLlm` trả lần lượt các `LlmResponse` đã định sẵn và ghi lại `messages` mỗi lần gọi)

**Interfaces:**
- Consumes: `LlmClient`, `ChatMessage`, `ToolCall`, `Tool`, `ToolContext`, `visibleTools`, `toToolSchemas`.
- Produces:
```ts
export interface AgentDeps { llm: LlmClient; model: string; maxRounds: number }
export interface PendingAction { convo: ChatMessage[]; toolCalls: ToolCall[]; tools: Tool[]; ctx: ToolContext; question: string }
export type AgentResult =
  | { kind: 'reply'; text: string; toolsUsed: string[] }      // toolsUsed: tên tool đã chạy thành công (cho Honesty Guard ở KH2)
  | { kind: 'needs_confirm'; question: string; pending: PendingAction };
export function runAgent(convo: ChatMessage[], allTools: Tool[], ctx: ToolContext, deps: AgentDeps): Promise<AgentResult>;
export function resumeAfterConfirm(p: PendingAction, approved: boolean, deps: AgentDeps): Promise<AgentResult>;
```
Hành vi:
- Mỗi vòng: nếu `ctx.signal?.aborted` → throw `'Tác vụ đã bị người dùng dừng lại.'`; gửi model `toToolSchemas(visibleTools(allTools, ctx))`.
- Không có tool call → `reply` với `content`; `content` rỗng/null → `'Mình chưa có câu trả lời, bạn hỏi lại giúp mình nhé.'`
- Có tool call: nếu **bất kỳ** call nào có `confirm(args)` trả về câu hỏi (và call đó hợp lệ) → **không chạy call nào của vòng này**, trả `needs_confirm` với `question` là các câu hỏi nối bằng `\n`.
- Thực thi mỗi call qua kiểm tra theo thứ tự, mỗi lỗi trở thành nội dung message `tool` (không throw ra ngoài): không có tool → `Lỗi: công cụ <name> không tồn tại`; `access==='admin' && !isAdmin` → `Lỗi: không có quyền dùng <name>`; `dmOnly && isGroup` → `Lỗi: <name> chỉ dùng trong chat riêng`; JSON hỏng → `Lỗi: tham số không phải JSON hợp lệ`; `run` throw → `Lỗi: <message>`.
- Các call `readOnly` chạy song song (`Promise.all`); call ghi chạy tuần tự theo thứ tự, sau nhóm readOnly. Message `tool` được đẩy vào convo theo **thứ tự gốc** của `toolCalls`.
- Hết `maxRounds` → throw `'Vượt quá số vòng lặp tối đa cho phép.'`
- `resumeAfterConfirm(p, true)`: chạy `p.toolCalls` bỏ qua `confirm`, rồi tiếp tục vòng lặp từ `p.convo`. `false` → `{ kind: 'reply', text: 'Đã huỷ thao tác.', toolsUsed: [] }`, không chạy tool nào.

- [ ] **Step 1: Viết test thất bại**
```ts
it('returns final content when no tool calls', ...)                 // text === 'xin chào'
it('runs tool and feeds result back', ...)                          // lần gọi 2: messages chứa { role: 'tool', tool_call_id: 'c1', content: '42' }
it('blocks admin tool for guest even if model names it', async () => {
  // allTools có adminTool (run = vi.fn()); llm gọi 'admin_tool' trong ctx khách
  expect(adminTool.run).not.toHaveBeenCalled();
  expect(toolMsgOf(llm.calls[1], 'c1')).toMatch(/không có quyền/);
  expect(llm.calls[0].tools.map(t => t.function.name)).not.toContain('admin_tool');
});
it('unknown tool, bad JSON and throwing tool become tool errors', ...)  // /không tồn tại/, /JSON/, /^Lỗi: boom/
it('throws after maxRounds', ...)                                    // llm luôn trả tool call → rejects /tối đa/
it('throws when aborted before calling llm', ...)                    // llm.calls.length === 0
it('runs readOnly tools concurrently, write tools sequentially', ...) // 2 readOnly cùng "started" trước khi resolve; 2 write: start2 sau end1
it('pauses for confirmation without running anything', ...)          // kind 'needs_confirm', question 'Xoá X?', run chưa gọi
it('resume approved runs tool and continues; rejected cancels', ...) // approved → run gọi 1 lần, reply cuối; rejected → 'Đã huỷ thao tác.'
it('empty final content gets fallback text', ...)
```
- [ ] **Step 2:** `npx vitest run test/agent.test.ts` → FAIL.
- [ ] **Step 3:** Implement `runAgent` / `resumeAfterConfirm` (logic chung trong một hàm nội bộ `loop(convo, ...)`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: safe agent loop with permission checks and confirmation pause`.

---

### Task 6: Hàng chờ duyệt "ok" (HITL)

**Files:**
- Create: `src/core/confirm.ts`
- Test: `test/confirm.test.ts`

**Interfaces:**
- Consumes: `PendingAction`.
- Produces:
```ts
export function classifyReply(text: string): 'approve' | 'reject' | null;
export class PendingConfirmations {
  constructor(ttlMs?: number /* mặc định 10 phút */, now?: () => number);
  set(threadId: string, p: PendingAction): void;          // ghi đè cái cũ của thread
  has(threadId: string): boolean;                          // false nếu đã hết hạn
  take(threadId: string): PendingAction | undefined;      // lấy ra và xoá
}
```
`classifyReply`: lowercase, trim, bỏ dấu câu cuối, chuẩn hoá Unicode NFC; **khớp nguyên câu** với approve = `ok, oke, okay, ừ, ừm, uh, có, đồng ý, tiến hành, yes, y`; reject = `thôi, huỷ, hủy, không, ko, no, cancel, dừng`.

- [ ] **Step 1: Viết test thất bại** — bảng: `'OK!'`→approve, `' tiến hành '`→approve, `'Hủy'` và `'huỷ'`→reject, `'ok nhưng đổi tên file đi'`→null, `''`→null; `set` rồi `take` trả về đúng object và lần `take` thứ hai `undefined`; với `now` giả, sau `ttlMs + 1` → `has() === false`, `take() === undefined`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: pending confirmation store and reply classifier`.

---

### Task 7: Công cụ `web_search` (Tavily)

**Files:**
- Create: `src/tools/web.ts`
- Test: `test/web.test.ts`

**Interfaces:**
- Consumes: `Tool`.
- Produces: `export function createWebSearchTool(apiKey: string, fetchFn?: typeof fetch, now?: () => number): Tool;`
  - `name: 'web_search'`, `access: 'public'`, `readOnly: true`; parameters `{ query: string (bắt buộc), max_results?: integer 1–8, mặc định 5 }`, kiểm tra bằng zod.
  - POST `https://api.tavily.com/search`, header `Authorization: Bearer <apiKey>`, body `{ query, search_depth: 'basic', include_raw_content: true, max_results }`.
  - Kết quả: mỗi mục `"<title>\n<url>\n<raw_content cắt tối đa 3000 ký tự, nếu không có thì content>"`, các mục cách nhau `\n---\n`.
  - Cache theo query đã chuẩn hoá (lowercase + gộp khoảng trắng) + max_results, TTL 10 phút.
  - HTTP không 2xx → throw `Error('Tavily lỗi HTTP <status>')`.

- [ ] **Step 1: Viết test thất bại** — body gửi đi có `search_depth: 'basic'` và `include_raw_content: true`; header Authorization đúng; raw_content 5000 ký tự bị cắt còn 3000; `'Giá  Vàng'` rồi `'giá vàng'` trong 10 phút → `fetchFn` gọi 1 lần, sau `10*60_000 + 1` ms → 2 lần; `{ query: 5 }` → rejects; status 500 → rejects `/HTTP 500/`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: tavily web_search tool with 10-minute cache`.

---

### Task 8: Lịch sử hội thoại JSONL

**Files:**
- Create: `src/core/memory.ts`
- Test: `test/memory.test.ts` (dùng thư mục tạm `fs.mkdtempSync`)

**Interfaces:**
- Produces:
```ts
export interface HistoryEntry { role: 'user' | 'assistant'; text: string; at: number; senderId?: string; senderName?: string; ambient?: boolean }
export class ThreadHistory {
  constructor(dataDir: string);
  append(threadId: string, e: HistoryEntry): Promise<void>;
  recent(threadId: string, max?: number /* mặc định 40 */): Promise<HistoryEntry[]>;  // cũ → mới
}
```
File: `<dataDir>/threads/<safeId>/history.jsonl`, `safeId` = threadId thay mọi ký tự ngoài `[A-Za-z0-9_-]` bằng `_`. Dòng hỏng bị bỏ qua. Thread chưa có file → `[]`.

- [ ] **Step 1: Viết test thất bại** — append 3 rồi `recent(id, 2)` trả 2 mục cuối đúng thứ tự; `'-100123'` tạo đúng `threads/-100123/history.jsonl`; `'../evil'` → file nằm **trong** `dataDir/threads/`; một dòng rác giữa file không làm hỏng `recent`; thread mới → `[]`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: per-thread JSONL history`.

---

### Task 9: Trí nhớ sự thật (Facts) & công cụ ghi nhớ

**Files:**
- Create: `src/core/facts.ts`, `src/tools/memoryTools.ts`
- Test: `test/facts.test.ts`, `test/memory-tools.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`.
- Produces:
```ts
export type Confidence = 'true' | 'joke' | 'unsure';
export interface Fact {
  id: string; content: string; subjectId: string; sourceId: string; threadId: string;
  createdAt: number; confidence: Confidence; visibility: 'private' | 'group'; volatile: boolean;
  tombstone?: { at: number; reason: string };
}
export interface FactScope { threadId: string; senderId: string; isGroup: boolean }
export class FactStore {
  constructor(filePath: string /* data/facts.json */, now?: () => number);
  add(input: Omit<Fact, 'id' | 'createdAt' | 'visibility' | 'tombstone'>, scope: FactScope): Fact; // visibility = isGroup ? 'group' : 'private'
  get(id: string): Fact | undefined;
  search(scope: FactScope, limit?: number /* 30, mới nhất trước */): (Fact & { stale: boolean })[];
  tombstone(id: string, reason: string): void;
  tombstones(scope: FactScope): Fact[];          // cùng quy tắc phạm vi như search
}
export function renderMemoryForPrompt(facts: (Fact & { stale: boolean })[], tombstones: Fact[]): string;
export function createMemoryTools(store: FactStore): Tool[];   // [remember_fact, forget_fact]
```
Quy tắc phạm vi (chặn cứng trong code, spec 5.7):
- Trong **group**: chỉ fact có `visibility === 'group'` **và** `threadId === scope.threadId`.
- Trong **DM**: fact có `threadId === scope.threadId`, hoặc (`visibility === 'group'` và `subjectId === scope.senderId`).
- Bỏ fact có `tombstone` khỏi `search`. Ghi file đồng bộ sau mỗi thay đổi (ghi file tạm rồi rename).
- `stale` = tuổi > 90 ngày, hoặc `volatile` và tuổi > 14 ngày.
- `renderMemoryForPrompt`: mỗi dòng `- [id] content (nguồn: sourceId, <ngày>, độ tin cậy: Thật|Đùa|Chưa chắc)` + ` (cũ, cần hỏi lại)` nếu stale; nếu có tombstone thêm mục `Thông tin đã đính chính, KHÔNG dùng lại:` liệt kê content cũ.

Tools:
- `remember_fact` — public, `readOnly: false`; args `{ content: string, confidence: Confidence, volatile?: boolean, about?: string, replacesId?: string }`. `subjectId = ctx.isAdmin && about ? about : ctx.senderId`; mọi trường `visibility` model gửi kèm bị bỏ qua. `replacesId`: chỉ tombstone (reason `'đính chính'`) nếu fact đó có `subjectId === ctx.senderId` hoặc `ctx.isAdmin`, ngược lại throw `'không được sửa thông tin của người khác'`. Trả `'Đã ghi nhớ [<id>]'`.
- `forget_fact` — `access: 'admin'`, `readOnly: false`; args `{ id: string, reason: string }`; `confirm` trả `Xoá ghi nhớ "<content>"?` (hoặc `null` nếu id không tồn tại → `run` sẽ throw `'không tìm thấy'`).

- [ ] **Step 1: Viết test thất bại**
  - `DM fact never visible in any group` — add trong DM `'u1'`; `search` ở group `'-1'` → rỗng; ở DM `'u1'` → có, `visibility: 'private'`.
  - `group fact not visible in another group` — add ở `'-1'`, search ở `'-2'` → rỗng.
  - `staleness` — now giả: 91 ngày → stale; volatile 15 ngày → stale; volatile 13 ngày → không.
  - `tombstoned facts hidden from search, listed in tombstones()`.
  - `persists across instances` — `new FactStore(samePath).search(...)` thấy fact cũ.
  - `remember_fact ignores model-supplied visibility` — args có `visibility: 'group'` trong DM → fact lưu `'private'`.
  - `guest cannot set about / replace others' facts` — `about: 'u2'` từ khách → `subjectId` là người gửi; `replacesId` của fact người khác → rejects, fact vẫn còn.
  - `forget_fact is admin-only and asks to confirm` — `access === 'admin'`, `confirm({id})` chứa nội dung fact.
  - `render marks stale and tombstones` — chuỗi chứa `(cũ, cần hỏi lại)` và `KHÔNG dùng lại`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: scoped fact memory with staleness and tombstones`.

---

### Task 10: Lọc bí mật đầu ra (Redaction)

**Files:**
- Create: `src/core/redact.ts`
- Test: `test/redact.test.ts`

**Interfaces:**
- Produces: `export function redact(text: string, secrets: string[]): string;` — thay bằng `[ĐÃ ẨN]`.
  - Mọi chuỗi trong `secrets` có độ dài ≥ 8 (bỏ qua chuỗi ngắn để không xoá nhầm từ thường).
  - Mẫu: `/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/` (token Telegram), `/\bsk-[A-Za-z0-9_-]{16,}/`, `/\btvly-[A-Za-z0-9_-]{10,}/`, `/\bAIza[0-9A-Za-z_-]{35}\b/`, `/Bearer\s+[A-Za-z0-9._~+\/-]{10,}=*/i`, `/(password|passwd|pwd|mật khẩu|mat khau)\s*[:=]\s*\S+/i` (giữ nhãn, ẩn giá trị).

- [ ] **Step 1: Viết test thất bại** — mỗi mẫu một case; secret literal `'my-super-secret-value'` bị ẩn; secret `'abc'` không ảnh hưởng `'abc xyz'`; `'mật khẩu: hunter22'` → `'mật khẩu: [ĐÃ ẨN]'`; văn bản thường giữ nguyên.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: output redaction`.

---

### Task 11: Dispatcher & lắp ráp toàn bộ bot

**Files:**
- Create: `src/core/dispatcher.ts`
- Modify: `src/index.ts` (thay luồng GĐ1 bằng dispatcher)
- Test: `test/dispatcher.test.ts` (fake `LlmClient`, `send` = `vi.fn()`, `log` = `vi.fn()`, thư mục tạm cho history/facts)

**Interfaces:**
- Consumes: mọi Produces của Task 1–10.
- Produces:
```ts
export interface DispatcherDeps {
  cfg: Config; llm: LlmClient; tools: Tool[]; history: ThreadHistory; facts: FactStore;
  pending: PendingConfirmations; persona: { get(): string };
  send: (threadId: string, text: string) => Promise<void>;
  secrets: string[];                                   // telegramToken, aiApiKey, tavilyApiKey
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}
export function createDispatcher(deps: DispatcherDeps): { handle(msg: IncomingMessage): Promise<void> };
```
Thứ tự xử lý trong `handle` (spec 3.2; dedup/queue/tier để KH2):
1. **HITL intercept:** nếu `pending.has(threadId)`, người gửi là admin và `classifyReply(text)` ≠ null → `take`, `resumeAfterConfirm`, gửi kết quả, return. Người không phải admin → bỏ qua bước này (tin đi tiếp như thường).
2. **Quyền truy cập:** group không thuộc `allowedGroups` → bỏ qua im lặng; DM khi `dmPolicy === 'admin'` và không phải admin → bỏ qua im lặng.
3. **Quy tắc group:** `isGroup && !mentionsBot` → `history.append({..., ambient: true})`, return (không gọi LLM).
4. **Dựng convo:** system = `persona.get()` + khối danh tính (`Người đang nói: <senderName> (id <senderId>) — <ADMIN | KHÁCH>`; `Đang ở: <chat riêng | nhóm>`; quyền admin chỉ xác định bởi id) + `renderMemoryForPrompt(facts.search(scope), facts.tombstones(scope))`; sau đó `history.recent` (mục ambient hiển thị dạng `[<tên>]: <text>`), cuối cùng tin user hiện tại.
5. `runAgent` với `ctx = { threadId, senderId, isAdmin: cfg.adminIds.has(senderId), isGroup }`.
6. `reply` → `redact` → `send` → append user + assistant vào history. `needs_confirm` → `pending.set`, gửi `"<question>\n(Admin trả lời: ok / thôi)"`.
7. Lỗi bất kỳ → `log('error', redact(String(err)))`, gửi `'⚠️ Có lỗi xảy ra trong quá trình xử lý.'`.

`src/index.ts`: `loadConfig` → `createPersona` → `createOpenAiLlm(new OpenAI({baseURL, apiKey}))` → tools = `[createTimeTool(), ...createMemoryTools(facts), ...(tavilyApiKey ? [createWebSearchTool(tavilyApiKey)] : [])]` → `startTelegram(cfg, m => dispatcher.handle(m).catch(...))`; log `console` qua `redact`.

- [ ] **Step 1: Viết test thất bại**
```ts
it('ignores guest DM when DM_POLICY=admin', ...)            // send & llm không được gọi
it('ignores groups not in ALLOWED_GROUPS', ...)
it('stores un-mentioned group message as ambient only', ...) // llm không gọi; recent() có ambient: true
it('replies to mention and records history', ...)            // send gọi 1 lần; history có user + assistant
it('spoofed name stays guest', async () => {
  // senderName 'Hiếu (Admin)', senderId '999' không thuộc adminIds; deps.tools có 1 tool admin
  expect(systemPromptOf(llm.calls[0])).toMatch(/KHÁCH/);
  expect(toolNames(llm.calls[0])).not.toContain('forget_fact');
});
it('admin ok resumes pending action; thôi cancels', ...)    // ok → tool.run gọi, reply gửi; thôi → 'Đã huỷ thao tác.'
it('non-admin ok does not approve', ...)                     // pending vẫn còn, tool.run không gọi
it('redacts secrets in replies', ...)                        // llm trả token bot → tin gửi chứa [ĐÃ ẨN], không chứa token
it('llm error is redacted in chat and log', ...)             // llm throw Error chứa aiApiKey → send nhận câu ⚠️; mọi đối số log không chứa key
it('includes persona and scoped memory in system prompt', ...) // fact DM khác không xuất hiện trong prompt ở group
```
- [ ] **Step 2:** `npx vitest run test/dispatcher.test.ts` → FAIL.
- [ ] **Step 3:** Implement `createDispatcher`; cập nhật `src/index.ts`.
- [ ] **Step 4:** `npm test` → tất cả PASS; `npm run typecheck` và `npm run build` → không lỗi.
- [ ] **Step 5: Kiểm chứng thật trên Telegram** (chỉ chạy ở một máy):
  - DM (admin): "mấy giờ rồi" → bot dùng `get_current_time`; "giá vàng hôm nay" → dùng `web_search`.
  - DM: "nhớ giúp tôi là tôi ở Cầu Giấy" → `Đã ghi nhớ`; sau đó "tôi chuyển nhà rồi, giờ ở Đống Đa" → fact cũ thành tombstone; hỏi "tôi ở đâu" → Đống Đa.
  - Admin: "quên thông tin [id] đi" → bot hỏi xác nhận; gõ `ok` → đã xoá; thử lại với `thôi` → `Đã huỷ thao tác.`
  - Group (đã thêm id vào `ALLOWED_GROUPS`): nhắn không tag → bot im lặng; `@<bot> tóm tắt mọi người vừa nói gì` → bot dùng ambient context; hỏi về thông tin vừa kể trong DM → bot không biết.
  - Tài khoản khác (khách) đổi tên giống admin → vẫn bị coi là khách.
- [ ] **Step 6:** Commit `feat: dispatcher with access control, HITL, memory and redaction`.

---

## Sau Kế hoạch 1

Tiếp theo là Kế hoạch 2 (dedup, keyed queue, tiering, `/stop`, tóm tắt history, Honesty Guard) — xem `docs/superpowers/plans/2026-11-11-lo-trinh-tong-the.md`. Kế hoạch đó sẽ được viết chi tiết khi KH1 hoàn tất, dựa trên code thực tế.
