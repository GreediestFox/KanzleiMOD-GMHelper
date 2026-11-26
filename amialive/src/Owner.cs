// The watchdog (runs in the one AmIAlive that owns the folder): samples the vitals every second, looks at the server every <interval> seconds,
// starts it when it is down (and nobody else is starting it), reports crashes to Discord and the crash bucket, trips the kill switch in a crash loop.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace AmIAliveApp
{
    class Owner
    {
        public readonly Settings S;
        public readonly Brain B;
        readonly Vitals V;
        public volatile VitalsSnapshot Last;
        VitalsSnapshot lastWithServer;
        public string StateText = "starting";
        public DateTime Started = DateTime.Now;
        public volatile bool Stop;
        DateTime nextWatch = DateTime.MinValue;
        DateTime lastStatus = DateTime.MinValue;
        string lastNote = "";
        DateTime lastDownAt = DateTime.MinValue;
        int ramHighTicks;
        Thread th;

        public Owner(Settings s)
        {
            S = s;
            B = new Brain(s);
            V = new Vitals(s);
        }

        public void StartThread()
        {
            th = new Thread(Loop);
            th.IsBackground = true;
            th.Start();
        }

        public void RunHere() { Loop(); }

        void Loop()
        {
            Log.Write("AmIAlive started (folder " + S.Dir + ", process " + S.ProcName + ", grace " + S.GraceSeconds + " s, interval " + S.IntervalSeconds + " s" + (S.DryRun ? ", DRY RUN" : "") + ")");
            Discord.Send("online", 60, "AmIAlive is watching", "The watchdog started on " + Environment.MachineName + ".", Discord.Grey, false,
                "Server", Srv.ServerProcs().Length > 0 ? "running" : "not running", "Hold", Srv.StopMarkText() != null ? "yes" : "no");
            while (!Stop)
            {
                try
                {
                    Last = V.Sample();
                    if (Last.Server.Present) lastWithServer = Last;
                    if (DateTime.Now >= nextWatch)
                    {
                        WatchStep();
                        nextWatch = DateTime.Now.AddSeconds(S.IntervalSeconds);
                    }
                    CheckWarnings();
                    if ((DateTime.Now - lastStatus).TotalSeconds >= 2) { WriteStatus(); lastStatus = DateTime.Now; }
                }
                catch (Exception e) { Log.Write("loop error: " + e.Message); }
                Thread.Sleep(1000);
            }
        }

        public string Summary()
        {
            StringBuilder b = new StringBuilder();
            VitalsSnapshot v = lastWithServer != null ? lastWithServer : Last;
            if (v != null)
            {
                b.AppendLine("last vitals (" + v.At.ToString("HH:mm:ss") + "):");
                b.AppendLine("  CPU total " + (v.Cpu >= 0 ? v.Cpu.ToString("0") + " %" : "n/a") + ", RAM " + Vitals.Bytes(v.RamUsed) + " of " + Vitals.Bytes(v.RamTotal) + " (" + v.RamPercent.ToString("0") + " %)");
                b.AppendLine("  network down " + Vitals.Rate(v.NetDownBps) + ", up " + Vitals.Rate(v.NetUpBps));
                b.AppendLine("  disk " + v.DiskName + " free " + Vitals.Bytes(v.DiskFree) + " of " + Vitals.Bytes(v.DiskTotal));
                if (v.Server.Present) b.AppendLine("  server: pid " + v.Server.Pid + ", CPU " + v.Server.CpuPercent.ToString("0") + " %, RAM " + Vitals.Bytes(v.Server.WorkingSet) + " (private " + Vitals.Bytes(v.Server.Private) + "), threads " + v.Server.Threads + ", handles " + v.Server.Handles + ", up " + Vitals.Span(v.Server.Uptime));
                if (v.Db.Present) b.AppendLine("  database: CPU " + v.Db.CpuPercent.ToString("0") + " %, RAM " + Vitals.Bytes(v.Db.WorkingSet));
            }
            b.AppendLine("starts by AmIAlive: " + B.StartsTotal + ", crashes seen: " + B.CrashesTotal + ", crashes in the last " + S.LoopMinutes + " min: " + B.CrashesInWindow(DateTime.Now));
            return b.ToString();
        }

        void WatchStep()
        {
            Srv.CloseBatWindows();
            bool running = Srv.ServerProcs().Length > 0;
            string stop = Srv.StopMarkText();
            BrainInput bi = new BrainInput();
            bi.Now = DateTime.Now;
            bi.Running = running;
            bi.StopMark = stop != null;
            bi.RestartMark = Srv.RestartInProgress();
            string who = "";
            if (!running && !bi.StopMark && !bi.RestartMark) bi.OtherStarter = Srv.OtherStarterActive(out who);
            BrainResult r = B.Step(bi);
            StateText = B.StateText(bi.Now, running, bi.StopMark, bi.RestartMark);
            if (r.Note.Length > 0 && r.Note != lastNote) { Log.Write(r.Note + (who.Length > 0 ? ": " + who : "")); lastNote = r.Note; }
            if (r.Note.Length == 0) lastNote = "";

            if (r.CrashDetected)
            {
                lastDownAt = bi.Now;
                string up = lastWithServer != null ? Vitals.Span(lastWithServer.Server.Uptime) : "?";
                Log.Write("SERVER DOWN without a planned stop (crash " + r.CrashesInWindow + " of " + S.LoopMax + " within " + S.LoopMinutes + " min, it had run " + up + ")");
                VitalsSnapshot v = lastWithServer;
                Discord.Send("crash", 0, "Server crashed", "The server process ended without a planned stop.", Discord.Orange, false,
                    "Crashes (" + S.LoopMinutes + " min)", r.CrashesInWindow + " / " + S.LoopMax,
                    "Had run", up,
                    "RAM", v != null ? v.RamPercent.ToString("0") + " %" : "n/a",
                    "CPU", v != null && v.Cpu >= 0 ? v.Cpu.ToString("0") + " %" : "n/a",
                    "Server RAM", v != null && v.Server.Present ? Vitals.Bytes(v.Server.WorkingSet) : "n/a");
                CrashReport.RunAsync("server crashed", Summary(), 10, false);
            }
            if (r.CameUp)
            {
                string down = lastDownAt != DateTime.MinValue ? Vitals.Span(DateTime.Now - lastDownAt) : "";
                Log.Write("the server is up again" + (down.Length > 0 ? " (down for " + down + ")" : ""));
                Discord.Send("up", 20, "Server is back", "The server process is running again.", Discord.Green, false, "Down for", down.Length > 0 ? down : "-");
            }
            if (r.Action == Act.Start)
            {
                bool launched = Srv.StartServer("watchdog");
                if (launched) Discord.Send("start", 30, "Starting the server", "AmIAlive is starting the server (no other starter was active).", Discord.Blue, false,
                    "Starts so far", B.StartsTotal.ToString());
            }
            else if (r.Action == Act.Trip)
            {
                string res = Srv.ForceKill("crash loop", true);
                Log.Write("KILL SWITCH (crash loop): " + res + " - restarts are held until 'AmIAlive.exe release'");
                Discord.Send("loop", 0, "CRASH LOOP - kill switch engaged", S.LoopMax + " crashes within " + S.LoopMinutes + " minutes. The server was force closed and will NOT be restarted until someone releases it (AmIAlive.exe release, or key S in the dashboard).", Discord.Red, true,
                    "Closed", res);
                CrashReport.RunAsync("crash loop", Summary(), 0, true);
            }
            else if (r.Action == Act.Paused)
            {
                Log.Write("PAUSED: " + r.Note);
                Discord.Send("loop", 0, "Crash loop - restarts paused", r.Note, Discord.Red, true);
                CrashReport.RunAsync("crash loop (paused)", Summary(), 0, true);
            }
        }

        void CheckWarnings()
        {
            VitalsSnapshot v = Last;
            if (v == null) return;
            if (S.WarnRamPercent > 0 && v.RamTotal > 0 && v.RamPercent >= S.WarnRamPercent) ramHighTicks++; else ramHighTicks = 0;
            if (ramHighTicks == 180)
                Discord.Send("ram", 3600, "RAM is almost full", "Memory has been above " + S.WarnRamPercent + " % for 3 minutes.", Discord.Yellow, false,
                    "RAM", v.RamPercent.ToString("0") + " %", "Server", v.Server.Present ? Vitals.Bytes(v.Server.WorkingSet) : "n/a");
            if (S.WarnDiskGb > 0 && v.DiskFree >= 0 && v.DiskFree < (long)S.WarnDiskGb * 1024 * 1024 * 1024)
                Discord.Send("disk", 21600, "Disk is almost full", "Only " + Vitals.Bytes(v.DiskFree) + " free on " + v.DiskName, Discord.Yellow, false);
        }

        void WriteStatus()
        {
            try
            {
                StringBuilder b = new StringBuilder();
                b.AppendLine("updated=" + DateTime.UtcNow.Ticks);
                b.AppendLine("owner_pid=" + Process.GetCurrentProcess().Id);
                b.AppendLine("owner_since=" + Started.ToString("s"));
                b.AppendLine("state=" + StateText);
                b.AppendLine("starts=" + B.StartsTotal);
                b.AppendLine("crashes=" + B.CrashesTotal);
                b.AppendLine("crashes_window=" + B.CrashesInWindow(DateTime.Now));
                b.AppendLine("loop_max=" + S.LoopMax);
                b.AppendLine("last_crash=" + (B.LastCrash == DateTime.MinValue ? "" : B.LastCrash.ToString("s")));
                b.AppendLine("report=" + CrashReport.LastResult);
                b.AppendLine("report_at=" + (CrashReport.LastAt == DateTime.MinValue ? "" : CrashReport.LastAt.ToString("s")));
                string stop = Srv.StopMarkText();
                b.AppendLine("hold=" + (stop ?? ""));
                string tmp = S.StatusPath + ".tmp";
                File.WriteAllText(tmp, b.ToString());
                File.Copy(tmp, S.StatusPath, true);
            }
            catch { }
        }

        public static Dictionary<string, string> ReadStatus(Settings s)
        {
            Dictionary<string, string> d = new Dictionary<string, string>();
            try
            {
                using (FileStream fs = new FileStream(s.StatusPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (StreamReader rd = new StreamReader(fs))
                {
                    string l;
                    while ((l = rd.ReadLine()) != null)
                    {
                        int i = l.IndexOf('=');
                        if (i > 0) d[l.Substring(0, i)] = l.Substring(i + 1);
                    }
                }
            }
            catch { }
            return d;
        }
    }
}
