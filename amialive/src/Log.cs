// One log file (AmIAlive.log, rolled at 1 MB) and the last lines of it for the dashboard.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace AmIAliveApp
{
    static class Log
    {
        public static string FilePath = "AmIAlive.log";
        public static bool Echo = true;      // print to the console as well (switched off while the dashboard owns the screen)
        static readonly object Gate = new object();

        public static void Write(string msg)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg;
            lock (Gate)
            {
                if (Echo) { try { Console.WriteLine(line); } catch { } }
                try
                {
                    if (File.Exists(FilePath) && new FileInfo(FilePath).Length > 1000000)
                    {
                        string old = FilePath + ".old";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(FilePath, old);
                    }
                    File.AppendAllText(FilePath, line + Environment.NewLine);
                }
                catch { }
            }
        }

        // the last n lines (the file may be written by another AmIAlive at the same time)
        public static string[] Tail(int n)
        {
            try
            {
                using (FileStream fs = new FileStream(FilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    long take = Math.Min(fs.Length, 32768);
                    fs.Seek(-take, SeekOrigin.End);
                    byte[] buf = new byte[take];
                    int got = fs.Read(buf, 0, buf.Length);
                    string text = Encoding.UTF8.GetString(buf, 0, got);
                    string[] all = text.Split(new char[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    List<string> res = new List<string>();
                    for (int i = Math.Max(0, all.Length - n); i < all.Length; i++) res.Add(all[i].TrimEnd('\r'));
                    return res.ToArray();
                }
            }
            catch { return new string[0]; }
        }
    }
}
