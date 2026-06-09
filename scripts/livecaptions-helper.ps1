# livecaptions-helper.ps1 — Dùng Windows Live Captions làm STT, CHẠY ẨN.
# Launch LC ẩn (off-screen + bỏ taskbar) → ép ngôn ngữ theo env LC_LANG → đọc CaptionsTextBlock liên tục,
# emit NDJSON {"t":"cap","text":"<toàn bộ text rolling>"} mỗi khi đổi. Node (win-livecaptions.js) diff ra câu chốt.
#
# env: LC_LANG = locale (en-US/ja-JP/ko-KR/zh-CN). LC_POLLMS = nhịp đọc (mặc định 250).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# QUAN TRỌNG: stdout của powershell.exe mặc định = OEM codepage (vd IBM437) → tiếng Nhật/CJK ra stdout thành '?'.
# Ép UTF-8 để caption CJK emit đúng (Node đọc stdout utf8). Đây là lý do trước đây chỉ nhận được SỐ.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Emit($o){ [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$SUPPORTED = @('en-US','ja-JP','ko-KR','zh-CN')
$locale = $env:LC_LANG; if (-not $locale) { $locale = 'en-US' }
if ($SUPPORTED -notcontains $locale) { Emit @{ t='err'; m="unsupported locale: $locale" }; exit 1 }
$REG = 'HKCU:\Software\Microsoft\LiveCaptions\UI'
$pollMs = [int]($env:LC_POLLMS); if ($pollMs -le 0) { $pollMs = 250 }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type @"
using System;using System.Runtime.InteropServices;
public class WApi{
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h,uint k,byte a,uint f);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr GetWindowLongPtrW(IntPtr h,int i);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetWindowLongPtrW(IntPtr h,int i,IntPtr v);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
}
"@
$AE=[System.Windows.Automation.AutomationElement]; $TS=[System.Windows.Automation.TreeScope]; $PC=[System.Windows.Automation.PropertyCondition]
$IP=[System.Windows.Automation.InvokePattern]
$root=$AE::RootElement
$script:pidCond = $null

function MoveOff($h){ if ($h -ne [IntPtr]::Zero) { [WApi]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x15) | Out-Null } }
# Ẩn hoàn toàn: off-screen + bỏ taskbar (TOOLWINDOW) + layered alpha=0 (vô hình kể cả khi LC nháy về góc).
function HideFromTaskbar($h){
  if ($h -eq [IntPtr]::Zero) { return }
  MoveOff $h
  [WApi]::ShowWindow($h, 0) | Out-Null
  $ex = [int64][WApi]::GetWindowLongPtrW($h, -20)
  [WApi]::SetWindowLongPtrW($h, -20, [IntPtr](($ex -bor 0x80 -bor 0x80000) -band (-bnot 0x40000))) | Out-Null
  [WApi]::ShowWindow($h, 8) | Out-Null
  [WApi]::SetLayeredWindowAttributes($h, 0, 0, 2) | Out-Null   # alpha=0 → vô hình
  MoveOff $h
}
function ReHide{
  $w = $root.FindFirst($TS::Children, $script:pidCond); if (-not $w) { return }
  $h = [IntPtr]$w.Current.NativeWindowHandle; if ($h -eq [IntPtr]::Zero) { return }
  $ex = [int64][WApi]::GetWindowLongPtrW($h, -20)
  $need = ($ex -bor 0x80 -bor 0x80000) -band (-bnot 0x40000)
  if ($need -ne $ex) { [WApi]::SetWindowLongPtrW($h, -20, [IntPtr]$need) | Out-Null }
  [WApi]::SetLayeredWindowAttributes($h, 0, 0, 2) | Out-Null
  MoveOff $h
}
# Trả focus về cửa sổ user đang dùng trước khi launch LC.
function RestoreFocus{
  $t = $script:fgBefore; if (-not $t -or $t -eq [IntPtr]::Zero) { return }
  $cur = [WApi]::GetForegroundWindow(); if ($cur -eq $t) { return }
  $tc = 0; [void][WApi]::GetWindowThreadProcessId($cur, [ref]$tc); $tt = 0; [void][WApi]::GetWindowThreadProcessId($t, [ref]$tt)
  [void][WApi]::AttachThreadInput($tc, $tt, $true); [void][WApi]::SetForegroundWindow($t); [void][WApi]::AttachThreadInput($tc, $tt, $false)
}
function Aid($a){ $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition($script:pidCond, (New-Object $PC ([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$a))))) }
function ClickAid($a){ $e=Aid $a; if($e){ ($e.GetCurrentPattern($IP::Pattern)).Invoke(); return $true }; return $false }

function LaunchHidden{
  Stop-Process -Name LiveCaptions -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600
  $script:fgBefore = [WApi]::GetForegroundWindow()   # nhớ cửa sổ user đang dùng → trả focus sau khi set xong
  Start-Process "$env:WINDIR\System32\LiveCaptions.exe"
  $found = $false
  for ($i = 0; $i -lt 80 -and -not $found; $i++) {
    $p = Get-Process LiveCaptions -ErrorAction SilentlyContinue
    if ($p) {
      $script:pidCond = New-Object $PC ([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p[0].Id)
      $w = $root.FindFirst($TS::Children, $script:pidCond)
      if ($w) { $h=[IntPtr]$w.Current.NativeWindowHandle; if ($h -ne [IntPtr]::Zero) { HideFromTaskbar $h; $found=$true } }
    }
    if (-not $found) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $script:pidCond) { throw 'LiveCaptions launch failed' }
  for ($k = 0; $k -lt 12; $k++) { Start-Sleep -Milliseconds 150; ReHide }
}

# Ép ngôn ngữ bằng REGISTRY (LC đọc lúc khởi động) — KHÔNG cần UIA menu nên không nháy menu + không cần focus.
function SetLangReg($loc){
  try { if (-not (Test-Path $REG)) { New-Item -Path $REG -Force | Out-Null } } catch {}
  try { Set-ItemProperty $REG -Name 'CaptionLanguage' -Value $loc -ErrorAction Stop } catch {}
  try { Set-ItemProperty $REG -Name 'HasUserConsented' -Value 1 -Type DWord -ErrorAction Stop } catch {}
}

try {
  SetLangReg $locale   # đặt ngôn ngữ qua registry TRƯỚC khi launch (LC tự dùng) — bỏ hẳn UIA navigation
  LaunchHidden
  RestoreFocus         # đọc caption là passive → trả focus cho user NGAY (không giật focus của bạn)
  if (Aid 'DownloadButton') { Emit @{ t='need-download'; lang=$locale } }   # model chưa tải → app báo tải trước
  Emit @{ t='ready'; lang=$locale }
  $last = ''
  $rehideTick = 0
  while ($true) {
    Start-Sleep -Milliseconds $pollMs
    if (((++$rehideTick) % 4) -eq 0) { ReHide }   # giữ off-screen định kỳ (mỗi ~1s)
    $el = Aid 'CaptionsTextBlock'
    if ($el) {
      $txt = $el.Current.Name
      if ($txt -and $txt -ne $last) { $last = $txt; Emit @{ t='cap'; text=$txt } }
    }
  }
} catch {
  Emit @{ t='err'; m=$_.Exception.Message }
} finally {
  Stop-Process -Name LiveCaptions -Force -ErrorAction SilentlyContinue
}
