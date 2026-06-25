# make-voice.ps1 - Tao file WAV giong doc (SAPI) de "fake" vao micro Chrome khi test.
# WAV xuat ra: 16-bit PCM, mono, 16 kHz (dung dinh dang Chrome --use-file-for-fake-audio-capture nhan).
# LUU Y: voi tieng Nhat/Viet phai dung -TextFile (file .txt UTF-8) de tranh loi ma hoa cua PowerShell.
#
# Vi du:
#   .\make-voice.ps1 -List
#   .\make-voice.ps1 -TextFile sample-ja.txt -Voice Haruka -Out sample-ja.wav
#   .\make-voice.ps1 -TextFile sample-en.txt -Voice Zira   -Out sample-en.wav
#   .\make-voice.ps1 -Text "Hello world" -Voice Zira -Out hi.wav
param(
  [string]$Text = "",
  [string]$TextFile = "",
  [string]$Voice = "Haruka",
  [string]$Out = "sample.wav",
  [int]$Rate = 16000,
  [switch]$List
)
Add-Type -AssemblyName System.Speech
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer

if ($List) {
  $syn.GetInstalledVoices().VoiceInfo | Select-Object Name, Culture, Gender | Format-Table -AutoSize
  $syn.Dispose(); return
}

if ($TextFile) {
  if (-not [IO.Path]::IsPathRooted($TextFile)) { $TextFile = Join-Path $PSScriptRoot $TextFile }
  if (-not (Test-Path $TextFile)) { Write-Error "Khong thay TextFile: $TextFile"; $syn.Dispose(); return }
  $Text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
}
if (-not $Text) { Write-Error "Thieu -Text hoac -TextFile."; $syn.Dispose(); return }

if ($Voice) {
  $v = $syn.GetInstalledVoices().VoiceInfo | Where-Object { $_.Name -like "*$Voice*" } | Select-Object -First 1
  if ($v) { $syn.SelectVoice($v.Name) } else { Write-Warning "Khong thay giong '$Voice' - dung giong mac dinh." }
}
$used = $syn.Voice.Name

if (-not [IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $PSScriptRoot $Out }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($Rate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$syn.SetOutputToWaveFile($Out, $fmt)
$syn.Speak($Text)
$syn.Dispose()
Write-Host "OK: $Out  (voice: $used, $Rate Hz, 16-bit, mono)"
