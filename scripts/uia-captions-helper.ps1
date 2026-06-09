<#
  uia-captions-helper.ps1 — Đọc Live Captions của Microsoft Teams qua UI Automation, xuất NDJSON ra stdout.
  Thay thế đường CDP (puppeteer + cdp-browser.js). KHÔNG cần port debug 9222, KHÔNG cần env var Teams.

  App (src/uia-captions.js) spawn tiến trình này bằng:
     powershell -NoProfile -Sta -EncodedCommand <base64-utf16le của nội dung file này>
  (dùng -EncodedCommand để né execution-policy cho .ps1; đây là chạy command-block, không phải script file)

  Cấu hình qua ENV:
     UIA_POLLMS   nhịp quét ms (mặc định 200)
     UIA_SECONDS  thời lượng chạy; 0 = vô hạn (mặc định 0)

  Mỗi dòng stdout là 1 JSON (NDJSON), CHỈ phát khi có thay đổi:
     {"t":"rows","box":{"x":..,"y":..,"w":..,"h":..},"rows":[{"spk":..,"txt":..,"x":..,"y":..,"w":..,"h":..},...]}
     {"t":"off"}                                          panel captions biến mất (đã tắt caption / rời meeting)
     {"t":"err","m":"<msg>"}                              lỗi không nghiêm trọng
#>
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference  = 'SilentlyContinue'
$VerbosePreference  = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Write-Output ('{"t":"err","m":"load-assembly-failed"}')
  exit 1
}

$AE   = [System.Windows.Automation.AutomationElement]
$TS   = [System.Windows.Automation.TreeScope]
$CT   = [System.Windows.Automation.ControlType]
$root = $AE::RootElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

# user32 để kiểm tra panel caption có bị cửa sổ app khác che không (WindowFromPoint → GA_ROOT → PID).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class W32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr hDC, int x, int y);
}
"@

$PollMs  = if ($env:UIA_POLLMS)  { [int]$env:UIA_POLLMS }  else { 200 }
$RunSecs = if ($env:UIA_SECONDS) { [int]$env:UIA_SECONDS } else { 0 }

$nameCap = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'Live Captions')
$aidDismiss = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'captions-panel-dismiss-button')
$textCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)

# CacheRequest: gom Name + BoundingRectangle của TẤT CẢ Text trong 1 round-trip cross-process
# (thay vì mỗi $e.Current.Name / .BoundingRectangle là 1 lần marshaling → tick nhanh hơn nhiều).
$cacheReq = New-Object System.Windows.Automation.CacheRequest
$cacheReq.Add($AE::NameProperty)
$cacheReq.Add($AE::BoundingRectangleProperty)

# Nút điều khiển panel (dismiss/settings/pop-out) — overlay CHỪA chỗ, không đè lên (#3). Cache 500ms.
$btnAids = @('captions-panel-dismiss-button','captions-settings-menu-trigger-button-non-overflow','closed-captions-pop-out-button')
$script:btnCache = $null; $script:btnAt = (Get-Date).AddSeconds(-10)
function Get-Buttons($container) {
  if ((Get-Date) -lt $script:btnAt.AddMilliseconds(500)) { return $script:btnCache }
  $script:btnAt = Get-Date
  $minX = [int]::MaxValue; $minY = [int]::MaxValue; $maxBottom = 0; $found = $false
  foreach ($aid in $btnAids) {
    $cc = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $aid)
    try {
      $b = $container.FindFirst($TS::Descendants, $cc)
      if ($b) { $r = $b.Current.BoundingRectangle; if (-not [double]::IsInfinity($r.X)) { $found=$true; if($r.X -lt $minX){$minX=[int]$r.X}; if($r.Y -lt $minY){$minY=[int]$r.Y}; if(($r.Y+$r.Height) -gt $maxBottom){$maxBottom=[int]($r.Y+$r.Height)} } }
    } catch {}
  }
  $script:btnCache = if ($found) { @{ x=$minX; y=$minY; bottom=$maxBottom } } else { $null }
  return $script:btnCache
}

# Màu NỀN caption theo theme Teams (#2) — sample pixel ở hàng TÊN (overlay không phủ), lấy mode.
# Debounce: chỉ ĐỔI màu khi giá trị mới lặp lại >=2 lần liên tiếp → hết NHÁY lúc scroll/ẩn-hiện.
$script:bgStable = $null; $script:bgCand = $null; $script:bgCandN = 0; $script:bgAt = (Get-Date).AddSeconds(-10)
function Get-Bg($box, $entries) {
  if ((Get-Date) -lt $script:bgAt.AddMilliseconds(250)) { return $script:bgStable }
  $script:bgAt = Get-Date
  $pts = New-Object System.Collections.ArrayList
  $n = $entries.Count
  if ($n -ge 1) {
    foreach ($f in 0.35, 0.5, 0.65, 0.8) {
      $idx = [int][Math]::Floor($n * $f); if ($idx -ge $n) { $idx = $n - 1 }
      $e = $entries[$idx]
      foreach ($dx in 150, 260) {
        $x = [int]($e.x + $dx)
        if ($box) { $mx = [int]($box.x + $box.w - 12); if ($x -gt $mx) { $x = $mx } }
        [void]$pts.Add(@($x, [int]($e.y - 12)))
      }
    }
  } elseif ($box) { [void]$pts.Add(@([int]($box.x + $box.w - 60), [int]($box.y + 4))) }
  if ($pts.Count -eq 0) { return $script:bgStable }
  $hdc = [W32]::GetDC([IntPtr]::Zero)
  if ($hdc -eq [IntPtr]::Zero) { return $script:bgStable }
  $tally = @{}
  foreach ($p in $pts) { $cr = [W32]::GetPixel($hdc, $p[0], $p[1]); if ($cr -ne [uint32]'0xFFFFFFFF') { if ($tally.ContainsKey($cr)) { $tally[$cr]++ } else { $tally[$cr] = 1 } } }
  [void][W32]::ReleaseDC([IntPtr]::Zero, $hdc)
  if ($tally.Count -eq 0) { return $script:bgStable }
  $mode = ($tally.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
  $r = $mode -band 0xFF; $g = ($mode -shr 8) -band 0xFF; $b = ($mode -shr 16) -band 0xFF
  $hex = '#{0:X2}{1:X2}{2:X2}' -f $r, $g, $b
  if ($hex -eq $script:bgStable) { $script:bgCand = $null; $script:bgCandN = 0 }
  elseif ($hex -eq $script:bgCand) { $script:bgCandN++; if ($script:bgCandN -ge 2) { $script:bgStable = $hex; $script:bgCand = $null; $script:bgCandN = 0 } }
  else { $script:bgCand = $hex; $script:bgCandN = 1; if (-not $script:bgStable) { $script:bgStable = $hex } }
  return $script:bgStable
}

function Emit($obj) {
  $j = ($obj | ConvertTo-Json -Compress -Depth 4)
  [Console]::Out.WriteLine($j)
  [Console]::Out.Flush()
}

# TẤT CẢ cửa sổ top-level của ms-teams (KHÔNG chỉ lớn nhất — panel caption có thể nằm ở cửa sổ
# meeting trong khi cửa sổ share-screen lại lớn hơn; cũng phủ cả trường hợp pop-out captions).
$script:TeamsPids = @()
function Get-TeamsWindows {
  $script:TeamsPids = @(Get-Process -Name ms-teams -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $wins = New-Object System.Collections.ArrayList
  foreach ($p in $script:TeamsPids) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$p)
    try { foreach ($w in $root.FindAll($TS::Children, $c)) { [void]$wins.Add($w) } } catch {}
  }
  return $wins
}

# Panel caption có đang HIỂN THỊ (không bị cửa sổ app KHÁC che) tại tâm panel?
# WindowFromPoint bỏ qua cửa sổ WS_EX_TRANSPARENT (overlay của ta) → an toàn, không tự nhận diện nhầm.
function Test-Visible($box) {
  if (-not $box) { return $true }
  try {
    $p = New-Object W32+POINT
    $p.X = [int]($box.x + $box.w / 2)
    $p.Y = [int]($box.y + $box.h / 2)
    $h = [W32]::WindowFromPoint($p)
    if ($h -eq [IntPtr]::Zero) { return $false }
    $rootHwnd = [W32]::GetAncestor($h, 2)   # GA_ROOT → cửa sổ top-level
    $procId = 0
    [void][W32]::GetWindowThreadProcessId($rootHwnd, [ref]$procId)
    return ($script:TeamsPids -contains [int]$procId)
  } catch { return $true }
}

# Quét panel 'Live Captions' trên mọi cửa sổ: ưu tiên theo Name; fallback nút dismiss (AutomationId ổn định).
function Search-Container($wins) {
  foreach ($w in $wins) {
    try { $c = $w.FindFirst($TS::Descendants, $nameCap); if ($c) { return $c } } catch {}
  }
  foreach ($w in $wins) {
    try {
      $btn = $w.FindFirst($TS::Descendants, $aidDismiss)
      if ($btn) {
        $cur = $btn; $up = 0
        while ($null -ne $cur -and $up -lt 6) {
          $nm = ''; try { $nm = $cur.Current.Name } catch {}
          if ($nm -eq 'Live Captions') { return $cur }
          $cur = $walker.GetParent($cur); $up++
        }
        return $walker.GetParent($walker.GetParent($btn))
      }
    } catch {}
  }
  return $null
}

function Find-Container {
  $wins = Get-TeamsWindows
  if (-not $wins -or $wins.Count -eq 0) { return $null }
  $c = Search-Container $wins
  if ($c) { return $c }
  # cây a11y của Chromium có thể chưa "bật" (cold) → nudge bằng FindAll(Text) rồi thử lại 1 lần
  foreach ($w in $wins) { try { [void]$w.FindAll($TS::Descendants, $textCond) } catch {} }
  Start-Sleep -Milliseconds 700
  return (Search-Container (Get-TeamsWindows))
}

function Read-Entries($container) {
  # Trả về mảng entry @{spk;txt;x;y;w;h}. Text trong panel xếp theo cặp (speaker, caption) theo thứ tự cây.
  $texts = New-Object System.Collections.ArrayList
  try {
    $ctx = $cacheReq.Activate()
    try { $els = $container.FindAll($TS::Descendants, $textCond) } finally { $ctx.Dispose() }
    foreach ($e in $els) {
      $t = ''; try { $t = $e.Cached.Name } catch {}
      if ([string]::IsNullOrWhiteSpace($t)) { continue }
      $t = ($t -replace '\s+', ' ').Trim()
      $rx = 0; $ry = 0; $rw = 0; $rh = 0
      try { $r = $e.Cached.BoundingRectangle; if (-not [double]::IsInfinity($r.X)) { $rx=[int]$r.X; $ry=[int]$r.Y; $rw=[int]$r.Width; $rh=[int]$r.Height } } catch {}
      [void]$texts.Add(@{ txt=$t; x=$rx; y=$ry; w=$rw; h=$rh })
    }
  } catch { return $null }  # null = container stale → caller re-find
  $entries = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $texts.Count; $i += 2) {
    $spk = $texts[$i].txt
    if ($i + 1 -lt $texts.Count) {
      $c = $texts[$i + 1]
      [void]$entries.Add(@{ spk=$spk; txt=$c.txt; x=$c.x; y=$c.y; w=$c.w; h=$c.h })
    } else {
      $c = $texts[$i]
      [void]$entries.Add(@{ spk=''; txt=$spk; x=$c.x; y=$c.y; w=$c.w; h=$c.h })
    }
  }
  return $entries
}

$container = $null
$lastSig = ''
$wasOn = $false
$deadline = if ($RunSecs -gt 0) { (Get-Date).AddSeconds($RunSecs) } else { $null }

while ($true) {
  if ($deadline -and (Get-Date) -ge $deadline) { break }

  # đảm bảo có container; re-find khi mất/stale
  $needFind = $true
  if ($container) {
    try { $null = $container.Current.Name; $needFind = $false } catch { $needFind = $true }
  }
  if ($needFind) {
    $container = Find-Container
    if (-not $container) {
      if ($wasOn -or $lastSig -ne 'OFF') { Emit @{ t='off' }; $wasOn = $false; $lastSig = 'OFF' }
      Start-Sleep -Milliseconds ([Math]::Max($PollMs, 400))
      continue
    }
  }

  # box rect (panel) cho overlay
  $box = $null
  try {
    $r = $container.Current.BoundingRectangle
    if (-not [double]::IsInfinity($r.X)) { $box = @{ x=[int]$r.X; y=[int]$r.Y; w=[int]$r.Width; h=[int]$r.Height } }
  } catch {}

  $entries = Read-Entries $container
  if ($null -eq $entries) { $container = $null; continue }  # stale → re-find vòng sau
  $wasOn = $true

  # panel có bị cửa sổ khác che không (overlay ẩn khi bị che) + vùng nút (chừa chỗ) + màu nền (theme)
  $vis = Test-Visible $box
  $btn = Get-Buttons $container
  $bg  = Get-Bg $box $entries

  # signature gồm toạ độ + vis + btn + bg → đổi gì cũng phát lại (overlay bám đúng + theo theme)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("v:$vis;g:$bg;")
  if ($btn) { [void]$sb.Append("k:$($btn.x),$($btn.y),$($btn.bottom);") }
  if ($box) { [void]$sb.Append("b:$($box.x),$($box.y),$($box.w),$($box.h);") }
  foreach ($e in $entries) { [void]$sb.Append("$($e.spk)|$($e.txt)|$($e.x),$($e.y),$($e.w),$($e.h);") }
  $sig = $sb.ToString()
  if ($sig -ne $lastSig) {
    $lastSig = $sig
    Emit @{ t='rows'; vis=$vis; bg=$bg; btn=$btn; box=$box; rows=@($entries | ForEach-Object { @{ spk=$_.spk; txt=$_.txt; x=$_.x; y=$_.y; w=$_.w; h=$_.h } }) }
  }

  Start-Sleep -Milliseconds $PollMs
}
