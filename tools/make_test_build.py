#!/usr/bin/env python3
"""Builds the local TEST package (a zip) from this repo:  python tools/make_test_build.py --steamids <steamids.cs> [--out dir]

The package runs everything on one PC: the relay is started locally (Start_Relay.bat, http://127.0.0.1:8787), so no Cloudflare is needed for the
first test. The Steam IDs come from the file you pass in (your own live steamids.cs) and are only written into the zip, never into the repo.
Contents: client mod, server mod in BOTH layouts (mods/LiFx and VPS scripts/lifmod/gm), relay + web UI, instructions."""
import argparse, os, shutil, subprocess, sys, zipfile, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--steamids", help="your live steamids.cs (kept out of git)")
ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
a = ap.parse_args()

# 1. checks first: a broken file must not get into a build
for cmd in ([sys.executable, "tools/kz_sync.py"],
            [sys.executable, "tools/lint_cs.py", "client/mod/KanzleiMOD/*.cs", "client/mod/KanzleiMOD/legacy/*.cs", "server/mods/LiFx/KanzleiCore/mod.cs"]):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip())
    if r.returncode:
        sys.exit("check failed: " + " ".join(cmd[1:2]))
for js in ("eyes/app.js", "eyes/theme.js", "eyes/i18n.js", "relay/src/index.js"):
    if subprocess.run(["node", "--check", js], cwd=ROOT).returncode:
        sys.exit("syntax error in " + js)

ver = re.search(r'\$KZ::version = "([^"]+)"', open(os.path.join(ROOT, "client/mod/KanzleiMOD/kanzlei.cs"), encoding="utf-8").read()).group(1)
name = "KanzleiMOD_" + ver
stage = os.path.join(a.out, name)
shutil.rmtree(stage, ignore_errors=True)

def copy(src, dst, skip=("cache", "node_modules", ".wrangler", "kanzlei_config.cs", "steamids.live.cs")):
    s = os.path.join(ROOT, src); d = os.path.join(stage, dst)
    if os.path.isdir(s):
        shutil.copytree(s, d, ignore=lambda _, names: [n for n in names if n in skip or n.endswith(".dso")])
    else:
        os.makedirs(os.path.dirname(d), exist_ok=True); shutil.copyfile(s, d)

def write(path, text, crlf=True):
    p = os.path.join(stage, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\r\n" if crlf else "\n") as f: f.write(text)

# 2. client
copy("client/mod/KanzleiMOD", "client/mod/KanzleiMOD")
write("client/mod/KanzleiMOD/kanzlei_config.cs", """// Local test: the relay runs on this PC (Start_Relay.bat). For the real website put the https / http addresses of gm.<your domain> here instead.
$KZ::pageHost = "http://127.0.0.1:8787";
$KZ::gameHost = "http://127.0.0.1:8787";
$KZ::iconBase = "none";   // icons come from the relay (/icons/, see tools/copy_icons.py), not from file:///
""")

# 3. server, two layouts (same code; the mod finds its folder by itself)
steam = '// GM panel access by Steam ID. One 64-bit Steam ID per account, separated by spaces.\n$LiFxGM::steamIds = "";\n'
if a.steamids:
    t = open(a.steamids, encoding="utf-8").read()
    if "$LiFxGM::steamIds" not in t:
        sys.exit("that file has no $LiFxGM::steamIds line")
    steam = t
    n = len(re.findall(r"\b7656119\d{10}\b", t)); print("Steam IDs taken over:", n)
copy("server/mods/LiFx/KanzleiCore", "server_LiFx/mods/LiFx/KanzleiCore")
write("server_LiFx/mods/LiFx/KanzleiCore/steamids.cs", steam)
shutil.copytree(os.path.join(ROOT, "server/mods/LiFx/KanzleiCore/data"), os.path.join(stage, "server_VPS/scripts/lifmod/gm/data"))
shutil.copyfile(os.path.join(ROOT, "server/mods/LiFx/KanzleiCore/mod.cs"), os.path.join(stage, "server_VPS/scripts/lifmod/gm/gm_commands.cs"))
write("server_VPS/scripts/lifmod/gm/steamids.cs", steam)

# 4. relay + web UI (runs locally with wrangler)
for f in ("src", "migrations", "wrangler.jsonc", "package.json", "package-lock.json"):
    copy("relay/" + f, "relay/" + f)
copy("eyes", "eyes")
copy("tools/copy_icons.py", "tools/copy_icons.py")   # the package cannot hold the game art: this fills eyes/icons from the player's own client
write("Start_Relay.bat", """@echo off
rem KanzleiMOD relay + web UI on this PC (needs Node.js). Leave this window open while testing. Stop with Ctrl+C.
cd /d "%~dp0relay"
if not exist node_modules call npm install
call npx wrangler d1 migrations apply kanzlei-gm --local --persist-to .wrangler/state
echo.
echo Relay: http://127.0.0.1:8787   (open  http://127.0.0.1:8787/?demo=1  in a browser to look at the UI without the game)
call npx wrangler dev --local --persist-to .wrangler/state --port 8787
pause
""")

# 5. instructions
readme = open(os.path.join(ROOT, "docs/TEST_RUN.md"), encoding="utf-8").read().replace("@VERSION@", ver)
write("README_START_HERE.txt", readme)
write("VERSION.txt", ver + "\n", crlf=False)

os.makedirs(a.out, exist_ok=True)
zp = os.path.join(a.out, name + ".zip")
if os.path.exists(zp): os.remove(zp)
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for dp, _, fs in os.walk(stage):
        for f in sorted(fs):
            full = os.path.join(dp, f); z.write(full, os.path.join(name, os.path.relpath(full, stage)))
print("built", zp, os.path.getsize(zp), "bytes")
