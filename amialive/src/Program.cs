// AmIAlive - keeps the LiF dedicated server running and shows how it is doing.
//
//   AmIAlive.exe             the watchdog + the live screen (vitals, state, last log lines, keys). The first one in a folder is the watchdog;
//                            every later one is a viewer of the same screen. Started by the scheduled task at boot it runs without a screen.
//   AmIAlive.exe status      what it sees (no screen)
//   AmIAlive.exe restart     planned restart (closes the server, starts it again, waits until it is up)
//   AmIAlive.exe stop        planned stop (the watchdog leaves it off)         AmIAlive.exe release   lets the watchdog start it again
//   AmIAlive.exe kill        KILL SWITCH: force closes the server and its start scripts (like End process tree) and holds restarts
//   AmIAlive.exe report      builds a crash report from the server logs and uploads it to the crash bucket
//   AmIAlive.exe discord     sends a test message to the Discord webhook
//   AmIAlive.exe selftest    checks the decision logic and the helpers (no server needed)
// Settings: AmIAlive.ini next to the exe (see AmIAlive.example.ini).  Log: AmIAlive.log.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace AmIAliveApp
{
    static class Program
    {
        public const string Version = "1.0";

        static int Main(string[] args)
        {
            string dir = (Environment.GetEnvironmentVariable("AMIALIVE_DIR") ?? AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\', '/');
            Settings s = Settings.Load(dir);
            Srv.S = s; Discord.S = s; CrashReport.S = s; Actions.S = s;
            Log.FilePath = s.LogPath;
            string cmd = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            string who = Environment.UserName + "@" + Environment.MachineName + " (command line)";
            switch (cmd)
            {
                case "selftest": return SelfTest.Run(args.Length > 1 && args[1].ToLowerInvariant() == "net");
                case "restart": Actions.PlannedRestart(who); Discord.Flush(8000); return 0;
                case "stop": Actions.Stop(who); Discord.Flush(8000); return 0;
                case "release":
                case "start":
                    Actions.Release(who);
                    if (Srv.ServerProcs().Length == 0 && !OwnerRuns(s)) Srv.StartServer("manual start (no watchdog is running)");
                    Discord.Flush(8000);
                    return 0;
                case "kill": Console.WriteLine(Actions.Kill(who)); Discord.Flush(8000); return 0;
                case "report":
                    Actions.Report(who, "(report started from the command line)");
                    CrashReport.WaitDone(180000);
                    Console.WriteLine(CrashReport.LastResult);
                    Discord.Flush(8000);
                    return CrashReport.LastResult.StartsWith("uploaded") ? 0 : 1;
                case "discord": Actions.DiscordTest(who); Discord.Flush(10000); return 0;
                case "status": return Status(s);
                case "help":
                case "-h":
                case "--help":
                case "/?": Console.WriteLine(Usage()); return 0;
            }
            return Run(s);
        }

        static string Usage()
        {
            return "AmIAlive " + Version + "\r\n" +
                "  AmIAlive.exe            watchdog + live screen (later copies are viewers)\r\n" +
                "  AmIAlive.exe status | restart | stop | release | kill | report | discord | selftest";
        }

        static bool OwnerRuns(Settings s)
        {
            bool created;
            using (Mutex m = new Mutex(false, "Global\\AmIAlive_" + s.InstanceKey, out created))
            {
                bool got = false;
                try { got = m.WaitOne(0); } catch (AbandonedMutexException) { got = true; }
                if (got) { try { m.ReleaseMutex(); } catch { } return false; }
                return true;
            }
        }

        static bool Interactive()
        {
            if (!Environment.UserInteractive) return false;
            try { int w = Console.WindowWidth; int h = Console.WindowHeight; return w > 0 && h > 0 && !Console.IsInputRedirected && !Console.IsOutputRedirected; }
            catch { return false; }
        }

        static int Run(Settings s)
        {
            bool created;
            Mutex m = new Mutex(true, "Global\\AmIAlive_" + s.InstanceKey, out created);
            bool interactive = Interactive();
            if (!created)
            {
                // somebody already watches this folder: show its screen
                m.Dispose();
                if (!interactive) { Console.WriteLine("another AmIAlive already runs in this folder (see AmIAlive.log, 'AmIAlive.exe status')"); return 0; }
                Dashboard.Run(s, null);
                return 0;
            }
            try
            {
                Owner o = new Owner(s);
                if (interactive)
                {
                    o.StartThread();
                    Dashboard.Run(s, o);
                    o.Stop = true;
                    Log.Write("AmIAlive closed from the screen");
                }
                else
                {
                    o.RunHere();
                }
            }
            finally { try { m.ReleaseMutex(); } catch { } m.Dispose(); }
            return 0;
        }

        static int Status(Settings s)
        {
            Process[] ps = Srv.ServerProcs();
            Console.WriteLine("AmIAlive " + Version);
            Console.WriteLine("folder:             " + s.Dir);
            string since = "";
            if (ps.Length > 0) { try { since = ", since " + ps[0].StartTime; } catch { } }
            Console.WriteLine("server process:     " + (ps.Length > 0 ? "running (pid " + ps[0].Id + since + ")" : "NOT running"));
            Console.WriteLine("watchdog:           " + (OwnerRuns(s) ? "running" : "NOT running"));
            Console.WriteLine("restart mark:       " + (File.Exists(s.RestartMarkPath) ? "yes (restart in progress)" : "no"));
            string stop = Srv.StopMarkText();
            Console.WriteLine("hold / stopped:     " + (stop != null ? "YES - " + stop : "no"));
            Dictionary<string, string> st = Owner.ReadStatus(s);
            string v;
            if (st.TryGetValue("state", out v)) Console.WriteLine("watchdog state:     " + v);
            if (st.TryGetValue("crashes", out v)) Console.WriteLine("crashes seen:       " + v);
            if (st.TryGetValue("report", out v) && v.Length > 0) Console.WriteLine("last crash report:  " + v);
            Console.WriteLine("discord:            " + (string.IsNullOrEmpty(s.DiscordUrl) ? "not set" : "on"));
            Console.WriteLine("crash bucket:       " + (string.IsNullOrEmpty(s.ReportUrl) ? "not set" : s.ReportUrl));
            return 0;
        }
    }
}
