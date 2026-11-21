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
