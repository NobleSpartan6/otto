$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
# System.Speech uses an installed Windows recognizer; there is no cloud fallback.
try {
    Add-Type -AssemblyName System.Speech
    Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Speech.Recognition;
using System.Text;
using System.Threading;
public static class OttoDictation {
    public static void Run() {
        if (SpeechRecognitionEngine.InstalledRecognizers().Count == 0) throw new InvalidOperationException();
        using (var engine = new SpeechRecognitionEngine())
        using (var done = new ManualResetEvent(false)) {
            var transcript = new StringBuilder();
            bool cancelled = false;
            bool failed = false;
            engine.LoadGrammar(new DictationGrammar());
            engine.SetInputToDefaultAudioDevice();
            engine.SpeechRecognized += (sender, args) => {
                lock(transcript) {
                    int length = transcript.Length + (transcript.Length > 0 ? 1 : 0) + args.Result.Text.Length;
                    if (length > 4000) { failed = true; return; }
                    if (transcript.Length > 0) transcript.Append(" ");
                    transcript.Append(args.Result.Text);
                }
            };
            engine.RecognizeCompleted += (sender, args) => {
                lock(transcript) { failed = failed || args.Error != null; }
                try { done.Set(); } catch (ObjectDisposedException) { }
            };
            engine.RecognizeAsync(RecognizeMode.Multiple);
            Console.WriteLine("{\"event\":\"listening\"}");
            Console.Out.Flush();
            var command = System.Threading.Tasks.Task.Run(() => Console.ReadLine());
            int reason = WaitHandle.WaitAny(new WaitHandle[] { ((IAsyncResult)command).AsyncWaitHandle, done }, TimeSpan.FromSeconds(40));
            if (reason == 0) cancelled = command.Result != "stop";
            if (!done.WaitOne(0)) {
                if (cancelled) engine.RecognizeAsyncCancel(); else engine.RecognizeAsyncStop();
                if (!done.WaitOne(TimeSpan.FromSeconds(3))) {
                    engine.RecognizeAsyncCancel();
                    if (!done.WaitOne(TimeSpan.FromSeconds(1))) throw new InvalidOperationException();
                }
            }
            string text;
            lock(transcript) { if (failed && !cancelled) throw new InvalidOperationException(); text = cancelled ? "" : transcript.ToString(); }
            // Emit escaped JSON without evaluating recognized content as script.
            var output = new StringBuilder("{\"event\":\"result\",\"text\":\"");
            foreach(char c in text) { if(c=='"' || c=='\\') output.Append('\\').Append(c); else if(c < 32) output.Append("\\u").Append(((int)c).ToString("x4")); else output.Append(c); }
            Console.WriteLine(output.Append("\"}").ToString());
        }
    }
}
'@
    [OttoDictation]::Run()
} catch {
    Write-Output '{"event":"error","message":"Local dictation is unavailable. Check microphone access and install a Windows speech language in Settings, or type your task."}'
    exit 1
}
