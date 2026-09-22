Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LensForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
}
'@
$handle = [LensForeground]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 1024
[void][LensForeground]::GetWindowText($handle, $title, 1024)
$processIdValue = [uint32]0
[void][LensForeground]::GetWindowThreadProcessId($handle, [ref]$processIdValue)
$processValue = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
@{ name = $processValue.ProcessName; title = $title.ToString() } | ConvertTo-Json -Compress
