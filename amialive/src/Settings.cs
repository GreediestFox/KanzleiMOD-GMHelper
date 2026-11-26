// AmIAlive settings: defaults + AmIAlive.ini next to the exe (key=value, # or ; = comment). Nothing secret is stored in code.
using System;
using System.Collections.Generic;
using System.IO;

namespace AmIAliveApp
{
    class Settings
    {
        public string Dir = ".";
        // what to watch and how to start it
        public string ProcName = "ddctd_cm_yo_server";
        public string BatName = "Start_LiF_Server_VPS.bat";
        public int GraceSeconds = 120;       // quiet time after a start
        public int IntervalSeconds = 5;      // how often the watchdog looks
        public bool DryRun = false;
        public bool CheckStarters = true;    // do not start while another starter (bat, task, a person) is already starting the server
        // crash loop
        public int LoopMax = 5;              // this many crashes ...
        public int LoopMinutes = 10;         // ... within this many minutes = crash loop
        public string OnLoop = "hold";       // hold = kill switch (stays off until release), pause = pause restarts for PauseMinutes
        public int PauseMinutes = 15;
        public bool KillDb = false;          // the kill switch also ends MariaDB
        // discord
        public string DiscordUrl = "";
        public string DiscordMention = "";   // e.g. <@123456789012345678>  or  <@&roleid>   (only used for crash loop / kill switch)
        public string DiscordName = "LiF Server";
        public int WarnRamPercent = 93;      // 0 = off
        public int WarnDiskGb = 5;           // 0 = off
        // crash reports
        public string ReportUrl = "";
        public string ReportToken = "";
        public string ReportDirs = ".;logs;data;log";
        public string ReportGlob = "*.log;*.dmp;*.err";
        public int ReportMaxMb = 25;
        public int ReportTailKb = 4096;
        public int ReportDays = 3;           // only files changed in the last days
        public int ReportMinutes = 10;       // at most one automatic report per this many minutes
        // dashboard
        public bool Fancy = false;           // block characters for the graphs (needs a console font that has them)

        public string StopMarkPath { get { return Path.Combine(Dir, "AmIAlive.stopped"); } }
        public string RestartMarkPath { get { return Path.Combine(Dir, "AmIAlive.restart"); } }
        public string StatusPath { get { return Path.Combine(Dir, "AmIAlive.status"); } }
        public string LogPath { get { return Path.Combine(Dir, "AmIAlive.log"); } }
        public string InstanceKey { get { return Dir.Replace('\\', '_').Replace(':', '_').Replace('/', '_'); } }

        public static Settings Load(string dir)
        {
            string[] lines = new string[0];
            string ini = Path.Combine(dir, "AmIAlive.ini");
            try { if (File.Exists(ini)) lines = File.ReadAllLines(ini); } catch { }
            return Parse(dir, lines);
        }

        public static Settings Parse(string dir, string[] lines)
        {
            Settings s = new Settings();
            s.Dir = dir.TrimEnd('\\', '/');
            foreach (string raw in lines)
            {
                string l = raw.Trim();
                if (l.Length == 0 || l.StartsWith("#") || l.StartsWith(";")) continue;
                int i = l.IndexOf('=');
                if (i < 1) continue;
                string k = l.Substring(0, i).Trim().ToLowerInvariant();
                string v = l.Substring(i + 1).Trim();
                int n;
                switch (k)
                {
                    case "process": s.ProcName = v; break;
                    case "bat": s.BatName = v; break;
                    case "grace": if (int.TryParse(v, out n) && n >= 0) s.GraceSeconds = n; break;
                    case "interval": if (int.TryParse(v, out n) && n >= 1) s.IntervalSeconds = n; break;
                    case "dryrun": s.DryRun = v == "1"; break;
                    case "checkstarters": s.CheckStarters = v != "0"; break;
                    case "loopmax": if (int.TryParse(v, out n) && n >= 1) s.LoopMax = n; break;
                    case "loopminutes": if (int.TryParse(v, out n) && n >= 1) s.LoopMinutes = n; break;
                    case "onloop": s.OnLoop = v.ToLowerInvariant() == "pause" ? "pause" : "hold"; break;
                    case "pauseminutes": if (int.TryParse(v, out n) && n >= 1) s.PauseMinutes = n; break;
                    case "kill_db": s.KillDb = v == "1"; break;
                    case "discord": s.DiscordUrl = v; break;
                    case "discord_mention": s.DiscordMention = v; break;
                    case "discord_name": s.DiscordName = v; break;
                    case "warn_ram": if (int.TryParse(v, out n) && n >= 0) s.WarnRamPercent = n; break;
                    case "warn_disk_gb": if (int.TryParse(v, out n) && n >= 0) s.WarnDiskGb = n; break;
                    case "report_url": s.ReportUrl = v; break;
                    case "report_token": s.ReportToken = v; break;
                    case "report_dirs": s.ReportDirs = v; break;
                    case "report_glob": s.ReportGlob = v; break;
                    case "report_maxmb": if (int.TryParse(v, out n) && n >= 1) s.ReportMaxMb = n; break;
                    case "report_tailkb": if (int.TryParse(v, out n) && n >= 64) s.ReportTailKb = n; break;
                    case "report_days": if (int.TryParse(v, out n) && n >= 1) s.ReportDays = n; break;
                    case "report_minutes": if (int.TryParse(v, out n) && n >= 1) s.ReportMinutes = n; break;
                    case "fancy": s.Fancy = v == "1"; break;
                }
            }
            return s;
        }
    }
}
