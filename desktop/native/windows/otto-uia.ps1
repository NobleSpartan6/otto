# Native selected-application adapter. Run with Windows PowerShell 5.1:
# powershell.exe -NoLogo -NoProfile -NonInteractive -Mta -ExecutionPolicy Bypass -File otto-uia.ps1
# stdin/stdout carry one JSON request/response per line. Never write diagnostics to stdout.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:AppRecords = @{}
$script:AllowedApps = @{}
$script:Snapshots = @{}
$script:WindowIdentities = @{}
$script:ControlIdentities = @{}
$script:StartupError = $null

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Otto {
  public sealed class WindowInfo {
    public long handle;
    public int pid;
    public string name;
    public string title;
    public bool foreground;
  }
  public static class Native {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; public POINT(int a, int b) { x=a; y=b; } }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mouse;
      [FieldOffset(0)] public KEYBDINPUT key;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    public static int ProcessId(IntPtr hwnd) { uint id; GetWindowThreadProcessId(hwnd, out id); return (int)id; }
    public static string Title(IntPtr hwnd) { var text = new StringBuilder(2048); GetWindowText(hwnd,text,text.Capacity); return text.ToString(); }
    public static WindowInfo[] Windows() {
      var result = new List<WindowInfo>();
      var active = GetForegroundWindow();
      EnumWindows(delegate(IntPtr hwnd, IntPtr param) {
        if (!IsWindowVisible(hwnd)) return true;
        string title = Title(hwnd);
        if (String.IsNullOrWhiteSpace(title)) return true;
        int appPid = ProcessId(hwnd);
        try {
          using (var process = Process.GetProcessById(appPid)) {
            if (appPid == Process.GetCurrentProcess().Id) return true;
            result.Add(new WindowInfo { handle=hwnd.ToInt64(), pid=appPid, name=process.ProcessName, title=title, foreground=hwnd==active });
          }
        } catch (ArgumentException) { } catch (InvalidOperationException) { }
        return true;
      }, IntPtr.Zero);
      return result.ToArray();
    }
    public static void ValidateWindow(IntPtr hwnd, int appPid) {
      if (!IsWindow(hwnd) || ProcessId(hwnd) != appPid) throw new InvalidOperationException("The selected application window is no longer available.");
    }
    public static void Focus(IntPtr hwnd, int appPid) {
      ValidateWindow(hwnd,appPid);
      if (IsIconic(hwnd)) ShowWindow(hwnd,9);
      SetForegroundWindow(hwnd);
      RequireForeground(appPid);
    }
    public static void RequireForeground(int appPid) {
      if (ProcessId(GetForegroundWindow()) != appPid) throw new InvalidOperationException("The selected application is not in the foreground. Focus it and retry.");
    }
    public static void GuardWindowInput(IntPtr hwnd, int appPid) {
      ValidateWindow(hwnd,appPid);
      if (GetAncestor(GetForegroundWindow(),2) != hwnd)
        throw new InvalidOperationException("The exact selected window must be in the foreground before input.");
      foreach (int key in new int[] {16,17,18,91,92}) {
        if ((GetAsyncKeyState(key) & 0x8000) != 0)
          throw new InvalidOperationException("Release modifier keys before allowing native input.");
      }
    }
    public static void PressKey(IntPtr hwnd, int appPid, string name) {
      ushort code;
      switch (name) {
        case "enter": code=13; break;
        case "escape": code=27; break;
        case "tab": code=9; break;
        default: throw new InvalidOperationException("Only Enter, Escape, and Tab are supported.");
      }
      GuardWindowInput(hwnd,appPid);
      var down=new INPUT { type=1 }; down.data.key.vk=code;
      var up=new INPUT { type=1 }; up.data.key.vk=code; up.data.key.flags=2;
      uint sent=SendInput(2,new INPUT[] {down,up},Marshal.SizeOf(typeof(INPUT)));
      if (sent != 2) {
        if (sent == 1) SendInput(1,new INPUT[] {up},Marshal.SizeOf(typeof(INPUT)));
        throw new InvalidOperationException("Windows did not confirm the complete key action. Do not retry automatically.");
      }
    }
    public static void GuardPoint(IntPtr hwnd, int appPid, int x, int y, RECT expected) {
      ValidateWindow(hwnd,appPid);
      RECT current;
      if (!GetWindowRect(hwnd,out current) || current.left != expected.left || current.top != expected.top ||
          current.right != expected.right || current.bottom != expected.bottom)
        throw new InvalidOperationException("The selected window moved or resized after observation.");
      if (x < expected.left || y < expected.top || x >= expected.right || y >= expected.bottom)
        throw new InvalidOperationException("The OCR point is outside the captured window.");
      if (GetAncestor(GetForegroundWindow(),2) != hwnd || GetAncestor(WindowFromPoint(new POINT(x,y)),2) != hwnd)
        throw new InvalidOperationException("The selected window is not foreground or the OCR point is covered.");
      GuardWindowInput(hwnd,appPid);
    }
    public static void ClickPoint(IntPtr hwnd, int appPid, int x, int y, RECT expected) {
      GuardPoint(hwnd,appPid,x,y,expected);
      int desktopX=GetSystemMetrics(76), desktopY=GetSystemMetrics(77);
      int desktopWidth=GetSystemMetrics(78), desktopHeight=GetSystemMetrics(79);
      if (desktopWidth < 2 || desktopHeight < 2 || x < desktopX || y < desktopY ||
          x >= desktopX+desktopWidth || y >= desktopY+desktopHeight)
        throw new InvalidOperationException("The OCR point is not on the current virtual desktop.");
      var move = new INPUT { type=0 };
      move.data.mouse.dx=(int)Math.Round((x-desktopX)*65535.0/(desktopWidth-1));
      move.data.mouse.dy=(int)Math.Round((y-desktopY)*65535.0/(desktopHeight-1));
      move.data.mouse.flags=0xC001;
      GuardPoint(hwnd,appPid,x,y,expected);
      var down = new INPUT { type=0 }; down.data.mouse.flags=2;
      var up = new INPUT { type=0 }; up.data.mouse.flags=4;
      // A single batch keeps pointer movement and the click together.
      var inputs = new INPUT[] {move,down,up};
      uint sent=SendInput(3,inputs,Marshal.SizeOf(typeof(INPUT)));
      if (sent != 3) {
        if (sent == 2) SendInput(1,new INPUT[] {up},Marshal.SizeOf(typeof(INPUT)));
        throw new InvalidOperationException("Windows did not confirm the complete click. Do not retry automatically.");
      }
    }
  }
}
'@

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows UI Automation requires Windows.' }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing
  Add-Type -TypeDefinition $nativeSource
  [void][Otto.Native]::SetProcessDPIAware()
} catch { $script:StartupError = $_.Exception.Message }

function Get-Field($Object, [string]$Name, $Default = $null) {
  if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return ,($Object.$Name) }
  return ,$Default
}

function Limit-Text($Value, [int]$Length = 500) {
  $text = [string]$Value
  if ($text.Length -gt $Length) { return $text.Substring(0, $Length) }
  return $text
}

function Get-Pattern($Element, $Pattern) {
  $result = $null
  if ($Element.TryGetCurrentPattern($Pattern, [ref]$result)) { return $result }
  return $null
}

function Get-WindowScreenshot([IntPtr]$Window, [object[]]$ProtectedBounds = @()) {
  $rect = New-Object Otto.Native+RECT
  if (-not [Otto.Native]::GetWindowRect($Window, [ref]$rect)) { return $null }
  $width = $rect.right - $rect.left
  $height = $rect.bottom - $rect.top
  if ($width -le 0 -or $height -le 0 -or $width -gt 7680 -or $height -gt 4320) { return $null }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $dc = $graphics.GetHdc()
    try { $captured = [Otto.Native]::PrintWindow($Window, $dc, 2) }
    finally { $graphics.ReleaseHdc($dc) }
    if (-not $captured) { return $null }
    $after = New-Object Otto.Native+RECT
    if (-not [Otto.Native]::GetWindowRect($Window, [ref]$after) -or
        $after.left -ne $rect.left -or $after.top -ne $rect.top -or
        $after.right -ne $rect.right -or $after.bottom -ne $rect.bottom) { return $null }
    foreach ($protected in $ProtectedBounds) {
      foreach ($part in @('x', 'y', 'width', 'height')) {
        $number = [double]$protected[$part]
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { throw 'Cannot safely mask a sensitive field with invalid bounds.' }
      }
      $maskLeft = [Math]::Max(0, [Math]::Floor($protected.x - $rect.left))
      $maskTop = [Math]::Max(0, [Math]::Floor($protected.y - $rect.top))
      $maskRight = [Math]::Min($width, [Math]::Ceiling($protected.x + $protected.width - $rect.left))
      $maskBottom = [Math]::Min($height, [Math]::Ceiling($protected.y + $protected.height - $rect.top))
      if ($maskRight -gt $maskLeft -and $maskBottom -gt $maskTop) {
        $graphics.FillRectangle([System.Drawing.Brushes]::Black, [single]$maskLeft, [single]$maskTop, [single]($maskRight-$maskLeft), [single]($maskBottom-$maskTop))
      }
    }
    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
      return @{ base64=[Convert]::ToBase64String($stream.ToArray()); width=$width; height=$height; rect=$rect }
    } finally { $stream.Dispose() }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

function Assert-MatchingPatch($Original, $Fresh, [int]$X, [int]$Y) {
  if ($Original.width -ne $Fresh.width -or $Original.height -ne $Fresh.height) { throw 'The captured window size changed. Observe again.' }
  $beforeStream = New-Object System.IO.MemoryStream(,[Convert]::FromBase64String($Original.base64))
  $afterStream = New-Object System.IO.MemoryStream(,[Convert]::FromBase64String($Fresh.base64))
  $beforeImage = $null
  $afterImage = $null
  try {
    $beforeImage = [System.Drawing.Bitmap]::FromStream($beforeStream)
    $afterImage = [System.Drawing.Bitmap]::FromStream($afterStream)
    $minX = [Math]::Max(0, $X - 32)
    $maxX = [Math]::Min($Original.width - 1, $X + 32)
    $minY = [Math]::Max(0, $Y - 32)
    $maxY = [Math]::Min($Original.height - 1, $Y + 32)
    $difference = 0.0
    $changed = 0
    $samples = 0
    for ($pixelY=$minY; $pixelY -le $maxY; $pixelY+=2) {
      for ($pixelX=$minX; $pixelX -le $maxX; $pixelX+=2) {
        $before = $beforeImage.GetPixel($pixelX, $pixelY)
        $after = $afterImage.GetPixel($pixelX, $pixelY)
        $delta = [Math]::Abs([int]$before.R - [int]$after.R) + [Math]::Abs([int]$before.G - [int]$after.G) + [Math]::Abs([int]$before.B - [int]$after.B)
        $difference += $delta
        if ($delta -gt 24) { $changed++ }
        $samples++
      }
    }
    if ($samples -eq 0 -or $difference / ($samples * 3) -gt 3 -or $changed / [double]$samples -gt 0.05) {
      throw 'The OCR target appearance changed after observation. Observe again before clicking.'
    }
  } finally {
    if ($null -ne $beforeImage) { $beforeImage.Dispose() }
    if ($null -ne $afterImage) { $afterImage.Dispose() }
    $beforeStream.Dispose()
    $afterStream.Dispose()
  }
}

function Get-Permissions {
  $available = $null -eq $script:StartupError
  if ($available) {
    try { [void][System.Windows.Automation.AutomationElement]::RootElement.Current.ProcessId }
    catch { $available = $false }
  }
  return @{ accessibility=$available; screenCapture=$available; platform='win32' }
}

function Get-Apps {
  $script:AppRecords = @{}
  $apps = New-Object 'System.Collections.Generic.List[object]'
  $seen = @{}
  foreach ($window in [Otto.Native]::Windows()) {
    if ($seen.ContainsKey($window.pid)) { continue }
    try {
      $process = [System.Diagnostics.Process]::GetProcessById($window.pid)
      try { $startTicks = $process.StartTime.ToUniversalTime().Ticks }
      finally { $process.Dispose() }
      $appId = 'uia:{0}:{1}' -f $window.pid, $startTicks
      $app = @{ id=$appId; pid=$window.pid; name=$window.name }
      $script:AppRecords[$appId] = @{ app=$app; startTicks=$startTicks }
      $seen[$window.pid] = $true
      $apps.Add($app)
    } catch { continue }
  }
  return @{ apps=@($apps.ToArray()); permissions=(Get-Permissions) }
}

function Assert-App([string]$AppId) {
  if (-not $script:AllowedApps.ContainsKey($AppId)) { throw 'This application was not explicitly selected for the current run.' }
  $record = $script:AllowedApps[$AppId]
  $process = [System.Diagnostics.Process]::GetProcessById($record.app.pid)
  try {
    if ($process.StartTime.ToUniversalTime().Ticks -ne $record.startTicks) { throw 'The selected application restarted. Select it again.' }
  } finally { $process.Dispose() }
  return $record
}

function Get-AppWindow($AppRecord) {
  $windows = @([Otto.Native]::Windows() | Where-Object { $_.pid -eq $AppRecord.app.pid } | Sort-Object -Property foreground -Descending)
  if ($windows.Count -eq 0) { throw 'The selected application has no visible window.' }
  return [IntPtr]::new([long]$windows[0].handle)
}

function Remove-ExpiredSnapshots {
  foreach ($key in @($script:Snapshots.Keys)) {
    $age = ([System.Diagnostics.Stopwatch]::GetTimestamp() - $script:Snapshots[$key].tick) / [System.Diagnostics.Stopwatch]::Frequency
    if ($age -gt 30) { $script:Snapshots.Remove($key) }
  }
}

function Read-Snapshot([string]$AppId) {
  $appRecord = Assert-App $AppId
  Remove-ExpiredSnapshots
  foreach ($key in @($script:Snapshots.Keys)) {
    if ($script:Snapshots[$key].appId -eq $AppId) { $script:Snapshots.Remove($key) }
  }
  $window = Get-AppWindow $appRecord
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($window)
  if ($null -eq $root -or $root.Current.ProcessId -ne $appRecord.app.pid) { throw 'Windows could not access the UI Automation tree of the selected application.' }
  $windowToken = $null
  if ($script:WindowIdentities.ContainsKey($AppId)) {
    $previous = $script:WindowIdentities[$AppId]
    try {
      if ($previous.window -eq $window -and [System.Windows.Automation.Automation]::Compare($previous.root, $root)) { $windowToken = $previous.token }
    } catch { $windowToken = $null }
  }
  if ($null -eq $windowToken) {
    $windowToken = [Guid]::NewGuid().ToString('N')
    $script:WindowIdentities[$AppId] = @{ window=$window; root=$root; token=$windowToken }
  }
  $previousControls = @{}
  if ($script:ControlIdentities.ContainsKey($AppId) -and $script:ControlIdentities[$AppId].windowToken -eq $windowToken) {
    $previousControls = $script:ControlIdentities[$AppId].elements
  }
  $nextControls = @{}
  $snapshotId = [Guid]::NewGuid().ToString('N')
  $controls = New-Object 'System.Collections.Generic.List[object]'
  $text = New-Object System.Text.StringBuilder
  $handles = @{}
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object 'System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]'
  $queue.Enqueue($root)
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $visited = 0
  while ($queue.Count -gt 0 -and $visited -lt 1200 -and $controls.Count -lt 180 -and $timer.ElapsedMilliseconds -lt 8000) {
    $element = $queue.Dequeue()
    $visited++
    try {
      $current = $element.Current
      if ($current.ProcessId -ne $appRecord.app.pid) { continue }
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child -and $queue.Count -lt 1200 -and $timer.ElapsedMilliseconds -lt 8000) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
      if ($current.IsOffscreen) { continue }
      $role = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
      $sensitive = $current.IsPassword -or ($current.Name + ' ' + $current.AutomationId) -match '(?i)(password|passcode|secret|api.?key|credit.?card|security.?code|cvv)'
      $label = Limit-Text $current.Name 500
      $value = $null
      $valuePattern = $null
      $pressPattern = $null
      $scrollPattern = $null
      $expandState = $null
      $toggleState = $null
      $selectionState = $null
      $actions = New-Object 'System.Collections.Generic.List[string]'
      $editable = $false
      if (-not $sensitive) {
        $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) {
          $value = Limit-Text $valuePattern.Current.Value 2001
          $editable = -not $valuePattern.Current.IsReadOnly
        }
        if ($current.IsEnabled) {
          foreach ($candidate in @(
            @{ name='invoke'; pattern=[System.Windows.Automation.InvokePattern]::Pattern },
            @{ name='toggle'; pattern=[System.Windows.Automation.TogglePattern]::Pattern },
            @{ name='select'; pattern=[System.Windows.Automation.SelectionItemPattern]::Pattern },
            @{ name='expand'; pattern=[System.Windows.Automation.ExpandCollapsePattern]::Pattern }
          )) {
            $pattern = Get-Pattern $element $candidate.pattern
            if ($null -ne $pattern) {
              if ($candidate.name -eq 'expand') {
                $expandState = $pattern.Current.ExpandCollapseState
                if ($expandState -eq [System.Windows.Automation.ExpandCollapseState]::LeafNode) { continue }
              }
              if ($candidate.name -eq 'toggle') { $toggleState = $pattern.Current.ToggleState }
              if ($candidate.name -eq 'select') { $selectionState = $pattern.Current.IsSelected }
              $pressPattern = $candidate.name
              $actions.Add('press')
              break
            }
          }
          if ($editable) { $actions.Add('fill') }
          $scrollPattern = Get-Pattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
          if ($null -ne $scrollPattern -and $scrollPattern.Current.VerticallyScrollable) {
            if ($scrollPattern.Current.VerticalScrollPercent -gt 0) { $actions.Add('scrollUp') }
            if ($scrollPattern.Current.VerticalScrollPercent -lt 100) { $actions.Add('scrollDown') }
          }
        }
      } else { $label = 'Sensitive field'; $value = $null }
      if ([string]::IsNullOrWhiteSpace($label)) { $label = $role }
      $id = '{0}:{1}' -f $snapshotId, $controls.Count
      $runtimeIdentity = $element.GetRuntimeId() -join ','
      $identity = [Guid]::NewGuid().ToString('N')
      if ($previousControls.ContainsKey($runtimeIdentity)) {
        try {
          $previousControl = $previousControls[$runtimeIdentity]
          if ($previousControl.element.Current.ProcessId -eq $current.ProcessId -and [System.Windows.Automation.Automation]::Compare($previousControl.element, $element)) { $identity = $previousControl.token }
        } catch { }
      }
      $nextControls[$runtimeIdentity] = @{ element=$element; token=$identity }
      $bounds = $current.BoundingRectangle
      $control = @{ id=$id; identity=$identity; role=$role; label=$label; enabled=[bool]$current.IsEnabled; actions=@($actions.ToArray()); editable=[bool]$editable; sensitive=[bool]$sensitive; source='accessibility' }
      if ($null -ne $value) { $control.value = $value }
      if (-not $bounds.IsEmpty -and -not [double]::IsInfinity($bounds.Width) -and -not [double]::IsNaN($bounds.Width)) {
        $control.bounds = @{ x=$bounds.X; y=$bounds.Y; width=$bounds.Width; height=$bounds.Height }
      }
      $controls.Add($control)
      $handles[$id] = @{ element=$element; runtimeId=($element.GetRuntimeId() -join ','); role=$role; name=$current.Name; automationId=$current.AutomationId; actions=@($actions.ToArray()); pressPattern=$pressPattern; expandState=$expandState; toggleState=$toggleState; selectionState=$selectionState; value=$value }
      if ($text.Length -lt 24000) {
        [void]$text.AppendLine(('{0}: {1}' -f $role, $label))
        if (-not $sensitive -and -not [string]::IsNullOrEmpty($value)) { [void]$text.AppendLine($value) }
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] { continue }
    catch [System.InvalidOperationException] { continue }
  }
  $timer.Stop()
  $script:ControlIdentities[$AppId] = @{ windowToken=$windowToken; elements=$nextControls }
  $result = @{ snapshotId=$snapshotId; windowToken=$windowToken; app=$appRecord.app; title=[Otto.Native]::Title($window); text=(Limit-Text $text.ToString() 24000); controls=@($controls.ToArray()); capturedAt=[DateTime]::UtcNow.ToString('o') }
  # PrintWindow captures only this selected window. No full-screen fallback that could expose unrelated apps.
  $sensitiveBounds = @($controls | Where-Object { $_.sensitive -and $_.ContainsKey('bounds') } | ForEach-Object { $_.bounds })
  $result.protectedBounds = $sensitiveBounds
  $capture = $null
  try {
    $capture = Get-WindowScreenshot $window $sensitiveBounds
    if ($null -ne $capture) {
      $result.screenshot = 'data:image/jpeg;base64,' + $capture.base64
      $result.screenshotSize = @{ width=$capture.width; height=$capture.height }
      $result.windowBounds = @{ x=$capture.rect.left; y=$capture.rect.top; width=$capture.width; height=$capture.height }
    }
  } catch { $capture = $null }
  $script:Snapshots[$snapshotId] = @{ appId=$AppId; window=$window; root=$root; handles=$handles; capture=$capture; sensitiveBounds=$sensitiveBounds; tick=[System.Diagnostics.Stopwatch]::GetTimestamp() }
  return $result
}

function Invoke-NativeAction($Action) {
  $appId = [string](Get-Field $Action 'appId' '')
  $appRecord = Assert-App $appId
  Remove-ExpiredSnapshots
  $snapshotId = [string](Get-Field $Action 'snapshotId' '')
  if (-not $script:Snapshots.ContainsKey($snapshotId)) { throw 'The observation expired or was already used. Observe the app again.' }
  $snapshot = $script:Snapshots[$snapshotId]
  if ($snapshot.appId -ne $appId) { throw 'The action does not match the observed application.' }
  # Consume before any native effect. Errors must not cause automatic action retries.
  $script:Snapshots.Remove($snapshotId)
  [Otto.Native]::ValidateWindow($snapshot.window, $appRecord.app.pid)
  $kind = [string](Get-Field $Action 'kind' '')
  if ($kind -eq 'activate') {
    [Otto.Native]::Focus($snapshot.window, $appRecord.app.pid)
    return @{}
  }
  if ($kind -eq 'key') {
    $keyName = Get-Field $Action 'value'
    if ($keyName -isnot [string] -or @('enter', 'escape', 'tab') -cnotcontains $keyName) { throw 'Only Enter, Escape, and Tab are supported native keys.' }
    [Otto.Native]::Focus($snapshot.window, $appRecord.app.pid)
    if ($null -ne $snapshot.capture) {
      $currentRect = New-Object Otto.Native+RECT
      if (-not [Otto.Native]::GetWindowRect($snapshot.window, [ref]$currentRect) -or
          $currentRect.left -ne $snapshot.capture.rect.left -or $currentRect.top -ne $snapshot.capture.rect.top -or
          $currentRect.right -ne $snapshot.capture.rect.right -or $currentRect.bottom -ne $snapshot.capture.rect.bottom) { throw 'The selected window moved or resized after observation.' }
    }
    [void](Assert-App $appId)
    [Otto.Native]::PressKey($snapshot.window, $appRecord.app.pid, $keyName)
    return @{}
  }
  if ($kind -eq 'click') {
    if ($null -eq $snapshot.capture) { throw 'OCR clicks require a successfully captured selected-window screenshot.' }
    $point = Get-Field $Action 'point'
    $rawX = Get-Field $point 'x'
    $rawY = Get-Field $point 'y'
    $numberTypes = @([int], [long], [double], [decimal])
    if ($null -eq $rawX -or $null -eq $rawY -or $numberTypes -notcontains $rawX.GetType() -or $numberTypes -notcontains $rawY.GetType()) {
      throw 'An OCR click requires numeric screenshot-derived coordinates.'
    }
    $x = [double]$rawX
    $y = [double]$rawY
    if ([double]::IsNaN($x) -or [double]::IsInfinity($x) -or [double]::IsNaN($y) -or [double]::IsInfinity($y) -or
        $x -lt $snapshot.capture.rect.left -or $x -ge $snapshot.capture.rect.right -or
        $y -lt $snapshot.capture.rect.top -or $y -ge $snapshot.capture.rect.bottom) { throw 'The OCR point is outside the captured window.' }
    $clickX = [int][Math]::Floor($x)
    $clickY = [int][Math]::Floor($y)
    foreach ($bounds in $snapshot.sensitiveBounds) {
      if ($clickX -ge $bounds.x -and $clickX -lt $bounds.x + $bounds.width -and $clickY -ge $bounds.y -and $clickY -lt $bounds.y + $bounds.height) {
        throw 'OCR clicking is not allowed inside a sensitive native field.'
      }
    }
    [Otto.Native]::Focus($snapshot.window, $appRecord.app.pid)
    [Otto.Native]::GuardPoint($snapshot.window, $appRecord.app.pid, $clickX, $clickY, $snapshot.capture.rect)
    $fresh = Get-WindowScreenshot $snapshot.window $snapshot.sensitiveBounds
    if ($null -eq $fresh) { throw 'Windows could not recapture the selected window to verify the OCR point.' }
    Assert-MatchingPatch $snapshot.capture $fresh ($clickX - $snapshot.capture.rect.left) ($clickY - $snapshot.capture.rect.top)
    if (([System.Diagnostics.Stopwatch]::GetTimestamp() - $snapshot.tick) / [System.Diagnostics.Stopwatch]::Frequency -gt 30) { throw 'The OCR observation expired during verification.' }
    [void](Assert-App $appId)
    [Otto.Native]::ClickPoint($snapshot.window, $appRecord.app.pid, $clickX, $clickY, $snapshot.capture.rect)
    return @{}
  }
  $targetId = [string](Get-Field $Action 'targetId' '')
  if (-not $snapshot.handles.ContainsKey($targetId)) { throw 'The action target was not present in this observation.' }
  $target = $snapshot.handles[$targetId]
  $element = $target.element
  $current = $element.Current
  if ($current.ProcessId -ne $appRecord.app.pid -or ($element.GetRuntimeId() -join ',') -ne $target.runtimeId -or
      $current.Name -ne $target.name -or $current.AutomationId -ne $target.automationId -or
      $current.ControlType.ProgrammaticName.Replace('ControlType.', '') -ne $target.role) { throw 'The target changed after observation. Observe again.' }
  if (-not $current.IsEnabled -or $current.IsOffscreen -or $current.IsPassword) { throw 'The target is disabled, hidden, or sensitive.' }
  $ancestor = $element
  $belongs = $false
  for ($depth=0; $depth -lt 60 -and $null -ne $ancestor; $depth++) {
    if ([System.Windows.Automation.Automation]::Compare($ancestor, $snapshot.root)) { $belongs=$true; break }
    $ancestor = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($ancestor)
  }
  if (-not $belongs) { throw 'The target is no longer inside the selected application window.' }
  $nativeAction = [string](Get-Field $Action 'nativeAction' '')
  if ($target.actions -notcontains $nativeAction) { throw 'The native action was not supported by this observed control.' }
  if ($kind -eq 'fill' -and $nativeAction -eq 'fill') {
    $value = Get-Field $Action 'value'
    if ($value -isnot [string] -or $value.Length -gt 10000) { throw 'Fill requires literal text of at most 10,000 characters.' }
    $pattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -eq $pattern -or $pattern.Current.IsReadOnly) { throw 'This control no longer accepts a native value.' }
    if ((Limit-Text $pattern.Current.Value 2001) -ne $target.value) { throw 'The field changed after observation. Observe it again.' }
    $pattern.SetValue($value)
  } elseif ($kind -eq 'press' -and $nativeAction -eq 'press') {
    switch ($target.pressPattern) {
      'invoke' { (Get-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() }
      'toggle' {
        $pattern = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
        if ($pattern.Current.ToggleState -ne $target.toggleState) { throw 'The control changed after observation. Observe again.' }
        $pattern.Toggle()
      }
      'select' {
        $pattern = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($pattern.Current.IsSelected -ne $target.selectionState) { throw 'The selection changed after observation. Observe again.' }
        $pattern.Select()
      }
      'expand' {
        $pattern = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($pattern.Current.ExpandCollapseState -ne $target.expandState) { throw 'The control expanded or collapsed after observation. Observe again.' }
        if ($target.expandState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $pattern.Collapse() }
        else { $pattern.Expand() }
      }
      default { throw 'This control does not expose a supported native press action.' }
    }
  } elseif ($kind -eq 'scroll' -and @('scrollUp', 'scrollDown') -contains $nativeAction) {
    $pattern = Get-Pattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($null -eq $pattern -or -not $pattern.Current.VerticallyScrollable) { throw 'This control no longer supports native scrolling.' }
    $amount = [System.Windows.Automation.ScrollAmount]::LargeIncrement
    if ($nativeAction -eq 'scrollUp') { $amount = [System.Windows.Automation.ScrollAmount]::LargeDecrement }
    $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, $amount)
  } else { throw 'Unsupported native action.' }
  return @{}
}

while ($null -ne ($line = [Console]::ReadLine())) {
  $requestId = $null
  try {
    if ($line.Length -gt 65536) { throw 'Request is too large.' }
    $request = $line | ConvertFrom-Json
    $requestId = Get-Field $request 'id'
    if ($requestId -isnot [string] -or $requestId.Length -gt 200) { throw 'A string request id is required.' }
    $operation = [string](Get-Field $request 'op' '')
    if ($operation -eq 'permissions' -or $operation -eq 'requestPermission') {
      $result = Get-Permissions
    } else {
      if ($null -ne $script:StartupError) { throw $script:StartupError }
      switch ($operation) {
        'apps' { $result = Get-Apps }
        'configure' {
          $script:Snapshots = @{}
          $script:WindowIdentities = @{}
          $script:ControlIdentities = @{}
          $script:AllowedApps = @{}
          $ids = Get-Field $request 'appIds' @()
          if ($ids -isnot [System.Array] -or $ids.Count -gt 8) { throw 'Select up to eight application ids.' }
          [void](Get-Apps)
          foreach ($appId in $ids) {
            if ($appId -isnot [string] -or -not $script:AppRecords.ContainsKey($appId)) { throw 'An application id is no longer available. Refresh the app list.' }
          }
          foreach ($appId in $ids) { $script:AllowedApps[$appId] = $script:AppRecords[$appId] }
          $result = @{}
        }
        'observe' { $result = Read-Snapshot ([string](Get-Field $request 'appId' '')) }
        'act' { $result = Invoke-NativeAction (Get-Field $request 'action') }
        default { throw 'Unknown native operation.' }
      }
    }
    $response = @{ id=$requestId; ok=$true; result=$result }
  } catch {
    $response = @{ id=$requestId; ok=$false; error=(Limit-Text $_.Exception.Message 1000) }
  }
  [Console]::WriteLine(($response | ConvertTo-Json -Depth 15 -Compress))
  [Console]::Out.Flush()
}
