// Tests the crash bucket against `wrangler dev --local` (R2 is simulated locally):   node test.mjs [http://127.0.0.1:8788]
// Start the worker first with the test tokens:  npx wrangler dev --local --persist-to .wrangler/state --port 8788 --var UPLOAD_TOKEN:up-test --var ADMIN_TOKEN:admin-test
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8788";
let fails = 0;
const check = (name, cond, extra = "") => { console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  " + extra)); if (!cond) fails++; };
const dir = mkdtempSync(join(tmpdir(), "crash-"));
const zipPath = join(dir, "t.zip");
execFileSync("python3", ["-c", `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('report.txt','hello'); z.writestr('logs/a.log','x'*5000); z.close()`, zipPath]);
const zip = readFileSync(zipPath);
const up = (tok, body, host = "VPS1") => fetch(BASE + "/upload", { method: "PUT", headers: { ...(tok ? { authorization: "Bearer " + tok } : {}), "x-host": host, "x-reason": "server crashed", "content-type": "application/zip" }, body });

let r = await fetch(BASE + "/"); check("health", r.status === 200);
r = await up(null, zip); check("no token -> 401", r.status === 401, r.status);
r = await up("up-test ", zip); check("a trailing blank in the header is tolerated", r.status === 200, r.status);
r = await up("wrong", zip); check("wrong token -> 401", r.status === 401, r.status);
r = await up("up-test", Buffer.from("this is not a zip file at all, just text")); check("not a zip -> 400", r.status === 400, r.status);
r = await up("up-test", zip); const j = await r.json(); check("upload ok", r.status === 200 && j.ok && j.key.startsWith("crash/") && j.key.endsWith(".zip"), JSON.stringify(j));
check("key holds the host", j.key.includes("/VPS1_"), j.key);
check("expiry is about 30 days ahead", Math.abs((Date.parse(j.expires) - Date.now()) / 86400000 - 30) < 0.1, j.expires);
r = await fetch(BASE + "/reports", { headers: { authorization: "Bearer up-test" } }); check("upload token cannot list", r.status === 401, r.status);
r = await fetch(BASE + "/reports", { headers: { authorization: "Bearer admin-test" } }); const lst = await r.json();
check("admin lists the report", r.status === 200 && lst.reports.some((x) => x.key === j.key && x.host === "VPS1" && x.reason === "server crashed"), JSON.stringify(lst).slice(0, 200));
r = await fetch(BASE + "/report?key=" + encodeURIComponent(j.key), { headers: { authorization: "Bearer admin-test" } }); const back = Buffer.from(await r.arrayBuffer());
check("admin downloads the same bytes", r.status === 200 && back.equals(zip), "len " + back.length);
r = await fetch(BASE + "/report?key=../secret", { headers: { authorization: "Bearer admin-test" } }); check("bad key refused", r.status === 400, r.status);
r = await fetch(BASE + "/admin/purge?days=30", { method: "POST", headers: { authorization: "Bearer admin-test" } }); const p30 = await r.json();
check("purge 30 days keeps a fresh report", p30.deleted === 0, JSON.stringify(p30));
r = await fetch(BASE + "/admin/purge?days=0", { method: "POST", headers: { authorization: "Bearer admin-test" } }); const p0 = await r.json();
check("purge 0 days deletes it", p0.deleted >= 1, JSON.stringify(p0));
r = await fetch(BASE + "/report?key=" + encodeURIComponent(j.key), { headers: { authorization: "Bearer admin-test" } }); check("gone after purge", r.status === 404, r.status);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
