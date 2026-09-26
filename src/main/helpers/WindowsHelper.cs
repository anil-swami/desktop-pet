// Desktop Pet: Windows helper process (build/windows-helper.exe).
//
// Answers READ-ONLY questions about the Windows shell for the main process.
// Requests come in as JSON lines on stdin, answers go out as JSON lines on
// stdout. It exits when stdin closes (app quit or crash).
//
// Why C#? The documented ways to read desktop icon positions (Shell COM API,
// IFolderView.GetItemPosition) and to be told when the active window changes
// (SetWinEventHook) are Windows APIs that Node can't call directly. Every
// Windows 10/11 PC ships the .NET Framework C# compiler, so scripts/build-helper.mjs
// compiles this file without any extra tools or npm packages.
//
// Safety:
//   - Only READ methods are declared on the COM interfaces. Methods that move,
//     select or rename items are not declared at all, so they cannot be called.
//   - No file is opened, read, changed or deleted.
//   - File paths never leave this process: they become anonymous ids (hashes).
//   - Window TITLES and contents are never read: only class names, rectangles,
//     and the foreground app's process file name (e.g. "Code.exe").
//
// Commands:
//   {"id":1,"command":"desktop-icons"}      -> {"Visible":true,"Icons":[{"Id","Name","Kind","X","Y","Width","Height","Occluded"}]}
//       Coordinates are physical screen pixels. Occluded = another window covers the icon.
//   {"id":2,"command":"watch-foreground"}   -> "ok", then an event line whenever the active window changes:
//       {"event":"foreground","data":{"kind":"app|desktop|folder|taskbar|self|none","process":"Code.exe",
//                                     "window":123456,"maximized":true,"fullscreen":false}}
//   {"id":3,"command":"unwatch-foreground"} -> "ok"
//   {"id":4,"command":"ping"}               -> "pong"
//
// Written for C# 5 (the compiler that ships with Windows).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace DesktopPet
{
    public static class Program
    {
        static int petPid;

        [STAThread] // the Shell COM objects expect a single-threaded apartment
        public static int Main(string[] args)
        {
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] == "--pet-pid") int.TryParse(args[i + 1], out petPid);
            }

            try
            {
                Dpi.MakeAware();
            }
            catch (Exception error)
            {
                Output.Write("{\"ready\":false,\"error\":" + Json.Str(error.Message) + "}");
                return 1;
            }
            Output.Write("{\"ready\":true}");

            string line;
            while ((line = Console.In.ReadLine()) != null) // null = stdin closed: the app is gone
            {
                if (line.Trim().Length > 0) Handle(line);
            }
            Foreground.Stop();
            return 0;
        }

        static void Handle(string line)
        {
            Match idMatch = Regex.Match(line, "\"id\"\\s*:\\s*(\\d+)");
            Match commandMatch = Regex.Match(line, "\"command\"\\s*:\\s*\"([a-z-]+)\"");
            string id = idMatch.Success ? idMatch.Groups[1].Value : "null";
            string command = commandMatch.Success ? commandMatch.Groups[1].Value : "";
            try
            {
                string result;
                switch (command)
                {
                    case "desktop-icons": result = Desktop.Scan(petPid); break;
                    case "watch-foreground": Foreground.Start(petPid); result = "\"ok\""; break;
                    case "unwatch-foreground": Foreground.Stop(); result = "\"ok\""; break;
                    case "ping": result = "\"pong\""; break;
                    default: throw new InvalidOperationException("Unknown command: " + command);
                }
                Output.Write("{\"id\":" + id + ",\"ok\":true,\"result\":" + result + "}");
            }
            catch (Exception error)
            {
                Output.Write("{\"id\":" + id + ",\"ok\":false,\"error\":" + Json.Str(error.Message) + "}");
            }
        }
    }

    // stdout is shared by the request loop and the foreground watcher thread.
    static class Output
    {
        static readonly object Gate = new object();

        public static void Write(string jsonLine)
        {
            lock (Gate)
            {
                Console.Out.WriteLine(jsonLine);
                Console.Out.Flush();
            }
        }
    }

    static class Json
    {
        public static string Str(string text)
        {
            var escaped = new StringBuilder("\"");
            foreach (char c in text ?? "")
            {
                if (c == '"' || c == '\\') escaped.Append('\\').Append(c);
                else if (c < ' ') escaped.AppendFormat("\\u{0:x4}", (int)c);
                else escaped.Append(c);
            }
            return escaped.Append('"').ToString();
        }

        public static string Bool(bool value)
        {
            return value ? "true" : "false";
        }
    }

    static class Dpi
    {
        // Physical pixels everywhere: the main process converts them to DIPs.
        public static void MakeAware()
        {
            if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Hwnd; public uint Message; public IntPtr WParam; public IntPtr LParam; public uint Time; public POINT Point; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }

    // --- COM interfaces. Methods we never call are placeholders (_Name) that only
    // keep the method table in the right order; everything after the last method
    // we need is simply left out.

    [ComImport, Guid("85CB6900-4D95-11CF-960C-0080C7F4EE85"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    interface IShellWindows
    {
        int Count { get; }
        [return: MarshalAs(UnmanagedType.IDispatch)] object Item([In, MarshalAs(UnmanagedType.Struct)] object index);
        [return: MarshalAs(UnmanagedType.IUnknown)] object _NewEnum();
        void _Register(); void _RegisterPending(); void _Revoke(); void _OnNavigate(); void _OnActivated();
        [return: MarshalAs(UnmanagedType.IDispatch)]
        object FindWindowSW([In, MarshalAs(UnmanagedType.Struct)] ref object pvarLoc,
                            [In, MarshalAs(UnmanagedType.Struct)] ref object pvarLocRoot,
                            int swClass, out int phwnd, int swfwOptions);
    }

    [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IComServiceProvider
    {
        [return: MarshalAs(UnmanagedType.IUnknown)] object QueryService([In] ref Guid guidService, [In] ref Guid riid);
    }

    [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellBrowser
    {
        void GetWindow(out IntPtr phwnd);
        void _ContextSensitiveHelp();
        void _InsertMenusSB(); void _SetMenuSB(); void _RemoveMenusSB(); void _SetStatusTextSB(); void _EnableModelessSB();
        void _TranslateAcceleratorSB(); void _BrowseObject(); void _GetViewStateStream(); void _GetControlWindow(); void _SendControlMsg();
        IShellView QueryActiveShellView();
    }

    [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellView
    {
        void GetWindow(out IntPtr phwnd);
    }

    // Read-only subset. SelectItem / SelectAndPositionItems (which move icons) are deliberately absent.
    [ComImport, Guid("CDE725B0-CCC9-4519-917E-325D72FAB4CE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFolderView
    {
        void _GetCurrentViewMode(); void _SetCurrentViewMode();
        [return: MarshalAs(UnmanagedType.IUnknown)] object GetFolder([In] ref Guid riid);
        IntPtr Item(int iItemIndex);
        int ItemCount(uint uFlags);
        void _Items(); void _GetSelectionMarkedItem(); void _GetFocusedItem();
        POINT GetItemPosition(IntPtr pidl);
        POINT GetSpacing();
    }

    // Read-only subset. SetNameOf (rename) is deliberately absent.
    [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellFolder
    {
        void _ParseDisplayName(); void _EnumObjects(); void _BindToObject(); void _BindToStorage(); void _CompareIDs(); void _CreateViewObject();
        void GetAttributesOf(uint cidl, [In, MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, ref uint rgfInOut);
        void _GetUIObjectOf();
        void GetDisplayNameOf(IntPtr pidl, uint uFlags, IntPtr pName);
    }

    static class Native
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)] public static extern int StrRetToBuf(IntPtr strret, IntPtr pidl, StringBuilder buffer, int size);

        public delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint time);
        [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventProc callback, uint processId, uint threadId, uint flags);
        [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG msg);
        [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG msg);
        [DllImport("user32.dll")] public static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    }

    static class Windows
    {
        public static string ClassName(IntPtr hWnd)
        {
            var name = new StringBuilder(64);
            Native.GetClassName(hWnd, name, name.Capacity);
            return name.ToString();
        }

        public static bool IsDesktopOrTaskbar(string className)
        {
            return className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd";
        }

        public static uint ProcessId(IntPtr hWnd)
        {
            uint pid;
            Native.GetWindowThreadProcessId(hWnd, out pid);
            return pid;
        }

        // Just the file name ("Code.exe"), never the full path.
        public static string ProcessName(uint pid)
        {
            IntPtr handle = Native.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (handle == IntPtr.Zero) return "";
            try
            {
                var path = new StringBuilder(1024);
                int size = path.Capacity;
                return Native.QueryFullProcessImageName(handle, 0, path, ref size) ? System.IO.Path.GetFileName(path.ToString()) : "";
            }
            finally
            {
                Native.CloseHandle(handle);
            }
        }
    }

    // --- Desktop icons ------------------------------------------------------------

    static class Desktop
    {
        const int SWC_DESKTOP = 8, SWFO_NEEDDISPATCH = 1;
        const uint SVGIO_ALLVIEW = 2, SHGDN_NORMAL = 0, SHGDN_FORPARSING = 0x8000;
        const uint SFGAO_LINK = 0x10000, SFGAO_STREAM = 0x400000, SFGAO_FOLDER = 0x20000000, SFGAO_FILESYSTEM = 0x40000000;
        const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20, DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

        public static string Scan(int petPid)
        {
            IntPtr listView;
            IFolderView view = OpenDesktopView(out listView);
            // "Show desktop icons" turned off hides the list view: nothing to visit.
            if (listView == IntPtr.Zero || !Native.IsWindowVisible(listView)) return "{\"Visible\":false,\"Icons\":[]}";

            var origin = new POINT();
            Native.ClientToScreen(listView, ref origin);
            POINT spacing = view.GetSpacing();
            Guid iidFolder = new Guid("000214E6-0000-0000-C000-000000000046");
            var folder = (IShellFolder)view.GetFolder(ref iidFolder);
            List<RECT> covering = CoveringWindows(petPid);

            var json = new StringBuilder("{\"Visible\":true,\"Icons\":[");
            int count = view.ItemCount(SVGIO_ALLVIEW);
            for (int i = 0; i < count; i++)
            {
                IntPtr pidl = view.Item(i);
                try
                {
                    POINT position = view.GetItemPosition(pidl);
                    int x = origin.X + position.X, y = origin.Y + position.Y;
                    if (i > 0) json.Append(',');
                    json.Append("{\"Id\":").Append(Json.Str(Hash(DisplayName(folder, pidl, SHGDN_FORPARSING))))
                        .Append(",\"Name\":").Append(Json.Str(DisplayName(folder, pidl, SHGDN_NORMAL)))
                        .Append(",\"Kind\":").Append(Json.Str(Kind(folder, pidl)))
                        .Append(",\"X\":").Append(x).Append(",\"Y\":").Append(y)
                        .Append(",\"Width\":").Append(spacing.X).Append(",\"Height\":").Append(spacing.Y)
                        .Append(",\"Occluded\":").Append(Json.Bool(Intersects(covering, x, y, spacing.X, spacing.Y)))
                        .Append('}');
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pidl);
                }
            }
            return json.Append("]}").ToString();
        }

        // Raymond Chen, "Manipulating the positions of desktop icons" (The Old New Thing, 2013):
        // ShellWindows -> desktop browser -> active shell view -> IFolderView.
        static IFolderView OpenDesktopView(out IntPtr listView)
        {
            var windows = (IShellWindows)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
            object location = 0; // CSIDL_DESKTOP
            object root = null;
            int hwnd;
            object dispatch = windows.FindWindowSW(ref location, ref root, SWC_DESKTOP, out hwnd, SWFO_NEEDDISPATCH);
            if (dispatch == null) throw new InvalidOperationException("Desktop window not found");

            Guid service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837"); // SID_STopLevelBrowser
            Guid iidBrowser = new Guid("000214E2-0000-0000-C000-000000000046");
            var browser = (IShellBrowser)((IComServiceProvider)dispatch).QueryService(ref service, ref iidBrowser);
            IShellView shellView = browser.QueryActiveShellView();

            IntPtr defView;
            shellView.GetWindow(out defView);
            listView = Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
            return (IFolderView)shellView;
        }

        static string DisplayName(IShellFolder folder, IntPtr pidl, uint flags)
        {
            IntPtr strret = Marshal.AllocCoTaskMem(528); // STRRET is at most 264 bytes
            try
            {
                folder.GetDisplayNameOf(pidl, flags, strret);
                var buffer = new StringBuilder(1024);
                Native.StrRetToBuf(strret, pidl, buffer, buffer.Capacity);
                return buffer.ToString();
            }
            finally
            {
                Marshal.FreeCoTaskMem(strret);
            }
        }

        static string Kind(IShellFolder folder, IntPtr pidl)
        {
            uint attributes = SFGAO_LINK | SFGAO_STREAM | SFGAO_FOLDER | SFGAO_FILESYSTEM;
            folder.GetAttributesOf(1, new IntPtr[] { pidl }, ref attributes);
            if ((attributes & SFGAO_LINK) != 0) return "shortcut";
            if ((attributes & SFGAO_FOLDER) != 0 && (attributes & SFGAO_STREAM) == 0)
                return (attributes & SFGAO_FILESYSTEM) != 0 ? "folder" : "system"; // e.g. This PC, Recycle Bin
            return (attributes & SFGAO_FILESYSTEM) != 0 ? "file" : "system";
        }

        static string Hash(string text)
        {
            using (var sha = SHA1.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                var hex = new StringBuilder();
                for (int i = 0; i < 6; i++) hex.Append(bytes[i].ToString("x2"));
                return hex.ToString();
            }
        }

        // Visible top-level windows that could hide desktop icons. Only their
        // rectangles are used; titles and contents are never read.
        static List<RECT> CoveringWindows(int petPid)
        {
            var rects = new List<RECT>();
            Native.EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
            {
                if (!Native.IsWindowVisible(hWnd) || Native.IsIconic(hWnd)) return true;
                if (Windows.ProcessId(hWnd) == (uint)petPid) return true;
                if (Windows.IsDesktopOrTaskbar(Windows.ClassName(hWnd))) return true;
                if ((Native.GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT) != 0) return true; // click-through overlays

                int cloaked;
                if (Native.DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;

                RECT rect;
                if (Native.DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) != 0)
                    Native.GetWindowRect(hWnd, out rect);
                if (rect.Right > rect.Left && rect.Bottom > rect.Top) rects.Add(rect);
                return true;
            }, IntPtr.Zero);
            return rects;
        }

        static bool Intersects(List<RECT> rects, int x, int y, int width, int height)
        {
            foreach (RECT r in rects)
            {
                if (r.Left < x + width && r.Right > x && r.Top < y + height && r.Bottom > y) return true;
            }
            return false;
        }
    }

    // --- Foreground window ------------------------------------------------------------

    // Tells the main process which window is in front, whenever that changes.
    // Windows calls OnForeground through a WinEvent hook, so there is no polling.
    static class Foreground
    {
        const uint EVENT_SYSTEM_FOREGROUND = 3, WINEVENT_OUTOFCONTEXT = 0, WM_QUIT = 0x12;
        const uint GA_ROOT = 2, MONITOR_DEFAULTTONEAREST = 2;

        static Thread thread;
        static uint threadId;
        static int petPid;
        static IntPtr lastWindow = IntPtr.Zero;
        static Native.WinEventProc callback; // kept in a field: Windows holds on to it, so the GC must not collect it

        public static void Start(int pid)
        {
            if (thread != null) return;
            petPid = pid;
            var started = new ManualResetEvent(false);
            thread = new Thread(delegate ()
            {
                threadId = Native.GetCurrentThreadId();
                callback = new Native.WinEventProc(OnForeground);
                IntPtr hook = Native.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, callback, 0, 0, WINEVENT_OUTOFCONTEXT);
                started.Set();
                Report(Native.GetForegroundWindow());
                // Hook callbacks are delivered while this thread pumps messages.
                MSG msg;
                while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    Native.TranslateMessage(ref msg);
                    Native.DispatchMessage(ref msg);
                }
                Native.UnhookWinEvent(hook);
            });
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            started.WaitOne(2000);
        }

        public static void Stop()
        {
            if (thread == null) return;
            Native.PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            thread.Join(2000);
            thread = null;
            lastWindow = IntPtr.Zero;
        }

        static void OnForeground(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint time)
        {
            try { Report(hwnd); } catch { } // an exception must never escape back into Windows
        }

        static void Report(IntPtr hwnd)
        {
            if (hwnd != IntPtr.Zero)
            {
                IntPtr root = Native.GetAncestor(hwnd, GA_ROOT);
                if (root != IntPtr.Zero) hwnd = root;
            }
            if (hwnd == lastWindow) return;
            lastWindow = hwnd;
            Output.Write("{\"event\":\"foreground\",\"data\":" + Describe(hwnd) + "}");
        }

        static string Describe(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "{\"kind\":\"none\"}";

            string cls = Windows.ClassName(hwnd);
            uint pid = Windows.ProcessId(hwnd);
            string kind = "app";
            if (cls == "Progman" || cls == "WorkerW") kind = "desktop";
            else if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") kind = "taskbar";
            else if (cls == "CabinetWClass") kind = "folder";
            else if (pid == (uint)petPid) kind = "self";

            string process = Windows.ProcessName(pid);
            // Store apps run inside ApplicationFrameHost; the real app owns a child window.
            if (string.Equals(process, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                string inner = ChildProcessName(hwnd, pid);
                if (inner != null) process = inner;
            }

            return "{\"kind\":" + Json.Str(kind)
                + ",\"process\":" + Json.Str(process)
                + ",\"window\":" + hwnd.ToInt64()
                + ",\"maximized\":" + Json.Bool(kind == "app" && Native.IsZoomed(hwnd))
                + ",\"fullscreen\":" + Json.Bool(kind == "app" && CoversMonitor(hwnd))
                + "}";
        }

        static string ChildProcessName(IntPtr frame, uint framePid)
        {
            string found = null;
            Native.EnumChildWindows(frame, delegate (IntPtr child, IntPtr lParam)
            {
                uint childPid = Windows.ProcessId(child);
                if (childPid == framePid) return true;
                found = Windows.ProcessName(childPid);
                return false;
            }, IntPtr.Zero);
            return string.IsNullOrEmpty(found) ? null : found;
        }

        // Fullscreen = covers the whole monitor, taskbar included (videos, games, slides).
        static bool CoversMonitor(IntPtr hwnd)
        {
            RECT window;
            if (!Native.GetWindowRect(hwnd, out window)) return false;
            var info = new MONITORINFO();
            info.Size = Marshal.SizeOf(typeof(MONITORINFO));
            if (!Native.GetMonitorInfo(Native.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref info)) return false;
            return window.Left <= info.Monitor.Left && window.Top <= info.Monitor.Top
                && window.Right >= info.Monitor.Right && window.Bottom >= info.Monitor.Bottom;
        }
    }
}
