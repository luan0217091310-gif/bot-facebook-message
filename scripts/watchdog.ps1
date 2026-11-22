# Kiểm tra bot mỗi vài phút: nếu link công khai (tunnel) hoặc bot chết (vd sau khi máy ngủ dậy) thì chạy lại start-local.ps1.
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'
$log = Join-Path $env:TEMP 'bekane\start.log'
$url = (Select-String -Path $envPath -Pattern '^PUBLIC_BASE_URL=(.*)$').Matches[0].Groups[1].Value.Trim()
$port = (Select-String -Path $envPath -Pattern '^PORT=(.*)$').Matches[0].Groups[1].Value.Trim()
function Test-Url($u) { try { (Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 10).StatusCode -eq 200 } catch { $false } }
# Không có mạng thì thôi, lần sau kiểm tra lại.
try { Invoke-WebRequest -UseBasicParsing 'https://graph.facebook.com/' -Method Head -TimeoutSec 5 | Out-Null } catch { if (-not $_.Exception.Response) { exit } }
if ((Test-Url "http://localhost:$port/health") -and (Test-Url "$url/health")) { exit }
Add-Content $log "$(Get-Date -Format s) watchdog: bot/tunnel khong phan hoi, khoi dong lai"
& (Join-Path $PSScriptRoot 'start-local.ps1')
