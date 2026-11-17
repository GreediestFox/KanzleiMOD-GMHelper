// Plays the GAME side against a running relay, so the web UI can be developed and tested without the game:
//   node tools/mock_game.mjs [relayUrl]      (default http://127.0.0.1:8787)    prints the URL to open in a browser.
// It uploads the shared command registry, animals, ground, a small made-up catalog, a player list and favourites, then polls for commands and answers them.
import { readFileSync } from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const rnd = () => Array.from({ length: 16 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
const s = rnd(), k = rnd(), p = rnd();
const shared = (f) => readFileSync(new URL("../shared/" + f, import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).join("\n") + "\n";
const g = async (path, params) => (await fetch(BASE + path + "?" + new URLSearchParams({ s, k, ...params }))).text();
const blob = async (name, text, h = "") => {
  const parts = []; let cur = "";
  for (const rec of text.split("\n").filter(Boolean)) { if (cur && cur.length + rec.length + 1 > 330) { parts.push(cur); cur = ""; } cur += rec + "\n"; }
  if (cur) parts.push(cur);
  await Promise.all(parts.map((d, i) => g("/g/blob", { name, h, n: i + 1, of: parts.length, d })));
};
await g("/g/hello", { lang: "de", v: "mock" });
const mats = ["Eisen", "Stahl", "Bronze", "Kupfer", "Eiche", "Leder", "Leinen", "Wolle", "Silber", "Stein"], types = [["Axt", 2], ["Spitzhacke", 2], ["Schwert", 1], ["Speer", 1], ["Schild", 3], ["Helm", 3], ["Barren", 4], ["Schale", 5], ["Umhang", 6]];
let cat = "C|1|Waffen\nC|2|Werkzeuge\nC|3|Rüstungen\nC|4|Ressourcen\nC|5|Haushalt\nC|6|Kleidung\nC|7|Werkstätten\nC|8|Möbel\n", id = 241;
for (const m of mats) for (const [t, c] of types) cat += `i|${id++}|${c}|${m}${m.endsWith("e") ? "ne" : "ner"} ${t}|\n`.replace(/ne /, " ");
["Scheune", "Schmiede", "Wassermühle", "Gerberei", "Steinmetz", "Taverne", "Kapelle", "Kornspeicher"].forEach((n, i) => (cat += `b|${100 + i}|7|${n}|\n`));
["Holzkarren", "Truhe", "Tisch", "Bank", "Fass", "Amboss", "Webstuhl", "Bücherregal"].forEach((n, i) => (cat += `m|${300 + i}|8|${n}|\n`));
await blob("cmds", shared("commands.kz")); await blob("animals", shared("animals.kz")); await blob("ground", shared("ground.kz"));
const h = "mock" + id; await blob("catalog", cat, h);
const ecoRows = () => { const out = []; let pp = 4600; for (let i = 44; i >= 0; i--) { pp += Math.sin(i / 5) * 90 + 40; const pl = 18 + Math.round(5 * Math.sin(i / 9)) + Math.round((45 - i) / 9), val = Math.round(pp * pl), cu = Math.round(val * 0.38), si = Math.round(val * 0.34 / 100), au = Math.round(val * 0.28 / 10000), tot = cu + si * 100 + au * 10000; out.push([new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), cu, si, au, tot, pl, (tot / pl).toFixed(2), ((tot / pl / 5000 - 1) * 100).toFixed(1), 5000].join(",")); } return out.join("\n") + "\n"; };
await blob("economy", ecoRows());
await blob("fav", "c:godon,c:heal,i:241,b:101,a:WolfData\n");
await g("/g/push", { t: "players", d: "101|Alrik Steinhand;102|Berta Müllerin;103|Cedric Vale" });
console.log(`\nOpen:  ${BASE}/?s=${s}&p=${p}&lang=de\n(mock game running, Ctrl+C to stop)\n`);
let after = 0, god = false;
for (;;) {
  const r = await g("/g/poll", { after });
  for (const l of r.split("\n")) {
    const f = l.split("\t"); if (f[0] !== "C") continue;
    after = Number(f[1]); const [cmd, ...args] = f.slice(2);
    console.log("command:", cmd, args.join(" | ").slice(0, 120));
    if (cmd === "godon" || cmd === "godoff") { god = cmd === "godon"; await g("/g/push", { t: "god", id: god ? "on" : "off" }); }
    if (cmd === "kz_players") await g("/g/push", { t: "players", d: "101|Alrik Steinhand;102|Berta Müllerin;103|Cedric Vale;104|Neu Dazu" });
    if (cmd === "kz_eco") { await blob("economy", ecoRows()); continue; }
    if (cmd.startsWith("kz_")) continue;
    const bad = cmd === "kick" || cmd === "ban";
    await g("/g/push", { t: "reply", id: bad ? "err" : "ok", d: bad ? "Spieler ist nicht online." : `${cmd}: erledigt (${args.join(" ")})` });
  }
  await new Promise((r) => setTimeout(r, 700));
}
