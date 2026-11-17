# Status – what is proven and what is not

Written 2026-11-16, first commit of the rework.

## Tested here (no game available)
| Area | How | Result |
|---|---|---|
| Relay protocol (sessions, keys, queue, chunked + out-of-order blobs, shared catalog, isolation) | `tools/e2e_protocol.mjs` against `wrangler dev --local` | 22 / 22 pass |
| Eyes UI: search, ranking, results window + paging, favourites drag and drop, forms, item dialog, GOD badge, German / English | Playwright (Chromium) in demo mode and against the relay with `mock_game.mjs` | works, no JS errors |
| `shared/*.kz` validation + distribution | `tools/kz_sync.py` | 62 commands, 18 animals, 3 ground materials |
| TorqueScript files | `tools/lint_cs.py`: brackets, strings, undefined functions | clean – this is **not** a compile |

## NOT tested – needs the real client / server
Everything in `.cs` has never run. Known unknowns, in the order they can hurt:
1. **`openWeb`** opens the page and is allowed to load a fresh https page (the Skriptorium proves `openWeb(url)` works, not our page).
2. **How old the embedded browser is.** The UI is written in plain ES5 + flexbox for that reason. `probe.html` shows the real feature set. If it lacks flexbox or XHR the page needs a different approach.
3. **URL length of `SimDownloadHelper`.** `$KZ::chunk = 330` is a cautious guess; the first catalog upload is ~230 requests at this size.
4. **Non-ASCII bytes**: names with umlauts travel as UTF-8 bytes through `KZ_enc`; `KZProbe()` checks the round trip. If it fails, the umlauts come out wrong (not fatal).
5. **TorqueScript details used for the first time here**: `strpos` with an offset, `getFields`, `call()`, local arrays `%part[%i]`, `Canvas.getContent()`, adding a control to `PlayGui` for the GOD text, `strreplace`. All are standard Torque 3D, none is verified in this engine build.
6. **Brain parsing**: the XML readers are line based and assume one tag per line (as in the shipped `objects_types.xml`) and `<string id="N">text</string>` on one line in the name files. The category rule (`$KZB::catDepth`) is a guess until the real type tree is seen.
7. The server mod is the repo's `GMCommands` plus additions; the additions were not run. The repo copy never called `setup()` (it relied on the live server's loader); `KanzleiCore` registers it itself – make sure the old `GMCommands` folder is gone so nothing runs twice.
8. **Icons from `file:///<game>/art/2D/`**: the page (https) loads local files; many embedded browsers block that. `KZProbe()` tests it. If blocked, the UI still works with letter tiles, and the fallback is a hosted copy via `iconBase` in `eyes/config.js`.
9. Cloudflare: custom domain, D1 id, and the "Always Use HTTPS" exception for `/g/*`.

## Durability follows quality (new)
`!give` / `!giveto` take the quality only (default 100, clamped 1-100). The server calculates the durability: it takes the 5 crafted items of the same type in the `items` table whose quality is nearest to the wanted one, averages `CreatedDurability / Quality`, and multiplies by the wanted quality. Types never crafted use `shared/durability.kz` (placeholder `* 1000`, linear). The dialog shows the result read-only; typing a 4th number in a chat `!give` still overrides it.
**Assumptions that need the real database:** the `items` table has the columns `Quality` and `CreatedDurability` (taken from the tradepost notes), quality runs 1-100, and durability is roughly linear in quality. If the first query fails the fallback table is used, and the reply says which source was used. Check with `SELECT ObjectTypeID, Quality, CreatedDurability FROM items WHERE ObjectTypeID=<id> LIMIT 5;`.

## Economy tab (new)
The old stand-alone dashboard page (Chart.js from a CDN, opened with the system browser) is replaced by the tab **Wirtschaft / Economy** of the web UI: KPI tiles (inflation index, value per player, coin value, players, copper / silver / gold), inflation chart with +10 % / -5 % zones, value per player against the baseline, stacked coin supply, trend (least squares, forecast for 7 days), history table, ranges 7 / 30 / 90 days / all, CSV export and import (paste), snapshot now, set baseline, price calculator and bulk price list. Plain SVG, no external libraries, follows the colour scheme. Data path: web page -> `kz_eco` -> Core runs `!inflation export` -> rows come back as blob `economy`. The server side is unchanged (daily snapshots in `lifx_inflation_log`). The old HTML stays only for the Ctrl+F6 panel (used when no web window is open). Tested in a browser (demo + relay with the mock game); the Core part is untested like the rest.

## Economy: tracked items, live refresh, compare, calculator, movable window (0.5.0-test3)
- **Tracking:** `+ Gegenstand beobachten` opens the search window (icons, paging, empty search lists all items) in pick mode. The tracked types are stored **on the server** (`lifx_gm_tracked`, max 12, shared by all GMs; commands `!ecotrack add|remove <id>`), the daily world stock per type in `lifx_item_log` (quantity + number of stacks), kept 30 days in the dashboard. The server also writes a snapshot every 3 hours by itself (first one a minute after start).
- **What is tracked:** the *world stock* of an item type (sum of `items.Quantity`, number of stacks). There is no price data on the server: if you want prices, tell me which table holds the tradepost offers.
- **Refresh rules:** on opening the tab (full + live), on the "Aktualisieren" button (full + live), and every 15 s while the tab is open and the page is visible (live only: one small message). Leaving the tab stops the timer; the last values stay in memory and in the browser's storage (`kz_eco_cache`) and are shown at once on the next opening ("gespeicherte Werte von ...").
- **Server load:** `!kzecolive` answers from a 10 s cache, so several open dashboards cost one query; history rows are written at most every 2 minutes. The SQL sums over `items` per tracked type (needs `items.ObjectTypeID` to be indexed to be cheap on a big database - check).
- **Compare:** the left side is the selected item in full, the right side a compact view (key numbers, small graph) plus a ratio line and an index chart (start = 100) of both.
- **Calculator:** floating, movable by its header, stays open when you change tabs, own expression parser (no `eval`), history, quick buttons for dashboard values, coin conversion (copper -> gold/silver/copper).
- **Movable window in the game:** after `openWeb` the Core sets the window movable / resizable, sizes it (1180 x 720, right edge) and moves it into `PlayGui` so the game stays usable behind it. **This is the least certain part:** it depends on the class the engine gives the browser window. Everything is guarded and switchable (`$KZ::webMove`, `$KZ::webDock` in `kanzlei_config.cs`); `KZProbe()` (run it while the window is open) prints class, parent and size of the window. Send me that line.
- Tested in a browser (demo + relay with the mock game, including the refresh rules). The server queries, the Core handlers and the window handling have not run.

## Not built yet (ideas, ask before)
- Ground / animal lists beyond the files; more categories for the *Alle* tab.
