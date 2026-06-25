@echo off
REM Bam-dup de test: bom giong NHAT (sample-ja.wav) vao mic Chrome -> dich sang tieng Viet.
powershell -ExecutionPolicy Bypass -File "%~dp0launch-chrome-fakemic.ps1" -Wav "%~dp0sample-ja.wav"
pause
