# Install and test plan

Order matters: nothing goes to the R2 bucket or any live server until step 6 passes. Work on the test copy (the ZIP / staging folder) first.

## 1. Relay (Cloudflare) – once
```bash
cd relay && npm install
npx wrangler d1 create kanzlei-gm          # copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply kanzlei-gm --remote
npx wrangler deploy                         # creates gm.wulpischelande.de (custom_domain route)
```
Cloudflare dashboard for that hostname: **"Always Use HTTPS" must not redirect `/g/*`** (the game's downloader cannot do TLS). Use a Configuration Rule / exception for the path `/g/*` and `/api/echo`, or switch the setting off for this subdomain. Otherwise the game gets a redirect instead of an answer.

## 2. Server
1. Stop using `mods/LiFx/GMCommands`; put `server/mods/LiFx/KanzleiCore/` in its place (VPS layout: `scripts/lifmod/gm/`, same files).
2. Copy your real Steam IDs into `steamids.cs` (the repo copy is empty on purpose, keep the live file out of git).
3. Start the server; the log must show `[GM] data loaded: registry 62 commands ...`.

## 3. Client
1. Copy `client/mod/KanzleiMOD/` to the client's `mod/KanzleiMOD/`.
2. In `art/materials.cs` replace `exec("mod/GMHelper/gm.cs");` by `exec("mod/KanzleiMOD/kanzlei.cs");`.
3. If the website address differs, create `mod/KanzleiMOD/kanzlei_config.cs` with `$KZ::pageHost = "..."; $KZ::gameHost = "...";`.
4. Delete stale `*.dso` of the changed scripts.

## 4. Probe (first thing in the game)
Console (`~`): `KZProbe();` – it prints what could not be tested outside the game: `openWeb`, the downloader, byte handling (umlauts), the longest URL the engine accepts, the browser's features (page `probe.html`). Send the output back. If the URL limit is below ~600, lower `$KZ::chunk`.

## 5. Test sequence (in game, as a registered GM)
1. F6 → a browser window "Kanzlei GM" opens, header shows "Spiel verbunden".
2. Wait for the first catalog upload (log line `[Kanzlei] sending catalog in N parts`); the *Alle* tab fills. Second start is instant (cached by hash).
3. Star something, restart the window: favourites are back.
4. Give an item to yourself; green **Erledigt** appears; check the inventory. Then to another player.
5. GOD on → gold "GM GOD" on screen and in the header; GOD off → gone. (The game's `/INVUL` is a toggle: if the overlay and the real state ever disagree, press OFF twice.)
6. A non-GM account presses F6 → refused. A forged command with a valid session but a non-GM account does nothing (the server checks the Steam ID).
7. Ctrl+F6 still opens the old panel.

## 6. Only then
Copy the proven files to the staging folder / `AP Fixes` and decide about the R2 upload. Item icons are read from the client's own `art/2D` folder; nothing of the game's art is hosted. Staging steps for `G:` are in `docs/STAGING_G.md`.
