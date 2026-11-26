// The numbers of the Task Manager: CPU, memory, network, disk (from the Windows performance counters) and the same per process for the server and the database.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace AmIAliveApp
{
    class ProcVitals
    {
        public bool Present;
        public int Pid;
        public int Count;
        public double CpuPercent;       // of the whole machine, like the Task Manager
        public long WorkingSet;
        public long Private;
        public int Threads;
        public int Handles;
        public TimeSpan Uptime;
    }

    class VitalsSnapshot
    {
        public DateTime At;
        public double Cpu = -1;             // total CPU %, -1 = not available
        public long RamTotal, RamUsed;      // bytes
        public double NetDownBps = -1, NetUpBps = -1;
        public long DiskFree = -1, DiskTotal = -1;
        public string DiskName = "";
        public ProcVitals Server = new ProcVitals();
        public ProcVitals Db = new ProcVitals();
        public int Cores;
        public double RamPercent { get { return RamTotal > 0 ? 100.0 * RamUsed / RamTotal : 0; } }
    }

    class Vitals
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        class MemStatus
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
            public MemStatus() { dwLength = (uint)Marshal.SizeOf(typeof(MemStatus)); }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GlobalMemoryStatusEx([In, Out] MemStatus lpBuffer);

        readonly Settings S;
        PerformanceCounter cpuTotal;
        List<PerformanceCounter> netIn = new List<PerformanceCounter>();
        List<PerformanceCounter> netOut = new List<PerformanceCounter>();
        DateTime lastNetScan = DateTime.MinValue;
        readonly Dictionary<int, TimeSpan> lastCpu = new Dictionary<int, TimeSpan>();
        DateTime lastCpuAt = DateTime.MinValue;
        readonly int cores = Math.Max(1, Environment.ProcessorCount);

        public Vitals(Settings s)
        {
            S = s;
            try { cpuTotal = new PerformanceCounter("Processor", "% Processor Time", "_Total"); cpuTotal.NextValue(); }
            catch (Exception e) { Log.Write("CPU counter not available: " + e.Message); cpuTotal = null; }
        }

        void ScanNics()
        {
            lastNetScan = DateTime.Now;
            try
            {
                PerformanceCounterCategory cat = new PerformanceCounterCategory("Network Interface");
                string[] names = cat.GetInstanceNames();
                List<PerformanceCounter> ni = new List<PerformanceCounter>();
                List<PerformanceCounter> no = new List<PerformanceCounter>();
                foreach (string n in names)
                {
                    string l = n.ToLowerInvariant();
                    if (l.Contains("loopback") || l.Contains("isatap") || l.Contains("teredo") || l.Contains("pseudo")) continue;
                    PerformanceCounter a = new PerformanceCounter("Network Interface", "Bytes Received/sec", n);
                    PerformanceCounter b = new PerformanceCounter("Network Interface", "Bytes Sent/sec", n);
                    a.NextValue(); b.NextValue();
                    ni.Add(a); no.Add(b);
                }
                netIn = ni; netOut = no;
            }
            catch (Exception e) { Log.Write("network counters not available: " + e.Message); netIn = new List<PerformanceCounter>(); netOut = new List<PerformanceCounter>(); }
        }

        ProcVitals Collect(Process[] ps, DateTime now, Dictionary<int, TimeSpan> nextCpu, double elapsedSec)
        {
            ProcVitals v = new ProcVitals();
            foreach (Process p in ps)
            {
                try
                {
                    v.Present = true;
                    v.Count++;
                    if (v.Pid == 0) v.Pid = p.Id;
                    v.WorkingSet += p.WorkingSet64;
                    v.Private += p.PrivateMemorySize64;
                    v.Threads += p.Threads.Count;
                    v.Handles += p.HandleCount;
                    TimeSpan up = now - p.StartTime;
                    if (up > v.Uptime) v.Uptime = up;
                    TimeSpan tot = p.TotalProcessorTime;
                    nextCpu[p.Id] = tot;
                    TimeSpan prev;
                    if (elapsedSec > 0.2 && lastCpu.TryGetValue(p.Id, out prev))
                        v.CpuPercent += 100.0 * (tot - prev).TotalSeconds / (elapsedSec * cores);
                }
                catch { }
            }
            return v;
        }

        public VitalsSnapshot Sample()
        {
            VitalsSnapshot s = new VitalsSnapshot();
            DateTime now = DateTime.Now;
            s.At = now;
            s.Cores = cores;
            try { if (cpuTotal != null) s.Cpu = Math.Min(100, cpuTotal.NextValue()); } catch { }
            try
            {
                MemStatus m = new MemStatus();
                if (GlobalMemoryStatusEx(m)) { s.RamTotal = (long)m.ullTotalPhys; s.RamUsed = (long)(m.ullTotalPhys - m.ullAvailPhys); }
            }
            catch { }
            try
            {
                if ((now - lastNetScan).TotalSeconds > 60) ScanNics();
                if (netIn.Count > 0)
                {
                    double d = 0, u = 0;
                    foreach (PerformanceCounter c in netIn) d += c.NextValue();
                    foreach (PerformanceCounter c in netOut) u += c.NextValue();
                    s.NetDownBps = d; s.NetUpBps = u;
                }
            }
            catch { }
            try
            {
                string root = Path.GetPathRoot(Path.GetFullPath(S.Dir));
                DriveInfo di = new DriveInfo(root);
                s.DiskFree = di.AvailableFreeSpace; s.DiskTotal = di.TotalSize; s.DiskName = root;
            }
            catch { }
            double elapsed = lastCpuAt == DateTime.MinValue ? 0 : (now - lastCpuAt).TotalSeconds;
            Dictionary<int, TimeSpan> next = new Dictionary<int, TimeSpan>();
            s.Server = Collect(Srv.ServerProcs(), now, next, elapsed);
            s.Db = Collect(Srv.DbProcs(), now, next, elapsed);
            lastCpu.Clear();
            foreach (KeyValuePair<int, TimeSpan> kv in next) lastCpu[kv.Key] = kv.Value;
            lastCpuAt = now;
            return s;
        }

        public static string Bytes(long b)
        {
            if (b < 0) return "n/a";
            double v = b;
            string[] u = new string[] { "B", "KB", "MB", "GB", "TB" };
            int i = 0;
            while (v >= 1024 && i < u.Length - 1) { v /= 1024; i++; }
            return (i >= 3 ? v.ToString("0.0") : v.ToString("0")) + " " + u[i];
        }

        public static string Rate(double bps)
        {
            if (bps < 0) return "n/a";
            if (bps >= 1024 * 1024) return (bps / 1024 / 1024).ToString("0.0") + " MB/s";
            return (bps / 1024).ToString("0") + " KB/s";
        }

        public static string Span(TimeSpan t)
        {
            if (t.TotalDays >= 1) return (int)t.TotalDays + "d " + t.Hours + "h";
            if (t.TotalHours >= 1) return (int)t.TotalHours + "h " + t.Minutes + "m";
            return t.Minutes + "m " + t.Seconds + "s";
        }
    }
}
