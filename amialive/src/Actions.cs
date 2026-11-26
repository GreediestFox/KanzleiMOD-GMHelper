// The things a person can do (command line, dashboard keys). Each one logs and tells Discord.
using System;
using System.IO;
using System.Threading;

namespace AmIAliveApp
{
    static class Actions
    {
        public static Settings S;

        // KILL SWITCH: like "End process tree" in the Task Manager, plus: the watchdog does not start the server again until release.
        public static string Kill(string who)
        {
            Log.Write("KILL SWITCH used by " + who);
            string res = Srv.ForceKill("manual kill by " + who, true);
            Log.Write("kill switch done: " + res + " - restarts are held until 'AmIAlive.exe release'");
            Discord.Send("kill", 0, "Kill switch used", "The server was force closed by " + who + ". It stays off until it is released.", Discord.Red, true, "Closed", res);
            return res;
        }

        // lets the watchdog start the server again (after Kill, Stop or a crash loop)
        public static void Release(string who)
        {
            Srv.ClearStopMark();
            Log.Write("released by " + who + ": the watchdog may start the server again");
            Discord.Send("release", 0, "Released", "The hold was removed by " + who + ". The watchdog starts the server if it is down.", Discord.Blue, false);
        }

        // planned stop: the watchdog leaves it alone
        public static void Stop(string who)
        {
            Srv.WriteStopMark("stop: by " + who + " @ " + DateTime.Now.ToString("s"));
            Log.Write("planned stop by " + who + ": the watchdog leaves the server alone until 'AmIAlive.exe release'");
            Discord.Send("stop", 0, "Planned stop", "The server is being stopped by " + who + ".", Discord.Grey, false);
            Srv.CloseServer();
        }

        // planned restart: closes the server, starts it again, waits until it is up. The watchdog does nothing while the mark exists.
        public static void PlannedRestart(string who)
        {
            try
            {
                File.WriteAllText(S.RestartMarkPath, DateTime.UtcNow.ToString("o"));
                Srv.ClearStopMark();
                Log.Write("planned restart by " + who + ": closing the server");
                Discord.Send("restartplan", 0, "Planned restart", "Restart started by " + who + ".", Discord.Grey, false);
                Srv.CloseServer();
                Thread.Sleep(3000);
                File.WriteAllText(S.RestartMarkPath, DateTime.UtcNow.ToString("o"));
                string who2;
                if (Srv.OtherStarterActive(out who2)) Log.Write("another starter is active (" + who2 + ") - not starting a second time");
                else Srv.StartServer("planned restart");
                DateTime until = DateTime.Now.AddSeconds(S.GraceSeconds);
                while (DateTime.Now < until && Srv.ServerProcs().Length == 0 && !S.DryRun) Thread.Sleep(1000);
                bool up = Srv.ServerProcs().Length > 0;
                Log.Write(up ? "planned restart done: the server process is up" : (S.DryRun ? "[dryrun] done" : "WARNING: the server process did not appear within " + S.GraceSeconds + " s"));
                Discord.Send("restartdone", 0, up ? "Planned restart done" : "Planned restart: server did not come up", up ? "The server process is running." : "No server process after " + S.GraceSeconds + " s - check the log.", up ? Discord.Green : Discord.Red, !up);
            }
            finally
            {
                try { File.Delete(S.RestartMarkPath); } catch { }
            }
        }

        public static void Report(string who, string summary)
        {
            Log.Write("crash report requested by " + who);
            CrashReport.RunAsync("manual by " + who, summary, 0, true);
        }

        public static void DiscordTest(string who)
        {
            if (string.IsNullOrEmpty(S.DiscordUrl)) { Log.Write("discord is not set in AmIAlive.ini"); return; }
            Log.Write("discord test by " + who);
            Discord.Send("test", 0, "AmIAlive test message", "If you can read this, the webhook works.", Discord.Blue, false, "From", Environment.MachineName, "By", who);
        }
    }
}
