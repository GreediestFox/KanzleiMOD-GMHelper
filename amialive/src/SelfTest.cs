// "AmIAlive.exe selftest": checks the decision logic, the settings, the Discord message, the report zip and the formatting - without a server.
// "AmIAlive.exe selftest net" additionally talks to a fake bucket / fake Discord on 127.0.0.1 (needs the right to listen; skipped if not allowed).
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Threading;

namespace AmIAliveApp
{
    static class SelfTest
    {
        static int ok, bad;

        static void Check(string name, bool good, string detail)
        {
            if (good) { ok++; Console.WriteLine("  ok    " + name); }
            else { bad++; Console.WriteLine("  FAIL  " + name + (detail.Length > 0 ? "   (" + detail + ")" : "")); }
        }

        static BrainInput In(DateTime t, bool run, bool stop, bool restart, bool other)
        {
            BrainInput i = new BrainInput();
            i.Now = t; i.Running = run; i.StopMark = stop; i.RestartMark = restart; i.OtherStarter = other;
            return i;
        }

        public static int Run(bool net)
        {
            Console.WriteLine("AmIAlive self test");
            TestSettings();
            TestBrain();
            TestFormat();
            TestDiscordJson();
            TestReportZip();
            if (net) TestNet();
            Console.WriteLine();
            Console.WriteLine(bad == 0 ? "ALL " + ok + " CHECKS PASSED" : bad + " CHECK(S) FAILED, " + ok + " passed");
            return bad == 0 ? 0 : 1;
        }

        static void TestSettings()
        {
            Console.WriteLine("settings");
            Settings s = Settings.Parse("C:\\srv\\", new string[] { "# comment", "process=abc", "grace=77", "onloop=pause", "discord=https://x/y", "loopmax=zz", "nonsense", "report_tailkb=10", "fancy=1" });
            Check("process", s.ProcName == "abc", s.ProcName);
            Check("grace", s.GraceSeconds == 77, s.GraceSeconds.ToString());
            Check("onloop pause", s.OnLoop == "pause", s.OnLoop);
            Check("discord url", s.DiscordUrl == "https://x/y", s.DiscordUrl);
            Check("a bad number keeps the default", s.LoopMax == 5, s.LoopMax.ToString());
            Check("a too small tail is ignored", s.ReportTailKb == 4096, s.ReportTailKb.ToString());
            Check("folder without trailing slash", s.Dir == "C:\\srv", s.Dir);
            Check("fancy", s.Fancy, "");
        }

        static void TestBrain()
        {
            Console.WriteLine("watchdog decisions");
            Settings s = Settings.Parse("C:\\x", new string[] { "loopmax=3", "loopminutes=10", "grace=60" });
            DateTime t = new DateTime(2026, 1, 1, 12, 0, 0);

            // A: down -> start, quiet during the grace time, start again when the start did not bring it up
            Brain b = new Brain(s);
            BrainResult r = b.Step(In(t, false, false, false, false));
            Check("down: start", r.Action == Act.Start, r.Action.ToString());
            r = b.Step(In(t.AddSeconds(5), false, false, false, false));
            Check("inside the grace time: nothing", r.Action == Act.None && !r.CrashDetected, r.Action.ToString());
            r = b.Step(In(t.AddSeconds(70), false, false, false, false));
            Check("the start never came up: counts as a crash and starts again", r.CrashDetected && r.Action == Act.Start, r.CrashDetected + " " + r.Action);

            // B: came up, later died -> crash + start
            b = new Brain(s);
            b.Step(In(t, false, false, false, false));
            r = b.Step(In(t.AddSeconds(10), true, false, false, false));
            Check("process appeared after our start", r.CameUp, "");
            r = b.Step(In(t.AddSeconds(100), false, false, false, false));
            Check("died after the grace time: crash and start", r.CrashDetected && r.Action == Act.Start, r.CrashDetected + " " + r.Action);

            // C: crash loop -> trip on the 3rd crash
            b = new Brain(s);
            DateTime c = t;
            Act last = Act.None;
            int crashesSeen = 0;
            for (int cycle = 0; cycle < 3; cycle++)
            {
                BrainResult a1 = b.Step(In(c, false, false, false, false));
                BrainResult a2 = b.Step(In(c.AddSeconds(5), true, false, false, false));
                BrainResult a3 = b.Step(In(c.AddSeconds(90), false, false, false, false));
                if (a3.CrashDetected) crashesSeen++;
                last = a3.Action;
                if (cycle < 2) Check("crash " + (cycle + 1) + " of 3: restart, no kill switch", a3.Action == Act.Start, a3.Action.ToString());
                c = c.AddSeconds(100);
            }
            Check("3rd crash within 10 minutes: kill switch", last == Act.Trip && crashesSeen == 3, last + " crashes " + crashesSeen);

            // D: planned stop is no crash and no start
            b = new Brain(s);
            b.Step(In(t, true, false, false, false));
            r = b.Step(In(t.AddSeconds(5), false, true, false, false));
            Check("stop mark: not a crash", !r.CrashDetected, "");
            Check("stop mark: no start", r.Action == Act.None, r.Action.ToString());
            r = b.Step(In(t.AddMinutes(30), false, true, false, false));
            Check("stop mark stays respected", r.Action == Act.None, r.Action.ToString());

            // E: planned restart in progress
            b = new Brain(s);
            b.Step(In(t, true, false, false, false));
            r = b.Step(In(t.AddSeconds(5), false, false, true, false));
            Check("restart mark: not a crash, no start", !r.CrashDetected && r.Action == Act.None, "");

            // F: another starter is active -> wait
            b = new Brain(s);
            r = b.Step(In(t, false, false, false, true));
            Check("another starter active: do not start", r.Action == Act.None && r.Note.Length > 0, r.Action + " " + r.Note);
            r = b.Step(In(t.AddSeconds(30), false, false, false, false));
            Check("the other starter is gone: start", r.Action == Act.Start, r.Action.ToString());

            // G: onloop=pause
            Settings sp = Settings.Parse("C:\\x", new string[] { "loopmax=2", "grace=60", "onloop=pause", "pauseminutes=15" });
            b = new Brain(sp);
            c = t;
            BrainResult lastR = null;
            for (int cycle = 0; cycle < 2; cycle++)
            {
                b.Step(In(c, false, false, false, false));
                b.Step(In(c.AddSeconds(5), true, false, false, false));
                lastR = b.Step(In(c.AddSeconds(90), false, false, false, false));
                c = c.AddSeconds(100);
            }
            Check("pause mode: restarts paused", lastR.Action == Act.Paused, lastR.Action.ToString());
            r = b.Step(In(c.AddMinutes(5), false, false, false, false));
            Check("paused: no start after 5 minutes", r.Action == Act.None, r.Action.ToString());
            r = b.Step(In(c.AddMinutes(20), false, false, false, false));
            Check("paused: start after the pause", r.Action == Act.Start, r.Action.ToString());

            // H: old crashes drop out of the window
            b = new Brain(s);
            c = t;
            for (int cycle = 0; cycle < 2; cycle++)
            {
                b.Step(In(c, false, false, false, false));
                b.Step(In(c.AddSeconds(5), true, false, false, false));
                b.Step(In(c.AddSeconds(90), false, false, false, false));
                c = c.AddMinutes(15);
            }
            Check("crashes older than the window do not count", b.CrashesInWindow(c) == 0, b.CrashesInWindow(c).ToString());
        }

        static void TestFormat()
        {
            Console.WriteLine("formatting");
            Check("bar 50 %", Dashboard.Bar(50, 10) == "[#####-----]", Dashboard.Bar(50, 10));
            Check("bar over 100", Dashboard.Bar(250, 4) == "[####]", Dashboard.Bar(250, 4));
            Check("bytes KB", Vitals.Bytes(2048) == "2 KB", Vitals.Bytes(2048));
            Check("bytes GB", Vitals.Bytes(3L * 1024 * 1024 * 1024).EndsWith(" GB") && Vitals.Bytes(3L * 1024 * 1024 * 1024).StartsWith("3"), Vitals.Bytes(3L * 1024 * 1024 * 1024));
            Check("rate", Vitals.Rate(2048) == "2 KB/s", Vitals.Rate(2048));
            Check("span", Vitals.Span(TimeSpan.FromMinutes(75)) == "1h 15m", Vitals.Span(TimeSpan.FromMinutes(75)));
            Check("span days", Vitals.Span(TimeSpan.FromHours(50)) == "2d 2h", Vitals.Span(TimeSpan.FromHours(50)));
        }

        static void TestDiscordJson()
        {
            Console.WriteLine("discord message");
            string j = Discord.BuildJson("T \"x\"", "line1\nline2 \\ end", 255, true, new string[] { "a", "b\tc" }, "Name", "<@1>", "host");
            Check("quotes escaped", j.IndexOf("T \\\"x\\\"") >= 0, j);
            Check("newline escaped", j.IndexOf("line1\\nline2") >= 0, "");
            Check("backslash escaped", j.IndexOf("\\\\ end") >= 0, "");
            Check("mention goes into content", j.IndexOf("\"content\":\"<@1>\"") >= 0, "");
            Check("mention allowed", j.IndexOf("\"parse\":[\"users\",\"roles\"]") >= 0, "");
            Check("field", j.IndexOf("\"fields\":[{\"name\":\"a\",\"value\":\"b\\tc\"") >= 0, "");
            string k = Discord.BuildJson("t", "d", 1, false, null, "", "<@1>", "h");
            Check("no mention when not asked", k.IndexOf("\"content\"") < 0 && k.IndexOf("\"parse\":[]") >= 0, k);
            Check("braces balance", Count(j, '{') == Count(j, '}') && Count(j, '[') == Count(j, ']'), "");
        }

        // a fake crash bucket and a fake Discord webhook on 127.0.0.1
        static void TestNet()
        {
            Console.WriteLine("upload and webhook against a local fake server");
            int port = 20000 + new Random().Next(0, 20000);
            string prefix = "http://127.0.0.1:" + port + "/";
            HttpListener l = new HttpListener();
            try { l.Prefixes.Add(prefix); l.Start(); }
            catch (Exception e) { Console.WriteLine("  skip  (this account may not listen on a local port: " + e.Message + ")"); return; }
            string gotAuth = "", gotHost = "", gotHook = "";
            int gotLen = 0;
            bool gotPk = false;
            Thread th = new Thread(delegate ()
            {
                try
                {
                    while (true)
                    {
                        HttpListenerContext c = l.GetContext();
                        if (c.Request.Url.AbsolutePath == "/up")
                        {
                            gotAuth = c.Request.Headers["Authorization"] ?? "";
                            gotHost = c.Request.Headers["X-Host"] ?? "";
                            MemoryStream ms = new MemoryStream();
                            c.Request.InputStream.CopyTo(ms);
                            byte[] b = ms.ToArray();
                            gotLen = b.Length;
                            gotPk = b.Length > 2 && b[0] == 0x50 && b[1] == 0x4B;
                            byte[] ans = Encoding.UTF8.GetBytes("{\"ok\":true,\"key\":\"crash/test/x.zip\"}");
                            c.Response.ContentType = "application/json";
                            c.Response.OutputStream.Write(ans, 0, ans.Length);
                        }
                        else
                        {
                            StreamReader rd = new StreamReader(c.Request.InputStream, Encoding.UTF8);
                            gotHook = rd.ReadToEnd();
                            c.Response.StatusCode = 204;
                        }
                        c.Response.Close();
                    }
                }
                catch { }
            });
            th.IsBackground = true;
            th.Start();
            Settings old = CrashReport.S;
            Settings oldD = Discord.S;
            string zip = Path.Combine(Path.GetTempPath(), "amialive_selftest_up.zip");
            try
            {
                Settings s = Settings.Parse(Path.GetTempPath(), new string[0]);
                s.ReportUrl = prefix + "up"; s.ReportToken = "tok123"; s.DiscordUrl = prefix + "hook"; s.DiscordName = "T";
                CrashReport.S = s; Discord.S = s;
                using (ZipArchive za = ZipFile.Open(zip, ZipArchiveMode.Create)) { ZipArchiveEntry en = za.CreateEntry("a.txt"); using (StreamWriter w = new StreamWriter(en.Open())) w.Write("x"); }
                string info;
                bool up = CrashReport.Upload(zip, "selftest", out info);
                Check("upload accepted", up, info);
                Check("bucket key returned", info == "crash/test/x.zip", info);
                Check("bearer token sent", gotAuth == "Bearer tok123", gotAuth);
                Check("host header sent", gotHost == Environment.MachineName.Replace(' ', '_') || gotHost.Length > 0, gotHost);
                Check("body is a zip", gotPk && gotLen > 20, gotLen.ToString());
                Discord.Send("selftest", 0, "hello", "world", Discord.Blue, false, "k", "v");
                Discord.Flush(6000);
                Check("webhook message arrived", gotHook.IndexOf("\"title\":\"hello\"") >= 0, gotHook);
            }
            catch (Exception e) { Check("network test ran", false, e.Message); }
            finally
            {
                CrashReport.S = old; Discord.S = oldD;
                try { l.Stop(); } catch { }
                try { File.Delete(zip); } catch { }
            }
        }

        static int Count(string s, char c) { int n = 0; foreach (char x in s) if (x == c) n++; return n; }

        static void TestReportZip()
        {
            Console.WriteLine("crash report zip");
            string root = Path.Combine(Path.GetTempPath(), "amialive_selftest_" + Guid.NewGuid().ToString("N"));
            string oldLog = Log.FilePath;
            Settings oldS = CrashReport.S;
            try
            {
                Directory.CreateDirectory(Path.Combine(root, "logs"));
                File.WriteAllText(Path.Combine(root, "logs", "a.log"), "hello a\r\n");
                StringBuilder big = new StringBuilder();
                for (int i = 0; i < 60000; i++) big.Append("line ").Append(i).Append(" xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r\n");
                File.WriteAllText(Path.Combine(root, "logs", "big.log"), big.ToString());
                string ol = Path.Combine(root, "logs", "old.log");
                File.WriteAllText(ol, "old");
                File.SetLastWriteTime(ol, DateTime.Now.AddDays(-10));
                File.WriteAllText(Path.Combine(root, "logs", "skip.txt"), "not a log");
                Settings s = Settings.Parse(root, new string[0]);
                s.ReportTailKb = 64; s.ReportMaxMb = 1; s.ReportDays = 3;
                CrashReport.S = s;
                Log.FilePath = Path.Combine(root, "AmIAlive.log");
                Log.Write("selftest line");
                int count; long raw;
                string zip = CrashReport.Build("selftest", "summary text", out count, out raw);
                Check("zip file exists", File.Exists(zip), zip);
                List<string> names = new List<string>();
                long bigLen = -1;
                using (ZipArchive za = ZipFile.OpenRead(zip))
                {
                    foreach (ZipArchiveEntry e in za.Entries) { names.Add(e.FullName); if (e.FullName.EndsWith("big.log")) bigLen = e.Length; }
                }
                Check("report.txt inside", names.Contains("report.txt"), string.Join(",", names.ToArray()));
                Check("recent logs inside", names.Contains("logs/logs/a.log") && names.Contains("logs/logs/big.log"), string.Join(",", names.ToArray()));
                Check("old and non-log files left out", !names.Contains("logs/logs/old.log") && !names.Contains("logs/logs/skip.txt"), string.Join(",", names.ToArray()));
                Check("big file cut to its tail", bigLen > 0 && bigLen < 70000, bigLen.ToString());
                try { File.Delete(zip); } catch { }
            }
            catch (Exception e) { Check("report test ran", false, e.Message); }
            finally
            {
                Log.FilePath = oldLog;
                CrashReport.S = oldS;
                try { Directory.Delete(root, true); } catch { }
            }
        }
    }
}
