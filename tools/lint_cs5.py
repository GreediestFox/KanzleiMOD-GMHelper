#!/usr/bin/env python3
"""Offline checks for the AmIAlive C# sources (there is no compiler in the build container; the real compile happens with Build.bat on Windows):
  1. syntax (tree-sitter C# grammar)
  2. only C# 5 features (the csc.exe that ships with Windows, v4.0.30319, rejects newer syntax)
  3. every Class.Member reference between our own classes exists (typos like Srv.StopMarkTxt)
Needs:  pip install tree-sitter tree-sitter-c-sharp        Usage:  python tools/lint_cs5.py amialive/src"""
import glob, sys, os
import tree_sitter_c_sharp as cs
import tree_sitter as ts

PARSER = ts.Parser(ts.Language(cs.language()))
NEWER = {
    "interpolated_string_expression": "string interpolation $\"\" (C# 6)",
    "conditional_access_expression": "?. operator (C# 6)",
    "arrow_expression_clause": "expression-bodied member (C# 6)",
    "is_pattern_expression": "pattern matching (C# 7)",
    "declaration_pattern": "pattern matching (C# 7)",
    "declaration_expression": "out var / inline declaration (C# 7)",
    "local_function_statement": "local function (C# 7)",
    "tuple_expression": "tuple (C# 7)",
    "tuple_type": "tuple (C# 7)",
    "throw_expression": "throw expression (C# 7)",
    "catch_filter_clause": "exception filter (C# 6)",
    "switch_expression": "switch expression (C# 8)",
    "recursive_pattern": "pattern (C# 8)",
    "range_expression": "range (C# 8)",
    "with_expression": "with (C# 9)",
    "nullable_directive": "nullable (C# 8)",
}

def walk(n):
    yield n
    for c in n.children:
        for x in walk(c):
            yield x

def text(src, n):
    return src[n.start_byte:n.end_byte].decode("utf-8", "replace")

def main(folder):
    files = sorted(glob.glob(os.path.join(folder, "*.cs")))
    problems = 0
    members = {}
    trees = {}
    for f in files:
        src = open(f, "rb").read()
        t = PARSER.parse(src)
        trees[f] = (src, t)
        for n in walk(t.root_node):
            if n.type == "ERROR" or n.is_missing:
                print("%s:%d: syntax problem near %r" % (f, n.start_point[0] + 1, text(src, n)[:50])); problems += 1
            if n.type in NEWER:
                print("%s:%d: %s" % (f, n.start_point[0] + 1, NEWER[n.type])); problems += 1
            if n.type == "property_declaration":
                for c in n.children:
                    if c.type == "equals_value_clause" or (c.type == "=" ):
                        print("%s:%d: auto-property initializer (C# 6)" % (f, n.start_point[0] + 1)); problems += 1
            if n.type == "invocation_expression" and text(src, n).startswith("nameof("):
                print("%s:%d: nameof (C# 6)" % (f, n.start_point[0] + 1)); problems += 1
        for n in walk(t.root_node):
            if n.type in ("class_declaration", "struct_declaration", "enum_declaration"):
                name = text(src, n.child_by_field_name("name"))
                mem = set()
                for d in walk(n):
                    if d.type == "method_declaration":
                        mem.add(text(src, d.child_by_field_name("name")))
                    elif d.type == "property_declaration":
                        mem.add(text(src, d.child_by_field_name("name")))
                    elif d.type in ("field_declaration",):
                        for v in walk(d):
                            if v.type == "variable_declarator":
                                mem.add(text(src, v.child_by_field_name("name") or v.children[0]))
                    elif d.type == "enum_member_declaration":
                        mem.add(text(src, d.child_by_field_name("name")))
                members.setdefault(name, set()).update(mem)
    # cross references: Name.Member where Name is one of our classes (S.x is the Settings instance)
    alias = {"S": "Settings"}
    for f, (src, t) in trees.items():
        for n in walk(t.root_node):
            if n.type == "member_access_expression":
                expr = n.child_by_field_name("expression")
                nm = n.child_by_field_name("name")
                if expr is None or nm is None or expr.type != "identifier":
                    continue
                cls = text(src, expr)
                cls = alias.get(cls, cls)
                if cls in members and cls != "Settings" or (cls == "Settings" and text(src, expr) == "S"):
                    member = text(src, nm)
                    if member not in members[cls] and member not in ("ToString", "Length", "Count"):
                        print("%s:%d: %s.%s does not exist" % (f, n.start_point[0] + 1, cls, member)); problems += 1
    print("%d file(s) checked, %s" % (len(files), "OK" if not problems else "%d problem(s)" % problems))
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "amialive/src"))
