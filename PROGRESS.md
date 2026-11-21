# Tiến độ

## Mốc đã kiểm tra
- Giai đoạn 0 hoàn tất. Nguồn setup-bot-tele/main `d2211a0`, bản sao ở D:\bot-message. Node 24.14.1, npm ci thành công, typecheck và build thành công. Vitest 4.1.12 chạy **71/71 test trong 15 file** trước khi sửa.
- Đọc adapter, dispatcher, agent, 11 tool, lưu trữ, test, persona, hướng dẫn và triển khai. ReminderStore gốc xoá job trước khi await gửi, WatchStore cập nhật hash trước khi báo. Cần xử lý thất bại khi chuyển sang gửi chủ động.
- Việc tiếp theo: thực hiện Giai đoạn 1 theo PLAN.md. Lệnh kiểm tra: npm run typecheck, npm test, npm run build.

## Giả định
- Một instance cấp dịch vụ cho một Page, có vùng dữ liệu riêng cho Page. Mặc định chỉ chạy Telegram để cấu hình cũ tiếp tục dùng được.
- Không tự suy ra liên kết PSID với Telegram ID. Dùng sự đồng ý của người dùng và bằng chứng kiểm soát hai tài khoản.

## VIỆC BẠN CẦN TỰ LÀM
- Tạo Page và app, cấp quyền, tạo token, lưu trong .env trên máy chủ.
- Chuẩn bị tên miền HTTPS, người phụ trách quyền riêng tư, chính sách lưu giữ và tài khoản tester.
- Kiểm tra opt-in và template được duyệt trên Page của bạn, ghi video App Review rồi chuyển Live khi được cấp quyền.

### Giai đoạn 1
Đã tách `createBrain`, hợp đồng `ChannelAdapter`, định danh Address và bộ chọn kênh. Adapter Messenger được nối ở Giai đoạn 2.

### Giai đoạn 2
Đã nối Messenger và Telegram vào cùng createBrain, thêm Fastify webhook, inbox SQLite, Graph, menu, chữ ký, parse attachment và cấu hình theo Page. Tiếp theo nối chính sách gửi chủ động và lệnh riêng.

### Giai đoạn 3
Đã nối nút HITL, admin PSID, lệnh riêng, ảnh, lịch và theo dõi. OTN gắn theo Page, PSID và job. Khi thiếu quyền gửi, lưu thông báo bị lỡ để trả ở lần tương tác tiếp.

### Giai đoạn 4
Worktree `.worktrees/messenger-production`, nhánh `feat/messenger-production`. Nghiệp vụ Page gồm STT, tài liệu riêng, FAQ có dẫn nguồn, gợi ý, Việt/Anh, chuyển nhân viên có hạn, phản hồi bình luận, đặt lịch có xác nhận, xuất/xoá dữ liệu và liên kết hai tài khoản. Test dùng provider giả. Không dùng Page thật.

## Tiến độ của Anti (`anti/phase4-6`)
- **Hoàn thiện Giai đoạn 4:**
  - `src/services/language.ts`: Nhận diện tiếng Việt có dấu và không dấu (tránh nhầm lệnh `/help`, `/book` thành tiếng Anh), hỗ trợ `/lang vi` và `/lang en`.
  - `src/services/page.ts`: Quick reply gợi ý theo ngữ cảnh (giới hạn <= 20 ký tự/nút theo chuẩn Meta), cải thiện lọc bình luận và gắn quick reply vào Private Reply, bổ sung lệnh `/lang`, xử lý `/link` khi chưa bật Telegram và `/faq` rỗng không chuyển nhầm sang nhân viên.
  - `src/services/links.ts` & `src/index.ts`: Bổ sung `linkedPsid`/`unlinkTelegram` để hỗ trợ `/unlink` từ phía Telegram, gắn nhãn `📩 [Messenger]` cho nhắc lỡ chéo kênh và `Promise.allSettled` khi cảnh báo admin Telegram.
- **Hoàn thiện Giai đoạn 6 (Kiểm thử & Trình giả lập cục bộ):**
  - `src/simulator.ts` (`npm run messenger:sim`): Trình giả lập chat Messenger cục bộ qua Fastify webhook có ký HMAC-SHA256 + SQLite inbox + Graph mock + Mock AI cục bộ khi chưa có `AI_API_KEY` (hỗ trợ chọn quick reply `:1..:9`, `:postback`, `:comment`, `:file`, `:kb`, `:user`, `:advance`, `:notify`).
  - `test/messenger-adapter.test.ts` & `test/phase4-features.test.ts`: Kiểm thử đơn vị và tích hợp cho chữ ký webhook, parser, chia tin nhắn 2000 ký tự, cửa sổ 24h/OTN/Telegram fallback/missed flush, phân quyền admin PSID lớn, luồng HTTP webhook → SQLite → `createBrain` → Graph mock, ngôn ngữ, gợi ý, bình luận và trình giả lập.
## Chia việc giữa các agent (2026-11-21)
- Gốc chung: `feat/messenger-production` @ `fef7bb3`.
- **Claude** — worktree `.worktrees/claude`, nhánh `claude/phase5-ops`: Giai đoạn 5 (vận hành) và 7 (hướng dẫn).
- **Anti** — worktree `.worktrees/anti`, nhánh `anti/phase4-6`: phần còn lại Giai đoạn 4 (gợi ý quick reply, bình luận + Private Reply, nhận diện ngôn ngữ, thông báo chéo kênh) và Giai đoạn 6 (integration test webhook → Graph giả, trình giả lập chat `npm run simulate`).
- Mỗi bên ghi tiến độ dưới mục mang tên mình để tránh xung đột khi merge. Merge lần lượt vào `feat/messenger-production`, rồi vào `main`.

### Claude: Giai đoạn 5 + 7 (đã xong)
- `src/core/docstore.ts`: repository (`FileDocStore`, `SqliteDocStore`, migration `core_migrations`). Mọi store lõi dùng `DocStore`. Muốn đổi sang PostgreSQL thì viết thêm một class implements `DocStore`.
- `src/core/metrics.ts`, `src/core/logger.ts`, `src/core/env.ts`. `src/brain.ts` bọc llm/tools/send/handle để ghi số liệu.
- `src/web/{server,auth,pages}.ts`: dashboard, `/privacy`, `/data-deletion`. Khi bật Messenger, các route gắn vào Fastify của webhook. Khi chỉ chạy Telegram, server riêng chỉ bật nếu có `DASHBOARD_PASSWORD`.
- Triển khai: `Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile`, `deploy/nginx.conf.example`, `deploy/bekane.service`, `.github/workflows/ci.yml`.
- Test: `test/ops.test.ts` (migration, nhập file cũ, bền qua restart, metrics, env tiếng Việt, logger che bí mật, session/CSRF/brute-force, signed_request, dashboard API). Tổng 89/89 pass.
- Kiểm tra: `npm run typecheck && npm test && npm run build`.

### Giả định (Claude)
- Mặc định `STORAGE=sqlite`. Dữ liệu cũ tự nhập ở lần đọc đầu, file cũ giữ nguyên nên quay lại được.
- Data Deletion của Meta gửi ASID (không phải PSID): xoá được khi khớp, nếu không thì ghi nhận và báo admin xử lý thủ công trong 30 ngày.
- Gửi ngoài 24h từ dashboard chỉ khi `FB_HUMAN_AGENT_ENABLED=true` (đã được Meta cấp) và trong 7 ngày.
- Chưa chạy `docker build` trên máy này. Job `docker` trong CI sẽ kiểm tra.

### VIỆC BẠN CẦN TỰ LÀM (bổ sung)
- Đặt `DASHBOARD_PASSWORD`, `PRIVACY_OWNER`, `PRIVACY_CONTACT`, `DOMAIN` trong `.env` trên VPS.
- Trỏ DNS tên miền về VPS, mở cổng 80/443, chạy `docker compose up -d --build`.
- Khai báo `https://DOMAIN/privacy` và `https://DOMAIN/data-deletion` trong Cài đặt > Cơ bản của app Meta, quay video và nộp App Review theo mục 7 của hướng dẫn.

## Trạng thái chạy thật (2026-11-21)
- Bot Messenger chạy trên máy Windows của chủ Page (cổng 3100, vì cổng 3000 bị Grafana chiếm), mở ra ngoài bằng Cloudflare quick tunnel (URL `*.trycloudflare.com`, ĐỔI mỗi lần khởi động lại).
- Page: Bekanebot, **Page ID thật = 1493463383840156** (khác ID trên link profile.php). App Meta: bekanebot (App ID 1190094460643584), chế độ **Development**.
- AI: Gemini qua endpoint tương thích OpenAI, model `gemini-3.1-flash-lite`. STT dùng Gemini generateContent (`src/services/stt.ts`).
- Page đã đăng ký webhook bằng API `POST /{page}/subscribed_apps` (nút "Add Subscriptions" trên web không lưu được vì token thiếu `pages_manage_metadata`).
- Token Page chỉ có `pages_messaging` → chưa dùng được trả lời bình luận (cần `pages_read_engagement`, `pages_manage_engagement`).
- App Secret và Page token đã từng gửi qua chat → PHẢI Reset/Generate lại trước khi chạy thật.
- Admin PSID: 29934953832755967.

## Vì sao người ngoài chưa nhắn được
App ở chế độ Development: Meta chỉ chuyển tin của người có vai trò trong app (Admin/Developer/Tester). Muốn công khai phải qua App Review quyền `pages_messaging` rồi chuyển app sang Live.

## KẾ HOẠCH PHIÊN TIẾP THEO (theo thứ tự)
### A. Mở công khai (P0)
1. Địa chỉ cố định: tên miền (gợi ý `.id.vn`) → Cloudflare (gói Free) → `cloudflared tunnel login/create/route dns` → cài tunnel thành Windows service; hoặc VPS + `docker compose up -d`.
2. Script tự khởi động bot khi bật máy (Task Scheduler) + script `scripts/update-webhook` cập nhật Callback URL qua Graph API `POST /{app-id}/subscriptions` (dùng `app_id|app_secret`) để không phải dán tay.
3. Điền Basic settings: Privacy URL `/privacy`, Data deletion callback `/data-deletion`, icon 1024×1024, Category, PRIVACY_OWNER/PRIVACY_CONTACT.
4. Reset App Secret + tạo Page token mới (sau khi cấp đủ quyền) → `.env`.
5. Business Verification nếu Meta yêu cầu; quay video demo; nộp App Review `pages_messaging` (+ `pages_manage_metadata`; + engagement nếu bật bình luận); khi duyệt → Publish → Live.
### B. Chất lượng trả lời (P1)
6. Persona riêng cho Messenger (CSKH lịch sự, xưng em–anh/chị), tách khỏi persona Telegram: `PERSONA_PATH` riêng cho Page.
7. Kho kiến thức: nạp PDF/DOCX từ dashboard (dùng `extract()`), chia đoạn tốt hơn, hiển thị nguồn gọn.
8. Đặt lịch: hiểu ngày giờ tự nhiên ("9h sáng thứ 7") thành thời điểm cụ thể, kiểm tra không ở quá khứ, tự đặt lời nhắc trước giờ hẹn, danh sách lịch hẹn trên dashboard (xác nhận/huỷ).
### C. Vận hành (P1)
9. Dashboard: thông báo realtime (tự tải lại), lọc khách đang chờ nhân viên, xuất CSV lịch hẹn.
10. Cảnh báo admin khi Graph báo token hết hạn/bị chặn; ghi lỗi vào thống kê.
11. Sao lưu `data/` hằng ngày (scripts/backup).
### D. Nâng cao (P2)
12. Trả lời bằng giọng nói (TTS) khi khách gửi tin thoại.
13. Thẻ sản phẩm (generic template) có ảnh/giá/nút.
14. Trả lời bình luận + Private Reply (sau khi có quyền engagement).
15. Kênh mới: Zalo OA / Instagram qua ChannelAdapter.
