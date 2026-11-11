# Lộ trình tổng thể — BotHieu (AI Agent cá nhân)

**Spec:** `HUONG-DAN-XAY-BOT.md`

Spec gồm nhiều hệ thống con độc lập, nên được chia thành 5 kế hoạch. Mỗi kế hoạch kết thúc bằng một con bot **chạy được và có test**, không phụ thuộc vào kế hoạch sau.

## Các quyết định cốt tử (Mục 2 của spec) — đã chốt mặc định

| # | Quyết định | Lựa chọn | Lý do |
|---|---|---|---|
| 2.1 | Kênh chat | **Telegram trước**, Zalo là Kế hoạch 5 (tuỳ chọn) | Khuyến nghị vàng của spec; kiến trúc Adapter giúp thêm Zalo sau |
| 2.2 | Model AI | SDK `openai` trỏ vào endpoint **OpenAI-compatible** (`AI_BASE_URL`) | Dùng được OpenAI, Gemini (OpenAI-compat), gateway… chỉ bằng đổi env |
| 2.3 | Server | Dev trên máy cá nhân ở KH1–KH3; VPS Ubuntu 24.04 2vCPU/4GB ở KH4 | Spec 2.3, 5.1 (chỉ chạy MỘT nơi) |
| 2.4 | Docker sandbox | Có, ở KH3 | Spec 2.4, 5.2 |
| 2.5 | Đối tượng | DM luôn nghe; Group chỉ trả lời khi `@tag`/biệt danh | Spec 2.5 |
| — | Ngôn ngữ | TypeScript, Node 22, ESM, test bằng `vitest` | Spec Mục 8–9 |
| — | Web search | Tavily | Spec 5.9 |

> Muốn đổi quyết định nào (ví dụ làm Zalo ngay, hay dùng Python) thì đổi **trước khi** bắt đầu KH1.

## Kế hoạch 1 — Bot Telegram lõi (GĐ 1–3, ~1 tuần) — CHI TIẾT
File: `docs/superpowers/plans/2026-11-11-ke-hoach-1-bot-telegram-loi.md`

Adapter Telegram → Dispatcher (phân quyền, quy tắc group, duyệt "ok", lọc bí mật) → Agent loop có Tool Calling → Tools (`get_current_time`, `web_search`, `remember_fact`, `forget_fact`) → Trí nhớ (history JSONL, facts có metadata/visibility/tombstone). Persona trong `config/persona.prompt.md`.

**Xong khi:** chat với bot trên Telegram, bot tra web, ghi nhớ sự thật, không rò rỉ DM vào group, khách không gọi được tool admin, xoá ghi nhớ phải chờ admin gõ "ok".

## Kế hoạch 2 — Điều phối nâng cao (GĐ 4, ~2 ngày)
- Khử trùng lặp `msgId` (LRU 2000) — spec 3.2.1
- Hàng đợi theo thread (Keyed Queue) — spec 3.2.4
- Phân tầng `fast` / `smart` / `deep` (heuristic + env model cho từng tầng) — spec 2.2, 3.2.5
- Rate limit theo người gửi; lệnh `/stop` với `AbortController` — spec 3.3
- Tự tóm tắt history khi vượt 250k token, tôn trọng tombstones — spec 3.5
- Honesty Guard + Turn Ledger — spec 5.6 (dùng `toolsUsed` mà KH1 đã trả về)

## Kế hoạch 3 — Sandbox & công cụ nâng cao (GĐ 5, ~3 ngày)
- `src/sandbox/docker.ts`: `--read-only --network none --cap-drop ALL --memory=512m --cpus=1 --pids-limit=64`, user không root, không mount `.env`/`.session`/`data/`/`.secrets/` — spec 2.4, 5.2
- Exit code cấu trúc (`exitCode === 0`), không dò chuỗi `exit=0` — spec 5.5
- `WriteLock` với force-release 15s sau khi huỷ + log cảnh báo — spec 5.3
- `src/core/net.ts` `safeFetch`: chống SSRF, timeout, redirect thủ công, cookie theo root domain — spec 5.15
- `watch_url`: hash SHA-256 văn bản sạch, im lặng khi không đổi, cooldown 5 phút — spec 4.1
- Vault AES-256-GCM (`.secrets/vault.key`, `.secrets/vault.enc`, chmod 600), `scripts/credentials.sh`, `site_login` đi theo chuỗi SSO — spec 4.2

## Kế hoạch 4 — Vận hành Production (GĐ 6, ~2 ngày)
- Checklist bảo mật VPS: SSH key-only, UFW, Fail2ban (4 lần/10 phút → khoá 1 giờ), user dịch vụ riêng, quyền file — spec Mục 6
- Node tại `/opt/node22`, systemd `--max-old-space-size=320`, `Restart=always`, `RestartSec=10` — spec 2.3
- `scripts/deploy_vps.sh` dùng `rsync --delete` với `--exclude` **`.env`, `.session`, `data/`, `.secrets/`** — spec 5.13
- `scripts/backup.sh` gồm `data/` và `.secrets/`; dùng `export` cho biến qua pipe — spec 5.13, 5.14
- Kênh báo động khẩn (bot Telegram phụ) khi mất mạng/hết token — spec 5.11
- Scheduler: nhắc việc thường + tác vụ `agentic = true` (vd. 6:00 quét deadline 72h) — spec 4.3

## Kế hoạch 5 (tuỳ chọn) — Adapter Zalo
`zca-js`, đăng nhập QR, auto-reconnect WebSocket, không giả định đọc được lịch sử nhóm (~50 tin) — spec 2.1, 5.1, 5.4. Chỉ thêm `src/adapters/zalo/`, không sửa lõi.
