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

## Not built yet (ideas, ask before)
- Economy dashboard inside the new UI (it still opens as before, in the system browser).
- Ground / animal lists beyond the files; more categories for the *Alle* tab.
