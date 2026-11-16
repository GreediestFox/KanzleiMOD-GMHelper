#!/usr/bin/env python3
"""Validate shared/*.kz and copy them to where they are used. Run after every edit of a .kz file.

  server  -> server/mods/LiFx/KanzleiCore/data/   commands.kz ground.kz animals.kz   (the server is the master copy the clients ask for)
  client  -> client/mod/KanzleiMOD/data/          commands.kz animals.kz hidden.kz    (offline fallback copy; the Brain prefers the server's)
Exit code 1 = validation failed, nothing copied.
"""
import os, re, shutil, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHARED = os.path.join(ROOT, "shared")
TARGETS = {
    os.path.join(ROOT, "server", "mods", "LiFx", "KanzleiCore", "data"): ["commands.kz", "ground.kz", "animals.kz", "durability.kz"],
    os.path.join(ROOT, "client", "mod", "KanzleiMOD", "data"): ["commands.kz", "animals.kz", "hidden.kz"],
}
VIA = {"server", "slash", "local"}
ARG_TYPES = {"item", "building", "object", "thing", "animal", "ground", "player", "int", "text", "word", "choice"}
errors = []
FORBIDDEN = '"' + chr(92) + ';%`'


def rows(name, ncols):
    out = []
    with open(os.path.join(SHARED, name), encoding="utf-8") as fh:
        text = fh.read()
    for n, line in enumerate(text.split("\n"), 1):
        if not line.strip() or line.startswith("#"):
            continue
        if len(line) > 240:
            errors.append(f"{name}:{n}: line is {len(line)} characters, the game's network strings allow 240")
        f = line.split("\t")
        if len(f) < ncols:
            errors.append(f"{name}:{n}: expected {ncols}+ TAB separated columns, got {len(f)}")
            continue
        out.append((n, f))
    return out


def check_commands():
    seen = set()
    for n, f in rows("commands.kz", 7):
        cid, cat, via, tpl, args = f[:5]
        if not re.fullmatch(r"[a-z][a-z0-9_]*", cid):
            errors.append(f"commands.kz:{n}: bad id '{cid}' (lower case letters, digits, _)")
        if cid in seen:
            errors.append(f"commands.kz:{n}: duplicate id '{cid}'")
        seen.add(cid)
        if via not in VIA:
            errors.append(f"commands.kz:{n}: via must be one of {sorted(VIA)}")
        if via != "local" and not tpl:
            errors.append(f"commands.kz:{n}: template missing")
        if via == "server" and not tpl.startswith("!"):
            errors.append(f"commands.kz:{n}: a server command template must start with !")
        if via == "slash" and not tpl.startswith("/"):
            errors.append(f"commands.kz:{n}: a slash command template must start with /")
        names = []
        for a in [x for x in args.split(",") if x]:
            m = re.fullmatch(r"([a-z][a-z0-9_]*):([a-z]+)(\([^)]*\))?(=[^?]*)?\??", a)
            if not m or m.group(2) not in ARG_TYPES:
                errors.append(f"commands.kz:{n}: bad arg '{a}'")
            else:
                names.append(m.group(1))
        for ph in re.findall(r"\{([a-z0-9_]+)\}", tpl):
            if ph not in names:
                errors.append(f"commands.kz:{n}: placeholder {{{ph}}} has no arg")
        if any(c in tpl for c in FORBIDDEN):
            errors.append(f"commands.kz:{n}: template contains a forbidden character")
    return len(seen)


def check_simple(name, ncols, idcheck=None):
    seen = set()
    for n, f in rows(name, ncols):
        if f[0] in seen:
            errors.append(f"{name}:{n}: duplicate '{f[0]}'")
        seen.add(f[0])
        if idcheck and not re.fullmatch(idcheck, f[1]):
            errors.append(f"{name}:{n}: '{f[1]}' does not look right")
    return len(seen)


nc = check_commands()
na = check_simple("animals.kz", 3)
ng = check_simple("ground.kz", 4, r"\d+")
for n, f in rows("durability.kz", 2):
    if not re.fullmatch(r"\*|\d+", f[0]) or not re.fullmatch(r"\d+", f[1]):
        errors.append(f"durability.kz:{n}: expected '<type id or *> TAB <number>'")
for n, f in rows("hidden.kz", 1):
    if not re.fullmatch(r"\d+(-\d+)?", f[0].strip()):
        errors.append(f"hidden.kz:{n}: bad id range '{f[0]}'")

if errors:
    print("VALIDATION FAILED:")
    print("\n".join("  " + e for e in errors))
    sys.exit(1)

for d, names in TARGETS.items():
    os.makedirs(d, exist_ok=True)
    for nme in names:
        shutil.copyfile(os.path.join(SHARED, nme), os.path.join(d, nme))
        print("copied", nme, "->", os.path.relpath(d, ROOT))
print(f"OK: {nc} commands, {na} animals, {ng} ground materials")
