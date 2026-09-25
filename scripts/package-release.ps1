param(
    [string]$OutputDir = "release",
    [string]$Name = "4d-print-server"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingRoot = Join-Path $repoRoot $OutputDir
$packageName = "$Name-$timestamp"
$stagingDir = Join-Path $stagingRoot $packageName
$zipPath = Join-Path $stagingRoot "$packageName.zip"

$excludeDirs = @(
    ".git",
    ".codegraph",
    ".codegraph.bak-20260605-003459",
    ".history",
    ".pytest_cache",
    ".playwright-mcp",
    ".omo",
    ".cursor",
    ".sisyphus",
    "node_modules",
    "frontend/node_modules",
    "frontend/dist",
    "backend/.pytest_cache",
    "backend/__pycache__",
    "backend/venv",
    "backend/.venv",
    "backend/uploads",
    "downloads",
    "uploads",
    "next-app/node_modules",
    "release",
    "%TEMP%",
    "-p"
)

$excludeFiles = @(
    ".env",
    ".env.*",
    "backend/.env",
    "frontend/.env",
    "frontend/.env.production",
    "backend/*.db",
    "backend/*.db*",
    "backend/*.db-*",
    "*.db",
    "*.db*",
    "*.db-*",
    "*.log",
    "*.pyc",
    "*.pyo",
    "backend/test.jpg",
    "backend/test_thumbnail.png",
    "nul"
)

function Convert-ToRelativePath([string]$Path) {
    $rootPath = $repoRoot.ProviderPath
    if (-not $rootPath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $rootPath += [System.IO.Path]::DirectorySeparatorChar
    }
    $rootUri = New-Object System.Uri($rootPath)
    $pathUri = New-Object System.Uri($Path)
    $relative = $rootUri.MakeRelativeUri($pathUri).ToString()
    return [System.Uri]::UnescapeDataString($relative).Replace("\", "/")
}

function Test-ExcludedDir([string]$Path) {
    $relative = Convert-ToRelativePath $Path
    foreach ($pattern in $excludeDirs) {
        if ($relative -eq $pattern -or $relative.StartsWith("$pattern/")) {
            return $true
        }
    }
    return $false
}

function Test-ExcludedFile([string]$Path) {
    $relative = Convert-ToRelativePath $Path
    if ([System.IO.Path]::GetFileName($relative) -eq "nul") {
        return $true
    }
    foreach ($pattern in $excludeFiles) {
        if ($relative -like $pattern) {
            return $true
        }
    }
    return $false
}

if (Test-Path $stagingRoot) {
    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
} else {
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
}

if (Test-Path $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir | Out-Null

Get-ChildItem -LiteralPath $repoRoot -Force | ForEach-Object {
    if ($_.PSIsContainer) {
        if (-not (Test-ExcludedDir $_.FullName)) {
            $relative = Convert-ToRelativePath $_.FullName
            $destination = Join-Path $stagingDir $relative
            New-Item -ItemType Directory -Force -Path $destination | Out-Null
        }
    }
}

Get-ChildItem -LiteralPath $repoRoot -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-ExcludedDir $_.DirectoryName) {
        return
    }
    if (Test-ExcludedFile $_.FullName) {
        return
    }
    $relative = Convert-ToRelativePath $_.FullName
    $destination = Join-Path $stagingDir $relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}

if (-not (Test-Path (Join-Path $stagingDir "scripts/deploy-server.sh"))) {
    throw "Missing scripts/deploy-server.sh in package."
}
if (-not (Test-Path (Join-Path $stagingDir "backend/resources/viewer-environments/default.hdr"))) {
    throw "Missing backend/resources/viewer-environments/default.hdr in package."
}
if (-not (Test-Path (Join-Path $stagingDir "backend/configs/prusa_i3_mk3.ini"))) {
    throw "Missing backend/configs/*.ini in package."
}
if (-not (Test-Path (Join-Path $stagingDir "frontend/package-lock.json"))) {
    throw "Missing frontend/package-lock.json in package."
}

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Package created: $zipPath"
Write-Host "Upload and run on Linux server:"
Write-Host "  unzip $([System.IO.Path]::GetFileName($zipPath)) -d 4d-print-release"
Write-Host "  cd 4d-print-release"
Write-Host "  sudo bash scripts/deploy-server.sh --domain your-domain.example"
