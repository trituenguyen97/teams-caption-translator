# launch-chrome-fakemic.ps1 - Mo Chrome (da nap extension) va BOM 1 file WAV thang vao micro.
# Co test cua Chromium:
#   --use-fake-device-for-media-stream      -> getUserMedia tra "thiet bi gia", KHONG hoi quyen.
#   --use-file-for-fake-audio-capture=FILE  -> thay tieng micro gia bang noi dung file WAV.
# Mac dinh phat 1 lan (%noloop). Them -Loop de lap vo han.
#
# Vi du:
#   .\launch-chrome-fakemic.ps1
#   .\launch-chrome-fakemic.ps1 -Wav .\sample-en.wav
#   .\launch-chrome-fakemic.ps1 -Wav .\sample-ja.wav -Loop
param(
  [string]$Wav = "$PSScriptRoot\sample-ja.wav",
  [switch]$Loop
)

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { Write-Error "Khong thay Chrome o: $chrome - sua bien chrome trong script."; return }
if (-not [System.IO.Path]::IsPathRooted($Wav)) { $Wav = Join-Path $PSScriptRoot $Wav }
if (-not (Test-Path $Wav)) { Write-Error "Khong thay file WAV: $Wav (chay make-voice.ps1 truoc)."; return }

$extDir  = Join-Path (Split-Path $PSScriptRoot -Parent) "extension"
$profile = Join-Path $env:TEMP "chrome-fakemic-profile"

if ($Loop) { $fileArg = $Wav } else { $fileArg = "$Wav%noloop" }

$chromeArgs = @(
  "--use-fake-device-for-media-stream",
  "--use-file-for-fake-audio-capture=$fileArg",
  "--load-extension=$extDir",
  "--user-data-dir=$profile",
  "--no-first-run",
  "--no-default-browser-check"
)

Write-Host "Chrome + fake mic"
if ($Loop) { Write-Host ("  WAV     : {0} (loop)" -f $Wav) } else { Write-Host ("  WAV     : {0} (play once)" -f $Wav) }
Write-Host ("  Ext     : {0}" -f $extDir)
Write-Host ("  Profile : {0}  (nhap API key 1 lan, lan sau giu nguyen)" -f $profile)
& $chrome @chromeArgs
