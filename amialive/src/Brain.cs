// The watchdog's decisions, without any Windows calls (so "AmIAlive.exe selftest" can check them anywhere).
// Input = what is seen right now, output = what to do. Time is passed in.
using System;
using System.Collections.Generic;

namespace AmIAliveApp
{
    enum Act { None, Start, Trip, Paused }

    class BrainInput
    {
        public DateTime Now;
        public bool Running;        // the server exe exists
        public bool StopMark;       // stopped on purpose / kill switch engaged
        public bool RestartMark;    // a planned restart is running
        public bool OtherStarter;   // somebody else is already starting the server
    }

    class BrainResult
    {
        public Act Action = Act.None;
        public bool CrashDetected;
        public bool CameUp;         // the server process appeared after our start
        public int CrashesInWindow;
        public string Note = "";
    }

    class Brain
    {
        readonly Settings S;
        bool wasRunning;
        bool awaitingUp;
        DateTime graceUntil = DateTime.MinValue;
        DateTime pausedUntil = DateTime.MinValue;
        DateTime lastStart = DateTime.MinValue;
        readonly Queue<DateTime> crashes = new Queue<DateTime>();
        string lastNote = "";

        public int StartsTotal;
        public int CrashesTotal;
        public DateTime LastCrash = DateTime.MinValue;
        public DateTime PausedUntil { get { return pausedUntil; } }

        public Brain(Settings s) { S = s; }

        public int CrashesInWindow(DateTime now)
        {
            while (crashes.Count > 0 && (now - crashes.Peek()).TotalMinutes > S.LoopMinutes) crashes.Dequeue();
            return crashes.Count;
        }

        void RecordCrash(DateTime now, BrainResult r)
        {
            CrashesTotal++;
            LastCrash = now;
            crashes.Enqueue(now);
            r.CrashDetected = true;
            r.CrashesInWindow = CrashesInWindow(now);
        }

        public BrainResult Step(BrainInput i)
        {
            BrainResult r = new BrainResult();
            bool planned = i.StopMark || i.RestartMark;

            // 1. what happened since the last look
            if (wasRunning && !i.Running)
            {
                if (planned) r.Note = "server ended (planned)";
                else RecordCrash(i.Now, r);
            }
            if (!wasRunning && i.Running)
            {
                if (awaitingUp) r.CameUp = true;
                awaitingUp = false;
            }
            // a start that never produced a process counts as a crash too (the start bat dies early)
            if (!i.Running && awaitingUp && i.Now >= graceUntil)
            {
                awaitingUp = false;
                if (!planned) { RecordCrash(i.Now, r); r.Note = "the start did not bring the server up"; }
            }
            wasRunning = i.Running;

            // 2. crash loop?
            if (r.CrashDetected && r.CrashesInWindow >= S.LoopMax)
            {
                crashes.Clear();
                if (S.OnLoop == "pause")
                {
                    pausedUntil = i.Now.AddMinutes(S.PauseMinutes);
                    r.Action = Act.Paused;
                    r.Note = "crash loop: restarts paused for " + S.PauseMinutes + " minutes";
                }
                else
                {
                    r.Action = Act.Trip;
                    r.Note = "crash loop: " + S.LoopMax + " crashes within " + S.LoopMinutes + " minutes - kill switch";
                }
                return r;
            }

            // 3. start?
            if (!i.Running && !planned && i.Now >= graceUntil && i.Now >= pausedUntil)
            {
                if (i.OtherStarter)
                {
                    r.Note = "another starter is already starting the server - waiting";
                }
                else
                {
                    r.Action = Act.Start;
                    graceUntil = i.Now.AddSeconds(S.GraceSeconds);
                    lastStart = i.Now;
                    awaitingUp = true;
                    StartsTotal++;
                }
            }
            return r;
        }

        // for the dashboard / status file
        public string StateText(DateTime now, bool running, bool stopMark, bool restartMark)
        {
            if (running) return "RUNNING";
            if (stopMark) return "HELD (stopped on purpose / kill switch)";
            if (restartMark) return "PLANNED RESTART";
            if (now < pausedUntil) return "PAUSED until " + pausedUntil.ToString("HH:mm:ss");
            if (now < graceUntil) return "STARTING";
            return "DOWN";
        }
    }
}
