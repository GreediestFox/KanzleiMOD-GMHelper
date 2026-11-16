# KanzleiMOD – GM Helper

GM tools for the *Life is Feudal: Your Own* server of Wulpische Lande. A rework of the old F6 GM panel into a small framework of three parts:

| Part | Where | Job |
|---|---|---|
| **Brain** | `client/mod/KanzleiMOD/brain.cs` (+ server data loader in `KanzleiCore`) | preloads what the tool needs: items / buildings / objects from the client's own `data\objects_types.xml`, names from `data\loc\<language>\data\objects_types_Name.xml`, command / animal / ground tables from `shared/*.kz` |
| **Core** | `client/mod/KanzleiMOD/core.cs`, `server/mods/LiFx/KanzleiCore/mod.cs`, `relay/` | moves data and runs commands: server GM mod, client, and the relay that connects the game to the web page |
| **Eyes** | `eyes/` | the UI: a web page (hosted on Cloudflare, a subdomain of the website) opened in the game's own browser window with **F6** |

```
 game client ──F6──> openWeb("https://gm.<site>/?s=..&p=..")  ──>  Eyes (HTML/JS)
      │  Core: plain-http GET (the engine has no TLS)                │ https
      └──────────────────────────> relay (Cloudflare Worker + D1) <──┘
      │ !commands / replies
 dedicated server: KanzleiCore (GM commands, registry, Steam-ID check)
```

**One place for commands:** `shared/commands.kz`. Add a line there, run `python tools/kz_sync.py`, and the server (`!help`, which chat commands exist), the client Core (what it may run) and the web UI (forms, search, favourites) all know it. The same goes for `animals.kz`, `ground.kz` and `hidden.kz`.

Status of what is tested and what is not: **[docs/STATUS.md](docs/STATUS.md)**. Install and test plan: **[docs/INSTALL.md](docs/INSTALL.md)**. Design and protocol: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Features of the new UI
- Tabs **Favoriten** and **Alle**. In *Alle* every entry has a grey star; click it to pin the entry. In *Favoriten* the tiles can be dragged into any order (or moved with ◀ ▶). Favourites are stored in a file on the GM's client.
- **Search engine** across commands, items, buildings, objects, animals and ground materials: all words must match, accents ignored, prefix and word-start ranking, small typos tolerated, icons, type filters, **results window with page buttons** whose page size follows the window size.
- Item dialog (quantity / quality / durability, to me or to a player), forms generated from the command registry, player picker from the online list.
- Every answer from the server shows as a green **Erledigt / Done** or red **Fehler / Failed**; log at the bottom.
- **GOD**: while invulnerable is on, a gold "GM GOD" is shown on the game screen and in the page header.
- German / English page; item and object names follow the game's own language.
- The old native panel stays available as **Ctrl+F6** (fallback) until the web UI is proven in the game.

## Repository layout
```
shared/            commands.kz animals.kz ground.kz hidden.kz   <- edit these
client/mod/KanzleiMOD/   Torque scripts for the client (+ legacy/ = old panel, economy/ = dashboard page)
server/mods/LiFx/KanzleiCore/   server GM mod (replaces mods/LiFx/GMCommands)
eyes/              the web UI (plain ES5 + CSS, no build step)
relay/             Cloudflare Worker + D1 schema
tools/             kz_sync.py (validate + distribute), lint_cs.py, e2e_protocol.mjs, mock_game.mjs
docs/
```

## Dev without the game
```bash
cd relay && npm install && npx wrangler d1 migrations apply kanzlei-gm --local --persist-to .wrangler/state
npx wrangler dev --local --persist-to .wrangler/state          # relay + UI on http://127.0.0.1:8787
node ../tools/mock_game.mjs                                      # plays the game, prints the URL to open
node ../tools/e2e_protocol.mjs                                   # protocol tests
# or just the UI with fake data:  http://127.0.0.1:8787/?demo=1
```
No game art is included. Item icons are loaded from `iconBase` (see `eyes/config.js`); without icons letter tiles are shown.
