$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '未找到 .NET Framework C# 编译器。' }

& (Join-Path $root 'scripts\restore-webview2.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'WebView2 开发组件获取失败。' }

$source = Join-Path $root 'src'
$arguments = @(
    '/nologo', '/target:winexe', '/platform:x64', '/codepage:65001', '/utf8output',
    ('/win32manifest:' + (Join-Path $source 'app.manifest')),
    ('/win32icon:' + (Join-Path $source 'app.ico')),
    ('/out:' + (Join-Path $root '听写本.exe')),
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    ('/reference:' + (Join-Path $root 'Microsoft.Web.WebView2.Core.dll')),
    ('/reference:' + (Join-Path $root 'Microsoft.Web.WebView2.WinForms.dll')),
    (Join-Path $source 'Host.cs')
)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw '构建失败。' }
Write-Output '已生成 听写本.exe。请在运行前导入有权使用的本地练习资源。'
