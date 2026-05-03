# Fix CDP cho Teams (UWP) - dùng WebView2 registry policy thay env var

# 1. Set registry policy (hoạt động với UWP app)
$path = 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
Set-ItemProperty -Path $path -Name '*' -Value '--remote-debugging-port=9222' -Type String
Write-Host "[OK] Registry policy da set:"
Get-ItemProperty $path | Format-List

# 2. Giữ nguyên env var (backup)
[System.Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '--remote-debugging-port=9222', 'User')
Write-Host "[OK] Env var: $([System.Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','User'))"

# 3. Restart Teams
Write-Host "[...] Dang restart Teams..."
Stop-Process -Name ms-teams -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
try { Start-Process 'ms-teams:' } catch {
    $exe = "$env:LOCALAPPDATA\Microsoft\WindowsApps\ms-teams.exe"
    if (Test-Path $exe) { Start-Process $exe }
}

# 4. Chờ Teams khởi động và kiểm tra port
Write-Host "[...] Cho Teams khoi dong (30s)..."
$found = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $listen = netstat -ano | Select-String '9222'
    if ($listen) {
        Write-Host "[OK] Port 9222 da mo sau $($i+1)s:"
        $listen
        $found = $true
        break
    }
    if ($i % 5 -eq 4) { Write-Host "  ...$(($i+1))s" }
}
if (-not $found) {
    Write-Host "[FAIL] Sau 30s van khong co port 9222"
    Write-Host "Thu scan port khac cua Teams..."
    $pids = @(Get-Process ms-teams -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    Write-Host "Teams PIDs: $($pids -join ',')"
    netstat -ano | Select-String "LISTEN" | ForEach-Object {
        $cols = $_ -split '\s+'
        if ($cols.Length -ge 5 -and $pids -contains [int]$cols[4]) {
            Write-Host " Port listen: $($cols[2])"
        }
    }
}
