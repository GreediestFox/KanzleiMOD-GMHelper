#!/usr/bin/env python3
"""Very small TorqueScript sanity linter (no engine needed): bracket balance, unterminated strings, calls to KZ_/KZB_/LiFxGMCommands:: functions that are defined nowhere.
It does NOT replace testing in the game; it only catches typos that would stop a script file from loading."""
import re, sys, os, glob

def strip(src):
    out, i, n, line = [], 0, len(src), 1
    errs = []
    while i < n:
        c = src[i]
        if c == '/' and src[i:i+2] == '//':
            while i < n and src[i] != '\n': i += 1
            continue
        if c == '/' and src[i:i+2] == '/*':
            j = src.find('*/', i + 2)
            if j < 0: errs.append((line, 'unterminated /* comment')); break
            line += src.count('\n', i, j); i = j + 2; continue
        if c in '"\'':
            q, j, s = c, i + 1, ''
            while j < n and src[j] != q:
                if src[j] == '\\': j += 1
                if j < n and src[j] == '\n': line += 1
                j += 1
            if j >= n: errs.append((line, 'unterminated string')); break
            out.append(q + 'S' + q); i = j + 1; continue
        if c == '\n': line += 1
        out.append(c); i += 1
    return ''.join(out), errs

files = [f for pat in sys.argv[1:] for f in glob.glob(pat, recursive=True)] or sys.exit('usage: lint_cs.py <files...>')
defined, called, bad = set(), {}, 0
texts = {}
for f in files:
    src = open(f, encoding='utf-8', errors='replace').read()
    t, errs = strip(src); texts[f] = t
    for ln, e in errs: print(f"{f}:{ln}: {e}"); bad += 1
    stack = []
    for ln, l in enumerate(t.split('\n'), 1):
        for ch in l:
            if ch in '({[': stack.append((ch, ln))
            elif ch in ')}]':
                if not stack or '({['.index(stack[-1][0]) != ')}]'.index(ch): print(f"{f}:{ln}: unbalanced '{ch}'"); bad += 1; stack = []; break
                stack.pop()
    if stack: print(f"{f}: unclosed '{stack[-1][0]}' opened at line {stack[-1][1]}"); bad += 1
    for m in re.finditer(r'function\s+([A-Za-z_][\w:]*)\s*\(', t): defined.add(m.group(1))
for f, t in texts.items():
    for m in re.finditer(r'(?<![\w$%:])((?:KZ|KZB|KZBrain|KZLegacy|KZProbe)_?\w*|LiFxGMCommands::\w+|LiFxGMReq::\w+)\s*\(', t):
        name = m.group(1)
        if name.startswith('function'): continue
        called.setdefault(name, set()).add(os.path.basename(f))
# names given as strings to schedule()/call()/callbacks are checked too
for f, src in ((f, open(f, encoding='utf-8', errors='replace').read()) for f in files):
    for m in re.finditer(r'"((?:KZ|KZB|KZBrain|KZLegacy|KZProbe)_\w+)"', src): called.setdefault(m.group(1), set()).add(os.path.basename(f))
legacy = {'toggleGMPanel'}
for name, where in sorted(called.items()):
    if name not in defined and not name.startswith('KZ_local_') and name not in legacy:
        print(f"undefined function: {name}  (used in {', '.join(sorted(where))})"); bad += 1
print(f"{len(files)} files, {len(defined)} functions defined, {'OK' if not bad else str(bad) + ' problem(s)'}")
sys.exit(1 if bad else 0)
