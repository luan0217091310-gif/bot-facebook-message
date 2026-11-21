# Chạy bot Messenger trên máy Windows với Cloudflare quick tunnel.
# Tự động: mở tunnel -> lấy URL mới -> ghi PUBLIC_BASE_URL vào .env -> chạy bot -> báo Callback URL mới cho Meta.
# Dùng: bấm đúp chay-bot.bat (hoặc: powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $env:TEMP 'bekane'; New-Item -ItemType Directory -Force $logDir | Out-Null
$envPath = Join-Path $root '.env'
function Get-EnvValue($name) { $m = Select-String -Path $envPath -Pattern "^$name=(.*)$"; if ($m) { $m.Matches[0].Groups[1].Value.Trim() } else { '' } }
$port = Get-EnvValue 'PORT'; if (-not $port) { $port = '3000' }

# 0. Chờ có mạng (khi vừa mở máy hoặc mất Wi-Fi): thử lại mỗi 10 giây, không báo lỗi.
$log0 = Join-Path $logDir 'start.log'
function Test-Online { try { (Invoke-WebRequest -UseBasicParsing 'https://graph.facebook.com/' -TimeoutSec 5 -Method Head) | Out-Null; $true } catch { [bool]$_.Exception.Response } }
while (-not (Test-Online)) { Add-Content $log0 "$(Get-Date -Format s) chua co mang, cho 10s"; Start-Sleep 10 }
Add-Content $log0 "$(Get-Date -Format s) da co mang, khoi dong bot"

# 1. Dừng bản cũ (nếu còn) để tránh trùng cổng.
$old = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($old) { Stop-Process -Id $old -Force; Start-Sleep 2 }
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Mở tunnel và đợi URL.
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { $cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
$cfLog = Join-Path $logDir 'tunnel.log'; Remove-Item $cfLog -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath $cf -ArgumentList "tunnel --no-autoupdate --url http://localhost:$port" -RedirectStandardError $cfLog
$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep 1
  if (Test-Path $cfLog) { $m = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
}
if (-not $url) { Add-Content $log0 "$(Get-Date -Format s) mo tunnel that bai, thu lai sau 30s"; Start-Sleep 30; & $PSCommandPath; exit }

# 3. Ghi URL mới vào .env (giữ UTF-8 không BOM).
$text = [IO.File]::ReadAllText($envPath)
$text = [regex]::Replace($text, '(?m)^PUBLIC_BASE_URL=.*$', "PUBLIC_BASE_URL=$url")
[IO.File]::WriteAllText($envPath, $text, (New-Object Text.UTF8Encoding $false))

# 4. Chạy bot.
$botLog = Join-Path $logDir 'bot.log'
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList "/c npx tsx src/index.ts > `"$botLog`" 2>&1" -WorkingDirectory $root
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep 1; try { $ok = (Invoke-WebRequest -UseBasicParsing "http://localhost:$port/health" -TimeoutSec 3).StatusCode -eq 200 } catch {} }
if (-not $ok) { Get-Content $botLog -Tail 20; throw 'Bot không khởi động được, xem lỗi ở trên.' }
# Đợi DNS của tunnel sẵn sàng trước khi báo Meta (Meta sẽ gọi thử URL ngay).
for ($i = 0; $i -lt 30; $i++) { try { if ((Invoke-WebRequest -UseBasicParsing "$url/health" -TimeoutSec 5).StatusCode -eq 200) { break } } catch { Start-Sleep 2 } }

# 5. Báo Callback URL mới cho Meta và đăng ký lại Page.
& npx tsx scripts/update-webhook.ts 2>&1 | Tee-Object -Append -FilePath $log0
Write-Host ''
Write-Host "✅ Bot đang chạy: $url" -ForegroundColor Green
Write-Host "   Dashboard: http://localhost:$port/dashboard"
Write-Host "   Log: $botLog"
