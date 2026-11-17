#!/usr/bin/env python3
"""Copies the item / building / object icons of the game into eyes/icons/ so the web UI can show them (the game's browser window blocks file:/// on an http page).

  python tools/copy_icons.py "<game folder>"        e.g. the client install (needs data/objects_types.xml and art/2D)

Only the icons named as <FaceImage> in data/objects_types.xml are copied (about 1,200 PNG files, ~37 MB), keeping the path below art/2D/ and the
spelling of the XML (a case-sensitive web server needs the same case). The folder is NOT in git (game artwork): run this before make_test_build.py
or before deploying the relay. The page asks for them at /icons/<path>; config.js has iconBase = "/icons/"."""
import os, re, shutil, sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
game = sys.argv[1]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "eyes", "icons")
xml = open(os.path.join(game, "data", "objects_types.xml"), encoding="utf-8", errors="replace").read()
faces = sorted(set(m.strip().replace("\\", "/") for m in re.findall(r"<FaceImage>([^<]*)</FaceImage>", xml)))
n = total = 0
seen = set()
for f in faces:
    if not f.lower().startswith("art/2d/"):
        continue
    rel = f[7:]
    src = os.path.join(game, f.replace("/", os.sep))
    if not os.path.isfile(src) or rel.lower() in seen:
        continue
    seen.add(rel.lower())
    out = os.path.join(dst, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copy2(src, out)
    n += 1
    total += os.path.getsize(src)
print("%d icons, %.1f MB -> %s" % (n, total / 1e6, os.path.normpath(dst)))
