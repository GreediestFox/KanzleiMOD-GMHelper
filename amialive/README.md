# AmIAlive – server watchdog with a live screen

One exe for the LiF dedicated server (`ddctd_cm_yo_server.exe`), in the server folder:

* **Live screen** (foreground): CPU, RAM, network and disk of the machine like the Task Manager, plus CPU / RAM / threads / handles of the **server** and of **MariaDB**, the watchdog state, crash counters, the last log lines.
* **Watchdog**: starts the server when it is not running – **and nobody else is starting it** (see below).
* **Crash reports**: when the server dies, the newest logs of the server folder are zipped and uploaded to a bucket that keeps them **30 days**.
* **Kill switch**: force closes the server (like *End process tree* in the Task Manager) and holds it off. Trips **by itself in a crash loop**.
* **Discord webhook**: crash, restart, back up, crash loop, kill switch, planned restarts, RAM / disk warnings, crash report uploaded.

It extends the older `tools/amialive` of the GreedyModCollection repo (same marks and commands, same scheduled task idea).

## Build and first test (Windows, no Visual Studio needed)
```
Build.bat                         builds AmIAlive.exe with the csc.exe that ships with Windows (.NET Framework 4.x)
AmIAlive.exe selftest             checks the decision logic, settings, Discord message, report zip (about 40 checks)
AmIAlive.exe selftest net         the same plus an upload and a webhook against a fake server on 127.0.0.1
powershell -ExecutionPolicy Bypass -File Test_AmIAlive.ps1      stand-in test: "ping" plays the server, nothing real is touched
```
The sources could not be compiled where they were written (no compiler there): `Build.bat` is the first real compile. If it prints errors, send them.

## Install (once, as Administrator, in the server folder)
1. Copy `AmIAlive.exe`, `AmIAlive.example.ini` → `AmIAlive.ini` (edit), `Install_AmIAlive.ps1` into the server folder.
2. `powershell -ExecutionPolicy Bypass -File Install_AmIAlive.ps1` – creates the boot task (SYSTEM, no window; replaces the old "LiF Server" task) and a desktop shortcut.
3. To look at it: double click the shortcut or run `AmIAlive.exe`. **The first AmIAlive in a folder is the watchdog, every later one is a viewer** of the same screen, so you can open and close the screen as often as you like without stopping the watchdog. (Run it as Administrator for the full numbers of the server process.)

## The screen
```
 AmIAlive  VPS1   [watchdog owner]   2026-11-26 14:03:22
 ------------------------------------------------------------
 SERVER    RUNNING   pid 4120   up 3h 12m
   process CPU  38 % [########------------]  RAM 3.1 GB (private 3.4 GB)  threads 88  handles 1200
 DATABASE  CPU   2 %   RAM 1.1 GB   threads 31
 SYSTEM    CPU  52 % [##########----------]  .:-=+*#%@...
           RAM  61 % [############--------]  9.8 GB / 16.0 GB
           NET  down 120 KB/s   up 340 KB/s
           DISK C:\  120 GB free of 500 GB
 WATCHDOG  starts 3   crashes 1   last 1 / 5 in 10 min   last crash 13:41:07
 REPORT    uploaded crash/2026/11/26/VPS1_20261126T124107Z_a1b2c3.zip
 DISCORD   on
 [K] KILL SWITCH  [R] restart  [T] stop  [S] release/start  [U] crash report  [D] discord test  [Q] quit
```
`K`, `R`, `T` ask first (`Y` to confirm). Everything is also available on the command line: `AmIAlive.exe status | restart | stop | release | kill | report | discord`.

## "Start it, but only if nobody else is starting it"
Before every start the watchdog checks, in this order, and waits if any of it is true:
1. a **stop / kill mark** exists (`AmIAlive.stopped`) or a **planned restart** is running (`AmIAlive.restart`),
2. another **starter is active**: a `cmd.exe` / `powershell.exe` / script that runs the start bat (any `Start_LiF_Server*`) and is younger than the grace time – the old scheduled task, a person at the console, the other AmIAlive command –, or **MariaDB was started less than 45 s ago**,
3. a **start lock** (named mutex) is held by another AmIAlive that is starting right now,
4. the grace time after the last start has not run out.
Only then it starts the server. `checkstarters=0` switches check 2 off.

## Crash loop and kill switch
* A **crash** = the server process vanished without a stop / restart mark, or a start did not bring it up within the grace time.
* `loopmax` crashes within `loopminutes` (default 5 in 10) = **crash loop**. With `onloop=hold` (default) the **kill switch trips**: the start-script windows, the server **and everything it started** are force closed, crash dialogs (WerFault) are closed, the stop mark is written – **nothing restarts it until you release it** (`AmIAlive.exe release` or key `S`). A Discord message pings `discord_mention`, a crash report is sent. With `onloop=pause` it only pauses for `pauseminutes` and tries again.
* **Manual kill switch**: key `K` or `AmIAlive.exe kill` – the same action. MariaDB is left alone unless `kill_db=1`.

## Crash reports and the 30 day bucket
* Sent on every crash (10 s after it, so the crash dump is written), on a crash loop, on key `U` / `AmIAlive.exe report`. At most one automatic report per `report_minutes`.
* Content: `report.txt` (host, time, reason, last vitals, counters, last lines of `AmIAlive.log`) and the newest files matching `report_glob` in `report_dirs` (default `.;logs;data;log` relative to the server folder, changed in the last `report_days`), big files cut to their last `report_tailkb` KB, all together at most `report_maxmb` MB. Files in use are read without locking them. **Logs can contain player names, Steam IDs and IPs – the bucket is private.**
* Upload goes to a small Worker (`crash-bucket/`) in front of an R2 bucket. The server only holds an **upload token** (it can add reports, nothing more); the R2 keys never leave Cloudflare. If the upload fails the zip stays in `AmIAlive_reports\` (max 5, max 7 days) and Discord says so.
* **Retention: 30 days** – a lifecycle rule on the bucket, plus a daily cron in the Worker as a second guard. Setup is in `crash-bucket/README.md`.

## Settings
`AmIAlive.ini` next to the exe, all keys with comments in `AmIAlive.example.ini`. It holds secrets (webhook, upload token) and is in `.gitignore`.

## Known limits
* Windows only (Task Manager numbers come from the Windows performance counters and WMI).
* Network is the machine's total (all adapters except loopback), not the server process alone – Windows has no cheap per-process network counter.
* `Environment.UserInteractive` decides between screen and no screen: started by the task at boot it runs without a window; started by a person it shows the screen.
* Not compiled / run on Windows yet by the author of this code – see "Build and first test".
