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
