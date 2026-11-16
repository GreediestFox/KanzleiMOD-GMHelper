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
8. Cloudflare: custom domain, D1 id, and the "Always Use HTTPS" exception for `/g/*`.

## Not built yet (ideas, ask before)
- Item icons pipeline (`iconBase`): needs a decision where the game's PNGs may be hosted.
- Economy dashboard inside the new UI (it still opens as before, in the system browser).
- Ground / animal lists beyond the files; more categories for the *Alle* tab.
