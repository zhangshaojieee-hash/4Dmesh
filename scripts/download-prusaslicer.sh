#!/bin/bash
# PrusaSlicer 自动下载脚本 (Windows)

echo "=== PrusaSlicer 自动下载工具 ==="
echo ""

# 检测系统架构
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
    EXT="zip"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
    EXT="dmg"
else
    PLATFORM="linux"
    EXT="AppImage"
fi

# PrusaSlicer 最新版本信息
VERSION="2.8.1"
BASE_URL="https://github.com/prusa3d/PrusaSlicer/releases/download/version_${VERSION}"

# 根据平台选择下载链接
case $PLATFORM in
    windows)
        FILENAME="PrusaSlicer-${VERSION}+win64-202409181019.zip"
        DOWNLOAD_URL="${BASE_URL}/${FILENAME}"
        ;;
    macos)
        FILENAME="PrusaSlicer-${VERSION}+MacOS-universal-202409181019.dmg"
        DOWNLOAD_URL="${BASE_URL}/${FILENAME}"
        ;;
    linux)
        FILENAME="PrusaSlicer-${VERSION}+linux-x64-GTK3-202409181019.AppImage"
        DOWNLOAD_URL="${BASE_URL}/${FILENAME}"
        ;;
esac

echo "检测到系统: $PLATFORM"
echo "下载版本: $VERSION"
echo "文件名: $FILENAME"
echo ""

# 创建下载目录
DOWNLOAD_DIR="downloads/prusaslicer"
mkdir -p "$DOWNLOAD_DIR"

# 下载文件
echo "开始下载..."
if command -v curl &> /dev/null; then
    curl -L -o "$DOWNLOAD_DIR/$FILENAME" "$DOWNLOAD_URL"
elif command -v wget &> /dev/null; then
    wget -O "$DOWNLOAD_DIR/$FILENAME" "$DOWNLOAD_URL"
else
    echo "错误: 未找到 curl 或 wget 下载工具"
    exit 1
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ 下载完成!"
    echo "文件位置: $DOWNLOAD_DIR/$FILENAME"
    echo ""
    
    case $PLATFORM in
        windows)
            echo "下一步操作:"
            echo "1. 解压 $FILENAME"
            echo "2. 运行 prusa-slicer.exe"
            echo "3. 将安装目录添加到 PATH"
            ;;
        macos)
            echo "下一步操作:"
            echo "1. 打开 $FILENAME"
            echo "2. 拖动 PrusaSlicer 到 Applications"
            echo "3. 运行: echo 'export PATH=\"/Applications/PrusaSlicer.app/Contents/MacOS:\$PATH\"' >> ~/.zshrc"
            ;;
        linux)
            echo "下一步操作:"
            echo "1. chmod +x $DOWNLOAD_DIR/$FILENAME"
            echo "2. sudo mv $DOWNLOAD_DIR/$FILENAME /usr/local/bin/prusa-slicer"
            ;;
    esac
else
    echo "✗ 下载失败"
    exit 1
fi
