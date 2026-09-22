Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LensDragHook {
  public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  public delegate IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint flags; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct WNDCLASSEX { public uint cbSize,style; public WindowProc wndProc; public int clsExtra,wndExtra; public IntPtr instance,icon,cursor,background; [MarshalAs(UnmanagedType.LPWStr)] public string menuName,className; public IntPtr iconSmall; }
  [StructLayout(LayoutKind.Sequential)] public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
  [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] public static extern sbyte GetMessage(out MSG message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG message);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WNDCLASSEX windowClass);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateWindowEx(int exStyle, string className, string title, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ValidateRect(IntPtr window, IntPtr rect);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr window, uint colorKey, byte alpha, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr window);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateSolidBrush(uint color);
  [DllImport("user32.dll")] public static extern int FillRect(IntPtr dc, ref RECT rect, IntPtr brush);
  [DllImport("user32.dll")] public static extern int FrameRect(IntPtr dc, ref RECT rect, IntPtr brush);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr objectHandle);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
  public static HookProc Callback;
  public static WindowProc OverlayCallback;
  public static IntPtr Hook;
  static IntPtr Overlay; static bool dragging; static POINT start; static int lastVisualUpdate;
  const uint WM_PAINT=0x000F, WM_NCHITTEST=0x0084; const int HTTRANSPARENT=-1;
  static IntPtr PaintOverlay(IntPtr window, uint message, IntPtr wParam, IntPtr lParam) {
    if(message==WM_NCHITTEST) return new IntPtr(HTTRANSPARENT);
    if(message==WM_PAINT) { RECT rect; GetClientRect(window,out rect); IntPtr dc=GetDC(window); IntPtr fill=CreateSolidBrush(0x78F0B4); FillRect(dc,ref rect,fill); FrameRect(dc,ref rect,fill); DeleteObject(fill); ReleaseDC(window,dc); ValidateRect(window,IntPtr.Zero); return IntPtr.Zero; }
    return DefWindowProc(window,message,wParam,lParam);
  }
  static void CreateOverlay() {
    OverlayCallback=PaintOverlay; var wc=new WNDCLASSEX(); wc.cbSize=(uint)Marshal.SizeOf(typeof(WNDCLASSEX)); wc.wndProc=OverlayCallback; wc.instance=GetModuleHandle(null); wc.className="LensDragIndicator"; RegisterClassEx(ref wc);
    Overlay=CreateWindowEx(0x080800A0,"LensDragIndicator","",unchecked((int)0x80000000),0,0,1,1,IntPtr.Zero,IntPtr.Zero,wc.instance,IntPtr.Zero); SetLayeredWindowAttributes(Overlay,0,76,2);
  }
  static void ShowOverlay(POINT point) {
    int now=Environment.TickCount; if(unchecked(now-lastVisualUpdate)<33) return; lastVisualUpdate=now;
    int left=Math.Min(start.x,point.x),top=Math.Min(start.y,point.y),width=Math.Abs(point.x-start.x),height=Math.Abs(point.y-start.y);
    if(width<4||height<4) return; SetWindowPos(Overlay,new IntPtr(-1),left,top,width,height,0x0050);
  }
  static void HideOverlay() { if(Overlay!=IntPtr.Zero) ShowWindow(Overlay,0); }
  static void Emit(string type, POINT point) {
    var info=new MONITORINFO(); info.cbSize=Marshal.SizeOf(typeof(MONITORINFO)); GetMonitorInfo(MonitorFromPoint(point,2),ref info);
    Console.WriteLine("{\"type\":\""+type+"\",\"x1\":"+start.x+",\"y1\":"+start.y+",\"x2\":"+point.x+",\"y2\":"+point.y+",\"mx\":"+info.rcMonitor.left+",\"my\":"+info.rcMonitor.top+"}"); Console.Out.Flush();
  }
  public static IntPtr Handle(int code, IntPtr message, IntPtr data) {
    if (code >= 0) {
      var point = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(data).pt;
      bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
      if (message == (IntPtr)0x0201 && ctrl) { dragging=true; start=point; lastVisualUpdate=0; Emit("start",point); }
      else if (message == (IntPtr)0x0201 && !dragging) { Emit("click",point); }
      if (message == (IntPtr)0x0200 && dragging && ctrl) { int now=Environment.TickCount; if(unchecked(now-lastVisualUpdate)>=16){lastVisualUpdate=now;Emit("move",point);} }
      if (message == (IntPtr)0x0202 && dragging) {
        dragging=false;
        HideOverlay();
        if (ctrl && (Math.Abs(point.x-start.x)>4 || Math.Abs(point.y-start.y)>4)) {
          Emit("end",point);
        }
      }
    }
    return CallNextHookEx(Hook, code, message, data);
  }
  public static void Run() {
    Callback=Handle; Hook=SetWindowsHookEx(14, Callback, GetModuleHandle(null), 0);
    if(Hook==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    MSG message; while(GetMessage(out message, IntPtr.Zero, 0, 0) != 0) { TranslateMessage(ref message); DispatchMessage(ref message); } HideOverlay(); if(Overlay!=IntPtr.Zero)DestroyWindow(Overlay); UnhookWindowsHookEx(Hook);
  }
}
'@
[LensDragHook]::Run()
