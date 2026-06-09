# lc-download-models.ps1 — Tải model Live Captions của Windows cho các ngôn ngữ app hỗ trợ, CHẠY ẨN.
# Đặt ngôn ngữ qua REGISTRY (HKCU\...\LiveCaptions\UI\CaptionLanguage) → launch LC ẩn → LC hiện màn
# "need download" → click DownloadButton → đọc InstallProgressBar (%). Emit NDJSON tiến trình ra stdout.
# (Không còn UIA Settings→ChangeLanguage→dropdown → bớt nháy + không cần focus để mở menu.)
#
# Input  (env): LC_DL_LANGS = danh sách locale, vd "en-US,ja-JP,ko-KR,zh-CN" (mặc định 4 ngôn ngữ này).
# Output (stdout NDJSON, mỗi dòng 1 JSON):
#   {"t":"plan","total":4,"installed":[...],"pending":[...]}
#   {"t":"progress","overall":62,"done":2,"total":4,"lang":"ko-KR","langPct":48,"status":"downloading"}
#   {"t":"langdone","lang":"ko-KR","done":3,"total":4}
#   {"t":"done","overall":100}
#   {"t":"err","m":"..."}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # tránh stdout OEM codepage làm hỏng CJK

function Emit($obj){ [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

# locale → tên hiển thị trong dropdown LC (chuỗi -like). vi KHÔNG có trong LC.
$NAME = @{
  'en-US' = 'English (United States)';
  'ja-JP' = 'Japanese (Japan)';
  'ko-KR' = 'Korean (Korea)';
  'zh-CN' = 'Chinese (Simplified, Mainland China)';
}

$langsRaw = $env:LC_DL_LANGS; if (-not $langsRaw) { $langsRaw = 'en-US,ja-JP,ko-KR,zh-CN' }
$langs = $langsRaw.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $NAME.ContainsKey($_) }
$total = $langs.Count
if ($total -eq 0) { Emit @{ t='err'; m='no valid LC languages' }; exit 1 }
$REG = 'HKCU:\Software\Microsoft\LiveCaptions\UI'

function PkgInstalled($locale){
  return ((Get-AppxPackage -Name "MicrosoftWindows.Speech.$locale*" -ErrorAction SilentlyContinue | Measure-Object).Count -ge 1)
}

# completed = số ngôn ngữ đã cài xong. overall = (completed*100 + curPct)/total (mỗi ngôn ngữ chiếm 100/total %).
$installed = @(); $pending = @()
foreach ($l in $langs) { if (PkgInstalled $l) { $installed += $l } else { $pending += $l } }
$completed = $installed.Count
function Overall($curPct){ [math]::Round((($completed * 100) + $curPct) / $total) }
Emit @{ t='plan'; total=$total; installed=$installed; pending=$pending }
Emit @{ t='progress'; overall=(Overall 0); done=$completed; total=$total; lang=''; langPct=0; status='start' }
if ($pending.Count -eq 0) { Emit @{ t='done'; overall=100 }; exit 0 }

# ── UIA + ẩn cửa sổ ──
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
$IP=[System.Windows.Automation.InvokePattern]; $RV=[System.Windows.Automation.RangeValuePattern]
$root=$AE::RootElement

# Đẩy cửa sổ off-screen (case B). layered alpha=0 làm flyout 'Change language' KHÔNG dựng → dùng off-screen.
# SWP_NOSIZE(0x1)|NOZORDER(0x4)|NOACTIVATE(0x10) = 0x15.
function MoveOff($h){ if ($h -ne [IntPtr]::Zero) { [WApi]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x15) | Out-Null } }
# Bỏ cửa sổ khỏi TASKBAR: set WS_EX_TOOLWINDOW(0x80) + bỏ WS_EX_APPWINDOW(0x40000). Cần hide→set→show
# (SW_SHOWNA=8, không activate) để shell cập nhật taskbar; off-screen trước nên KHÔNG flash khi show lại.
function HideFromTaskbar($h){
  if ($h -eq [IntPtr]::Zero) { return }
  MoveOff $h
  [WApi]::ShowWindow($h, 0) | Out-Null   # SW_HIDE → gỡ nút taskbar (tree tear down tạm)
  $ex = [int64][WApi]::GetWindowLongPtrW($h, -20)
  [WApi]::SetWindowLongPtrW($h, -20, [IntPtr](($ex -bor 0x80 -bor 0x80000) -band (-bnot 0x40000))) | Out-Null  # +TOOLWINDOW +LAYERED -APPWINDOW
  [WApi]::ShowWindow($h, 8) | Out-Null   # SW_SHOWNA → hiện lại off-screen, không activate, không taskbar
  [WApi]::SetLayeredWindowAttributes($h, 0, 0, 2) | Out-Null   # alpha=0 → vô hình kể cả khi LC nháy về dock
  MoveOff $h
}
function ReHide{
  $win = $root.FindFirst($TS::Children, $script:pidCond); if (-not $win) { return }
  $h = [IntPtr]$win.Current.NativeWindowHandle; if ($h -eq [IntPtr]::Zero) { return }
  $ex = [int64][WApi]::GetWindowLongPtrW($h, -20)
  $need = ($ex -bor 0x80 -bor 0x80000) -band (-bnot 0x40000)
  if ($need -ne $ex) { [WApi]::SetWindowLongPtrW($h, -20, [IntPtr]$need) | Out-Null }
  [WApi]::SetLayeredWindowAttributes($h, 0, 0, 2) | Out-Null
  MoveOff $h
}
# Trả focus về cửa sổ user đang dùng trước khi launch LC (gọi SAU khi đã set xong, trước phần passive).
function RestoreFocus{
  $t = $script:fgBefore; if (-not $t -or $t -eq [IntPtr]::Zero) { return }
  $cur = [WApi]::GetForegroundWindow(); if ($cur -eq $t) { return }
  $tc = 0; [void][WApi]::GetWindowThreadProcessId($cur, [ref]$tc); $tt = 0; [void][WApi]::GetWindowThreadProcessId($t, [ref]$tt)
  [void][WApi]::AttachThreadInput($tc, $tt, $true); [void][WApi]::SetForegroundWindow($t); [void][WApi]::AttachThreadInput($tc, $tt, $false)
}
function LaunchHidden{
  Stop-Process -Name LiveCaptions -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600
  $script:fgBefore = [WApi]::GetForegroundWindow()   # nhớ cửa sổ user đang dùng → trả focus sau khi set xong
  Start-Process "$env:WINDIR\System32\LiveCaptions.exe"
  # Bắt cửa sổ NGAY khi vừa xuất hiện rồi ẩn (off-screen + bỏ taskbar) → flash ~0.1–0.3s thay vì 5s.
  $found = $false
  for ($i = 0; $i -lt 80 -and -not $found; $i++) {
    $p = Get-Process LiveCaptions -ErrorAction SilentlyContinue
    if ($p) {
      $script:pidCond = New-Object $PC ([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p[0].Id)
      $win = $root.FindFirst($TS::Children, $script:pidCond)
      if ($win) { $h = [IntPtr]$win.Current.NativeWindowHandle; if ($h -ne [IntPtr]::Zero) { HideFromTaskbar $h; $found = $true } }
    }
    if (-not $found) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $script:pidCond) { throw 'LiveCaptions launch failed' }
  # Đẩy lại nhiều lần phòng LC tự dời cửa sổ về vị trí dock sau khi khởi tạo xong (tree đã rebuild sau SW_SHOWNA).
  for ($k = 0; $k -lt 12; $k++) { Start-Sleep -Milliseconds 150; ReHide }
}
function Aid($a){ $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition($script:pidCond, (New-Object $PC ([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$a))))) }
function ClickAid($a){ $e=Aid $a; if($e){ ($e.GetCurrentPattern($IP::Pattern)).Invoke(); return $true }; return $false }

# Ép ngôn ngữ bằng REGISTRY (LC đọc lúc khởi động) — bỏ hẳn UIA Settings→ChangeLanguage→dropdown.
function SetLangReg($loc){
  try { if (-not (Test-Path $REG)) { New-Item -Path $REG -Force | Out-Null } } catch {}
  try { Set-ItemProperty $REG -Name 'CaptionLanguage' -Value $loc -ErrorAction Stop } catch {}
  try { Set-ItemProperty $REG -Name 'HasUserConsented' -Value 1 -Type DWord -ErrorAction Stop } catch {}
}

function ProgressPct{
  $pbs=$root.FindAll($TS::Descendants,(New-Object System.Windows.Automation.AndCondition($script:pidCond,(New-Object $PC ([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ProgressBar)))))
  for($m=0;$m -lt $pbs.Count;$m++){ try{ $rv=$pbs.Item($m).GetCurrentPattern($RV::Pattern); return [int]$rv.Current.Value }catch{} }
  return -1   # indeterminate / chưa có
}

try {
  foreach ($locale in $pending) {
    Emit @{ t='progress'; overall=(Overall 0); done=$completed; total=$total; lang=$locale; langPct=0; status='selecting' }
    SetLangReg $locale   # đặt ngôn ngữ qua registry TRƯỚC khi launch
    LaunchHidden
    RestoreFocus   # Continue/Download là nút MAIN-WINDOW → click qua UIA KHÔNG cần focus → trả focus NGAY (no-focus)
    # Model chưa có: LC hiện "Getting ready... [Continue]" → rồi "We'll need to download... [Download]".
    # Click cả 2 mỗi vòng (nút nào hiện thì trúng) tới khi tải bắt đầu (ProgressBar) hoặc model đã cài.
    for ($r = 0; $r -lt 24; $r++) {
      Start-Sleep -Milliseconds 500; ReHide
      if (PkgInstalled $locale) { break }
      if ((ProgressPct) -ge 0) { break }   # đã bắt đầu tải
      ClickAid 'ContinueButton' | Out-Null
      ClickAid 'DownloadButton' | Out-Null
    }
    # poll tới khi package cài xong hoặc timeout
    $deadline = (Get-Date).AddMinutes(8)
    $noProgDeadline = (Get-Date).AddSeconds(45)   # 45s không thấy % nào (offline/policy chặn) → bỏ, KHÔNG treo 8 phút
    $last = -999; $seenProg = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 1200
      ReHide
      if (PkgInstalled $locale) { break }
      $pct = ProgressPct
      if ($pct -ge 0) { $seenProg = $true }
      if (-not $seenProg -and (Get-Date) -gt $noProgDeadline) { Emit @{ t='err'; m="no progress (offline/blocked?): $locale" }; break }
      $p2 = $pct; if ($p2 -lt 0) { $p2 = 0 }
      if ($p2 -ne $last) {
        $last = $p2
        Emit @{ t='progress'; overall=(Overall $p2); done=$completed; total=$total; lang=$locale; langPct=$p2; status='downloading' }
      }
    }
    if (-not (PkgInstalled $locale)) { Emit @{ t='err'; m="timeout/failed: $locale" }; continue }
    $completed++
    Emit @{ t='langdone'; lang=$locale; done=$completed; total=$total }
    Emit @{ t='progress'; overall=(Overall 0); done=$completed; total=$total; lang=$locale; langPct=100; status='installed' }
  }
  Emit @{ t='done'; overall=(Overall 0) }
} catch {
  Emit @{ t='err'; m=$_.Exception.Message }
} finally {
  Stop-Process -Name LiveCaptions -Force -ErrorAction SilentlyContinue
}
