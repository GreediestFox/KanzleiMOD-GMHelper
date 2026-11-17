KanzleiMOD @VERSION@ - local test run
=====================================

What this is: the new GM tool (web window on F6) running completely on your own PC against your local server. Nothing goes to the internet, to R2 or to a live server.
Your Steam IDs are already in the server files of this package (taken from the server zip you gave me). Do not upload this package anywhere.

BEFORE YOU START (backup, as always)
  Copy these to E:\ClaudeScratch\purge\ first (keep the folder names), do not delete them:
   - the client's  mod\GMHelper  (old panel)
   - the server's  mods\LiFx\GMCommands  (or on the VPS layout  scripts\lifmod\gm\gm_commands.cs)
   - art\materials.cs (the client file you are about to change one line in)
  Nothing here may overwrite Daniel's files. If a file you are about to replace is his, stop and ask.

1. RELAY (the connector between game and web page)
   Needs Node.js. Double-click Start_Relay.bat and leave the window open.
   Check: a browser on  http://127.0.0.1:8787/?demo=1  shows the new UI with demo data.

2. SERVER  (pick the layout that your server uses)
   A) with the LiFx framework:  copy  server_LiFx\mods\LiFx\KanzleiCore  to  <server>\mods\LiFx\KanzleiCore
      and remove (move to purge) <server>\mods\LiFx\GMCommands - never run both.
   B) VPS layout (scripts\lifmod):  copy  server_VPS\scripts\lifmod\gm  over  <server>\scripts\lifmod\gm
      (the old gm_commands.cs goes to purge first; keep your own steamids.cs if you changed it since).
   Start the server. In its log you must see:  [GM] data loaded: registry 62 commands ...

3. CLIENT
   Copy  client\mod\KanzleiMOD  to  <client>\mod\KanzleiMOD
   In <client>\art\materials.cs replace the line   exec("mod/GMHelper/gm.cs");
   by   exec("mod/KanzleiMOD/kanzlei.cs");      (change only this line; delete stale *.dso of changed scripts)
   The file mod\KanzleiMOD\kanzlei_config.cs already points to the local relay.

4. TEST (in this order, tell me what happens at each step)
   a) In the game console (~):   KZProbe();        -> copy ALL lines starting with [KZProbe] to me, plus a screenshot of the page that opens.
   b) Press F6. A browser window "Kanzlei GM" opens; the header must say "Spiel verbunden".
   c) The tab "Alle" fills (first start: the item list is sent in many small parts, give it up to a minute; the log line is [Kanzlei] sending catalog).
   d) Give yourself an item at quality 100 and at quality 50: green "Erledigt", item in the inventory. The dialog shows the calculated durability; look at the server log line "[GM] durability ..." and compare with a crafted item of the same type (SQL in docs/STATUS.md).
   e) Give an item to another online player.
   f) GOD on: gold "GM GOD" on the game screen and in the page header. GOD off: gone.
   g) Star three things, reorder them in "Favoriten", close the window, press F6 again: still there.
   h) Button "Farben": try the three colour schemes.
   h2) Tab "Wirtschaft": press "Snapshot jetzt" - KPIs, three charts, the history table and the price calculator appear (needs coins in the world for a baseline). Switch the colour scheme: the charts follow it.
   h3) Wirtschaft: "+ Gegenstand beobachten", search an item (icons), pick it: a card appears. After a minute the first snapshot exists. Press the arrow button on a second tracked item for the split view. Open "Rechner", drag it around. Leave the tab for 20 s, come back: the old values show at once, then refresh. The status line shows "Auto 15 s".
   h4) The window itself: can you drag the "Kanzlei GM" window by its title bar, resize it, and still walk / click in the game next to it? Run KZProbe() while it is open and send the "[KZProbe] web window" line.
   i) Place a building or object, spawn an animal, change the weather.
   j) A non-GM account must not get anything. Ctrl+F6 still opens the old panel.

IF SOMETHING GOES WRONG
   - F6 does nothing: console ~ shows [Kanzlei] lines; send them. Ctrl+F6 (old panel) still works.
   - Window opens but stays empty / "Warte auf das Spiel": the relay window is not running, or the game cannot reach 127.0.0.1:8787.
   - To go back: put the purged files back (materials.cs line, GMCommands) and delete mod\KanzleiMOD.

WHAT I NEED BACK: the [KZProbe] lines, the result of each step a) - j), and the first 30 lines of the server log after the start.
