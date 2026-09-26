# Desktop Pet: Windows helper process.
#
# Answers READ-ONLY questions about the Windows shell for the main process.
# It runs as a child process: requests come in as JSON lines on stdin, answers
# go out as JSON lines on stdout. It exits when stdin closes (app quit/crash).
#
# Why PowerShell + C#? The documented way to read desktop icon positions is the
# Shell COM API (IFolderView.GetItemPosition). Node can't call COM directly, and
# a native addon would need build tools. Every Windows 10/11 PC has PowerShell
# and the .NET compiler, so we compile a small C# class once at startup.
#
# Safety:
#   - Only READ methods are declared on the COM interfaces. Methods that move,
#     select or rename items are not declared at all, so they cannot be called.
#   - No file is opened, read, changed or deleted.
#   - File paths never leave this process: they become anonymous ids (hashes).
#
# Commands:
#   {"id":1,"command":"desktop-icons"} -> { Visible, Icons: [{ Id, Name, Kind, X, Y, Width, Height, Occluded }] }
#     Coordinates are physical screen pixels. Occluded = another window covers the icon.
#   {"id":2,"command":"ping"}          -> "pong"

param([int]$PetPid = 0)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace DesktopPet
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public class DesktopIcon
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Kind { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Occluded { get; set; }
    }

    public class DesktopScan
    {
        public bool Visible { get; set; }
        public List<DesktopIcon> Icons { get; set; }
    }

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
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)] public static extern int StrRetToBuf(IntPtr strret, IntPtr pidl, StringBuilder buffer, int size);
    }

    public static class Desktop
    {
        const int SWC_DESKTOP = 8, SWFO_NEEDDISPATCH = 1;
        const uint SVGIO_ALLVIEW = 2, SHGDN_NORMAL = 0, SHGDN_FORPARSING = 0x8000;
        const uint SFGAO_LINK = 0x10000, SFGAO_STREAM = 0x400000, SFGAO_FOLDER = 0x20000000, SFGAO_FILESYSTEM = 0x40000000;
        const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20, DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

        // Physical pixels everywhere: the main process converts to DIPs.
        public static void Init()
        {
            if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
        }

        public static DesktopScan Scan(int petPid)
        {
            IntPtr listView;
            IFolderView view = OpenDesktopView(out listView);
            var scan = new DesktopScan();
            scan.Icons = new List<DesktopIcon>();
            // "Show desktop icons" turned off hides the list view: nothing to visit.
            scan.Visible = listView != IntPtr.Zero && Native.IsWindowVisible(listView);
            if (!scan.Visible) return scan;

            var origin = new POINT();
            Native.ClientToScreen(listView, ref origin);
            POINT spacing = view.GetSpacing();
            Guid iidFolder = new Guid("000214E6-0000-0000-C000-000000000046");
            var folder = (IShellFolder)view.GetFolder(ref iidFolder);
            List<RECT> covering = CoveringWindows(petPid);

            int count = view.ItemCount(SVGIO_ALLVIEW);
            for (int i = 0; i < count; i++)
            {
                IntPtr pidl = view.Item(i);
                try
                {
                    POINT position = view.GetItemPosition(pidl);
                    var icon = new DesktopIcon();
                    icon.X = origin.X + position.X;
                    icon.Y = origin.Y + position.Y;
                    icon.Width = spacing.X;
                    icon.Height = spacing.Y;
                    icon.Name = DisplayName(folder, pidl, SHGDN_NORMAL);
                    icon.Id = Hash(DisplayName(folder, pidl, SHGDN_FORPARSING));
                    icon.Kind = Kind(folder, pidl);
                    icon.Occluded = Intersects(covering, icon);
                    scan.Icons.Add(icon);
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pidl);
                }
            }
            return scan;
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
                uint pid;
                Native.GetWindowThreadProcessId(hWnd, out pid);
                if (pid == (uint)petPid) return true;

                var className = new StringBuilder(64);
                Native.GetClassName(hWnd, className, className.Capacity);
                string name = className.ToString();
                if (name == "Progman" || name == "WorkerW" || name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd") return true;
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

        static bool Intersects(List<RECT> rects, DesktopIcon icon)
        {
            foreach (RECT r in rects)
            {
                if (r.Left < icon.X + icon.Width && r.Right > icon.X && r.Top < icon.Y + icon.Height && r.Bottom > icon.Y) return true;
            }
            return false;
        }
    }
}
'@

function Send($message) {
    [Console]::Out.WriteLine(($message | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}

try {
    Add-Type -TypeDefinition $source -Language CSharp
    [DesktopPet.Desktop]::Init()
} catch {
    Send @{ ready = $false; error = $_.Exception.Message }
    exit 1
}
Send @{ ready = $true }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break } # stdin closed: the app is gone
    if ($line.Trim() -eq '') { continue }
    $id = $null
    try {
        $request = $line | ConvertFrom-Json
        $id = $request.id
        switch ($request.command) {
            'desktop-icons' { $result = [DesktopPet.Desktop]::Scan($PetPid) }
            'ping' { $result = 'pong' }
            default { throw "Unknown command: $($request.command)" }
        }
        Send @{ id = $id; ok = $true; result = $result }
    } catch {
        Send @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
}
