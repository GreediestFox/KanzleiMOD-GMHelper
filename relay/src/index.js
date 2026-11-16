// KanzleiMOD relay: a tiny message broker between the game client (plain http GET, no TLS in the engine) and the web UI (https).
// Protocol overview: docs/PROTOCOL.md.   /g/* = game side (needs s + k),  /p/* = web page side (needs s + p),  everything else = static UI (../eyes).

const ID_RE = /^[a-z0-9]{12,24}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const SESSION_TTL = 12 * 3600;       // seconds
const MAX_QUEUE = 80;                // pending commands per session
const MAX_ARG = 120;
const MAX_ARG_BIG = 1800;            // kz_favsave carries the whole favourites list
const MAX_DATA = 1900;               // one pushed chunk
const BIG_ARG_CMDS = new Set(["kz_favsave"]);
const BUILTIN_CMDS = new Set(["kz_favsave", "kz_refresh", "kz_players", "kz_close", "kz_ping"]);
const EVENT_TYPES = new Set(["reply", "players", "status", "fav", "god", "blob", "info"]);

const now = () => Math.floor(Date.now() / 1000);
const END = "\n#END\n";
const txt = (body, status = 200) =>
  new Response(body + END, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
// blob chunks are tables (TAB and newline are their structure); everything else uses clean()
const keepText = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, max);
const ok = (v) => typeof v === "string" && ID_RE.test(v);

async function session(env, s) {
  if (!ok(s)) return null;
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE s=?").bind(s).first();
  if (!row || now() - row.created > SESSION_TTL) return null;
  return row;
}

async function purge(env) {
  const old = now() - SESSION_TTL;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cmdq WHERE s IN (SELECT s FROM sessions WHERE created<?)").bind(old),
    env.DB.prepare("DELETE FROM events WHERE s IN (SELECT s FROM sessions WHERE created<?)").bind(old),
    env.DB.prepare("DELETE FROM blobs WHERE key LIKE 's:%' AND created<?").bind(old),
    env.DB.prepare("DELETE FROM sessions WHERE created<?").bind(old),
    // shared catalogs live a week; the game re-uploads when needed
    env.DB.prepare("DELETE FROM blobs WHERE key LIKE 'c:%' AND created<?").bind(now() - 7 * 86400),
  ]);
}

// ------------------------------------------------------------------ game side (GET only, answers end with #END)
async function game(env, url) {
  const q = url.searchParams;
  const path = url.pathname;
  const s = q.get("s") || "";
  const k = q.get("k") || "";
  if (!ok(s) || !ok(k)) return txt("ERR bad id", 400);

  if (path === "/g/hello") {
    const row = await env.DB.prepare("SELECT k, created FROM sessions WHERE s=?").bind(s).first();
    if (row && row.k !== k) return txt("ERR bad key", 403);
    const lang = /^[a-z]{2,8}$/.test(q.get("lang") || "") ? q.get("lang") : "en";
    const ver = clean(q.get("v"), 20);
    if (!row) {
      await purge(env);
      await env.DB.prepare("INSERT INTO sessions (s,k,lang,ver,created,game_seen) VALUES (?,?,?,?,?,?)").bind(s, k, lang, ver, now(), now()).run();
    } else {
      await env.DB.prepare("UPDATE sessions SET lang=?, ver=?, game_seen=? WHERE s=?").bind(lang, ver, now(), s).run();
    }
    return txt("OK");
  }

  const sess = await session(env, s);
  if (!sess || sess.k !== k) return txt("ERR no session", 403);
  await env.DB.prepare("UPDATE sessions SET game_seen=? WHERE s=?").bind(now(), s).run();

  if (path === "/g/poll") {
    const after = Math.max(0, parseInt(q.get("after") || "0", 10) || 0);
    await env.DB.prepare("DELETE FROM cmdq WHERE s=? AND seq<=?").bind(s, after).run();
    const { results } = await env.DB.prepare("SELECT seq, line FROM cmdq WHERE s=? AND seq>? ORDER BY seq LIMIT 20").bind(s, after).all();
    const lines = ["S\t" + (sess.p ? 1 : 0) + "\t" + now()];
    for (const r of results) lines.push("C\t" + r.seq + "\t" + r.line);
    return txt(lines.join("\n"));
  }

  if (path === "/g/has") {            // does the shared catalog for this hash exist completely?
    const h = clean(q.get("h"), 40);
    const row = await env.DB.prepare("SELECT total, (SELECT COUNT(*) FROM blobs b2 WHERE b2.key=b.key) AS have FROM blobs b WHERE key=? LIMIT 1").bind("c:" + h).first();
    return txt(row && row.have >= row.total ? "1" : "0");
  }

  if (path === "/g/blob") {           // chunked upload: name=cmds|catalog|animals|ground ...  h=<hash> makes it a shared catalog
    const name = q.get("name") || "";
    const n = parseInt(q.get("n") || "", 10), total = parseInt(q.get("of") || "", 10);
    if (!NAME_RE.test(name) || !(n >= 1) || !(total >= 1) || n > total || total > 900) return txt("ERR bad blob", 400);
    const h = clean(q.get("h"), 40);
    const key = h ? "c:" + h : "s:" + s + ":" + name;
    const data = keepText(q.get("d"), MAX_DATA);
    // chunks may arrive out of order (the game sends a few at a time): drop leftovers of an older, differently sized upload, then store this one
    await env.DB.prepare("DELETE FROM blobs WHERE key=? AND total<>?").bind(key, total).run();
    await env.DB.prepare("INSERT OR REPLACE INTO blobs (key,n,total,data,created) VALUES (?,?,?,?,?)").bind(key, n, total, data, now()).run();
    const have = await env.DB.prepare("SELECT COUNT(*) AS c FROM blobs WHERE key=?").bind(key).first();
    if (have.c === total) await addEvent(env, s, "blob", name, h);
    return txt("OK");
  }

  if (path === "/g/ready") {          // the shared catalog already exists: tell the page without uploading
    const h = clean(q.get("h"), 40);
    await addEvent(env, s, "blob", clean(q.get("name"), 32), h);
    return txt("OK");
  }

  if (path === "/g/push") {
    const type = q.get("t") || "";
    if (!EVENT_TYPES.has(type) || type === "blob") return txt("ERR bad type", 400);
    await addEvent(env, s, type, clean(q.get("id"), 32), clean(q.get("d"), MAX_DATA));
    return txt("OK");
  }
  return txt("ERR unknown", 404);
}

async function addEvent(env, s, type, id, data) {
  await env.DB.prepare("INSERT INTO events (s,type,id,data,created) VALUES (?,?,?,?,?)").bind(s, type, id, data, now()).run();
  // keep the table small
  await env.DB.prepare("DELETE FROM events WHERE s=? AND seq < (SELECT MAX(seq) FROM events WHERE s=?) - 400").bind(s, s).run();
}

// ------------------------------------------------------------------ web page side (https)
async function page(env, request, url) {
  const q = url.searchParams;
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch { body = {}; }
  }
  const s = body.s || q.get("s") || "";
  const p = body.p || q.get("p") || "";
  if (!ok(s) || !ok(p)) return json({ error: "bad id" }, 400);
  const sess = await session(env, s);
  if (!sess) return json({ error: "no session" }, 404);

  if (url.pathname === "/p/claim") {
    if (sess.p && sess.p !== p) return json({ error: "session already claimed" }, 403);
    if (!sess.p) await env.DB.prepare("UPDATE sessions SET p=? WHERE s=? AND p IS NULL").bind(p, s).run();
    return json({ ok: true, lang: sess.lang, ver: sess.ver, gameAge: now() - sess.game_seen });
  }
  if (sess.p !== p) return json({ error: "not claimed / wrong key" }, 403);
  await env.DB.prepare("UPDATE sessions SET page_seen=? WHERE s=?").bind(now(), s).run();

  if (url.pathname === "/p/events") {
    const after = Math.max(0, parseInt(q.get("after") || "0", 10) || 0);
    const { results } = await env.DB.prepare("SELECT seq,type,id,data FROM events WHERE s=? AND seq>? ORDER BY seq LIMIT 100").bind(s, after).all();
    const fresh = await env.DB.prepare("SELECT game_seen FROM sessions WHERE s=?").bind(s).first();
    return json({ events: results, gameAge: now() - (fresh ? fresh.game_seen : 0), now: now() });
  }

  if (url.pathname === "/p/blob") {
    const name = q.get("name") || "";
    const h = clean(q.get("h"), 40);
    if (!NAME_RE.test(name)) return json({ error: "bad name" }, 400);
    const key = h ? "c:" + h : "s:" + s + ":" + name;
    const { results } = await env.DB.prepare("SELECT n,total,data FROM blobs WHERE key=? ORDER BY n").bind(key).all();
    if (!results.length || results.length < results[0].total) return json({ error: "incomplete", have: results.length }, 404);
    return json({ data: results.map((r) => r.data).join("") });
  }

  if (url.pathname === "/p/cmd" && request.method === "POST") {
    const id = String(body.cmd || "");
    if (!NAME_RE.test(id)) return json({ error: "bad command id" }, 400);
    const args = Array.isArray(body.args) ? body.args.slice(0, 8) : [];
    const max = BIG_ARG_CMDS.has(id) ? MAX_ARG_BIG : MAX_ARG;
    const line = [id, ...args.map((a) => clean(a, max))].join("\t");
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM cmdq WHERE s=?").bind(s).first();
    if (cnt.n >= MAX_QUEUE) return json({ error: "queue full (is the game running?)" }, 429);
    const r = await env.DB.prepare("INSERT INTO cmdq (s,line,created) VALUES (?,?,?)").bind(s, line, now()).run();
    return json({ ok: true, seq: r.meta.last_row_id });
  }
  return json({ error: "unknown" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/g/")) return await game(env, url);
      if (url.pathname.startsWith("/p/")) return await page(env, request, url);
      if (url.pathname === "/api/health") return json({ ok: true, builtin: [...BUILTIN_CMDS] });
      // probe helper: tells the game how long a URL / which bytes arrived (used by client probe.cs to find the engine's URL limit and test umlauts)
      if (url.pathname === "/api/echo") { const d = url.searchParams.get("d") || ""; return txt("LEN=" + d.length + " URL=" + request.url.length + " TXT=" + d.slice(0, 80)); }
    } catch (e) {
      return url.pathname.startsWith("/g/") ? txt("ERR " + String(e.message || e).slice(0, 100), 500) : json({ error: "server error" }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
