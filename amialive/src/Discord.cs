// Discord webhook: short, rate-limited messages (embeds). Failures are only logged, they never stop the watchdog.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace AmIAliveApp
{
    static class Discord
    {
        public static Settings S;
        static readonly Queue<string> queue = new Queue<string>();
        static Thread worker;
        static volatile bool posting;
        static readonly object gate = new object();
        static readonly Dictionary<string, DateTime> lastByKey = new Dictionary<string, DateTime>();

        public const int Green = 0x4CAF76, Orange = 0xFF6B3D, Red = 0xE0402F, Blue = 0x4FD6E6, Grey = 0x8A8F98, Yellow = 0xF0C24A;

        public static string Esc(string s)
        {
            if (s == null) return "";
            StringBuilder b = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
                        else b.Append(c);
                        break;
                }
            }
            return b.ToString();
        }

        static string Cut(string s, int max)
        {
            if (s == null) return "";
            return s.Length <= max ? s : s.Substring(0, max - 3) + "...";
        }

        // kv = name, value, name, value ...
        public static string BuildJson(string title, string text, int color, bool mention, string[] kv, string name, string mentionText, string host)
        {
            StringBuilder b = new StringBuilder();
            b.Append("{");
            if (!string.IsNullOrEmpty(name)) b.Append("\"username\":\"" + Esc(Cut(name, 80)) + "\",");
            bool ping = mention && !string.IsNullOrEmpty(mentionText);
            b.Append("\"allowed_mentions\":" + (ping ? "{\"parse\":[\"users\",\"roles\"]}" : "{\"parse\":[]}") + ",");
            if (ping) b.Append("\"content\":\"" + Esc(Cut(mentionText, 200)) + "\",");
            b.Append("\"embeds\":[{");
            b.Append("\"title\":\"" + Esc(Cut(title, 250)) + "\",");
            b.Append("\"description\":\"" + Esc(Cut(text, 3800)) + "\",");
            b.Append("\"color\":" + color + ",");
            b.Append("\"timestamp\":\"" + DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") + "\",");
            b.Append("\"footer\":{\"text\":\"" + Esc(Cut(host, 100)) + "\"}");
            if (kv != null && kv.Length >= 2)
            {
                b.Append(",\"fields\":[");
                int n = 0;
                for (int i = 0; i + 1 < kv.Length && n < 24; i += 2, n++)
                {
                    if (n > 0) b.Append(",");
                    b.Append("{\"name\":\"" + Esc(Cut(kv[i], 250)) + "\",\"value\":\"" + Esc(Cut(kv[i + 1], 1000)) + "\",\"inline\":true}");
                }
                b.Append("]");
            }
            b.Append("}]}");
            return b.ToString();
        }

        // key = the same kind of message is sent at most once per minGapSeconds (0 = always)
        public static void Send(string key, int minGapSeconds, string title, string text, int color, bool mention, params string[] kv)
        {
            if (S == null || string.IsNullOrEmpty(S.DiscordUrl)) return;
            try
            {
                lock (gate)
                {
                    DateTime last;
                    if (minGapSeconds > 0 && lastByKey.TryGetValue(key, out last) && (DateTime.Now - last).TotalSeconds < minGapSeconds) return;
                    lastByKey[key] = DateTime.Now;
                    string json = BuildJson(title, text, color, mention, kv, S.DiscordName, S.DiscordMention, Environment.MachineName);
                    while (queue.Count >= 20) queue.Dequeue();
                    queue.Enqueue(json);
                    if (worker == null || !worker.IsAlive)
                    {
                        worker = new Thread(Run);
                        worker.IsBackground = true;
                        worker.Start();
                    }
                    Monitor.PulseAll(gate);
                }
            }
            catch (Exception e) { Log.Write("discord queue failed: " + e.Message); }
        }

        // command line calls end right after sending: wait until the queue is empty (max ms)
        public static void Flush(int ms)
        {
            DateTime until = DateTime.Now.AddMilliseconds(ms);
            while (DateTime.Now < until)
            {
                bool empty;
                lock (gate) { empty = queue.Count == 0; }
                if (empty && !posting) return;
                Thread.Sleep(100);
            }
        }

        static void Run()
        {
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }   // TLS 1.2 (Discord needs it)
            while (true)
            {
                string json = null;
                lock (gate)
                {
                    if (queue.Count == 0) { if (!Monitor.Wait(gate, 20000)) { if (queue.Count == 0) return; } }
                    if (queue.Count > 0) json = queue.Dequeue();
                }
                if (json == null) continue;
                posting = true;
                try { Post(json); } finally { posting = false; }
                Thread.Sleep(1500);
            }
        }

        static void Post(string json)
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(S.DiscordUrl);
                    r.Method = "POST";
                    r.ContentType = "application/json";
                    r.UserAgent = "AmIAlive/1.0 (+server watchdog)";
                    r.Timeout = 10000;
                    r.ServicePoint.Expect100Continue = false;
                    byte[] body = Encoding.UTF8.GetBytes(json);
                    r.ContentLength = body.Length;
                    using (Stream st = r.GetRequestStream()) st.Write(body, 0, body.Length);
                    using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse()) { }
                    return;
                }
                catch (WebException we)
                {
                    HttpWebResponse hr = we.Response as HttpWebResponse;
                    if (hr != null && (int)hr.StatusCode == 429)
                    {
                        double wait = 3;
                        try { double.TryParse(hr.Headers["Retry-After"], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out wait); } catch { }
                        Thread.Sleep((int)(Math.Min(30, Math.Max(1, wait)) * 1000));
                        continue;
                    }
                    Log.Write("discord: " + (hr != null ? ((int)hr.StatusCode).ToString() + " " + hr.StatusDescription : we.Message));
                    return;
                }
                catch (Exception e) { Log.Write("discord: " + e.Message); return; }
            }
        }
    }
}
