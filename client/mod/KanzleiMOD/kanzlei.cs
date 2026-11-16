// KanzleiMOD client loader.  Add ONE line at the end of art/materials.cs:   exec("mod/KanzleiMOD/kanzlei.cs");
// (and remove the old exec("mod/GMHelper/gm.cs") line; the old panel lives on as Ctrl+F6, see legacy/).
//
//   Brain  (brain.cs)  preloads game data: items / buildings / objects from data\objects_types.xml, names from data\loc\<language>\data\objects_types_Name.xml
//   Core   (core.cs)   talks to the server GM mod and to the relay; runs the commands the web UI sends; keeps favourites
//   Eyes   (web)       the UI, opened with the game's own browser window (openWeb) from the relay's address
//
// F6 = open / close the GM window (needs a Steam ID registered on the server).  Ctrl+F6 = the old native panel (fallback while the web UI is new).
$KZ::version = "0.1.0";
$KZ::dir = "mod/KanzleiMOD";

// ---- settings (override them in mod/KanzleiMOD/kanzlei_config.cs, which is never overwritten by updates) ----
$KZ::pageHost = "https://gm.wulpischelande.de";   // the web UI, opened in the game's browser window (https works there)
$KZ::gameHost = "http://gm.wulpischelande.de";    // the same server for the game's own downloads: the engine downloader has NO TLS, plain http only
$KZ::chunk = 330;                                 // characters of data per upload request (the engine's URL length limit is unknown: see probe.cs)
$KZ::iconBase = "";                                // "" = the game folder's art/2D as file:/// (automatic); "none" = no icons; or any address ending in /
$KZ::pollMs = 1000;                               // how often the game asks the relay for commands while the window is open
$KZ::godText = "<just:center><font:Arial:15><color:ffd860>GM<font:Arial Bold:30><color:ffe890> GOD";
if (isFile($KZ::dir @ "/kanzlei_config.cs")) {
   exec($KZ::dir @ "/kanzlei_config.cs");
}

exec($KZ::dir @ "/brain.cs");
exec($KZ::dir @ "/core.cs");
exec($KZ::dir @ "/probe.cs");

GlobalActionMap.bindCmd(keyboard, "f6", "KZ_toggle();", "");
GlobalActionMap.bindCmd(keyboard, "ctrl f6", "KZ_legacy();", "");
echo("[Kanzlei] KanzleiMOD client" SPC $KZ::version SPC "loaded. F6 = GM window, Ctrl+F6 = old panel");
