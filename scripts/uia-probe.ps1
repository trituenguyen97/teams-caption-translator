<#
  uia-probe.ps1 — POC: đọc Live Captions của Microsoft Teams qua UI Automation (KHÔNG cần CDP/port 9222).

  Mục đích: kiểm chứng UIA có "nhìn" được vào cây accessibility của Teams (WebView2/Chromium) để
  lấy text caption + tên người nói, làm phương án thay CDP.

  Cách dùng:
    # 1) Dump 1 lần toàn bộ phần tử Text trong cửa sổ Teams (xem UIA có thấy gì không)
    powershell -ExecutionPolicy Bypass -File scripts\uia-probe.ps1

    # 2) Chỉ in các dòng khớp từ khoá (vd tên bạn, hoặc 1 từ trong caption)
    powershell -ExecutionPolicy Bypass -File scripts\uia-probe.ps1 -Filter "caption|live|語|です"

    # 3) Theo dõi LIVE: vào meeting, bật Live Captions, rồi chạy lệnh này ~30s — nó in caption mới khi xuất hiện
    powershell -ExecutionPolicy Bypass -File scripts\uia-probe.ps1 -Watch -Seconds 30

  Lưu ý: Chromium/WebView2 chỉ "bật" cây accessibility khi có client UIA yêu cầu (lazy). Script tự kích hoạt
  bằng cách quét; lần quét đầu có thể trống → đã thêm 1 nhịp chờ + quét lại.
#>
param(
  [string]$Filter = '',
  [switch]$Watch,
  [int]$Seconds = 30,
  [int]$Max = 300,
  [switch]$ShowTree   # in cả cây (ControlType + Name) bounded, để soi cấu trúc
)

$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Write-Host "LỖI nạp UIAutomation assemblies: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$AE   = [System.Windows.Automation.AutomationElement]
$TS   = [System.Windows.Automation.TreeScope]
$CT   = [System.Windows.Automation.ControlType]
$root = $AE::RootElement

function Get-TeamsWindows {
  $procs = Get-Process -Name ms-teams -ErrorAction SilentlyContinue
  if (-not $procs) { return @() }
  $wins = New-Object System.Collections.ArrayList
  foreach ($p in ($procs | Select-Object -ExpandProperty Id)) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$p)
    try {
      $found = $root.FindAll($TS::Children, $cond)
      foreach ($f in $found) {
        # Bỏ cửa sổ rỗng/ẩn nhỏ; ưu tiên cửa sổ có Name
        [void]$wins.Add($f)
      }
    } catch {}
  }
  return $wins
}

function Get-ElText($el) {
  # Lấy text: ưu tiên Name; nếu trống thử ValuePattern; rồi TextPattern.
  $n = ''
  try { $n = $el.Current.Name } catch {}
  if ([string]::IsNullOrWhiteSpace($n)) {
    try {
      $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($vp) { $n = $vp.Current.Value }
    } catch {}
  }
  if ([string]::IsNullOrWhiteSpace($n)) {
    try {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($tp) { $n = $tp.DocumentRange.GetText(2000) }
    } catch {}
  }
  return ($n -as [string])
}

function Dump-TextElements($win, [string]$filter, [int]$max) {
  $textCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)
  $lines = New-Object System.Collections.ArrayList
  try {
    $els = $win.FindAll($TS::Descendants, $textCond)
    foreach ($e in $els) {
      $t = (Get-ElText $e)
      if ([string]::IsNullOrWhiteSpace($t)) { continue }
      $t = ($t -replace '\s+', ' ').Trim()
      if ($filter -ne '' -and ($t -notmatch $filter)) { continue }
      [void]$lines.Add($t)
      if ($lines.Count -ge $max) { break }
    }
  } catch {
    Write-Host "  (lỗi FindAll Text: $($_.Exception.Message))" -ForegroundColor DarkYellow
  }
  return $lines
}

function Walk-Tree($el, [int]$depth, [int]$maxDepth, [ref]$count, [int]$maxCount) {
  if ($count.Value -ge $maxCount -or $depth -gt $maxDepth) { return }
  $name = ''; $ct = ''
  try { $name = $el.Current.Name } catch {}
  try { $ct = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.','' } catch {}
  $name = ($name -replace '\s+',' ').Trim()
  if ($name.Length -gt 80) { $name = $name.Substring(0,80) + '…' }
  Write-Host ("{0}[{1}] {2}" -f ('  ' * $depth), $ct, $name)
  $count.Value++
  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($el)
    while ($child -ne $null -and $count.Value -lt $maxCount) {
      Walk-Tree $child ($depth+1) $maxDepth $count $maxCount
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
}

# ---- main ----
Write-Host "== UIA Teams probe ==" -ForegroundColor Cyan
$wins = Get-TeamsWindows
if (-not $wins -or $wins.Count -eq 0) {
  Write-Host "Không tìm thấy cửa sổ top-level nào của ms-teams. Teams đang chạy & có cửa sổ mở chứ?" -ForegroundColor Red
  exit 2
}
Write-Host ("Thấy {0} cửa sổ top-level của ms-teams:" -f $wins.Count)
$idx = 0
foreach ($w in $wins) {
  $wn = ''; try { $wn = $w.Current.Name } catch {}
  $bb = ''; try { $r = $w.Current.BoundingRectangle; $bb = "{0}x{1}" -f [int]$r.Width, [int]$r.Height } catch {}
  Write-Host ("  [{0}] '{1}' ({2})" -f $idx, $wn, $bb)
  $idx++
}

# Kích hoạt a11y của Chromium: quét lần 1, chờ, quét lại
$main = $wins | Sort-Object { try { -($_.Current.BoundingRectangle.Width * $_.Current.BoundingRectangle.Height) } catch { 0 } } | Select-Object -First 1
Write-Host ""
Write-Host "Đang kích hoạt accessibility tree của WebView2 (quét sơ bộ)…" -ForegroundColor DarkGray
[void](Dump-TextElements $main '' 5)
Start-Sleep -Milliseconds 1500

if ($ShowTree) {
  Write-Host ""
  Write-Host "== Cấu trúc cây (bounded 400 node, sâu 25) ==" -ForegroundColor Cyan
  $cnt = 0
  Walk-Tree $main 0 25 ([ref]$cnt) 400
  Write-Host ("(in $cnt node)") -ForegroundColor DarkGray
}

if ($Watch) {
  Write-Host ""
  Write-Host ("== WATCH {0}s — vào meeting & bật Live Captions; caption mới sẽ in ra ==" -f $Seconds) -ForegroundColor Cyan
  $seen = @{}
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $cur = Get-TeamsWindows
    foreach ($w in $cur) {
      $lines = Dump-TextElements $w $Filter $Max
      foreach ($l in $lines) {
        if (-not $seen.ContainsKey($l)) {
          $seen[$l] = $true
          Write-Host ("  {0:HH:mm:ss}  {1}" -f (Get-Date), $l) -ForegroundColor Green
        }
      }
    }
    Start-Sleep -Milliseconds 700
  }
  Write-Host ("== Hết. Tổng {0} dòng text duy nhất ==" -f $seen.Count) -ForegroundColor Cyan
} else {
  Write-Host ""
  Write-Host "== Các phần tử Text UIA thấy trong cửa sổ Teams (sau khi kích hoạt) ==" -ForegroundColor Cyan
  $all = New-Object System.Collections.Specialized.OrderedDictionary
  foreach ($w in $wins) {
    $lines = Dump-TextElements $w $Filter $Max
    foreach ($l in $lines) { if (-not $all.Contains($l)) { $all[$l] = $true } }
  }
  if ($all.Count -eq 0) {
    Write-Host "  (KHÔNG thấy phần tử Text nào — a11y của Chromium có thể chưa bật, hoặc cửa sổ trống)" -ForegroundColor Yellow
  } else {
    $i = 0
    foreach ($k in $all.Keys) { Write-Host ("  {0,3}. {1}" -f (++$i), $k); if ($i -ge $Max) { break } }
    Write-Host ("  --- tổng {0} dòng text duy nhất ---" -f $all.Count) -ForegroundColor DarkGray
  }
}
