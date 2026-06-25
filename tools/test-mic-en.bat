@echo off
REM Bam-dup de test: bom giong ANH (sample-en.wav) vao mic Chrome -> dich sang tieng Viet.
powershell -ExecutionPolicy Bypass -File "%~dp0launch-chrome-fakemic.ps1" -Wav "%~dp0sample-en.wav"
pause
