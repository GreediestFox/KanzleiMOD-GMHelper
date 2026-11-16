# Instruction: put KanzleiMOD into the staging folder (G:)

This file only **describes** what to do. Nothing is copied or uploaded by the repo. The staging folder on `G:` is the place where the upload to the R2 bucket is prepared; the R2 upload itself happens **only after** every point of "Gate" below passed in the game.

Rules that apply (from the working agreement):
- The repo copy is the base template, the ZIP copy is for testing.
- Nothing may overwrite earlier work of Daniel. If a file you are about to replace is Daniel's (or you are not sure), stop and ask first.
- Everything that is replaced, no longer used or no longer shipped goes to `E:\ClaudeScratch\purge\` (keep the relative folder names), never deleted.
- Fixes that proved themselves are copied to `C:\Users\MJZej\OneDrive\Desktop\Daniel\AP Fixes` **only after your approval**.
- Fixes and new files live in their own folder, not loose in the main directory.

## 0. Before copying
1. `git pull` branch `kanzleimod-rework` of KanzleiMOD-GMHelper (or download it as ZIP).
2. In the repo folder: `python tools/kz_sync.py` – must print `OK`.
3. Make sure the live `steamids.cs` is **not** taken from the repo (the repo copy is empty on purpose). Keep your own file.

## 1. Client files (staging root = the folder that mirrors the game's client folder)
| From the repo | To (inside the staging client tree) | Note |
|---|---|---|
| `client/mod/KanzleiMOD/` (everything) | `mod/KanzleiMOD/` | new folder |
| – | `art/materials.cs` | replace the line `exec("mod/GMHelper/gm.cs");` by `exec("mod/KanzleiMOD/kanzlei.cs");`. This file is shared with other mods: change only that line. |
| old `mod/GMHelper/` | `E:\ClaudeScratch\purge\mod\GMHelper\` | move it there; the old panel now lives in `mod/KanzleiMOD/legacy/` |
| any `*.dso` next to changed scripts | purge | stale compiled scripts win over the `.cs` |

Optional file `mod/KanzleiMOD/kanzlei_config.cs` only if the website address differs from `gm.wulpischelande.de`. The cache folder `mod/KanzleiMOD/cache/` is created by the game; do not ship it.

Icons need nothing extra: the page reads them from the client's own `art/2D` folder.

## 2. Server files
| From the repo | To (staging server tree) | Note |
|---|---|---|
| `server/mods/LiFx/KanzleiCore/` | `mods/LiFx/KanzleiCore/` (VPS layout: `scripts/lifmod/gm/`) | `steamids.cs`: keep the live one |
| old `mods/LiFx/GMCommands/` | `E:\ClaudeScratch\purge\mods\LiFx\GMCommands\` | KanzleiCore replaces it; never run both |
| VPS only: `scripts/lifmod/gm/gm_commands.cs` | purge, then name the new file the same, or change the exec in `lifmod_init.cs` | ask before touching `lifmod_init.cs` |

Mods that call `LiFxGMCommands::getPlayer` (for example LayDown) keep working, the function names are unchanged.

## 3. Relay (website side, once)
Follow `docs/INSTALL.md` section 1 (`wrangler d1 create`, migrations, `wrangler deploy`) and the Cloudflare exception so `/g/*` and `/api/echo` stay reachable over plain http.

## 4. Gate – all must pass in the game on the TEST copy before anything goes to R2
1. `KZProbe();` in the console: send the printed lines. Wanted: openWeb yes, downloader yes, URL limit >= 600 (otherwise lower `$KZ::chunk`), umlaut test ok, icon test (file://) ok.
2. F6 opens the window, header "Spiel verbunden", the *Alle* tab fills.
3. Give an item to yourself and to another player at quality 50 and 100: green "Erledigt", item really in the inventory, the reply names the durability used and where it came from, and the value matches a crafted item of that quality (compare in the database).
4. GOD on / off: "GM GOD" on screen and in the header appears and disappears.
5. Favourites: pin, reorder, close and reopen: still there.
6. A non-GM account cannot do anything.
7. Ctrl+F6 still opens the old panel.

## 5. After the gate
Tell me the results. With your approval I put the proven files into `AP Fixes`; the R2 upload is a separate decision of yours.
