# Bot Hiếu — Telegram AI cho nhóm

Bot tự trả lời tin nhắn văn bản và chú thích ảnh/tài liệu của mọi thành viên trong những nhóm được cho phép. Không cần @tag khi dùng chế độ mặc định `all`.

Mã dùng TypeScript, Node.js >=22, `node-telegram-bot-api` **v2** và SDK `openai`. Không dùng API khởi tạo `new TelegramBot(...)` của thư viện Telegram v1.

## Chạy trên Windows

Mở terminal tại thư mục dự án. Các lệnh dùng `npm.cmd` để tránh lỗi PowerShell chặn `npm.ps1`.

```powershell
npm.cmd ci
```

Nếu chưa có `.env`, sao chép `.env.example` thành `.env`. Không ghi đè file chứa cấu hình thật.

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

Điền các trường sau **trực tiếp trên máy**, không dán khóa vào chat, ảnh chụp hoặc Git:

```dotenv
TELEGRAM_BOT_TOKEN=token_tu_BotFather
TELEGRAM_BOT_USERNAME=ten_username_cua_bot_khong_co_dau_@
ADMIN_TELEGRAM_IDS=ID_so_tai_khoan_cua_ban
ALLOWED_GROUPS=-1001234567890
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=khoa_API_cua_nha_cung_cap
AI_MODEL=gpt-4o-mini
GROUP_REPLY_MODE=all
DM_POLICY=admin
```

`AI_MODEL` là mã model tài khoản của bạn được phép gọi; giá trị mẫu được giữ từ cấu hình cũ, không có nghĩa tài khoản nào cũng có quyền sử dụng. Endpoint cần hỗ trợ Chat Completions và `max_completion_tokens`. Bot gửi `store: false` với endpoint thông thường, nhưng bỏ trường này khi kết nối trực tiếp Gemini vì Google không hỗ trợ nó. ChatGPT và API có cấu hình tài khoản/thanh toán riêng; bot cần khóa API của endpoint đã chọn.

Để dùng Gemini, đặt `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `AI_MODEL=gemini-3.1-flash-lite` và điền khóa Google AI Studio vào `AI_API_KEY`. Không dùng token Telegram cho trường này.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

Hoặc dùng `npm.cmd run dev` khi phát triển. Dừng bằng Ctrl+C. Chỉ bật một phiên chạy cho cùng token. Nếu máy ngủ hoặc tắt thì bot local sẽ ngừng phục vụ.

## Thiết lập Telegram

1. Trong Telegram, mở đúng tài khoản **@BotFather**, dùng `/newbot` và lấy token. Có thể dùng lại bot đã tạo.
2. Lấy ID số tài khoản cá nhân bằng cách nhắn một bot cung cấp user ID đáng tin cậy, rồi điền `ADMIN_TELEGRAM_IDS`. ID không phải số điện thoại hay username.
3. Thêm bot vào nhóm thử nghiệm. Qua BotFather dùng `/setprivacy`, chọn bot, chọn **Disable**. Theo hướng dẫn Telegram, cần thêm lại bot vào nhóm để thay đổi Privacy Mode có hiệu lực. Bot phải có quyền gửi tin trong nhóm.
4. Có thể tạm để `ALLOWED_GROUPS` rỗng. Chủ bot gửi `/id@ten_bot` trong nhóm; bot trả Chat ID để điền vào `ALLOWED_GROUPS`, sau đó khởi động lại. `/id` chỉ được chủ bot sử dụng kể cả nhóm chưa được cho phép.
5. Gửi tin thường bằng tài khoản thành viên. Bot phải reply đúng tin nhắn đó, trong đúng topic nếu có.

Không cần cấp quyền xóa tin hay quản lý thành viên cho chức năng trả lời. Các nhóm không nằm trong danh sách được phép sẽ bị bỏ qua. Bản này bỏ qua tin từ bot khác, channel và tài khoản gửi ẩn danh qua `sender_chat`; chưa có xử lý chỉnh sửa tin, voice, sticker hay nội dung ảnh/tài liệu.

Nếu bot có webhook từ ứng dụng cũ, chương trình sẽ dừng với thông báo. Tắt ứng dụng cũ và gỡ webhook bằng công cụ quản lý của bạn trước khi bật long polling; chương trình không tự xóa webhook đang tồn tại.

## Lệnh

| Lệnh | Ai dùng | Tác dụng |
|---|---|---|
| `/help`, `/start` | Thành viên được phép | Xem hướng dẫn |
| `/stop` | Thành viên được phép | Hủy câu hỏi của chính mình đang chạy và đang chờ trong chat/topic hiện tại |
| `/stop` | Chủ bot | Hủy mọi tác vụ trong chat/topic hiện tại |
| `/id` | Chủ bot | Xem User ID, Chat ID và Topic ID |
| `/status` | Chủ bot | Xem chế độ, số tác vụ, số lỗi và tổng token API báo từ khi khởi động |
| `/pause` | Chủ bot | Tắt tự trả lời, hủy tác vụ của mọi topic trong nhóm |
| `/resume` | Chủ bot | Bật lại tự trả lời trong nhóm |
| `/mode all` | Chủ bot | Trả lời mọi tin nhắn văn bản trong nhóm |
| `/mode mention` | Chủ bot | Chỉ trả lời khi @tag bot hoặc @biệt_danh |
| `/clear_history` | Chủ bot | Xem hướng dẫn xóa ngữ cảnh |
| `/clear_history confirm` | Chủ bot | Hủy tác vụ và xóa lịch sử được lưu của chat/topic hiện tại |

"Chủ bot" nghĩa là ID nằm trong `ADMIN_TELEGRAM_IDS`, không tự động bao gồm mọi quản trị viên Telegram. Người đổi tên giống Hiếu vẫn không có quyền này. Lệnh có hậu tố `@bot_khac` sẽ bị bỏ qua. Trong chế độ `mention`, reply tin bot mà không tag chỉ được lưu làm ngữ cảnh.

`/clear_history` không xóa tin nhắn trên Telegram. `/stop` không thu hồi tin đã gửi hoặc bảo đảm hủy một lượt gửi mà Telegram đã nhận. Lệnh quản trị vẫn hoạt động khi nhóm đang pause. Trạng thái pause/mode được lưu theo nhóm trong `data/group-settings.json`; đổi mặc định trong `.env` không ghi đè lựa chọn đã lưu bằng lệnh.

## Các giới hạn mặc định

| Biến | Giá trị | Ý nghĩa |
|---|---:|---|
| `HISTORY_LIMIT` | 40 | Số mục lịch sử tối đa mỗi chat/topic |
| `HISTORY_MAX_CHARS` | 16000 | Ngân sách ký tự JSON của lịch sử được giữ |
| `MAX_INPUT_CHARS` | 6000 | Độ dài tin nhắn đầu vào tối đa |
| `MAX_REPLY_CHARS` | 3500 | Độ dài phản hồi tối đa; phần vượt được cắt bằng dấu … |
| `MAX_OUTPUT_TOKENS` | 600 | Giới hạn token đầu ra của AI, gồm cả phần suy luận nếu model có |
| `AI_TIMEOUT_MS` | 30000 | Thời gian tối đa chờ một câu trả lời AI |
| `MAX_CONCURRENT_AI` | 3 | Số luồng đang xử lý; mỗi luồng bao gồm cả việc gửi phản hồi |
| `MAX_QUEUE_PER_THREAD` | 10 | Số tác vụ tối đa gồm đang chạy và chờ mỗi chat/topic; cũng giới hạn số phản hồi đang chờ mỗi chat |
| `MAX_QUEUE_TOTAL` | 100 | Tổng tác vụ tối đa; đồng thời giới hạn hàng đợi phản hồi toàn bot |
| `MAX_QUEUE_WAIT_MS` | 90000 | Câu hỏi quá tuổi này khi đến lượt sẽ bị bỏ, có thông báo khi có thể |
| `USER_MESSAGES_PER_MINUTE` | 10 | Số yêu cầu tối đa mỗi người trong cửa sổ một phút, tính chung các chat |

Phản hồi được gửi tuần tự trong mỗi chat, cách nhau tối thiểu khoảng 3,1 giây, tính cả lệnh và các đoạn tin dài. Tốc độ này áp dụng chung các topic. HTTP 429 được thử lại tối đa hai lần theo `retry_after` trong phạm vi 60 giây; lỗi mạng khi gửi không tự thử lại vì có thể tạo tin trùng.

Khi quá tải, bot gộp thông báo tối đa một lần mỗi 30 giây cho mỗi chat, tránh spam thêm. Vì có giới hạn tải và giới hạn Telegram, bot không hứa trả lời riêng từng tin trong một nhóm gửi liên tục quá nhanh. Theo dõi `/status` và số token trên trang của nhà cung cấp để kiểm soát sử dụng; bản này chưa có hạn mức tiền theo ngày.

Trong chế độ `mention`, tin thường chỉ làm ngữ cảnh và không tiêu hạn mức yêu cầu AI. Lệnh quản trị của chủ bot và `/stop` vẫn được xử lý khi người gửi đã hết hạn mức; hàng đợi gửi Telegram vẫn có giới hạn.

Chỉnh cách xưng hô và kiến thức hướng dẫn trong `config/persona.prompt.md`; nội dung được đọc lại mỗi lượt, không cần build lại. Dữ liệu user được gửi cho AI dưới dạng nội dung hội thoại có ID người gửi và ngữ cảnh reply; không có công cụ cho AI thay đổi cài đặt hay quyền quản trị.

## Lưu dữ liệu và giới hạn bản đầu

- Lịch sử có giới hạn được ghi dạng JSONL tại `data/threads/<chatId>[_<topicId>]/history.jsonl`, bằng ghi file tạm rồi đổi tên.
- Chat riêng, nhóm khác và topic khác có lịch sử riêng. Mỗi lượt chỉ nạp lịch sử của phạm vi hiện tại. Không có cơ sở dữ liệu trí nhớ cá nhân dùng chung.
- Token/key được lọc trước khi gửi ra chat, ghi lịch sử và ghi log. Nội dung hội thoại được gửi đến nhà cung cấp AI đã cấu hình; nên thông báo cho thành viên khi bật bot.
- Lịch sử giữ lại qua khởi động lại. Bộ chống trùng 2000 tin, hạn mức theo người và hàng đợi nằm trong RAM. Tác vụ chưa hoàn tất có thể mất khi tiến trình dừng; thành viên cần gửi lại. Chưa có hàng đợi bền vững hay bảo đảm exactly-once qua restart.
- Trong mỗi chat/topic, câu hỏi chạy tuần tự. Các chat/topic khác chạy đồng thời theo giới hạn. AI lỗi/timeout không chặn vĩnh viễn câu hỏi sau.
- File chỉ có ảnh/tài liệu sẽ nhận thông báo hỗ trợ văn bản. Chú thích được đọc như văn bản; bot chưa đọc ảnh, PDF hay file đính kèm.
- Chưa có tra web, ghi nhớ facts dài hạn, chạy shell, Docker sandbox, Zalo hay scheduler. Các kế hoạch trong `docs/superpowers/plans/` là thiết kế giai đoạn trước; README này mô tả bản đang triển khai.

## Chạy 24/7 trên VPS Ubuntu

Chuẩn bị Node.js >=22, một user dịch vụ `botuser`, và thư mục `/opt/bothieu` thuộc user đó. Chép mã nguồn, `package-lock.json`, `config/` và các cấu hình TypeScript lên VPS; không chép `node_modules` Windows. Giữ `.env`, `data/` và `backups/` của máy chủ khi cập nhật.

Tại `/opt/bothieu`, cài và build rồi giảm dependency dùng cho phát triển:

```bash
npm ci
npm run build
npm prune --omit=dev
```

Tạo `.env` bằng mẫu, điền cấu hình và đặt quyền chỉ user dịch vụ đọc. Tạo `data/` và `backups/` thuộc `botuser`. Cài `deploy/bothieu.service` vào `/etc/systemd/system/bothieu.service`. Mẫu service dùng `/usr/bin/node`; chỉnh nếu Node được cài ở đường dẫn khác. **Tắt bot local trước khi bật bot trên VPS.**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bothieu
sudo systemctl status bothieu
sudo journalctl -u bothieu -f
```

Service tự chạy lại sau lỗi. Xem log bằng journal; bot không ghi toàn bộ nội dung cuộc trò chuyện vào console. Chưa tích hợp kênh báo động ngoài khi bot chết. Khi cập nhật, dừng service, build phiên bản mới và khởi động lại; không xóa thư mục trạng thái.

Sao lưu bằng user có quyền đọc dữ liệu và ghi thư mục backup:

```bash
bash scripts/backup.sh /opt/bothieu/data /opt/bothieu/backups
```

Có thể đặt lệnh trên vào cron mỗi ngày. Script lưu toàn bộ dữ liệu, gồm lịch sử và chế độ nhóm; không chứa `.env`. Giữ bản cấu hình bí mật riêng ở nơi an toàn. Để khôi phục, dừng service, giải nén backup vào thư mục tạm để kiểm tra rồi phục hồi `data/` với đúng quyền user dịch vụ trước khi khởi động lại.

## Kiểm chứng

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Test không gửi tin Telegram thật và không tiêu tiền AI. Bài tích hợp chạy SDK Telegram v2 và OpenAI thật với HTTP giả lập để kiểm tra cả đường đi: polling → parser → dispatcher → AI → reply đúng tin/topic.

Trước khi dùng nhóm chính: thử hai thành viên hỏi xen kẽ, câu hỏi nối tiếp bằng reply, một nhóm ngoài danh sách, giả tên chủ bot, `/pause`, `/resume`, `/stop`, chuyển mode, xóa lịch sử một topic và khởi động lại. Kiểm tra model và token thực tế bằng nhóm thử nghiệm.

## Tài liệu API tham khảo

- [Telegram: Privacy Mode và tin nhắn bot nhận được](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get)
- [Telegram: BotFather và Privacy Mode](https://core.telegram.org/bots/features#privacy-mode)
- [Telegram: giới hạn gửi tin](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
- [Telegram: sendMessage và reply_parameters](https://core.telegram.org/bots/api#sendmessage)
- [OpenAI Docs: Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
