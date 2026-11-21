# Lịch sử thay đổi

## Đang phát triển

- Bắt đầu chuyển Bekane Bot sang kiến trúc đa kênh từ `setup-bot-tele`, commit `d2211a030769c26fbb4d32d3253a8054774d13a7`.

### Giai đoạn 5–7 (nhánh `claude/phase5-ops`)
- Lưu trữ lõi qua lớp repository `DocStore` (SQLite mặc định, migration có phiên bản; tự nhập file JSON/JSONL cũ, không xoá). `STORAGE=file` để quay lại.
- `npm run data:migrate` chuyển toàn bộ `data/` sang SQLite.
- Lời nhắc và website theo dõi lưu trong SQLite, còn nguyên sau khi khởi động lại.
- Thống kê: tin đến/đi, người dùng hoạt động, latency TB/P95, token, chi phí ước tính, tool, lỗi.
- Log JSON bằng pino, che bí mật bằng `redact.ts` (cả trường lồng nhau).
- Kiểm tra `.env` bằng zod khi khởi động, báo lỗi tiếng Việt.
- Dashboard `/dashboard` có đăng nhập (cookie HMAC, chống CSRF, khoá IP khi sai nhiều): thống kê, hội thoại, trả lời trực tiếp (HUMAN_AGENT khi được cấp), bật/tắt bot theo người, quản lý ghi nhớ/lời nhắc/website, kho kiến thức.
- `/privacy` và Data Deletion Callback `/data-deletion` (kiểm `signed_request`).
- Dockerfile, docker-compose + Caddy HTTPS, mẫu Nginx, unit systemd `deploy/bekane.service`, GitHub Actions.
- `docs/messenger/HUONG-DAN-MESSENGER.md` và README đa kênh.
