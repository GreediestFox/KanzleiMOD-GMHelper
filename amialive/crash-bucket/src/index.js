// Crash bucket: receives the crash-report zips of AmIAlive and keeps them for 30 days.
//   PUT    /upload              Bearer UPLOAD_TOKEN   body = zip (checked: size, zip header, per-host daily limit)   -> {ok,key,expires}
//   GET    /reports?host=&n=    Bearer ADMIN_TOKEN    newest first
//   GET    /report?key=         Bearer ADMIN_TOKEN    download
//   DELETE /report?key=         Bearer ADMIN_TOKEN
//   POST   /admin/purge?days=   Bearer ADMIN_TOKEN    delete everything older than <days> (default 30)
// The server only knows UPLOAD_TOKEN (it can add reports, nothing else). R2 keys never leave Cloudflare.
// Retention: the bucket's lifecycle rule (see README) does the real work; the daily cron here is a second guard.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function same(a, b) {
  // compares without leaking where the first difference is
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

async function authed(request, secret) {
  if (!secret || !String(secret).trim()) return false;
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") && (await same(h.slice(7).trim(), String(secret).trim()));
}

const cleanHost = (s) => (String(s || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40) || "unknown");
const days = (env) => Math.max(0, Number(env.RETENTION_DAYS || 30));

async function purge(env, olderThanDays) {
  const cutoff = Date.now() - olderThanDays * 86400000;
  let cursor, deleted = 0, seen = 0;
  do {
    const page = await env.REPORTS.list({ prefix: "crash/", cursor, limit: 500 });
    const old = page.objects.filter((o) => o.uploaded.getTime() <= cutoff).map((o) => o.key);
    seen += page.objects.length;
    if (old.length) { await env.REPORTS.delete(old); deleted += old.length; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { deleted, seen };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") return new Response("kanzlei crash bucket ok\n", { headers: { "content-type": "text/plain" } });

    if (path === "/upload" && request.method === "PUT") {
      if (!(await authed(request, env.UPLOAD_TOKEN))) return json({ error: "unauthorized" }, 401);
      const max = Number(env.MAX_BYTES || 62914560);
      const declared = Number(request.headers.get("content-length") || 0);
      if (declared > max) return json({ error: "too big", max }, 413);
      const buf = await request.arrayBuffer();
      if (buf.byteLength > max) return json({ error: "too big", max }, 413);
      const head = new Uint8Array(buf.slice(0, 2));
      if (buf.byteLength < 22 || head[0] !== 0x50 || head[1] !== 0x4b) return json({ error: "not a zip file" }, 400);
      const host = cleanHost(request.headers.get("x-host"));
      const now = new Date();
      const p2 = (n) => String(n).padStart(2, "0");
      const day = `${now.getUTCFullYear()}/${p2(now.getUTCMonth() + 1)}/${p2(now.getUTCDate())}`;
      const cap = Number(env.MAX_PER_HOST_PER_DAY || 30);
      const today = await env.REPORTS.list({ prefix: `crash/${day}/${host}_`, limit: cap + 1 });
      if (today.objects.length >= cap) return json({ error: "daily limit for this host reached", cap }, 429);
      const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`;
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(3))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const key = `crash/${day}/${host}_${stamp}_${rnd}.zip`;
      await env.REPORTS.put(key, buf, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: { host, reason: String(request.headers.get("x-reason") || "").slice(0, 120), version: String(request.headers.get("x-version") || "").slice(0, 20), at: now.toISOString() },
      });
      return json({ ok: true, key, bytes: buf.byteLength, expires: new Date(now.getTime() + days(env) * 86400000).toISOString() });
    }

    // everything below is for the admin only
    if (["/reports", "/report", "/admin/purge"].includes(path)) {
      if (!(await authed(request, env.ADMIN_TOKEN))) return json({ error: "unauthorized" }, 401);

      if (path === "/reports" && request.method === "GET") {
        const host = url.searchParams.get("host");
        const n = Math.min(500, Math.max(1, Number(url.searchParams.get("n") || 100)));
        let cursor, all = [];
        do {
          const page = await env.REPORTS.list({ prefix: "crash/", cursor, limit: 1000, include: ["customMetadata"] });
          all = all.concat(page.objects);
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor && all.length < 5000);
        all = all.filter((o) => !host || (o.customMetadata && o.customMetadata.host === cleanHost(host))).sort((a, b) => b.uploaded - a.uploaded).slice(0, n);
        return json({ count: all.length, reports: all.map((o) => ({ key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString(), host: o.customMetadata && o.customMetadata.host, reason: o.customMetadata && o.customMetadata.reason })) });
      }
      if (path === "/report" && request.method === "GET") {
        const key = url.searchParams.get("key") || "";
        if (!key.startsWith("crash/") || key.includes("..")) return json({ error: "bad key" }, 400);
        const obj = await env.REPORTS.get(key);
        if (!obj) return json({ error: "not found" }, 404);
        return new Response(obj.body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${key.split("/").pop()}"` } });
      }
      if (path === "/report" && request.method === "DELETE") {
        const key = url.searchParams.get("key") || "";
        if (!key.startsWith("crash/") || key.includes("..")) return json({ error: "bad key" }, 400);
        await env.REPORTS.delete(key);
        return json({ ok: true });
      }
      if (path === "/admin/purge" && request.method === "POST") {
        const d = url.searchParams.has("days") ? Math.max(0, Number(url.searchParams.get("days"))) : days(env);
        return json({ ok: true, days: d, ...(await purge(env, d)) });
      }
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env, days(env)));
  },
};
