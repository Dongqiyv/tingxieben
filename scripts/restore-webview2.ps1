$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$files = @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'WebView2-LICENSE.txt')
if (@($files | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) }).Count -eq 0) { return }

$version = '1.0.4314.35'
$base = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg"
$archivePath = Join-Path ([IO.Path]::GetTempPath()) ("tingxieben-webview2-$version-" + [Guid]::NewGuid().ToString('N') + '.nupkg')
try {
    Invoke-WebRequest -Uri $base -OutFile $archivePath
    $registration = Invoke-RestMethod -Uri "https://api.nuget.org/v3/registration5-semver1/microsoft.web.webview2/$version.json"
    if ($registration.packageContent -ne $base) { throw 'WebView2 官方登记地址与下载地址不一致。' }
    $catalogEntry = Invoke-RestMethod -Uri $registration.catalogEntry
    if ($catalogEntry.packageHashAlgorithm -ne 'SHA512') { throw 'WebView2 包缺少 SHA-512 校验信息。' }
    $expected = $catalogEntry.packageHash
    $sha = [Security.Cryptography.SHA512]::Create()
    try { $actual = [Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($archivePath))) }
    finally { $sha.Dispose() }
    if ($actual -ne $expected) { throw 'WebView2 NuGet 包校验失败。' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $paths = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll' = 'WebView2Loader.dll'
        'LICENSE.txt' = 'WebView2-LICENSE.txt'
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        foreach ($relative in $paths.Keys) {
            $entry = $archive.GetEntry($relative)
            if ($null -eq $entry) { throw "NuGet 包缺少 $relative" }
            $target = Join-Path $root $paths[$relative]
            $inputStream = $entry.Open()
            try {
                $outputStream = [IO.File]::Create($target)
                try { $inputStream.CopyTo($outputStream) }
                finally { $outputStream.Dispose() }
            } finally { $inputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally {
    Remove-Item -LiteralPath $archivePath -ErrorAction SilentlyContinue
}
