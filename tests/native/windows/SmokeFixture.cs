using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// A disposable test window. No network, shell execution, or user documents.
public static class SmokeFixture {
    [StructLayout(LayoutKind.Sequential)] struct UserObjectFlags { public int inherit, reserved; public uint flags; }
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool GetUserObjectInformation(IntPtr handle, int index, ref UserObjectFlags info, int size, out int needed);
    static string statusPath;
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();

    static bool HasInteractiveDesktop() {
        UserObjectFlags flags = new UserObjectFlags();
        int needed;
        return Environment.UserInteractive && GetUserObjectInformation(GetProcessWindowStation(), 1, ref flags, Marshal.SizeOf(typeof(UserObjectFlags)), out needed) && (flags.flags & 1) != 0;
    }
    static void Save(object state) {
        string temporary = statusPath + ".next";
        File.WriteAllText(temporary, json.Serialize(state));
        if (File.Exists(statusPath)) File.Replace(temporary, statusPath, null);
        else File.Move(temporary, statusPath);
    }

    [STAThread]
    public static int Main(string[] args) {
        if (args.Length != 3) return 64;
        statusPath = args[0];
        string stopPath = args[1];
        int parentId = Int32.Parse(args[2]);
        int processId = Process.GetCurrentProcess().Id;
        if (!HasInteractiveDesktop()) {
            Save(new { status="blocked", reason="The process has no visible interactive Windows desktop.", pid=processId });
            return 2;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var form = new Form()) {
            form.Text = "Otto Windows Native Smoke Fixture";
            form.ClientSize = new Size(520, 210);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.MaximizeBox = false;
            var input = new TextBox { Name="OttoFixtureInput", AccessibleName="Fixture text input", Text="Initial fixture text", Location=new Point(24,32), Size=new Size(465,25) };
            var apply = new Button { Name="OttoFixtureApply", AccessibleName="Apply fixture text", Text="Apply fixture text", Location=new Point(24,78), Size=new Size(180,35) };
            var status = new Label { Name="OttoFixtureStatus", AccessibleName="No action applied", Text="No action applied", AutoSize=true, Location=new Point(24,138) };
            form.Controls.AddRange(new Control[] { input, apply, status });
            int presses = 0;
            string applied = "";
            bool ready = false;
            Action<bool> record = delegate(bool closed) {
                Save(new { status=closed?"closed":"ready", ready=ready, pid=processId, hwnd=form.Handle.ToInt64().ToString(), text=input.Text, pressCount=presses, applied=applied, label=status.Text });
            };
            input.TextChanged += delegate { if (ready) record(false); };
            apply.Click += delegate {
                presses++;
                applied = input.Text;
                status.Text = "Applied: " + applied;
                status.AccessibleName = status.Text;
                record(false);
            };
            form.Shown += delegate { ready=true; input.Focus(); record(false); };
            form.FormClosing += delegate { record(true); };
            var started = Stopwatch.StartNew();
            using (var timer = new Timer { Interval=100 }) {
                timer.Tick += delegate {
                    bool parentGone;
                    try { using (var parent=Process.GetProcessById(parentId)) parentGone=parent.HasExited; }
                    catch (ArgumentException) { parentGone=true; }
                    if (File.Exists(stopPath) || parentGone || started.Elapsed > TimeSpan.FromMinutes(2)) form.Close();
                };
                timer.Start();
                Application.Run(form);
            }
        }
        return 0;
    }
}
