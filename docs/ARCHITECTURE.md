# Architecture

## Why a relay
The game's browser window (`openWeb`) can show any https page, but a page cannot call into the game, and the game's downloader (`SimDownloadHelper`) can only do **plain-http GET** (no TLS). The Skriptorium (books) already works this way: a ticket in the page URL, the game polls an API with plain GET. KanzleiMOD generalises that:

* **game → relay**: plain GET `/g/*` (hello, poll for commands, push events, upload data in chunks).
* **web page → relay**: https `/p/*` (claim session, send command, read events and data).
* The relay (Cloudflare Worker + D1, `relay/`) only stores and forwards. It does not know what a command means.

## Parts
**Brain** (client) reads the game's own files in small timer slices (no freeze): `objects_types.xml` (what exists), `cm_objects.xml` (what has a 3D model → placeable), the name file for the language in `$pref::language::pack` (English as fallback, XML `Name` as last fallback). Rules for buildings / objects / items are the ones of the old `gen_gmobjects.py`; `hidden.kz` replaces its hardcoded hidden id ranges. The result is a compact text catalog plus a hash (entry count + checksum + language). The relay caches catalogs **by hash**, so the second GM with the same game files and language uploads nothing.

**Core** (client) – session handling, HTTP lanes, command registry, execution, favourites file, GOD overlay, login. Commands from the page arrive as `id + values`; Core renders the text from the registry template, strips dangerous characters, validates numbers and runs it as a server chat command (`!give ...`), a game slash command (`/WEATHER ...`) or a local action (`KZ_local_<id>`). Unknown ids are refused.

**Core** (server, `KanzleiCore`) = the repo's `GMCommands` 0.13.1 with the same package and function names (other mods call `LiFxGMCommands::getPlayer`), plus: registry-driven `isKnown` / `!help`, `data/ground.kz` and `data/animals.kz`, `!kzcat` `!kzplayers` `!kzreload` `!kzping`, and every `reply()` also goes to the client as `KZReply ok|err`.

**Eyes** – plain ES5 + flexbox (the embedded browser may be old; `probe.html` tells). `?demo=1` runs it with fake data.

## Security
* GM rights stay **on the server**: the Steam ID of the connected account decides, exactly as before. Whatever reaches the relay, the server refuses it for non-GMs.
* The page never sends command text, only ids + values; Core accepts only ids in the registry.
* Session ids are random (16 chars). The game uses `s`+`k` (sent over plain http, unavoidable), the page uses `s`+`p` (https only). `p` is claimed once by the first page that presents it. Residual risk: someone who can read the GM's unencrypted traffic could race the claim in the first seconds. Sessions end after 12 h; commands are capped (80 queued, 120 characters per value).
* The relay has no Steam ID data and no secrets. Nothing personal is stored; tables hold session ids, queued commands, event text and catalogs.

## Decisions taken without asking (change if you disagree)
* Subdomain `gm.wulpischelande.de` (in `relay/wrangler.jsonc` and `kanzlei.cs`).
* Favourites live in a client file, not on the relay.
* Category of a catalog entry = the ancestor two steps below the root of the type tree (`$KZB::catDepth`); needs a look at the real data.
* The server mod replaces `GMCommands` instead of living next to it.
