param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [switch]$CopyAudio
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$required = @('catalog.json', 'alignment.json', 'variants.json')
foreach ($file in $required) {
    $origin = Join-Path (Join-Path $source 'app') $file
    if (-not (Test-Path -LiteralPath $origin -PathType Leaf)) { throw "来源文件夹缺少 app\$file" }
}
$sourceAudio = Join-Path $source 'audio'
if (-not (Test-Path -LiteralPath $sourceAudio -PathType Container)) { throw '来源文件夹缺少 audio 文件夹。' }

foreach ($file in $required) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $source 'app') $file) -Destination (Join-Path (Join-Path $root 'app') $file) -Force
}
if ($CopyAudio) {
    $destination = Join-Path $root 'audio'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -LiteralPath $sourceAudio | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
    $audioRoot = 'audio'
} else {
    $audioRoot = $sourceAudio
}
@{ audioRoot = $audioRoot; version = '1.0.0' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding utf8
Write-Output '本地练习资源已导入。个人学习记录不会复制。'
