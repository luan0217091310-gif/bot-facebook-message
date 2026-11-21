# Đối chiếu Telegram và Messenger

Khảo sát ngày 21/11/2026 trên commit Telegram `d2211a0`. Cột trạng thái mô tả quyết định thiết kế. Xem PROGRESS.md để biết phần đã kiểm thử.

| Tính năng gốc | Messenger | Trạng thái | Lý do |
|---|---|---|---|
| Long polling, parse update | Webhook Page, chữ ký raw body, hàng đợi bền, bỏ echo và chống trùng mid | Thay thế | Meta gửi lại sự kiện khi lỗi |
| DM_POLICY, ID admin | DM Page, ADMIN_PSIDS dạng chuỗi | Làm lại | PSID thuộc từng Page, có thể vượt giới hạn số nguyên JS |
| ALLOWED_GROUPS, mention, alias, topic, /mode | Chỉ Telegram | Bỏ | Page trò chuyện 1–1 |
| /help, /start | Get Started, trợ giúp, menu | Làm lại | Người dùng có thể chạm hoặc gõ |
| /stop | Huỷ tác vụ theo người và hội thoại | Giữ nguyên | Có thể huỷ khi AI đang bận |
| /memories, /facts | Ghi nhớ của PSID | Làm lại | Không có dữ liệu nhóm |
| /reminders, /watches | Danh sách theo hội thoại | Giữ nguyên | Phạm vi dữ liệu độc lập |
| /id | Hiện PSID của chính người hỏi | Làm lại | Hỗ trợ nhận diện admin trước cấu hình |
| /status | Thống kê cho admin | Giữ nguyên | Kiểm quyền tại server |
| /pause, /resume | Bật/tắt theo hội thoại | Làm lại | Telegram áp dụng cho nhóm |
| /clear_history confirm | Xác nhận trước khi xoá lịch sử | Giữ nguyên | Chỉ admin |
| Agent, MAX_ROUNDS, tool calling, OpenAI/Gemini, persona tự nạp | Cùng agent và provider | Giữ nguyên | Không phụ thuộc giao thức |
| Queue, timeout, giới hạn theo người, redact | Chia phạm vi theo kênh, che thêm bí mật Meta | Làm lại | Hai bên có thể có ID trùng nhau |
| Ảnh, caption, OCR qua vision | Attachment URL từ Meta CDN | Làm lại | Telegram dùng file_id |
| get_current_time, web_search, fetch_url | Công cụ dùng chung | Giữ nguyên | Phân quyền tại dispatcher/agent |
| remember_fact, forget_fact | Stale, tombstone theo người, xác nhận bằng nút | Làm lại | Tách dữ liệu Page |
| schedule_reminder, list_reminders, cancel_reminder | Lưu bền, kiểm tra quyền gửi lúc đến hạn | Làm lại | Cửa sổ gửi chủ động |
| watch_url, list_watches, unwatch_url | Giữ quyền thêm/gỡ cho admin và áp dụng cùng chính sách gửi | Làm lại | Một opt-in chỉ đủ cho một lần |
| HITL ok/thôi | Đồng ý / Huỷ hoặc gõ tay | Làm lại | Quick reply cung cấp payload |
| Gửi văn bản dài, typing | Chia dưới 2.000 đơn vị UTF-16, sender actions | Làm lại | Giới hạn kênh |
| JSONL/JSON, systemd | Migration SQLite, systemd hoặc Docker + Caddy | Thay thế kho lưu | Khôi phục job sau restart |

## Quyết định theo tài liệu Meta

- GET trả challenge, POST xác thực HMAC-SHA256 trên byte gốc trước khi parse. Chỉ ACK sau khi ghi inbox thành công. [Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- Dùng cửa sổ bảo thủ 24 giờ, tính từ tương tác hợp lệ. Echo, read, delivery và thời gian server nhận webhook cũ không gia hạn. HUMAN_AGENT chỉ cho nhân viên thật, đúng quyền và thời hạn. Private Reply tối đa một lần trong 7 ngày kể từ bình luận. [Policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy)
- Ba tag giao dịch cũ bị từ chối từ 27/04/2026. OTN được Policy mô tả là beta, cần kiểm tra khả dụng cho Page. Dùng token đúng chủ đề một lần hoặc template Utility đúng mục đích đã duyệt. Khi thiếu điều kiện, lưu lỡ hẹn. [Changelog](https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog/) · [Send API](https://developers.facebook.com/docs/graph-api/reference/page/messages)
