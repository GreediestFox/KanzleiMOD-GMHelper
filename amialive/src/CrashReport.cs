// Crash report: zips the newest log files of the server folder (tails of big files, files in use are read shared) with a short summary
// and uploads the zip to the crash bucket (a Cloudflare Worker in front of an R2 bucket that deletes everything after 30 days).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace AmIAliveApp
{
    static class CrashReport
    {
        public static Settings S;
        static DateTime lastReport = DateTime.MinValue;
        static readonly object gate = new object();
        static bool running;
        static Thread current;
        public static string LastResult = "";
        public static DateTime LastAt = DateTime.MinValue;

        class Item { public string Path; public DateTime Written; public long Size; }

        static List<Item> FindFiles()
        {
            List<Item> found = new List<Item>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string[] dirs = S.ReportDirs.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            string[] globs = S.ReportGlob.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            DateTime oldest = DateTime.Now.AddDays(-S.ReportDays);
            foreach (string d0 in dirs)
            {
                string d = d0.Trim();
                string full = Path.IsPathRooted(d) ? d : Path.GetFullPath(Path.Combine(S.Dir, d));
                if (!Directory.Exists(full)) continue;
                foreach (string g in globs)
                {
                    string[] files;
                    try { files = Directory.GetFiles(full, g.Trim(), SearchOption.TopDirectoryOnly); } catch { continue; }
                    foreach (string f in files)
                    {
                        string key = Path.GetFullPath(f);
                        if (!seen.Add(key)) continue;
                        try
                        {
                            FileInfo fi = new FileInfo(key);
                            if (fi.LastWriteTime < oldest) continue;
                            Item it = new Item();
                            it.Path = key; it.Written = fi.LastWriteTime; it.Size = fi.Length;
                            found.Add(it);
                        }
                        catch { }
                    }
                }
            }
            found.Sort(delegate (Item a, Item b) { return b.Written.CompareTo(a.Written); });
            return found;
        }

        static void CopyTail(string path, long maxBytes, Stream to)
        {
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (fs.Length > maxBytes)
                {
                    fs.Seek(-maxBytes, SeekOrigin.End);
                    byte[] note = Encoding.UTF8.GetBytes("[... only the last " + (maxBytes / 1024) + " KB of this file ...]\r\n");
                    to.Write(note, 0, note.Length);
                }
                byte[] buf = new byte[65536];
                int n;
                while ((n = fs.Read(buf, 0, buf.Length)) > 0) to.Write(buf, 0, n);
            }
        }

        // returns the path of the zip (in the temp folder) or null
        public static string Build(string reason, string summary, out int fileCount, out long rawBytes)
        {
            fileCount = 0; rawBytes = 0;
            string zip = Path.Combine(Path.GetTempPath(), "AmIAlive_report_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".zip");
            long budget = (long)S.ReportMaxMb * 1024 * 1024;
            long tail = (long)S.ReportTailKb * 1024;
            using (FileStream fs = new FileStream(zip, FileMode.Create))
            using (ZipArchive za = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                ZipArchiveEntry e0 = za.CreateEntry("report.txt", CompressionLevel.Optimal);
                using (StreamWriter w = new StreamWriter(e0.Open(), Encoding.UTF8))
                {
                    w.WriteLine("AmIAlive crash report");
                    w.WriteLine("host:    " + Environment.MachineName);
                    w.WriteLine("time:    " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " (local), " + DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss") + " UTC");
                    w.WriteLine("reason:  " + reason);
                    w.WriteLine("folder:  " + S.Dir);
                    w.WriteLine();
                    w.WriteLine(summary);
                    w.WriteLine();
                    w.WriteLine("---- last lines of AmIAlive.log ----");
                    foreach (string l in Log.Tail(60)) w.WriteLine(l);
                }
                foreach (Item it in FindFiles())
                {
                    long take = Math.Min(it.Size, tail);
                    if (rawBytes + take > budget && fileCount > 0) continue;
                    try
                    {
                        string rel = it.Path.StartsWith(S.Dir, StringComparison.OrdinalIgnoreCase) ? it.Path.Substring(S.Dir.Length).TrimStart('\\', '/') : Path.GetFileName(it.Path);
                        ZipArchiveEntry en = za.CreateEntry("logs/" + rel.Replace('\\', '/'), CompressionLevel.Optimal);
                        using (Stream o = en.Open()) CopyTail(it.Path, tail, o);
                        fileCount++;
                        rawBytes += take;
                    }
                    catch (Exception e) { Log.Write("report: could not add " + it.Path + ": " + e.Message); }
                }
            }
            return zip;
        }

        static string Clean(string s)
        {
            StringBuilder b = new StringBuilder();
            foreach (char c in s ?? "") b.Append(c < 32 || c > 126 ? '_' : c);
            return b.ToString();
        }

        // true = uploaded; info = the key the bucket gave, or the error
        public static bool Upload(string zip, string reason, out string info)
        {
            info = "";
            if (string.IsNullOrEmpty(S.ReportUrl)) { info = "report_url is not set in AmIAlive.ini"; return false; }
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    FileInfo fi = new FileInfo(zip);
                    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(S.ReportUrl);
                    r.Method = "PUT";
                    r.ContentType = "application/zip";
                    r.UserAgent = "AmIAlive/1.0";
                    r.Timeout = 120000;
                    r.ReadWriteTimeout = 120000;
                    r.ContentLength = fi.Length;
                    r.AllowWriteStreamBuffering = false;
                    r.ServicePoint.Expect100Continue = false;
                    if (!string.IsNullOrEmpty(S.ReportToken)) r.Headers["Authorization"] = "Bearer " + S.ReportToken;
                    r.Headers["X-Host"] = Clean(Environment.MachineName);
                    r.Headers["X-Reason"] = Clean(reason);
                    r.Headers["X-Version"] = "1";
                    using (FileStream src = new FileStream(zip, FileMode.Open, FileAccess.Read))
                    using (Stream dst = r.GetRequestStream())
                    {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = src.Read(buf, 0, buf.Length)) > 0) dst.Write(buf, 0, n);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
                    using (StreamReader rd = new StreamReader(resp.GetResponseStream()))
                    {
                        string body = rd.ReadToEnd();
                        Match m = Regex.Match(body, "\"key\"\\s*:\\s*\"([^\"]+)\"");
                        info = m.Success ? m.Groups[1].Value : body;
                        return true;
                    }
                }
                catch (WebException we)
                {
                    HttpWebResponse hr = we.Response as HttpWebResponse;
                    info = hr != null ? ((int)hr.StatusCode) + " " + hr.StatusDescription : we.Message;
                    if (hr != null && (int)hr.StatusCode >= 400 && (int)hr.StatusCode < 500 && (int)hr.StatusCode != 429) return false;   // wrong token / too big: retrying does not help
                }
                catch (Exception e) { info = e.Message; }
                Thread.Sleep(attempt * 3000);
            }
            return false;
        }

        // Collect + upload in the background. force = ignore the "one report per N minutes" limit.
        public static void RunAsync(string reason, string summary, int delaySeconds, bool force)
        {
            lock (gate)
            {
                if (running) { Log.Write("a crash report is already being made"); return; }
                if (!force && (DateTime.Now - lastReport).TotalMinutes < S.ReportMinutes) { Log.Write("crash report skipped (the last one is younger than " + S.ReportMinutes + " minutes)"); return; }
                running = true;
                lastReport = DateTime.Now;
            }
            Thread t = new Thread(delegate ()
            {
                try
                {
                    if (delaySeconds > 0) Thread.Sleep(delaySeconds * 1000);   // give the server time to write its last lines / crash dump
                    int count; long raw;
                    string zip = Build(reason, summary, out count, out raw);
                    long size = new FileInfo(zip).Length;
                    Log.Write("crash report built: " + count + " file(s), " + Vitals.Bytes(raw) + " -> " + Vitals.Bytes(size));
                    string info;
                    bool ok = Upload(zip, reason, out info);
                    LastAt = DateTime.Now;
                    if (ok)
                    {
                        LastResult = "uploaded " + info;
                        Log.Write("crash report uploaded: " + info);
                        Discord.Send("report", 0, "Crash report uploaded", "Reason: " + reason, Discord.Blue, false, "Bucket key", info, "Files", count.ToString(), "Size", Vitals.Bytes(size));
                        try { File.Delete(zip); } catch { }
                    }
                    else
                    {
                        LastResult = "FAILED: " + info;
                        string keep = Path.Combine(S.Dir, "AmIAlive_reports");
                        try { Directory.CreateDirectory(keep); File.Move(zip, Path.Combine(keep, Path.GetFileName(zip))); } catch { }
                        Log.Write("crash report NOT uploaded (" + info + "); the zip is kept in AmIAlive_reports");
                        Discord.Send("reportfail", 600, "Crash report could not be uploaded", info, Discord.Yellow, false);
                    }
                    PruneKept();
                }
                catch (Exception e) { LastResult = "FAILED: " + e.Message; Log.Write("crash report failed: " + e.Message); }
                finally { lock (gate) { running = false; } }
            });
            t.IsBackground = true;
            current = t;
            t.Start();
        }

        // command line calls: wait for the background report (max ms)
        public static void WaitDone(int ms)
        {
            Thread t = current;
            if (t != null) t.Join(ms);
        }

        // kept (not uploaded) reports: at most 5, none older than 7 days
        static void PruneKept()
        {
            try
            {
                string keep = Path.Combine(S.Dir, "AmIAlive_reports");
                if (!Directory.Exists(keep)) return;
                List<FileInfo> l = new List<FileInfo>(new DirectoryInfo(keep).GetFiles("*.zip"));
                l.Sort(delegate (FileInfo a, FileInfo b) { return b.LastWriteTime.CompareTo(a.LastWriteTime); });
                for (int i = 0; i < l.Count; i++) if (i >= 5 || l[i].LastWriteTime < DateTime.Now.AddDays(-7)) { try { l[i].Delete(); } catch { } }
            }
            catch { }
        }
    }
}
