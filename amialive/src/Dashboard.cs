// The foreground screen: vitals like the Task Manager, watchdog state, the last log lines, and the keys (kill switch, restart, ...).
// The owner (the AmIAlive that runs the watchdog) and any later started AmIAlive (a viewer) show the same screen.
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;

namespace AmIAliveApp
{
    class Seg
    {
        public string T;
        public ConsoleColor C;
        public Seg(string t, ConsoleColor c) { T = t; C = c; }
    }

    class Dashboard
    {
        readonly Settings S;
        readonly Owner O;                       // null = viewer
        readonly Vitals Vit;
        readonly List<double> cpuHist = new List<double>();
        readonly List<double> ramHist = new List<double>();
        readonly List<double> netHist = new List<double>();
        string pending = "";                    // a question waiting for Y / N
        string msg = "";
        DateTime msgAt = DateTime.MinValue;
        bool busy;
        bool quit;

        public Dashboard(Settings s, Owner o)
        {
            S = s;
            O = o;
            Vit = o == null ? new Vitals(s) : null;
        }

        static Seg G(string t, ConsoleColor c) { return new Seg(t, c); }

        public static string Bar(double pct, int width)
        {
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            int fill = (int)Math.Round(pct / 100.0 * width);
            return "[" + new string('#', fill) + new string('-', width - fill) + "]";
        }

        static ConsoleColor Level(double pct)
        {
            if (pct >= 90) return ConsoleColor.Red;
            if (pct >= 70) return ConsoleColor.Yellow;
            return ConsoleColor.Green;
        }

        string Spark(List<double> h, double max, int width)
        {
            string ascii = " .:-=+*#%@";
            string blocks = " ▁▂▃▄▅▆▇█";
            string set = S.Fancy ? blocks : ascii;
            StringBuilder b = new StringBuilder();
            int from = Math.Max(0, h.Count - width);
            if (max <= 0) max = 1;
            for (int i = from; i < h.Count; i++)
            {
                double v = h[i] < 0 ? 0 : h[i];
                int idx = (int)Math.Round(Math.Min(1.0, v / max) * (set.Length - 1));
                b.Append(set[idx]);
            }
            return b.ToString().PadLeft(width);
        }

        static void Push(List<double> l, double v)
        {
            l.Add(v);
            while (l.Count > 120) l.RemoveAt(0);
        }

        public static void Run(Settings s, Owner o)
        {
            Dashboard d = new Dashboard(s, o);
            d.Loop();
        }

        void Loop()
        {
            Log.Echo = false;
            try { Console.CursorVisible = false; Console.Clear(); } catch { }
            while (!quit)
            {
                VitalsSnapshot v = O != null ? O.Last : Vit.Sample();
                if (v != null)
                {
                    Push(cpuHist, v.Cpu);
                    Push(ramHist, v.RamPercent);
                    Push(netHist, v.NetDownBps + v.NetUpBps > 0 ? (v.NetDownBps + v.NetUpBps) : 0);
                }
                try { Draw(v); } catch { }
                DateTime until = DateTime.Now.AddMilliseconds(1000);
                while (DateTime.Now < until && !quit)
                {
                    try { if (Console.KeyAvailable) HandleKey(Console.ReadKey(true)); } catch { }
                    Thread.Sleep(50);
                }
            }
            try { Console.CursorVisible = true; Console.ResetColor(); Console.Clear(); } catch { }
            Log.Echo = true;
        }

        void Say(string m) { msg = m; msgAt = DateTime.Now; }

        void Background(string what, ThreadStart work)
        {
            if (busy) { Say("busy - wait until the last action is done"); return; }
            busy = true;
            Say(what + " ...");
            Thread t = new Thread(delegate ()
            {
                try { work(); Say(what + ": done"); }
                catch (Exception e) { Say(what + " failed: " + e.Message); Log.Write(what + " failed: " + e.Message); }
                finally { busy = false; }
            });
            t.IsBackground = true;
            t.Start();
        }

        string Who() { return Environment.UserName + "@" + Environment.MachineName; }

        string SummaryText()
        {
            if (O != null) return O.Summary();
            return "(report started from a viewer window; see the status lines of the owner in AmIAlive.status)";
        }

        void HandleKey(ConsoleKeyInfo k)
        {
            if (pending.Length > 0)
            {
                string p = pending;
                pending = "";
                if (k.Key != ConsoleKey.Y) { Say("cancelled"); return; }
                if (p == "kill") Background("KILL SWITCH", delegate () { Actions.Kill(Who()); });
                else if (p == "restart") Background("planned restart", delegate () { Actions.PlannedRestart(Who()); });
                else if (p == "stop") Background("planned stop", delegate () { Actions.Stop(Who()); });
                else if (p == "quit") quit = true;
                return;
            }
            switch (k.Key)
            {
                case ConsoleKey.K: pending = "kill"; Say("FORCE CLOSE the server (like End process tree) and hold restarts?  Y = yes, any other key = no"); break;
                case ConsoleKey.R: pending = "restart"; Say("Planned restart: close the server and start it again?  Y = yes"); break;
                case ConsoleKey.T: pending = "stop"; Say("Planned stop: close the server and leave it off?  Y = yes"); break;
                case ConsoleKey.S: Actions.Release(Who()); Say("released - the watchdog starts the server if it is down"); break;
                case ConsoleKey.U: Actions.Report(Who(), SummaryText()); Say("crash report is being made and uploaded ..."); break;
                case ConsoleKey.D: Actions.DiscordTest(Who()); Say(string.IsNullOrEmpty(S.DiscordUrl) ? "discord is not set in AmIAlive.ini" : "test message sent to Discord"); break;
                case ConsoleKey.Q:
                    if (O != null) { pending = "quit"; Say("Quit AmIAlive? The watchdog stops (the server keeps running).  Y = yes"); }
                    else quit = true;
                    break;
            }
        }

        List<Seg[]> Build(VitalsSnapshot v, int width)
        {
            List<Seg[]> L = new List<Seg[]>();
            Dictionary<string, string> st = O == null ? Owner.ReadStatus(S) : null;
            string state;
            string hold;
            string starts, crashes, window, lastCrash, report;
            bool ownerAlive = true;
            if (O != null)
            {
                state = O.StateText;
                hold = Srv.StopMarkText() ?? "";
                starts = O.B.StartsTotal.ToString();
                crashes = O.B.CrashesTotal.ToString();
                window = O.B.CrashesInWindow(DateTime.Now).ToString();
                lastCrash = O.B.LastCrash == DateTime.MinValue ? "-" : O.B.LastCrash.ToString("HH:mm:ss");
                report = CrashReport.LastResult;
            }
            else
            {
                string tmp;
                state = st.TryGetValue("state", out tmp) ? tmp : "?";
                hold = st.TryGetValue("hold", out tmp) ? tmp : "";
                starts = st.TryGetValue("starts", out tmp) ? tmp : "?";
                crashes = st.TryGetValue("crashes", out tmp) ? tmp : "?";
                window = st.TryGetValue("crashes_window", out tmp) ? tmp : "?";
                lastCrash = st.TryGetValue("last_crash", out tmp) && tmp.Length > 10 ? tmp.Substring(11) : "-";
                report = st.TryGetValue("report", out tmp) ? tmp : "";
                long ticks;
                ownerAlive = st.TryGetValue("updated", out tmp) && long.TryParse(tmp, out ticks) && (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalSeconds < 20;
            }
            ConsoleColor sc = state.StartsWith("RUNNING") ? ConsoleColor.Green : (state.StartsWith("HELD") || state.StartsWith("PAUSED") ? ConsoleColor.Red : ConsoleColor.Yellow);
            int bw = Math.Max(10, Math.Min(24, width - 70));

            L.Add(new Seg[] { G(" AmIAlive ", ConsoleColor.Cyan), G(Environment.MachineName + "   ", ConsoleColor.Gray), G(O != null ? "[watchdog owner]" : "[viewer]", ConsoleColor.DarkGray), G("   " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), ConsoleColor.Gray) });
            L.Add(new Seg[] { G(new string('-', Math.Max(10, width - 1)), ConsoleColor.DarkGray) });
            if (!ownerAlive) L.Add(new Seg[] { G(" The watchdog is NOT running (no heartbeat). Start AmIAlive.exe from the scheduled task or double click it.", ConsoleColor.Red) });
            L.Add(new Seg[] { G(" SERVER    ", ConsoleColor.DarkGray), G(state, sc), G(v != null && v.Server.Present ? "   pid " + v.Server.Pid + "   up " + Vitals.Span(v.Server.Uptime) : "", ConsoleColor.Gray) });
            if (v != null && v.Server.Present)
            {
                ProcVitals p = v.Server;
                L.Add(new Seg[] { G("   process ", ConsoleColor.DarkGray), G("CPU " + p.CpuPercent.ToString("0").PadLeft(3) + " % ", ConsoleColor.White), G(Bar(p.CpuPercent, bw), Level(p.CpuPercent)),
                    G("  RAM " + Vitals.Bytes(p.WorkingSet) + " (private " + Vitals.Bytes(p.Private) + ")  threads " + p.Threads + "  handles " + p.Handles, ConsoleColor.White) });
            }
            if (v != null && v.Db.Present)
            {
                ProcVitals p = v.Db;
                L.Add(new Seg[] { G(" DATABASE  ", ConsoleColor.DarkGray), G("CPU " + p.CpuPercent.ToString("0").PadLeft(3) + " %   RAM " + Vitals.Bytes(p.WorkingSet) + "   threads " + p.Threads, ConsoleColor.White) });
            }
            if (v != null)
            {
                L.Add(new Seg[] { G(" SYSTEM    ", ConsoleColor.DarkGray), G("CPU ", ConsoleColor.Gray), G((v.Cpu >= 0 ? v.Cpu.ToString("0").PadLeft(3) + " % " : " n/a "), ConsoleColor.White), G(Bar(v.Cpu, bw), Level(v.Cpu)), G("  " + Spark(cpuHist, 100, 30), ConsoleColor.DarkCyan) });
                L.Add(new Seg[] { G("           ", ConsoleColor.DarkGray), G("RAM ", ConsoleColor.Gray), G(v.RamPercent.ToString("0").PadLeft(3) + " % ", ConsoleColor.White), G(Bar(v.RamPercent, bw), Level(v.RamPercent)), G("  " + Vitals.Bytes(v.RamUsed) + " / " + Vitals.Bytes(v.RamTotal) + "  " + Spark(ramHist, 100, 20), ConsoleColor.DarkCyan) });
                double top = 1024 * 1024;
                foreach (double x in netHist) if (x > top) top = x;
                L.Add(new Seg[] { G("           ", ConsoleColor.DarkGray), G("NET ", ConsoleColor.Gray), G("down " + Vitals.Rate(v.NetDownBps) + "   up " + Vitals.Rate(v.NetUpBps), ConsoleColor.White), G("   " + Spark(netHist, top, 30), ConsoleColor.DarkCyan) });
                L.Add(new Seg[] { G("           ", ConsoleColor.DarkGray), G("DISK " + v.DiskName + "  " + Vitals.Bytes(v.DiskFree) + " free of " + Vitals.Bytes(v.DiskTotal), ConsoleColor.White) });
            }
            L.Add(new Seg[] { G(" WATCHDOG  ", ConsoleColor.DarkGray), G("starts " + starts + "   crashes " + crashes + "   last " + window + " / " + S.LoopMax + " in " + S.LoopMinutes + " min   last crash " + lastCrash, ConsoleColor.White) });
            if (hold.Length > 0) L.Add(new Seg[] { G(" HOLD      ", ConsoleColor.DarkGray), G(hold + "   (key S releases)", ConsoleColor.Red) });
            L.Add(new Seg[] { G(" REPORT    ", ConsoleColor.DarkGray), G(report.Length > 0 ? report : "none yet" + (string.IsNullOrEmpty(S.ReportUrl) ? " (report_url is not set)" : ""), report.StartsWith("FAILED") ? ConsoleColor.Red : ConsoleColor.White) });
            L.Add(new Seg[] { G(" DISCORD   ", ConsoleColor.DarkGray), G(string.IsNullOrEmpty(S.DiscordUrl) ? "not set (discord= in AmIAlive.ini)" : "on", ConsoleColor.White) });
            L.Add(new Seg[] { G(new string('-', Math.Max(10, width - 1)), ConsoleColor.DarkGray) });
            foreach (string line in Log.Tail(8)) L.Add(new Seg[] { G(" " + line, ConsoleColor.Gray) });
            return L;
        }

        void Draw(VitalsSnapshot v)
        {
            int w = 100, h = 40;
            try { w = Console.WindowWidth; h = Console.WindowHeight; } catch { }
            List<Seg[]> lines = Build(v, w);
            List<Seg[]> bottom = new List<Seg[]>();
            ConsoleColor mc = pending.Length > 0 ? ConsoleColor.Yellow : ConsoleColor.Green;
            if (msg.Length > 0 && (pending.Length > 0 || (DateTime.Now - msgAt).TotalSeconds < 12)) bottom.Add(new Seg[] { G(" " + msg, mc) });
            else bottom.Add(new Seg[] { G(" ", ConsoleColor.Gray) });
            bottom.Add(new Seg[] { G(" [K] KILL SWITCH ", ConsoleColor.Red), G("[R] restart  [T] stop  [S] release/start  [U] crash report  [D] discord test  [Q] quit", ConsoleColor.Gray) });
            int room = Math.Max(1, h - 1 - bottom.Count);
            while (lines.Count > room) lines.RemoveAt(lines.Count - 1);
            int y = 0;
            foreach (Seg[] line in lines) { WriteLine(y++, line, w); }
            while (y < h - 1 - bottom.Count) WriteLine(y++, new Seg[] { G("", ConsoleColor.Gray) }, w);
            foreach (Seg[] line in bottom) { WriteLine(y++, line, w); }
        }

        static void WriteLine(int y, Seg[] segs, int w)
        {
            try
            {
                Console.SetCursorPosition(0, y);
                int used = 0;
                foreach (Seg s in segs)
                {
                    string t = s.T;
                    if (used + t.Length > w - 1) t = t.Substring(0, Math.Max(0, w - 1 - used));
                    Console.ForegroundColor = s.C;
                    Console.Write(t);
                    used += t.Length;
                }
                if (used < w - 1) { Console.ForegroundColor = ConsoleColor.Gray; Console.Write(new string(' ', w - 1 - used)); }
            }
            catch { }
        }
    }
}
