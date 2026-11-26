// Everything that touches the server process: find it, start it (once), close it, force-kill it (kill switch), find other starters.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Text;
using System.Threading;

namespace AmIAliveApp
{
    static class Srv
    {
        public static Settings S;

        public static Process[] ServerProcs()
        {
            try { return Process.GetProcessesByName(S.ProcName); } catch { return new Process[0]; }
        }

        public static Process[] DbProcs()
        {
            List<Process> l = new List<Process>();
            try { l.AddRange(Process.GetProcessesByName("mariadbd")); } catch { }
            try { l.AddRange(Process.GetProcessesByName("mysqld")); } catch { }
            return l.ToArray();
        }

        // ---- marks (files next to the exe) ----
        public static string StopMarkText()
        {
            try { return File.Exists(S.StopMarkPath) ? File.ReadAllText(S.StopMarkPath).Trim() : null; } catch { return null; }
        }

        public static void WriteStopMark(string text)
        {
            try { File.WriteAllText(S.StopMarkPath, text); } catch (Exception e) { Log.Write("could not write the stop mark: " + e.Message); }
        }

        public static void ClearStopMark()
        {
            try { if (File.Exists(S.StopMarkPath)) File.Delete(S.StopMarkPath); } catch { }
        }

        public static bool RestartInProgress()
        {
            try
            {
                if (!File.Exists(S.RestartMarkPath)) return false;
                // a mark older than 10 minutes is stale (a restart that died half way)
                if ((DateTime.UtcNow - File.GetLastWriteTimeUtc(S.RestartMarkPath)).TotalMinutes > 10)
                {
                    File.Delete(S.RestartMarkPath);
                    Log.Write("stale restart mark removed");
                    return false;
                }
                return true;
            }
            catch { return false; }
        }

        // ---- WMI helpers ----
        class Proc { public int Pid; public string Name; public string Cmd; public DateTime Created; public int Parent; }

        static List<Proc> Query(string cond)
        {
            List<Proc> res = new List<Proc>();
            try
            {
                using (ManagementObjectSearcher s = new ManagementObjectSearcher("SELECT ProcessId, ParentProcessId, Name, CommandLine, CreationDate FROM Win32_Process WHERE " + cond))
                {
                    foreach (ManagementObject o in s.Get())
                    {
                        Proc p = new Proc();
                        p.Pid = Convert.ToInt32(o["ProcessId"]);
                        p.Parent = Convert.ToInt32(o["ParentProcessId"]);
                        p.Name = (o["Name"] as string) ?? "";
                        p.Cmd = (o["CommandLine"] as string) ?? "";
                        try { p.Created = ManagementDateTimeConverter.ToDateTime((string)o["CreationDate"]); } catch { p.Created = DateTime.MinValue; }
                        res.Add(p);
                    }
                }
            }
            catch (Exception e) { Log.Write("process query failed: " + e.Message); }
            return res;
        }

        static bool IsStarterName(string n)
        {
            n = n.ToLowerInvariant();
            return n == "cmd.exe" || n == "powershell.exe" || n == "pwsh.exe" || n == "wscript.exe" || n == "cscript.exe";
        }

        // Is somebody else already starting the server (the start bat, the old scheduled task, a person at the console)?
        // Yes = a starter process of the start bat younger than the grace time, or MariaDB that has only just been started.
        public static bool OtherStarterActive(out string who)
        {
            who = "";
            if (!S.CheckStarters) return false;
            string stem = Path.GetFileNameWithoutExtension(S.BatName);
            foreach (Proc p in Query("Name = 'cmd.exe' OR Name = 'powershell.exe' OR Name = 'pwsh.exe' OR Name = 'wscript.exe' OR Name = 'cscript.exe'"))
            {
                if (!IsStarterName(p.Name)) continue;
                if (p.Cmd.IndexOf(S.BatName, StringComparison.OrdinalIgnoreCase) < 0 && p.Cmd.IndexOf(stem, StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (p.Created == DateTime.MinValue || (DateTime.Now - p.Created).TotalSeconds < S.GraceSeconds)
                {
                    who = p.Name + " " + p.Pid + " (" + (int)(DateTime.Now - p.Created).TotalSeconds + " s old)";
                    return true;
                }
            }
            foreach (Proc p in Query("Name = 'mysqld.exe' OR Name = 'mariadbd.exe'"))
            {
                if (p.Created != DateTime.MinValue && (DateTime.Now - p.Created).TotalSeconds < 45)
                {
                    who = "the database is just starting (" + p.Name + " " + p.Pid + ")";
                    return true;
                }
            }
            return false;
        }

        // ---- start ----
        // true = the start was launched. A named mutex makes sure that two AmIAlive instances (or the planned restart) never start at the same moment.
        public static bool StartServer(string why)
        {
            string bat = Path.Combine(S.Dir, S.BatName);
            if (!File.Exists(bat)) { Log.Write("ERROR: " + bat + " not found - cannot start the server"); return false; }
            Mutex lk = null;
            bool got = false;
            try
            {
                lk = new Mutex(false, "Global\\AmIAlive_Starting_" + S.InstanceKey);
                try { got = lk.WaitOne(0); }
                catch (AbandonedMutexException) { got = true; }
                if (!got) { Log.Write("another start is running right now - not starting a second time"); return false; }
                Log.Write("starting the server (" + why + ")");
                if (S.DryRun) { Log.Write("[dryrun] would run: cmd /c \"" + bat + "\" auto"); return true; }
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\" auto\"");
                psi.WorkingDirectory = S.Dir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
                Thread.Sleep(1500);
                return true;
            }
            catch (Exception e) { Log.Write("start failed: " + e.Message); return false; }
            finally
            {
                if (lk != null)
                {
                    if (got) { try { lk.ReleaseMutex(); } catch { } }
                    lk.Dispose();
                }
            }
        }

        // ---- planned close: ask politely, then end ----
        public static void CloseServer()
        {
            foreach (Process p in ServerProcs())
            {
                Log.Write("closing server process " + p.Id);
                if (S.DryRun) continue;
                try { p.CloseMainWindow(); } catch { }
            }
            if (S.DryRun) return;
            DateTime until = DateTime.Now.AddSeconds(20);
            while (DateTime.Now < until && ServerProcs().Length > 0) Thread.Sleep(500);
            foreach (Process p in ServerProcs())
            {
                Log.Write("server process " + p.Id + " did not close, killing it");
                try { p.Kill(); p.WaitForExit(10000); } catch (Exception e) { Log.Write("kill failed: " + e.Message); }
            }
        }

        // ---- the kill switch: like "End process tree" in the Task Manager ----
        static void KillPid(int pid, string what)
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                Log.Write("force closing " + what + " " + pid);
                if (!S.DryRun) { p.Kill(); p.WaitForExit(8000); }
            }
            catch (ArgumentException) { }   // already gone
            catch (Exception e) { Log.Write("could not end " + what + " " + pid + ": " + e.Message); }
        }

        static void Descendants(int pid, List<int> into, List<Proc> all, int depth)
        {
            if (depth > 6) return;
            foreach (Proc p in all)
            {
                if (p.Parent == pid && p.Pid != pid && !into.Contains(p.Pid))
                {
                    into.Add(p.Pid);
                    Descendants(p.Pid, into, all, depth + 1);
                }
            }
        }

        // Ends the start-bat windows first (so nothing relaunches the server), then the server with everything it started, then crash dialogs.
        // hold = also write the stop mark, so the watchdog leaves the server off until "release". Returns a one-line summary.
        public static string ForceKill(string reason, bool hold)
        {
            if (hold) WriteStopMark("kill: " + reason + " @ " + DateTime.Now.ToString("s"));
            int bats = 0, servers = 0, kids = 0, dialogs = 0, db = 0;
            string stem = Path.GetFileNameWithoutExtension(S.BatName);
            List<Proc> all = Query("ProcessId > 4");
            foreach (Proc p in all)
            {
                if (IsStarterName(p.Name) && (p.Cmd.IndexOf(S.BatName, StringComparison.OrdinalIgnoreCase) >= 0 || p.Cmd.IndexOf(stem, StringComparison.OrdinalIgnoreCase) >= 0)
                    && p.Pid != Process.GetCurrentProcess().Id)
                {
                    KillPid(p.Pid, "start script");
                    bats++;
                }
            }
            foreach (Process sp in ServerProcs())
            {
                List<int> d = new List<int>();
                Descendants(sp.Id, d, all, 0);
                for (int k = d.Count - 1; k >= 0; k--) { KillPid(d[k], "child process"); kids++; }
                KillPid(sp.Id, "server");
                servers++;
            }
            foreach (Proc p in all)
            {
                if (p.Name.Equals("WerFault.exe", StringComparison.OrdinalIgnoreCase) && p.Cmd.IndexOf(S.ProcName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    KillPid(p.Pid, "crash dialog");
                    dialogs++;
                }
            }
            if (S.KillDb)
            {
                foreach (Process p in DbProcs()) { KillPid(p.Id, "database"); db++; }
            }
            return "server " + servers + ", children " + kids + ", start scripts " + bats + ", crash dialogs " + dialogs + (S.KillDb ? ", database " + db : "");
        }

        // close the cmd.exe windows that run the start bat and are older than the grace time (the server itself keeps running)
        public static void CloseBatWindows()
        {
            foreach (Proc p in Query("Name = 'cmd.exe'"))
            {
                if (p.Cmd.IndexOf(S.BatName, StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (p.Created == DateTime.MinValue || (DateTime.Now - p.Created).TotalSeconds < S.GraceSeconds) continue;
                Log.Write("closing the start-bat window (cmd.exe " + p.Pid + ", open for " + (int)(DateTime.Now - p.Created).TotalSeconds + " s)");
                if (S.DryRun) continue;
                try { Process.GetProcessById(p.Pid).Kill(); } catch (Exception e) { Log.Write("could not close it: " + e.Message); }
            }
        }
    }
}
