using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
internal static class Launcher {
    [STAThread] private static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        if (args.Length == 1 && args[0] == "--check")
            return File.Exists(Path.Combine(root, "launch.ps1")) && File.Exists(Path.Combine(root, "runtime.json")) ? 0 : 1;
        try {
            var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell/v1.0/powershell.exe"));
            start.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "launch.ps1") + "\"";
            if (Array.IndexOf(args, "--headless") >= 0) start.Arguments += " -Headless";
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception error) { MessageBox.Show(error.Message, "code-recorder"); return 1; }
    }
}
