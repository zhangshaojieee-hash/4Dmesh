@echo off
chcp 65001 >nul
mkdir downloads\prusaslicer 2>nul

echo Downloading PrusaSlicer...
powershell -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+win64-202409181019.zip' -OutFile 'downloads\prusaslicer\PrusaSlicer.zip'"

if exist downloads\prusaslicer\PrusaSlicer.zip (
    echo Download complete!
    echo Extracting...
    powershell -Command "Expand-Archive -Path 'downloads\prusaslicer\PrusaSlicer.zip' -DestinationPath 'downloads\prusaslicer' -Force"
    echo Done! PrusaSlicer is in: downloads\prusaslicer
) else (
    echo Download failed. Please download manually from:
    echo https://github.com/prusa3d/PrusaSlicer/releases/latest
)
pause
