# 听写本

离线 Windows 听写、自动批改和错词背诵软件。桌面窗口采用 C# / .NET Framework 和 Microsoft WebView2；界面及练习规则采用 HTML、CSS、JavaScript。

## 功能

- 整节播放原音频，听写速度 1×、1.4×、1.6×。
- 编号列表输入；提交后按词批改，保存正确率及每次听写批次。
- 按章节和批次选择错词；循环播放原 MP3 的对应片段，连续拼写正确 7 次后进入下一词。
- 本地自动保存、继续未完成练习、查看历史记录及导出学习记录备份。
- 背诵时可手工调整原声片段的起止时间。

## 公开内容与本地资源

此仓库公开**程序源码**。原教材、Excel 词库、音频、由它们整理的 `catalog.json` / `alignment.json`、个人学习记录和完整离线安装包**不在仓库或公开 Release 中**。请使用自己有权使用的练习资料；不要把资源和学习记录提交到公共仓库。

当前程序读取以下本地文件：

| 路径 | 用途 |
| --- | --- |
| `app/catalog.json` | 章节、小节、词条、释义和音频相对路径 |
| `app/alignment.json` | 原声片段的起止秒数 |
| `app/variants.json` | 可接受的英美拼写映射 |
| `config.json` | 原音频目录 |
| `audio/` 或自选本地音频目录 | 用户自己的 MP3 文件 |
| `data/` | 本机自动产生的学习记录 |

仓库中的 `.gitignore` 排除了上述本地资源和个人记录。若你已有本项目的完整本地版本，可以运行下面的导入脚本，只将资源导入到本机工作副本：

```powershell
.\scripts\import-local-assets.ps1 -SourceDirectory "D:\path\to\听写本"
```

脚本默认沿用来源文件夹中的音频，不复制 MP3；若需生成便携目录，添加 `-CopyAudio`。它不会复制 `data/`，学习记录由软件在本地新建。导入后请确认 `app/catalog.json` 等三个 JSON 文件和 `config.json` 已生成。

当前公开版本尚无通用的教材/音频自动导入器，因此仅下载源码不能直接开始练习。原声时间索引与具体音频版本绑定；更换音频后需重新核对片段起止时间。

## 构建

环境：Windows x64、.NET Framework 4.6.2 或以上、PowerShell、Microsoft Edge WebView2 Runtime。构建脚本使用 Windows 自带的 .NET Framework C# 编译器；首次构建需要网络连接，以从 NuGet 官方源下载 Microsoft WebView2 开发组件。日常运行无需联网。NuGet 包的 SHA-512 校验值会与官方元数据核对。

```powershell
.\build.ps1
.\听写本.exe
```

构建前先导入本地练习资源；缺少资源时 EXE 可编译，但练习界面无法加载词库。运行时请保留 EXE、`app/`、所需 DLL、`config.json` 和个人资源文件所在目录。第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 核心规则测试

已安装 Node.js 时可以运行独立于教材资源的规则测试：

```powershell
node --test tests/core.test.mjs
```

## 已知范围

这版沿用现有横向听写与综合测试流程，纵向测试、预测试及通用资源导入器尚未加入。原声片段来自特定本地资料的时间索引，未经全部逐项人工听审。程序提供手动调整片段功能。

## 许可证

程序源码按 [MIT](LICENSE) 许可发布。该许可**仅覆盖本仓库中的程序源码**，不授予第三方教材、词库、音频或个人学习数据的再分发权利。
