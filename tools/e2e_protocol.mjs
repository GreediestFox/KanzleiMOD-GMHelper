// End-to-end protocol test: plays the GAME (plain GET, /g/*) and the PAGE (/p/*) against a running relay.
//   cd relay && npx wrangler dev --local --persist-to .wrangler/state     (in another terminal)
//   node tools/e2e_protocol.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] || "http://127.0.0.1:8787";
let fails = 0;
const check = (name, cond, extra = "") => { console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  " + extra)); if (!cond) fails++; };
const rnd = () => Array.from({ length: 16 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
const s = rnd(), k = rnd(), p = rnd(), other = rnd();

const g = async (path, params) => { const r = await fetch(BASE + path + "?" + new URLSearchParams(params)); const t = await r.text(); return { status: r.status, text: t, endOk: t.trimEnd().endsWith("#END") }; };
const pj = async (path, body, method = "POST") => { const r = method === "GET" ? await fetch(BASE + path + "?" + new URLSearchParams(body)) : await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

console.log("game side");
let r = await g("/g/hello", { s, k, lang: "de", v: "0.1" });
check("hello creates the session, answer ends with #END", r.status === 200 && r.text.startsWith("OK") && r.endOk, r.text);
r = await g("/g/hello", { s, k: other });
check("hello with a wrong key is refused", r.status === 403);
r = await g("/g/poll", { s, k, after: 0 });
check("poll: empty queue, claimed=0", r.text.split("\n")[0].split("\t")[1] === "0", r.text);

console.log("page side");
let c = await pj("/p/claim", { s, p });
check("claim works", c.json.ok === true && c.json.lang === "de", JSON.stringify(c));
c = await pj("/p/claim", { s, p: other });
check("a second claimer is refused", c.status === 403);
c = await pj("/p/events", { s, p: other }, "GET");
check("events with the wrong page key are refused", c.status === 403);
c = await pj("/p/cmd", { s, p, cmd: "give; drop table", args: [] });
check("bad command id is refused", c.status === 400);

console.log("page -> game commands");
c = await pj("/p/cmd", { s, p, cmd: "give", args: ["241", "5", "100", "100"] });
check("cmd queued", c.json.ok === true, JSON.stringify(c));
c = await pj("/p/cmd", { s, p, cmd: "say", args: ["line1\nline2\tx"] });
r = await g("/g/poll", { s, k, after: 0 });
const lines = r.text.split("\n").filter((l) => l.startsWith("C\t"));
check("game polls both commands, claimed=1", lines.length === 2 && r.text.split("\n")[0].split("\t")[1] === "1", r.text);
check("args arrive TAB separated, control chars removed", lines[0].split("\t").slice(2).join("|") === "give|241|5|100|100" && lines[1].split("\t").length === 4, JSON.stringify(lines));
const seq2 = Number(lines[1].split("\t")[1]);
r = await g("/g/poll", { s, k, after: seq2 });
check("acknowledged commands are gone", r.text.split("\n").filter((l) => l.startsWith("C\t")).length === 0);

console.log("game -> page");
await g("/g/push", { s, k, t: "reply", id: "ok", d: "give 241 x5 : done" });
await g("/g/push", { s, k, t: "evil", d: "x" }).then((x) => check("unknown event type refused", x.status === 400));
let ev = await pj("/p/events", { s, p, after: 0 }, "GET");
check("page sees the reply event", ev.json.events?.some((e) => e.type === "reply" && e.id === "ok" && e.data.includes("done")), JSON.stringify(ev.json));

console.log("chunked blob (shared catalog, out of order)");
const h = "t" + Date.now();
r = await g("/g/has", { s, k, h });
check("has: no catalog yet", r.text.startsWith("0"), r.text);
const parts = ["one\ttab,\n", "two,\n", "three"];
for (const n of [2, 3, 1]) await g("/g/blob", { s, k, name: "catalog", h, n, of: 3, d: parts[n - 1] });
r = await g("/g/has", { s, k, h });
check("has: catalog complete after all chunks", r.text.startsWith("1"), r.text);
ev = await pj("/p/events", { s, p, after: 0 }, "GET");
check("exactly one blob event", ev.json.events.filter((e) => e.type === "blob" && e.id === "catalog").length === 1);
let b = await pj("/p/blob", { s, p, name: "catalog", h }, "GET");
check("page reads the assembled catalog", b.json.data === "one\ttab,\ntwo,\nthree", JSON.stringify(b));
console.log("second GM reuses the shared catalog");
const s2 = rnd(), k2 = rnd(), p2 = rnd();
await g("/g/hello", { s: s2, k: k2, lang: "de" });
await pj("/p/claim", { s: s2, p: p2 });
r = await g("/g/has", { s: s2, k: k2, h });
await g("/g/ready", { s: s2, k: k2, name: "catalog", h });
b = await pj("/p/blob", { s: s2, p: p2, name: "catalog", h }, "GET");
check("has=1 and page B reads it without any upload", r.text.startsWith("1") && b.json.data === "one\ttab,\ntwo,\nthree");
console.log("sessions are isolated");
ev = await pj("/p/events", { s: s2, p: p2, after: 0 }, "GET");
check("session B sees no events of session A", !ev.json.events.some((e) => e.type === "reply"));
r = await g("/g/poll", { s, k: k2, after: 0 });
check("session A cannot be polled with B's key", r.status === 403);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
