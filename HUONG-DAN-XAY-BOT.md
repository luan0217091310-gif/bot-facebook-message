# Xây một con bot chat AI của riêng bạn (Từ Zero đến Production)

Tài liệu này là **bản thiết kế kiến trúc và quy trình thực chiến** để bạn tự xây dựng một con bot AI Agent hoàn chỉnh cho riêng mình.
Nội dung được đúc kết trực tiếp từ quá trình phát triển và vận hành thực tế của **Goblin** (Bot Zalo/Telegram cá nhân, vượt qua hơn **930+ bài kiểm thử tự động**, chạy ổn định 24/7 trên VPS Ubuntu 4GB RAM).

Đọc kỹ Mục 1–3 trước khi gõ dòng code đầu tiên. **Mục 5 & Mục 6 là những bài học "xương máu" đắt giá nhất** — những lỗi thực tế đã phải trả giá bằng thời gian, bảo mật và dữ liệu thật, đọc kỹ để không bao giờ lặp lại.

---

## 1. Bản chất: Bot AI này thực ra là gì?

Đây **không phải** là chatbot hỏi-đáp kịch bản cứng (rule-based) hay một ứng dụng RAG đơn giản. Nó là **một AI Agent có nhận thức và công cụ (Tool-using Agent)**:

```
[Tin nhắn người dùng]
         ↓
  [Hiểu ngữ cảnh & Ý định]
         ↓
  [Bộ suy luận (Agent Loop)] ←──────┐
         ↓                          │
  [Chọn công cụ (Tool Calling)]     │ (Lặp lại nếu chưa xong)
         ↓                          │
  [Thực thi công cụ & Nhận kết quả] ─┘
         ↓
  [Tổng hợp câu trả lời & Ghi nhớ trí nhớ]
         ↓
[Phản hồi ra Zalo / Telegram]
```

Một AI Agent hữu dụng và an toàn bắt buộc phải có **3 trụ cột cốt lõi**:

1. **Vòng lặp suy luận (Agentic Loop):** Khả năng tự quyết định xem cần gọi công cụ nào (tìm kiếm web, đọc file, chạy code, tra cứu dữ liệu), đọc kết quả trả về và tự sửa lỗi nếu lệnh thất bại.
2. **Hệ thống trí nhớ phân cấp (Hierarchical Memory):** Nhớ ngữ cảnh cuộc trò chuyện, nhớ sự thật về từng người dùng (sở thích, thói quen), nhớ lịch sử nhóm nhưng tuyệt đối không rò rỉ dữ liệu riêng tư.
3. **Phân quyền & Kiểm soát an toàn (Guardrails & Human-in-the-Loop):** Phân biệt rạch ròi giữa Chủ nhân (Admin) và Khách (Guest). Những hành động có tác dụng phụ rủi ro (xoá file, gửi file, chạy lệnh mạng, thay đổi hệ thống) bắt buộc phải dừng lại chờ Admin gõ "ok".

---

## 2. Chốt 5 quyết định CỐT TỬ trước khi code

Hãy trả lời rõ 5 câu hỏi này trước khi mở IDE. Thay đổi các quyết định này ở giai đoạn sau sẽ tốn gấp nhiều lần công sức.

### 2.1 Kênh chat: Telegram hay Zalo?

| Tiêu chí | Telegram | Zalo |
|---|---|---|
| **API** | **Chính thức** (Telegram Bot API đầy đủ, ổn định) | **Không chính thức** (`zca-js`, reverse-engineer Zalo Web) |
| **Xác thực** | Token từ `@BotFather`, không bao giờ hết hạn | Quét mã QR, lưu session file (`credentials.json`) |
| **Độ ổn định phiên** | Bền vững 100%, không bị văng | **Thường xuyên rớt session** sau vài tuần hoặc khi Zalo đổi cơ chế |
| **Cơ chế nhận tin** | Webhook (HTTPS) hoặc Long-polling cực chuẩn | WebSocket nội bộ, phải tự viết logic auto-reconnect |
| **Rủi ro tài khoản** | Không có rủi ro khoá tài khoản | Tài khoản cá nhân có nguy cơ bị hạn chế nếu gửi tin dồn dập |

> **Khuyến nghị vàng:** Nếu bạn mới bắt đầu, **hãy làm trên Telegram trước**. Bạn chỉ mất đúng 1 buổi tối để dựng xong bot chạy thông suốt, học trọn vẹn tư duy Agent và Tool Calling mà không bị phân tâm bởi việc duy trì session. Khi logic lõi đã vững, bạn bọc thêm Adapter Zalo vào sau (vì kiến trúc tách lớp sẽ bảo vệ bạn).

### 2.2 Chọn mô hình AI & Định tuyến 3 tầng (Tiering)

Đừng chỉ dùng duy nhất 1 model đắt tiền cho mọi tin nhắn. Hãy định tuyến theo **3 tầng tải**:

```
[Tin nhắn đến]
      │
      ├─► Tầng FAST  (Model siêu nhẹ / flash-low): Chat xã giao, chào hỏi, giỡn vui (0 tool, phản hồi < 3s)
      │
      ├─► Tầng SMART (Model tiêu chuẩn / flash-medium): Tra cứu web, đọc ảnh/PDF, chạy 1-2 công cụ
      │
      └─► Tầng DEEP  (Model tư duy cao / flash-high): Viết code, phân tích logic phức tạp, chạy nhiều bước
```

**Số đo độ trễ thực tế qua Gateway API:**
- `Fast`: **2.3 – 5.0 giây** (Trả lời tức thì, 0 token suy luận, chi phí cực thấp).
- `Smart`: **9.5 – 12.7 giây** (~650 – 755 token suy luận).
- `Deep`: **11.3 – 15.4 giây** (~750 – 930 token suy luận).

*Bài học thực tế:* Tầng Smart và Deep có độ trễ gần tương đương nhau trên các dòng model mới. Khi câu hỏi đòi hỏi tính toán, lập luận hay so sánh, hãy mạnh dạn cấp model chất lượng cao nhất vì chi phí thời gian không chênh lệch nhiều.

### 2.3 Môi trường máy chủ (Server)

- **Không nên chạy trên laptop cá nhân:** Laptop có cơ chế ngủ (`suspend`/`s2idle`), khi ngủ toàn bộ tiến trình và card mạng bị đóng băng, bot sẽ mất kết nối hoàn toàn.
- **Thuê một VPS Linux nhỏ (Ubuntu 24.04):** Cấu hình chỉ cần **2 vCPU / 4GB RAM** là đủ sức gánh cả Bot + Docker Sandbox + Database nhẹ. Bot lõi chỉ tiêu thụ **~100MB – 150MB RAM**.
- **Cài đặt Node.js cô lập:** Cài riêng Node tại `/opt/node22` (hoặc phiên bản chỉ định), tránh dùng Node mặc định của OS để không bị xung đột khi nâng cấp hệ thống.
- **Chặn trần bộ nhớ trong systemd service:**
  ```ini
  [Service]
  ExecStart=/opt/node22/bin/node --max-old-space-size=320 dist/index.js
  Restart=always
  RestartSec=10
  ```
  *Ý nghĩa:* Nếu có rò rỉ bộ nhớ (memory leak), tiến trình sẽ tự kết thúc sạch sẽ và systemd tự khởi động lại trong 10 giây, thay vì kéo cả VPS vào swap làm đơ máy chủ.

### 2.4 Có cần Docker Sandbox không?

- **CÓ:** Nếu bạn cho phép bot chạy lệnh Shell tự do (`bash`) hoặc chạy script Python để phân tích dữ liệu, xuất biểu đồ/Excel.
- **CẢNH BÁO:** Thêm user vào nhóm `docker` tương đương với việc cấp quyền **Root** trên máy chủ!
- **Quy chuẩn Sandbox bắt buộc:** Container phải chạy `read-only rootfs`, **không có quyền mạng** (chặn internet trừ khi Admin cấp phép rõ ràng), không chạy quyền root bên trong container, giới hạn CPU (1 core), RAM (512MB), PID (tối đa 64 tiến trình) và tuyệt đối che giấu các thư mục nhạy cảm (`.env`, `.session`, thư mục dữ liệu).

### 2.5 Phân nhóm đối tượng người dùng

- **Chế độ 1-1 (Direct Message):** Luôn mở, bot lắng nghe trọn vẹn, hiểu được các câu nối tiếp ("làm tiếp cái hồi nãy đi").
- **Chế độ Nhóm (Group Chat):**
  - **Quy tắc bắt buộc:** Chỉ phản hồi khi được `@tag` đích danh (hoặc gõ đúng biệt danh `@goblin`).
  - Nếu chỉ gọi tên không có tag hoặc reply tin nhắn cũ mà không tag: Bot chỉ **lưu vào bộ nhớ môi trường (ambient context)** để hiểu diễn biến, tuyệt đối không chen ngang câu chuyện của nhóm.

---

## 3. Kiến trúc 5 lớp chuẩn công nghiệp

Hệ thống được module hoá thành 5 lớp độc lập. Một lớp thay đổi không làm ảnh hưởng các lớp khác:

```
┌─────────────────────────────────────────────────────────┐
│ 1. LỚP ADAPTER (Kênh giao tiếp)                         │
│    Telegram / Zalo → Chuẩn hoá thành IncomingMessage     │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. LỚP ĐIỀU PHỐI (Dispatcher)                           │
│    Chống spam → Bắt duyệt "ok" → Hàng đợi per-thread    │
│    → Phân loại Tier → Kiểm soát Rate Limit              │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. LỚP SUY LUẬN LÕI (Agent Core)                        │
│    Vòng lặp Tool Calling • AbortSignal (/stop)          │
│    Khoá đồng bộ ghi (WriteLock)                         │
└──────────┬──────────────────────────┬───────────────────┘
           ↓                          ↓
┌────────────────────────┐  ┌─────────────────────────────┐
│ 4. LỚP CÔNG CỤ (Tools)  │  │ 5. LỚP TRÍ NHỚ (Memory)     │
│ Web search, File, Code,│  │ Thread facts, User profiles,│
│ Watch URL, Site Login  │  │ Group notes, Tombstones     │
└────────────────────────┘  └─────────────────────────────┘
```

### 3.1 Lớp Adapter: Hợp đồng tin nhắn đồng nhất

Mọi kênh chat (Zalo, Telegram, Discord...) đều phải chuyển đổi payload thành một interface duy nhất:

```ts
export interface IncomingMessage {
  threadId: string;       // ID phòng chat (DM hoặc Group)
  senderId: string;       // ID duy nhất của người gửi do nền tảng cấp (KHÔNG dùng Display Name)
  senderName?: string;    // Tên hiển thị (chỉ dùng để xưng hô)
  text: string;           // Nội dung văn bản đã làm sạch
  attachments?: FileAttachment[];
  isGroup: boolean;
  msgId: string;          // Dùng để loại bỏ tin nhắn trùng lặp (Deduplication)
  replyTo?: string;       // ID tin nhắn đang được trả lời
}
```

*Nguyên tắc sống còn:* Phân quyền Admin phải so khớp tuyệt đối bằng `senderId` (chuỗi số định danh). Tên hiển thị người dùng có thể đổi bất kỳ lúc nào để mạo danh Admin.

### 3.2 Lớp Dispatcher: Trọng tài điều phối

Mọi tin nhắn đi qua phễu xử lý theo đúng thứ tự:

1. **Khử trùng lặp (Deduplication):** Kiểm tra `msgId` trong bộ nhớ đệm 2000 tin gần nhất. Nếu đã thấy → Huỷ ngay.
2. **Ưu tiên lệnh duyệt (HITL Intercept):** Nếu Admin đang có việc chờ xác nhận mà gửi "ok", "ừ", "tiến hành" hoặc "thôi", "huỷ" → **Chặn xử lý ngay lập tức tại đây, không đưa vào hàng đợi chờ đợi.**
3. **Kiểm tra quyền truy cập:** Lọc danh sách nhóm cho phép (`ALLOWED_GROUPS`) và chính sách chat riêng (`DM_POLICY`).
4. **Hàng đợi độc lập theo từng Thread (Keyed Queue):** Mỗi cuộc trò chuyện xử lý tuần tự, nhưng các cuộc trò chuyện khác nhau chạy hoàn toàn song song.
5. **Định tuyến tầng suy luận (Tier Classification):** Heuristic phân tích độ phức tạp để chọn model (`fast`, `smart`, `deep`).
6. **Thực thi Agent:** Đưa qua bộ suy luận.
7. **Lọc dữ liệu đầu ra (Redaction):** Quét sạch API Key, Token, mật khẩu trước khi gửi ra ngoài màn hình chat.

### 3.3 Lớp Agent: Vòng lặp suy luận an toàn

Vòng lặp cơ bản của Agent:

```ts
async function runAgent(convo: Message[], tools: Tool[], ctx: Context): Promise<string> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 1. Kiểm tra tín hiệu huỷ bỏ /stop từ người dùng
    if (ctx.signal?.aborted) throw new Error("Tác vụ đã bị người dùng dừng lại.");

    // 2. Gọi model
    const response = await llm.complete(convo, tools, { signal: ctx.signal });

    // 3. Nếu không yêu cầu gọi tool -> Đã có câu trả lời cuối cùng
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response.content;
    }

    // 4. Thực thi song song các tool chỉ-đọc, xếp hàng các tool ghi dữ liệu
    const results = await executeTools(response.toolCalls, ctx);

    // 5. Nạp kết quả tool vào ngữ cảnh hội thoại và lặp tiếp
    convo.push({ role: 'assistant', tool_calls: response.toolCalls });
    for (const res of results) {
      convo.push({ role: 'tool', tool_call_id: res.id, content: res.output });
    }
  }
  throw new Error("Vượt quá số vòng lặp tối đa cho phép.");
}
```

### 3.4 Lớp Tools: Hợp đồng công cụ tự kiểm chứng

Mọi công cụ phải tự định nghĩa phạm vi an toàn của nó:

```ts
export interface Tool {
  name: string;
  description: string;           // Viết rõ ràng: khi nào nên dùng, khi nào KHÔNG ĐƯỢC dùng
  parameters: Record<string, unknown>; // JSON Schema chuẩn
  access: 'public' | 'admin';   // Khách tuyệt đối không nhìn thấy tool admin trong schema
  readOnly: boolean;            // true: chạy song song, false: phải chiếm WriteLock
  dmOnly?: boolean;             // Dữ liệu nhạy cảm: cấm chạy trong Group chat
  confirm?: (args: any) => string | null; // Trả về câu hỏi xác nhận nếu thao tác rủi ro
  run: (args: any, ctx: ToolContext) => Promise<string>;
}
```

*Quy tắc thép:* Code backend phải kiểm tra lại tham số của model. Model hoàn toàn có thể "ảo giác" bịa ra `action: "delete_all"`. Tuyệt đối không tin tưởng schema phía model.

### 3.5 Lớp Trí nhớ: Đa tầng & Có căn cứ xác thực

Trí nhớ không bao giờ là một file text khổng lồ nhồi nhét tất cả. Phải phân tầng:

- **Lịch sử hội thoại (Thread History):** Lưu dạng JSONL (`history.jsonl`). Tự động tóm tắt khi vượt ngưỡng 250k token.
- **Sự thật (Facts) có Metadata:** Mỗi thông tin ghi nhớ phải gắn nhãn:
  `[Nội dung] (Người cung cấp, Thời điểm, Độ tin cậy: Thật/Đùa/Chưa chắc)`.
  Thông tin cũ quá 90 ngày (hoặc 14 ngày đối với thông tin biến động như địa chỉ, kế hoạch) phải bị gắn cờ cảnh báo để bot hỏi lại thay vì khẳng định chắc nịch.
- **Đính chính & Quên (Tombstone):** Khi người dùng nói "anh chuyển nhà rồi, không ở Cầu Giấy nữa", bot phải lưu giá trị cũ vào danh sách `tombstones` để khi hệ thống tóm tắt lại lịch sử không vô tình lôi lại địa chỉ cũ.

---

## 4. Các tính năng nâng cao thực chiến

Đây là những năng lực giúp con bot vượt xa một chatbot thông thường:

### 4.1 Giám sát thay đổi Website (`watch_url`)

Thay vì mỗi lần muốn biết tin tức bạn phải nhắn hỏi bot (tốn lượt gọi AI), hãy để bot tự canh trang:
- **Nguyên lý băm văn bản sạch (Clean Text Hash):** Trước khi băm SHA-256 nội dung trang, phải dùng Regex loại bỏ toàn bộ mã Javascript, thẻ CSS, comment HTML, các chuỗi ngày giờ hệ thống tự nhảy (`10:31:05`), timestamp, nonce quảng cáo. Chỉ băm phần văn bản hiển thị thực sự.
- **Tiết kiệm tuyệt đối:** Bot quét định kỳ bằng HTTP GET thông thường. Nếu hash không đổi → **Im lặng 100%, tốn 0đ tiền AI**. Chỉ khi nội dung thay đổi thực sự mới gửi thông báo kèm đường link.
- **Chống báo động dồn dập (Cooldown):** Nếu một trang liên tục cập nhật, áp dụng khoảng cách tối thiểu giữa 2 lần báo (ví dụ 5 phút/lần).

### 4.2 Kho mật khẩu mã hoá & Đăng nhập lại tự động (`site_login`)

Với các trang nội bộ (như cổng sinh viên, hệ thống công ty) thường xuyên bị đá phiên (hết session cookie):
- **Kiến trúc Vault 2 lớp an toàn:**
  - File khoá giải mã: `.secrets/vault.key` (32 bytes ngẫu nhiên, chmod 600).
  - File dữ liệu đã mã hoá: `.secrets/vault.enc` (AES-256-GCM, chmod 600).
  - Mật khẩu **được mã hoá ngay trên máy cá nhân** qua script terminal (`scripts/23c-credentials.sh put <site>`), chỉ gửi payload mã hoá lên VPS qua stdin của SSH. Mật khẩu không bao giờ xuất hiện trong file cấu hình hay tin nhắn chat.
- **Giải mã trong RAM:** Khi cần đăng nhập lại, bot đọc khoá, giải mã tạm thời trong bộ nhớ tiến trình, thực hiện POST form đăng nhập, lấy session cookie lưu vào jar và lập tức giải phóng bộ nhớ. Mật khẩu không bao giờ lọt vào log hay lỗi hiển thị.
- **Xử lý chuỗi chuyển hướng SSO phức tạp:** Nhiều hệ thống sau khi POST thông tin sẽ trả về URL chuyển tiếp chứa mã dùng 1 lần (như `sso.school.edu.vn/Authenticate.aspx?Token=...`). Hệ thống đăng nhập của bot phải tự đi theo chuỗi chuyển hướng từng bước, mang theo cookie tích luỹ thì mới lấy được phiên đăng nhập thực tế.

### 4.3 Tác vụ chạy ngầm & Nhắc việc chủ động (Agentic Scheduler)

- Hỗ trợ 2 dạng nhắc việc:
  1. **Nhắc việc thông thường:** Đến giờ nhắn một câu nhắc đã định sẵn.
  2. **Tác vụ Agent tự động (`agentic = true`):** Đến giờ hẹn (ví dụ 6:00 sáng mỗi ngày), bot tự động khởi chạy một lượt Agent ngầm ở tầng sâu (`deep tier`), tự gọi công cụ kiểm tra deadline môn học trên Moodle/E-learning, tổng hợp danh sách bài tập sắp hết hạn trong 72 giờ tới và chủ động gửi tin nhắn báo cáo vào Zalo/Telegram của bạn.

---

## 5. 15 Cạm bẫy "xương máu" người đi trước đã trả giá

Đọc thật kỹ mục này. Đây là những lỗi thực tế đã xảy ra và cách khắc phục triệt để:

### 5.1 Cạm bẫy chạy song song 2 nơi
**Hiện tượng:** Vừa bật bot chạy test trên máy tính cá nhân, vừa để bot chạy trên VPS.
**Hậu quả:** Cả hai bên dùng chung một file session Zalo, tranh chấp kết nối WebSocket liên tục, dẫn đến session bị huỷ ngay lập tức và tài khoản bị tạm khoá.
**Quy tắc:** Chỉ chạy bot ở **MỘT NƠI DUY NHẤT**. Khi chuyển sang VPS, tắt hoàn toàn tiến trình ở local.

### 5.2 Nhóm Docker = Quyền Root
**Cảnh báo:** User chạy bot nếu được add vào nhóm `docker` (`usermod -aG docker botuser`) thì user đó có thể mount toàn bộ ổ cứng máy chủ vào container và đọc sạch file nhạy cảm của hệ thống.
**Khắc phục:** Sandbox phải bật các cờ bảo vệ tối đa: `--read-only`, `--network none`, `--cap-drop ALL`, giới hạn `--memory=512m`.

### 5.3 WriteLock treo toàn bộ bot
**Hiện tượng:** Một công cụ ghi dữ liệu (như chạy code phân tích trong container) bị treo vô hạn, khiến khoá ghi `WriteLock` không được nhả ra.
**Hậu quả:** Mọi tin nhắn sau đó yêu cầu sửa file hoặc chạy lệnh đều bị xếp hàng chờ vĩnh viễn, bot trông như bị "chết não".
**Khắc phục:** Luôn cài đặt **thời gian giải phóng cưỡng bức** (Force release sau 15 giây kể từ khi tác vụ bị huỷ bỏ), ghi log cảnh báo `⚠️ Khóa ghi bị cưỡng bức giải phóng`.

### 5.4 API lịch sử nhóm Zalo trả mã 404
**Thực tế:** Endpoint lấy lịch sử chat nhóm chính thức của Zalo Web hiện trả về mã lỗi 404.
**Khắc phục:** Phải chuyển sang bắt gói tin qua WebSocket (`requestOldMessages`). Tuy nhiên qua WebSocket, Zalo chỉ trả về tối đa **~50 tin nhắn gần nhất tính chung cho tất cả các nhóm**, không thể cuộn lùi trang sâu hơn. Đừng bao giờ thiết kế tính năng dựa trên giả định đọc được toàn bộ tin nhắn cũ của nhóm.

### 5.5 Kiểm tra "exit=0" bằng chuỗi văn bản thô
**Sai lầm:** Dò tìm chuỗi `exit=0` trong nội dung stdout in ra để kết luận lệnh thành công.
**Lỗ hổng:** Mã độc hoặc script chỉ cần cố tình `echo "exit=0"` ra màn hình là đánh lừa được bot.
**Khắc phục:** Phải bắt **Exit Code cấu trúc thực sự** từ quá trình gọi tiến trình của Docker/Node.js (`exitCode === 0`).

### 5.6 Model có xu hướng khoe "Em đã làm xong rồi" dù chưa làm gì
**Hiện tượng:** Model hay tự tin khẳng định đã sửa xong code hoặc kiểm tra xong file dù chưa hề gọi tool thực thi.
**Khắc phục:** Viết một tầng kiểm chứng bằng code (`Honesty Guard`). Nếu model nói câu khẳng định hoàn thành mà trong sổ theo dõi lượt (`Turn Ledger`) không có bất kỳ lệnh kiểm tra nào (`npm test`, `tsc`, `pytest`) chạy thành công sau lần sửa file cuối cùng → Code tự động chèn cảnh báo vào câu trả lời: `[Cảnh báo hệ thống: Thao tác này chưa được kiểm chứng thực tế]`.

### 5.7 Rò rỉ dữ liệu từ chat riêng (DM) vào nhóm chat
**Lỗi phổ biến nhất:** Người dùng tâm sự thông tin nhạy cảm trong chat riêng. Vài ngày sau, khi chat trong nhóm bạn bè, bot vô tình lấy thông tin đó làm ngữ cảnh trả lời.
**Khắc phục:** Phải **lọc quyền ngay tại thời điểm thu thập dữ liệu (Collection Time)**, tuyệt đối không lọc lúc hiển thị. Thông tin nói trong DM phải gắn cờ `visibility: private` và hàm tìm kiếm trí nhớ trong nhóm chat bị chặn cứng bằng code không được quét qua các mục `private`.

### 5.8 Câu trả lời quá dài làm người dùng ngán ngẩm
**Thực tế:** Model mặc định thường viết rất dài dòng, mở bài lịch sự, thân bài phân tích, kết bài tóm tắt dài dòng khiến người chat trên điện thoại rất khó chịu.
**Khắc phục:** Đặt quy chuẩn thép trong System Prompt: Mặc định trả lời cô đọng trong **1 đến 3 câu**, đưa đáp án hoặc số liệu lên ngay đầu câu, bỏ toàn bộ lời rào đón xã giao. Chỉ viết dài khi người dùng yêu cầu "giải thích chi tiết từng bước". (Thống kê từ Goblin: độ dài giảm từ 1534 ký tự xuống còn 566 ký tự/câu).

### 5.9 Tối ưu chi phí Search Web
- Luôn cấu hình tham số `search_depth: basic` (1 credit), tránh dùng `advanced` (2 credit).
- Yêu cầu lấy kèm nội dung thô (`include_raw_content: true`) — bạn sẽ có ngay bài viết đầy đủ trong kết quả tìm kiếm mà không cần tốn thêm một vòng gọi `fetch_url` (tiết kiệm 3–5 giây/trang).
- Bật bộ nhớ đệm RAM (RAM Cache) 10 phút cho các truy vấn tìm kiếm giống nhau.

### 5.10 Tách System Prompt Persona ra file Markdown riêng
Không bao giờ hard-code tính cách của bot vào trong code TypeScript/Python. Hãy để tại `config/persona.prompt.md`. Mỗi khi cần tinh chỉnh giọng điệu, xưng hô, chỉ cần sửa file text và reload lại bộ nhớ, không cần build lại dự án.

### 5.11 Cảnh báo chủ động khi bot gặp sự cố
Đừng bao giờ để bot im lặng khi đứt kết nối mạng, token AI hết hạn, hay session chat chết. Phải có kênh thông báo khẩn cấp (như gửi tin nhắn qua một con bot Telegram phụ dự phòng hoặc bắn thông báo hệ thống) báo ngay cho chủ nhân.

### 5.12 Tập trung viết Test tự động cho logic An toàn
Đừng lãng phí thời gian viết test kiểm tra xem bot trả lời câu văn có hay không (vì model luôn có tính ngẫu nhiên). Hãy dồn toàn bộ sức lực viết test cho:
- Khách có gọi trộm được tool của Admin không?
- Model bịa lệnh có bị chặn lại không?
- Lệnh nguy hiểm có dừng lại chờ "ok" không?
- Token và mật khẩu có bị lộ trong log lỗi không?

### 5.13 Cạm bẫy Deploy: `rsync --delete` xoá sạch dữ liệu nhạy cảm
**Sự cố thực tế:** Script deploy dùng lệnh `rsync -a --delete` để đồng bộ code sạch lên server, nhưng trong danh sách loại trừ (`--exclude`) chỉ loại trừ `.env`, `.session`, `data/` mà **quên loại trừ thư mục `.secrets/`**.
**Hậu quả:** Ngay khi gõ lệnh deploy bản cập nhật mới, toàn bộ kho mật khẩu mã hoá `vault.enc` và `vault.key` vừa lưu trên server bị xoá sạch hoàn toàn!
**Bài học:** Bất kỳ thư mục nào chứa trạng thái lúc chạy (runtime state) đều phải được đưa vào danh sách `--exclude` của lệnh deploy và phải được thêm vào script sao lưu (`backup.sh`).

### 5.14 Cạm bẫy Shell: Truyền biến môi trường sai qua đường ống (Pipe)
**Sự cố:** Chạy lệnh theo cú pháp `NAME="abc" ssh server ... | python3 script.py`.
**Lỗi:** Biến `NAME="abc"` chỉ có tác dụng đối với tiến trình `ssh` ở đầu pipe, tiến trình `python3` ở cuối pipe hoàn toàn không nhìn thấy biến này và văng lỗi `KeyError: 'NAME'`.
**Khắc phục:** Phải dùng lệnh `export NAME` rõ ràng trước khi chạy chuỗi pipe.

### 5.15 Cạm bẫy SSO Redirect: Cookie bị chặn khi đổi subdomain
**Sự cố:** Các hệ thống cổng thông tin trường học/công ty thường chia thành nhiều subdomain (`stdportal.school.edu.vn` và `sso.school.edu.vn`). Khi hàm xử lý cookie quá khắt khe, cookie cấp cho host này sẽ bị chặn không cho gửi sang host kia.
**Khắc phục:** Cơ chế xử lý HTTP chuyển hướng của bot phải nhận biết được các subdomain có chung **Tên miền gốc (Root Domain)** để cho phép mang theo cookie xác thực qua từng bước chuyển tiếp.

---

## 6. Bảo vệ máy chủ: Checklist bảo mật VPS bắt buộc

Trước khi đưa bot vào vận hành và lưu trữ bất kỳ thông tin nào, bắt buộc phải hoàn thành các bước gia cố hệ thống này:

1. **Khép chặt cửa SSH:**
   - Đổi cổng SSH mặc định (tùy chọn) hoặc cấu hình bắt buộc: `PasswordAuthentication no`, `PermitRootLogin without-password` (hoặc `prohibit-password`), chỉ cho phép đăng nhập bằng SSH Key (ed25519).
2. **Kích hoạt tường lửa UFW:**
   - Mặc định chặn toàn bộ kết nối vào: `sudo ufw default deny incoming`.
   - Cho phép toàn bộ kết nối ra: `sudo ufw default allow outgoing`.
   - Chỉ mở duy nhất cổng SSH: `sudo ufw allow 22/tcp`.
   - Bật tường lửa: `sudo ufw enable`.
3. **Cài đặt Fail2ban chống rà quét:**
   - Cài đặt: `sudo apt install fail2ban`.
   - Cấu hình jail SSH (`/etc/fail2ban/jail.d/sshd.local`): Sai mật khẩu/khoá 4 lần trong 10 phút → Khoá IP 1 giờ.
4. **Quyền hạn file nghiêm ngặt:**
   - File cấu hình chứa API Key (`.env`): `chmod 600`.
   - Thư mục session, cookies, vault: `chmod 700` cho thư mục, `chmod 600` cho các file bên trong.
   - Thư mục chạy bot phải thuộc quyền sở hữu của user dịch vụ riêng (`goblin` hoặc `botuser`), không chạy bot trực tiếp dưới quyền `root`.

---

## 7. Lộ trình phát triển 6 giai đoạn (~2 tuần)

Đừng cố gắng xây dựng toàn bộ mọi thứ cùng một lúc. Hãy đi từng bước vững chắc:

```
[Tuần 1]
GĐ 1: Kết nối Kênh & Chat đơn giản (Echo / LLM text) ────────┐
                                                             │
GĐ 2: Dựng Agentic Loop lõi & 2 công cụ đầu tiên ────────────┤
                                                             │
GĐ 3: Hệ thống Trí nhớ, Phân quyền Admin & Duyệt "ok" ───────┘

[Tuần 2]
GĐ 4: Bộ định tuyến 3 Tầng (Tiering) & Chống trùng lặp ───────┐
                                                             │
GĐ 5: Sandbox Docker an toàn & Các công cụ nâng cao ─────────┤
                                                             │
GĐ 6: Đóng gói Systemd, Giám sát Web, Backup & Vận hành ─────┘
```

- **Giai đoạn 1 (Ngày 1):** Tạo bot Telegram qua `@BotFather`, viết ~150 dòng code nhận tin qua Long-polling, chuyển đến OpenAI/Gemini API và trả lời lại. Cấu hình Persona trong file markdown.
- **Giai đoạn 2 (Ngày 2–4):** Viết vòng lặp Agent có `while/for` xử lý `tool_calls`. Tạo 2 công cụ cơ bản: `web_search` và `remember_fact`. Cài đặt giới hạn số vòng lặp tối đa.
- **Giai đoạn 3 (Ngày 5–7):** Thêm bộ nhớ lịch sử ra file JSONL. Xây dựng phân quyền: Khách chỉ được chat, chỉ có Admin ID mới được gọi công cụ nhạy cảm. Thêm cơ chế hỏi duyệt "ok" trước khi thao tác.
- **Giai đoạn 4 (Ngày 8–9):** Phân chia 3 tầng model (Fast cho chat phiếm, Smart/Deep cho việc nặng). Thêm hàng đợi theo thread và bộ lọc chống gửi trùng tin nhắn.
- **Giai đoạn 5 (Ngày 10–12):** Dựng Docker Sandbox không mạng để chạy Python/Bash. Thêm tính năng giám sát web (`watch_url`) và tự đăng nhập lưu cookie (`site_login`).
- **Giai đoạn 6 (Ngày 13–14):** Cấu hình file dịch vụ systemd trên VPS, thiết lập giới hạn RAM (`--max-old-space-size=320`), viết script deploy tự động và script backup định kỳ.

---

## 8. Cấu trúc thư mục chuẩn tham khảo

```
my-ai-bot/
├── src/
│   ├── index.ts                  # Điểm khởi đầu: nạp env, kết nối adapter, kích hoạt scheduler
│   ├── adapters/                 # LỚP 1: Kênh liên lạc
│   │   ├── telegram/
│   │   │   ├── client.ts         # Quản lý kết nối Telegram Bot API
│   │   │   └── parse.ts          # Chuyển đổi tin Telegram -> IncomingMessage
│   │   └── zalo/                 # (Nếu mở rộng sang Zalo)
│   ├── core/                     # LỚP 2 & 3: Trí não và logic điều phối
│   │   ├── dispatcher.ts         # Luồng phân phối tin nhắn, kiểm soát hàng đợi
│   │   ├── agent.ts              # Vòng lặp Agent suy luận, quản lý Tool Calling
│   │   ├── tier.ts               # Bộ phân loại độ phức tạp (Fast / Smart / Deep)
│   │   ├── confirm.ts            # Quản lý việc chờ duyệt xác nhận từ Admin
│   │   ├── memory.ts             # Quản lý file lịch sử JSONL và tóm tắt
│   │   ├── facts.ts              # Trí nhớ sự thật: nguồn gốc, độ tin cậy, đính chính
│   │   ├── watches.ts            # Logic băm văn bản sạch & quản lý URL giám sát
│   │   ├── siteLogin.ts          # Logic giải mã vault và đăng nhập tự động
│   │   └── net.ts                # safeFetch chống SSRF, kiểm soát timeout và redirect
│   ├── tools/                    # LỚP 4: Các công cụ mở rộng
│   │   ├── types.ts              # Interface chuẩn của một Tool
│   │   ├── index.ts              # Đăng ký và lọc tool theo quyền hạn
│   │   ├── web.ts                # Công cụ tìm kiếm Tavily / Brave
│   │   ├── watchTools.ts         # Tool thêm/bớt/xem danh sách theo dõi trang
│   │   └── siteLoginTools.ts     # Tool kích hoạt đăng nhập lại trang
│   └── sandbox/                  # Khối thực thi cô lập
│       └── docker.ts             # Quản lý vòng đời container chạy code an toàn
├── config/
│   ├── persona.prompt.md         # Tính cách, phong cách xưng hô của bot (Markdown)
│   └── skills/                   # Các kỹ năng chuyên sâu được bổ sung dần
├── scripts/
│   ├── deploy_vps.sh             # Script đóng gói code sạch đẩy lên server
│   ├── backup.sh                 # Script sao lưu dữ liệu và vault định kỳ
│   └── credentials.sh            # Script mã hoá mật khẩu từ terminal máy cá nhân
├── .secrets/                     # (Chỉ có trên server, chmod 700, nằm ngoài Git)
│   ├── vault.key                 # Khoá giải mã AES-256 (chmod 600)
│   └── vault.enc                 # Dữ liệu mật khẩu đã mã hoá (chmod 600)
├── data/                         # Dữ liệu hoạt động lúc chạy (Gitignore hoàn toàn)
│   ├── threads/                  # Lịch sử hội thoại từng cuộc chat
│   ├── watches.json              # Danh sách trang web đang theo dõi
│   └── watches-cookies/          # Cookie phiên đăng nhập của các trang
├── test/                         # Bộ kiểm thử tự động (Unit / Integration test)
├── .env.example                  # File mẫu các biến môi trường
└── package.json
```

---

## 9. Khởi động ngay hôm nay: Mã nguồn mẫu Telegram Agent (Giai đoạn 1)

Dưới đây là khung code hoàn chỉnh (~150 dòng TypeScript), sử dụng thư viện chính thức `node-telegram-bot-api` và SDK OpenAI, có sẵn vòng lặp Tool Calling cơ bản để bạn chạy được ngay lập tức:

```ts
import TelegramBot from 'node-telegram-bot-api';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID!; // ID tài khoản của bạn

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({
  baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.AI_API_KEY!,
});

// Định nghĩa công cụ mẫu: Lấy giờ hiện tại
const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Lấy ngày giờ chính xác hiện tại ở Việt Nam',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// Hàm thực thi công cụ
async function callTool(name: string, _args: any): Promise<string> {
  if (name === 'get_current_time') {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  }
  return 'Lỗi: Không tìm thấy công cụ.';
}

// Xử lý tin nhắn đến
bot.on('message', async (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const senderId = String(msg.from?.id || '');
  const isAdmin = senderId === ADMIN_ID;

  // Hiển thị trạng thái đang soạn tin nhắn trên Telegram
  await bot.sendChatAction(chatId, 'typing');

  const systemPrompt = `Mày là một trợ lý AI thông minh, ngắn gọn và hữu ích.
Chủ nhân của mày là ${isAdmin ? 'người đang chat trực tiếp với mày' : 'người khác, người này là khách'}.
Quy tắc: Trả lời ngắn gọn từ 1 đến 3 câu, đúng trọng tâm, không chào hỏi dài dòng.`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: msg.text },
  ];

  try {
    // Vòng lặp Agent (Tối đa 5 vòng lặp)
    for (let round = 0; round < 5; round++) {
      const response = await openai.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        messages,
        tools,
      });

      const choice = response.choices[0].message;

      // Nếu model không yêu cầu gọi tool -> Gửi câu trả lời về Telegram và kết thúc
      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        if (choice.content) {
          await bot.sendMessage(chatId, choice.content);
        }
        break;
      }

      // Nạp bước suy luận của assistant vào lịch sử
      messages.push(choice);

      // Thực thi từng công cụ được yêu cầu
      for (const tc of choice.tool_calls) {
        if (tc.type === 'function') {
          const fnName = tc.function.name;
          const fnArgs = JSON.parse(tc.function.arguments || '{}');
          
          const toolResult = await callTool(fnName, fnArgs);
          
          // Trả kết quả tool lại cho model
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
      }
    }
  } catch (error: any) {
    console.error('Lỗi Agent:', error);
    await bot.sendMessage(chatId, '⚠️ Có lỗi xảy ra trong quá trình xử lý.');
  }
});

console.log('🤖 Bot Telegram đã khởi động thành công và sẵn sàng nhận tin!');
```

---

## 10. Lời kết

Xây dựng một con bot AI Agent cá nhân là một hành trình thú vị. Sự khác biệt giữa một "món đồ chơi demo" và một "trợ lý số tin cậy hàng ngày" không nằm ở việc bạn dùng model nào to nhất, mà nằm ở:
1. **Sự ổn định:** Không tự chết, không treo tiến trình, tự phục hồi sau sự cố.
2. **Sự an toàn:** Không rò rỉ dữ liệu riêng tư, không tự ý phá hoại dữ liệu khi chưa được duyệt.
3. **Sự chủ động:** Biết tự theo dõi trang web, tự quét deadline nhắc việc đúng giờ mà không cần chủ nhân phải nhớ để hỏi.

Hãy bắt đầu từ **Mục 9**, cho bot chạy thử những lệnh đầu tiên, và từng bước bồi đắp kiến trúc theo tài liệu này. Chúc bạn xây dựng thành công trợ lý AI đắc lực cho riêng mình!
