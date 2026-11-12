using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Threading;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program {
    [STAThread]
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e) { MessageBox.Show(e.Exception.Message, "听写本", MessageBoxButtons.OK, MessageBoxIcon.Error); };
        string dataPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--data-dir") dataPath = args[i + 1];
        string key;
        using (var hash = SHA256.Create()) key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(dataPath).ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
        using (var mutex = new Mutex(false, "Local\\ListenWrite_" + key)) {
            bool held;
            try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
            if (!held) { MessageBox.Show("听写本已经打开，请使用已打开的窗口。", "听写本", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            try { Application.Run(new MainWindow(args)); } finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed class MainWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 134217728, RecursionLimit = 200 };
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string dataDir;
    readonly string testScript;
    readonly string testReport;
    readonly bool offlineTest;
    readonly string screenshotDir;
    readonly string testFilesDir;
    string audioRoot;
    bool allowClose;
    bool ready;
    bool closing;

    public MainWindow(string[] args) {
        dataDir = GetArgument(args, "--data-dir") ?? Path.Combine(root, "data");
        testScript = GetArgument(args, "--test-script");
        testReport = GetArgument(args, "--test-report");
        offlineTest = Array.IndexOf(args, "--offline-test") >= 0;
        screenshotDir = GetArgument(args, "--screenshots");
        testFilesDir = GetArgument(args, "--test-files");
        Directory.CreateDirectory(dataDir);
        Text = "听写本 · 听写与错词背诵";
        AutoScaleMode = AutoScaleMode.None;
        var area = Screen.PrimaryScreen.WorkingArea;
        float scale;
        using (var graphics = CreateGraphics()) scale = graphics.DpiX / 96f;
        Size = new Size(Math.Min((int)(1360 * scale), area.Width - 48), Math.Min((int)(900 * scale), area.Height - 48));
        MinimumSize = new Size(Math.Min((int)(1000 * scale), area.Width - 48), Math.Min((int)(650 * scale), area.Height - 48));
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(247, 248, 250);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
        Shown += async delegate { await Initialize(); };
        FormClosing += async delegate(object sender, FormClosingEventArgs e) {
            if (allowClose || !ready) return;
            e.Cancel = true;
            if (closing) return;
            closing = true;
            try { await view.CoreWebView2.ExecuteScriptAsync("window.requestClose && window.requestClose()"); }
            catch { allowClose = true; Close(); }
        };
    }

    static string GetArgument(string[] args, string flag) {
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == flag) return args[i + 1];
        return null;
    }

    async Task Initialize() {
        try {
            var settingsPath = Path.Combine(dataDir, "settings.json");
            var defaultSettings = ReadObject(Path.Combine(root, "config.json"));
            var settings = File.Exists(settingsPath) ? ReadObject(settingsPath) : defaultSettings;
            audioRoot = settings.ContainsKey("audioRoot") ? Convert.ToString(settings["audioRoot"]) : "";
            if (!String.IsNullOrWhiteSpace(audioRoot) && !Path.IsPathRooted(audioRoot)) audioRoot = Path.GetFullPath(Path.Combine(root, audioRoot));
            var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-background-networking");
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "browser"), options);
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = testScript != null;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.IsZoomControlEnabled = true;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("corpus-app.test", Path.Combine(root, "app"), CoreWebView2HostResourceAccessKind.Deny);
            view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            view.CoreWebView2.WebResourceRequested += ResourceRequested;
            view.CoreWebView2.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.Host != "corpus-app.test") e.Cancel = true;
            };
            view.CoreWebView2.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            view.CoreWebView2.WebMessageReceived += MessageReceived;
            if (offlineTest) {
                await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
                await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.emulateNetworkConditions", "{\"offline\":true,\"latency\":0,\"downloadThroughput\":0,\"uploadThroughput\":0}");
            }
            view.CoreWebView2.Navigate("https://corpus-app.test/index.html");
        } catch (Exception e) {
            File.WriteAllText(Path.Combine(dataDir, "startup-error.txt"), e.ToString(), Encoding.UTF8);
            MessageBox.Show("启动失败：" + e.Message + "\n\n错误详情已保存在 data\\startup-error.txt。", "听写本", MessageBoxButtons.OK, MessageBoxIcon.Error);
            allowClose = true;
            Close();
        }
    }

    void ResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
        Uri uri;
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri)) return;
        if (uri.Host == "corpus-app.test") return;
        if (uri.Host != "corpus-audio.test") {
            e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 403, "Offline only", "Content-Type: text/plain\r\n");
            return;
        }
        try {
            var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var audioBase = Path.GetFullPath(audioRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var path = Path.GetFullPath(Path.Combine(audioBase, relative));
            if (!path.StartsWith(audioBase, StringComparison.OrdinalIgnoreCase) || !path.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) throw new FileNotFoundException();
            var length = new FileInfo(path).Length;
            long start = 0, end = length - 1;
            bool partial = false;
            if (e.Request.Headers.Contains("Range")) {
                var range = e.Request.Headers.GetHeader("Range");
                if (range.StartsWith("bytes=")) {
                    var pieces = range.Substring(6).Split('-');
                    if (pieces[0].Length == 0) { long suffix; if (long.TryParse(pieces[1], out suffix)) start = Math.Max(0, length - suffix); }
                    else long.TryParse(pieces[0], out start);
                    if (pieces.Length > 1 && pieces[0].Length > 0 && pieces[1].Length > 0) long.TryParse(pieces[1], out end);
                    end = Math.Min(length - 1, end);
                    partial = true;
                }
            }
            if (start < 0 || start >= length || end < start) {
                e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 416, "Range Not Satisfiable", "Content-Range: bytes */" + length + "\r\n");
                return;
            }
            var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            stream.Position = start;
            var headers = "Content-Type: audio/mpeg\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: https://corpus-app.test\r\nContent-Length: " + (end - start + 1) + "\r\n";
            if (partial) headers += "Content-Range: bytes " + start + "-" + end + "/" + length + "\r\n";
            e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new LimitedStream(stream, end - start + 1), partial ? 206 : 200, partial ? "Partial Content" : "OK", headers);
        } catch {
            e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Audio not found", "Content-Type: text/plain\r\n");
        }
    }

    Dictionary<string, object> ReadObject(string path) {
        return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
    }

    void AtomicWrite(string path, string text) {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, text, new UTF8Encoding(false));
        if (File.Exists(path)) File.Replace(temporary, path, path + ".bak");
        else File.Move(temporary, path);
    }

    async void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        string id = "";
        try {
            if (!e.Source.StartsWith("https://corpus-app.test/", StringComparison.Ordinal)) return;
            var request = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            id = Convert.ToString(request["id"]);
            string method = Convert.ToString(request["method"]);
            var args = request.ContainsKey("args") && request["args"] != null ? (Dictionary<string, object>)request["args"] : new Dictionary<string, object>();
            object result = null;
            if (method == "init") {
                object state = null;
                string recovered = null;
                string path = Path.Combine(dataDir, "learning.json");
                if (File.Exists(path)) {
                    try { state = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)); }
                    catch {
                        if (File.Exists(path + ".bak")) { state = json.DeserializeObject(File.ReadAllText(path + ".bak", Encoding.UTF8)); recovered = "上次记录文件无法读取，已恢复上一份自动备份。"; }
                        else throw new InvalidDataException("学习记录无法读取，请先备份 data 文件夹，再联系修复。原文件已保留。");
                    }
                }
                result = new { state = state, audioRoot = audioRoot, audioReady = Directory.Exists(audioRoot), version = "1.0.0", dataDir = dataDir, recovered = recovered };
            } else if (method == "save") {
                string text = Convert.ToString(args["state"]);
                var state = json.Deserialize<Dictionary<string, object>>(text);
                if (!state.ContainsKey("schema") || !state.ContainsKey("batches") || Convert.ToInt32(state["schema"]) != 1) throw new InvalidDataException("学习记录格式不正确，已保留原文件。");
                AtomicWrite(Path.Combine(dataDir, "learning.json"), text);
                result = true;
            } else if (method == "pickAudio") {
                using (var dialog = new FolderBrowserDialog()) {
                    dialog.Description = "请选择包含 Chapter 3、Chapter 4 等子文件夹的“音频”目录";
                    if (Directory.Exists(audioRoot)) dialog.SelectedPath = audioRoot;
                    if (dialog.ShowDialog(this) == DialogResult.OK) {
                        audioRoot = dialog.SelectedPath;
                        AtomicWrite(Path.Combine(dataDir, "settings.json"), json.Serialize(new { audioRoot = audioRoot }));
                        result = new { path = audioRoot, ready = true };
                    }
                }
            } else if (method == "export") {
                if (testScript != null && testFilesDir != null) {
                    Directory.CreateDirectory(testFilesDir);
                    var path = Path.Combine(testFilesDir, "backup.json");
                    File.WriteAllText(path, Convert.ToString(args["state"]), new UTF8Encoding(false));
                    result = path;
                } else
                using (var dialog = new SaveFileDialog()) {
                    dialog.Title = "导出学习记录备份";
                    dialog.Filter = "听写本备份 (*.json)|*.json";
                    dialog.FileName = "听写本备份_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".json";
                    if (dialog.ShowDialog(this) == DialogResult.OK) {
                        File.WriteAllText(dialog.FileName, Convert.ToString(args["state"]), new UTF8Encoding(false));
                        result = dialog.FileName;
                    }
                }
            } else if (method == "import") {
                if (testScript != null && testFilesDir != null) {
                    result = json.DeserializeObject(File.ReadAllText(Path.Combine(testFilesDir, "backup.json"), Encoding.UTF8));
                } else
                using (var dialog = new OpenFileDialog()) {
                    dialog.Title = "读取听写本备份";
                    dialog.Filter = "听写本备份 (*.json)|*.json";
                    if (dialog.ShowDialog(this) == DialogResult.OK) result = json.DeserializeObject(File.ReadAllText(dialog.FileName, Encoding.UTF8));
                }
            } else if (method == "openData") {
                System.Diagnostics.Process.Start("explorer.exe", "\"" + dataDir + "\"");
                result = true;
            } else if (method == "ready") {
                ready = true;
                result = true;
                if (testScript != null) {
                    await Task.Delay(200);
                    await view.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(testScript, Encoding.UTF8));
                }
            } else if (method == "testReport" && testReport != null) {
                File.WriteAllText(testReport, json.Serialize(args), new UTF8Encoding(false));
                allowClose = true;
                BeginInvoke(new Action(Close));
                result = true;
            } else if (method == "screenshot" && testScript != null && screenshotDir != null) {
                Directory.CreateDirectory(screenshotDir);
                string name = Path.GetFileName(Convert.ToString(args["name"]));
                if (!name.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Expected PNG");
                using (var stream = File.Create(Path.Combine(screenshotDir, name))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                result = name;
            } else if (method == "close") {
                allowClose = true;
                BeginInvoke(new Action(Close));
                result = true;
            } else if (method == "cancelClose") {
                closing = false;
                result = true;
            } else throw new InvalidOperationException("未知操作：" + method);
            view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { id = id, result = result }));
        } catch (Exception error) {
            if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { id = id, error = error.Message }));
        }
    }
}

internal sealed class LimitedStream : Stream {
    readonly Stream inner;
    readonly long length;
    readonly long origin;
    long position;
    public LimitedStream(Stream stream, long count) { inner = stream; length = count; origin = stream.Position; }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }
    public override long Position { get { return position; } set { Seek(value, SeekOrigin.Begin); } }
    public override int Read(byte[] buffer, int offset, int count) { int read = inner.Read(buffer, offset, (int)Math.Min(count, length - position)); position += read; return read; }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin mode) {
        long target = mode == SeekOrigin.Begin ? offset : mode == SeekOrigin.Current ? position + offset : length + offset;
        if (target < 0 || target > length) throw new IOException("Invalid media stream position");
        inner.Position = origin + target; position = target; return position;
    }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
}
