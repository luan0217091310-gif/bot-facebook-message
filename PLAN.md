# Kế hoạch Bekane đa kênh

| Giai đoạn | Ưu tiên | Công việc và tiêu chí hoàn thành |
|---|---|---|
| 0. Khảo sát | P0 | Chốt SHA, đối chiếu quyền và lệnh trong source, chạy typecheck + 71 test + build làm mốc. |
| 1. Lõi | P0 | Tách khởi tạo agent khỏi polling. Hai kênh có định danh và admin riêng. Chạy lại test Telegram, giữ dữ liệu cũ qua migration. |
| 2. Messenger | P0 | Raw HMAC, challenge, parser, dedup, inbox, Graph client, profile và .env.example. Event ký sai bị từ chối trước khi xử lý. |
| 3. Tương đương | P0 | 11 tool và vision, lệnh, HITL, giới hạn outbound. Kiểm thử đúng biên 24h, OTN một lần, fallback và hiển thị nhắc lỡ. |
| 4. Nghiệp vụ | P1 | Thoại, PDF/DOCX/TXT, tìm tài liệu có nguồn, gợi ý, chuyển nhân viên, bình luận, đặt lịch, Việt/Anh, quyền dữ liệu, liên kết Telegram. Có ca thử cho từng luồng. |
| 5. Vận hành | P0/P1 | SQLite + migration, job bền, dashboard đăng nhập, health, log/metrics, callback xoá dữ liệu, Docker/Caddy/systemd và CI. Kiểm tra restart, quyền và khôi phục. |
| 6. Kiểm thử | P0 | Test HTTP từ webhook đến Graph giả, cả hai kênh; CLI mô phỏng không cần Page. Chạy typecheck/test/build. |
| 7. Hướng dẫn | P2 | README có sơ đồ, hướng dẫn từ Page mới đến Live, lỗi thường gặp, danh sách việc của chủ Page. Kiểm tra lệnh với package.json. |

Mỗi mốc có commit riêng trong repo bot-facebook-message. Không dùng token Telegram production để chạy thử polling.
