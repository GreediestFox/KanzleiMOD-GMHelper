# Relay protocol (v1)

All ids are `[a-z0-9]{12,24}`. Game answers are plain text ending with a line `#END` (that is how the game knows a download finished). Page answers are JSON.

## Game side – GET, plain http allowed
| Request | Meaning |
|---|---|
| `/g/hello?s&k&lang&v` | create / refresh session (key `k` is bound on first use) → `OK` |
| `/g/poll?s&k&after=N` | acknowledges commands ≤ N, returns `S<TAB>claimed<TAB>now` and `C<TAB>seq<TAB>id<TAB>arg...` lines |
| `/g/push?s&k&t=<reply\|players\|status\|god\|info>&id&d` | one event for the page |
| `/g/blob?s&k&name&n&of&d[&h]` | chunk n of `of` of a named data blob; with `h` it is a shared catalog (cached by hash for a week) |
| `/g/has?s&k&h` | `1` when the catalog with that hash is complete |
| `/g/ready?s&k&name&h` | announce an already cached catalog to the page |
| `/api/echo?d=` | probe helper: returns the length received |

Blob names: `cmds` (registry), `animals`, `ground`, `catalog`, `fav`. Chunks are cut at line ends and may arrive in any order.

## Page side – https
| Request | Meaning |
|---|---|
| `POST /p/claim {s,p}` | first caller binds `p`; later callers need the same `p` |
| `GET /p/events?s&p&after=N` | events since N (`reply` `players` `god` `blob` `info`) + `gameAge` (seconds since the game last talked) |
| `GET /p/blob?s&p&name[&h]` | assembled blob |
| `POST /p/cmd {s,p,cmd,args[]}` | queue a command (`cmd` = registry id or built-in) |

Built-ins handled by the Core: `kz_favsave` (arg: comma list of favourite keys), `kz_themesave`, `kz_dur` (args: item type, quality → asks the server for the calculated durability, answer arrives as event `dur` = `type|quality|durability|note`), `kz_players`, `kz_refresh`, `kz_close`, `kz_ping`.

## Server ↔ client (Torque `commandToClient`)
`KZDur(type, quality, durability, note)` · `KZReply(status, text, last)` · `KZDataBegin/KZData/KZDataEnd(section[, line])` · `KZPlayersBegin/Row/End` · `GMLoginResult(code)` · `GMEconomyBegin/Row/End`. Strings must stay under 255 characters; `kz_sync.py` enforces 240 for registry lines.

## Registry format (`shared/commands.kz`)
`id TAB category TAB via TAB template TAB args TAB label_en TAB label_de TAB keywords`; `via` = `server` | `slash` | `local`; args = `name:type[(choices)][=default][?]` with types `item building object thing animal ground player int text word choice`.
