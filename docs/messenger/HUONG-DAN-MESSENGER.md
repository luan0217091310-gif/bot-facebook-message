# Hướng dẫn đưa Bekane lên Facebook Messenger (cho người mới)

Tài liệu đi từ con số 0 (chưa có Page) đến lúc bot chạy công khai (Live). Làm lần lượt, đừng bỏ bước.
Giao diện Meta thay đổi thường xuyên: nếu tên nút khác một chút, tìm mục có ý nghĩa tương tự.

> Bạn cần: một tài khoản Facebook cá nhân, máy cài **Node.js 22+**, API key OpenAI hoặc Gemini.
> Khi đưa lên mạng thật: một VPS Linux và một tên miền (ví dụ `bot.example.com`).

---

## Bước 0. Chạy thử trên máy, chưa cần Facebook

```bash
npm ci
cp .env.example .env        # Windows: copy .env.example .env
npm test                    # mọi test phải xanh
npm run simulate            # trình giả lập chat Messenger (nhánh của Anti, xem PROGRESS.md)
```

Trình giả lập dùng Graph API giả, không cần token thật. Bạn có thể nói chuyện với bot giống như trên Messenger.

---

## Bước 1. Tạo Facebook Page

1. Vào <https://www.facebook.com/pages/create>.
2. Đặt tên Page, chọn hạng mục (ví dụ "Cửa hàng", "Dịch vụ"), bấm **Tạo Page**.
3. Vào Page → **Giới thiệu** → ghi lại **ID Page** (một dãy số). Đây là `FB_PAGE_ID`.

## Bước 2. Tạo app trên Meta for Developers

1. Vào <https://developers.facebook.com/apps> → **Tạo ứng dụng**.
2. Chọn mục đích có Messenger (thường là **"Khác" → loại "Doanh nghiệp"**), đặt tên app, bấm tạo.
3. Trong app: **Thêm sản phẩm** → **Messenger** → **Thiết lập**.
4. Mục **Cài đặt > Cơ bản**: bấm **Hiển thị** ở ô **Khoá bí mật của ứng dụng** → đó là `FB_APP_SECRET`.
5. Trong **Messenger > Cài đặt API** (hoặc "Messenger API Settings"):
   - **Kết nối Page** vừa tạo (Add/Connect Page), cấp đủ quyền khi được hỏi.
   - Bấm **Tạo mã** (Generate token) cạnh Page → đó là `FB_PAGE_ACCESS_TOKEN`.
     Token này có quyền gửi tin thay Page: **không** dán vào chat, không commit lên GitHub.
6. Tự nghĩ một chuỗi bí mật dài ≥ 8 ký tự (ví dụ chạy `openssl rand -hex 16`) → `FB_VERIFY_TOKEN`.

Điền vào `.env`:

```ini
ENABLED_CHANNELS=messenger          # hoặc telegram,messenger để chạy cả hai
AI_API_KEY=...
FB_PAGE_ID=123456789012345
FB_PAGE_ACCESS_TOKEN=EAAG...
FB_APP_SECRET=abcdef...
FB_VERIFY_TOKEN=chuoi-bi-mat-tu-dat
GRAPH_API_VERSION=v27.0             # xem phiên bản mới nhất trong Meta for Developers
PUBLIC_BASE_URL=https://xxxx.trycloudflare.com   # điền ở bước 3
PORT=3000
DASHBOARD_PASSWORD=mot-mat-khau-dai-it-nhat-12-ky-tu
```

Nếu thiếu hoặc sai biến, bot sẽ dừng ngay khi khởi động và in danh sách lỗi bằng tiếng Việt.

## Bước 3. Chạy bot trên máy + mở đường HTTPS công khai

Meta chỉ gửi webhook tới URL **HTTPS công khai**. Khi phát triển trên máy, dùng một "tunnel":

**Cách A, Cloudflare Tunnel (miễn phí, không cần tài khoản):**

```bash
npm run dev                                          # cửa sổ 1: bot chạy ở cổng 3000
cloudflared tunnel --url http://localhost:3000       # cửa sổ 2
```

**Cách B, ngrok:** `ngrok http 3000` (cần đăng ký tài khoản ngrok và chạy `ngrok config add-authtoken ...`).

Lấy URL dạng `https://....trycloudflare.com` (hoặc `https://....ngrok-free.app`), điền vào `PUBLIC_BASE_URL` rồi khởi động lại bot.
Kiểm tra: mở `PUBLIC_BASE_URL/health` → thấy `{"ok":true}`.

**Khai báo webhook** trong app Meta → **Messenger > Cài đặt API > Webhook**:

| Ô | Giá trị |
|---|---|
| Callback URL | `PUBLIC_BASE_URL/webhooks/messenger` |
| Verify Token | đúng chuỗi `FB_VERIFY_TOKEN` |

Bấm **Xác minh và lưu**. Sau đó, ở dòng Page, bấm **Thêm gói đăng ký** (Add subscriptions) và tích:

- `messages`, `messaging_postbacks`, `messaging_optins`, `message_reactions`, `message_reads`, `message_deliveries`
- `feed`: chỉ khi muốn bot tự trả lời bình luận (đặt thêm `FB_COMMENTS_ENABLED=true`)

> Mỗi lần khởi động lại tunnel miễn phí, URL thay đổi → phải cập nhật lại `PUBLIC_BASE_URL` và Callback URL.

## Bước 4. Thêm tester và chat thử

App mới ở chế độ **Development**: chỉ người có vai trò trong app mới chat được với bot.

1. App → **Vai trò ứng dụng > Vai trò** → **Thêm người** (vai trò Tester hoặc Developer) → người đó phải chấp nhận lời mời tại <https://developers.facebook.com/requests>.
2. Mở Page bằng tài khoản đó → **Nhắn tin** → gửi "xin chào".
3. Bot chào và nói rõ mình là chatbot AI (Meta bắt buộc). Gõ `/id` để lấy **PSID** của bạn.
4. Điền PSID vào `ADMIN_PSIDS=` (nhiều người thì cách nhau bằng dấu phẩy), khởi động lại. Giờ bạn dùng được `/status`, `/pause`, `/resume`, `/clear_history`.

## Bước 5. Cài menu, nút Bắt đầu và lời chào

```bash
npm run messenger:setup
```

Lệnh này cài nút **Bắt đầu** (Get Started), lời chào, **Persistent Menu** (Trợ giúp, Dừng, Ghi nhớ, Lời nhắc, Theo dõi web) và **Ice Breakers**.
Menu có thể mất vài phút mới hiện. Thử xoá hội thoại rồi mở lại.

## Bước 6. Đưa lên VPS chạy 24/7 (có HTTPS)

Trỏ tên miền về IP VPS (bản ghi **A** `bot.example.com → IP`). Mở cổng 80 và 443.

### Cách A, Docker (khuyên dùng)

```bash
git clone https://github.com/luan0217091310-gif/bot-facebook-message.git bekane && cd bekane
cp .env.example .env && nano .env      # điền như bước 2, thêm DOMAIN=bot.example.com
                                       # PUBLIC_BASE_URL=https://bot.example.com
docker compose up -d --build
docker compose logs -f bot             # xem log (JSON, đã che token)
```

Caddy tự xin chứng chỉ HTTPS. Dữ liệu nằm ở `./data` (SQLite), nên nhớ sao lưu thư mục này.

### Cách B, systemd (không Docker)

```bash
sudo useradd -r -s /usr/sbin/nologin botuser
sudo mkdir -p /opt/bekane && sudo chown botuser /opt/bekane
# copy mã nguồn vào /opt/bekane, rồi:
cd /opt/bekane && npm ci && npm run build
sudo cp deploy/bekane.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bekane
journalctl -u bekane -f
```

HTTPS: cài Caddy (`apt install caddy`), dùng `deploy/Caddyfile` với `UPSTREAM=127.0.0.1:3000` và `DOMAIN=bot.example.com`,
hoặc dùng Nginx + certbot theo `deploy/nginx.conf.example`.

Sau khi deploy: đổi **Callback URL** trong Meta sang `https://bot.example.com/webhooks/messenger`.

### Chuyển dữ liệu cũ

Nếu đã có dữ liệu bot Telegram trong `data/` (file JSON/JSONL): `npm run data:migrate`. Lệnh an toàn khi chạy nhiều lần và **không xoá** file cũ.
Thực ra bot cũng tự nhập file cũ ở lần đọc đầu tiên. `STORAGE=file` cho phép quay lại cách lưu cũ.

### Dashboard admin

Mở `https://bot.example.com/dashboard`, đăng nhập bằng `DASHBOARD_PASSWORD`. Bạn có thể:

- Xem thống kê: tin nhắn, người dùng hoạt động, thời gian phản hồi, token, chi phí ước tính, tool dùng nhiều, lỗi.
- Xem hội thoại, **trả lời trực tiếp** khi khách cần người thật, bật/tắt bot với từng người.
- Xoá ghi nhớ, huỷ lời nhắc, bỏ theo dõi website.
- Nạp **kho kiến thức** (FAQ, bảng giá, chính sách): bot trả lời có dẫn nguồn, không có nguồn thì nói không biết.

Đăng nhập sai 5 lần trong 1 phút thì IP đó bị khoá tạm.

## Bước 7. App Review và chuyển sang Live

Ở chế độ Development, người lạ **không** chat được với bot. Để mở công khai:

1. **Chuẩn bị:**
   - Trang chính sách bảo mật: bot có sẵn `https://bot.example.com/privacy`. Điền `PRIVACY_OWNER` và `PRIVACY_CONTACT` trong `.env`.
   - Data Deletion Callback: `https://bot.example.com/data-deletion`. Khai báo ở **Cài đặt > Cơ bản > URL hướng dẫn/Callback xoá dữ liệu**.
     Lưu ý: Meta gửi ID theo app (khác PSID). Bot xoá ngay nếu khớp được hội thoại; nếu không khớp, bot ghi nhận và báo admin xử lý trong 30 ngày.
     Người dùng luôn tự xoá được bằng lệnh `/delete` trong chat.
   - Điền icon app, hạng mục, email liên hệ trong **Cài đặt > Cơ bản**.
   - Xác minh doanh nghiệp (Business Verification) nếu Meta yêu cầu.
2. **Quyền cần xin** (App Review > Quyền và tính năng):

   | Quyền | Để làm gì |
   |---|---|
   | `pages_messaging` | Nhận và trả lời tin nhắn (bắt buộc) |
   | `pages_manage_metadata` | Đăng ký webhook cho Page |
   | `pages_show_list` | Chọn Page khi kết nối |
   | `pages_read_engagement`, `pages_manage_engagement` | Chỉ khi bật trả lời bình luận |
   | Tính năng **Human Agent** | Chỉ khi admin cần trả lời quá 24 giờ (rồi đặt `FB_HUMAN_AGENT_ENABLED=true`) |

3. **Video demo** (quay màn hình 1–3 phút cho từng quyền): mở Page → nhắn tin → bot chào và nói mình là bot → hỏi một câu → bot trả lời → bấm menu → đặt lời nhắc → (nếu có) bình luận bài viết và thấy trả lời. Quay cả phía dashboard nếu dùng Human Agent.
4. **Mô tả cách dùng** từng quyền, kèm hướng dẫn tester: "Nhắn 'xin chào' tới Page X".
5. Nộp, chờ duyệt (thường vài ngày). Khi được duyệt: chuyển công tắc app sang **Live**.

**Chính sách bắt buộc tuân thủ:** chỉ nhắn trong vòng 24 giờ kể từ tin cuối của khách. Ngoài 24 giờ, bot chỉ gửi khi khách đã đồng ý nhận thông báo (opt-in/"Nhắc tôi")
hoặc có template Utility được duyệt. Lời nhắc không gửi được sẽ lưu lại và báo khi khách nhắn tiếp (hoặc gửi qua Telegram nếu khách đã liên kết `/link`).
Không gửi quảng cáo ngoài 24 giờ, không lạm dụng message tag.

---

## Bảng xử lý lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Bấm "Xác minh và lưu" báo lỗi | Bot chưa chạy / tunnel tắt / sai URL / Verify Token không trùng | Mở `PUBLIC_BASE_URL/health` phải thấy `ok`. URL phải kết thúc bằng `/webhooks/messenger`. So lại `FB_VERIFY_TOKEN`. |
| Xác minh được nhưng bot không nhận tin | Chưa "Thêm gói đăng ký" cho Page, hoặc người nhắn không có vai trò trong app (Development) | Tích `messages`, `messaging_postbacks`… ở dòng Page. Thêm người đó làm Tester. |
| Log báo chữ ký sai, webhook trả 403 | `FB_APP_SECRET` sai (lấy nhầm app), hoặc proxy sửa body | Lấy lại App Secret đúng app. Không bật nén/sửa body ở proxy. |
| `Graph API: credential (190)` | Page token hết hạn hoặc bị thu hồi (đổi mật khẩu FB, gỡ quyền) | Tạo lại token ở bước 2.5, cập nhật `.env`, khởi động lại. |
| `Graph API: window` / "Hết cửa sổ Messenger 24h" | Bot gửi khi khách đã im quá 24 giờ | Bình thường, đúng chính sách. Lời nhắc được lưu thành "nhắc bị lỡ". Bật opt-in hoặc liên kết Telegram. |
| `Graph API: blocked (551)` | Người dùng chặn Page / không nhận tin | Không gửi tiếp. Admin được báo. |
| `Graph API: rate` | Gửi quá nhanh | Bot tự thử lại có backoff. Nếu kéo dài, giảm `USER_MESSAGES_PER_MINUTE`. |
| Bot chạy nhưng thoát ngay, báo "Cấu hình .env chưa hợp lệ" | Thiếu/sai biến | Đọc danh sách lỗi in ra, sửa đúng tên biến đó. |
| Menu không hiện | Chưa chạy `npm run messenger:setup` hoặc cache Messenger | Chạy lại lệnh, đợi vài phút, xoá hội thoại rồi mở lại. |
| Dashboard báo 401 liên tục | Chưa đặt `DASHBOARD_PASSWORD`, hoặc đổi mật khẩu (phiên cũ hết hiệu lực) | Đặt mật khẩu ≥ 12 ký tự, đăng nhập lại. |
| Docker: Caddy không cấp được HTTPS | DNS chưa trỏ đúng, cổng 80/443 bị chặn | `dig bot.example.com`, mở firewall, xem `docker compose logs caddy`. |
| Lỗi `ExperimentalWarning: SQLite` | Node 22 báo SQLite là thử nghiệm | Chỉ là cảnh báo, không ảnh hưởng. |
