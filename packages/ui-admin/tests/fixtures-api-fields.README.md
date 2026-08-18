# fixtures-api-fields.txt

Every field name an admin table could render as a column header, extracted from
the backend repository. Regenerate after the API changes:

```bash
cd services/api/src/vav   # in the vavactivity repository
python3.12 - <<'PY' > <this-repo>/packages/ui-admin/tests/fixtures-api-fields.txt
import ast, pathlib, sys
fields, skipped = set(), []
def walk(path, want_mapped):
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError as exc:
        skipped.append(f"{path}: {exc}"); return
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef): continue
        for stmt in node.body:
            if not (isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)): continue
            name = stmt.target.id
            if name.startswith("_") or name == "model_config": continue
            if want_mapped:
                ann = ast.unparse(stmt.annotation)
                value = ast.unparse(stmt.value) if stmt.value else ""
                if not (ann.startswith("Mapped[") or "mapped_column" in value): continue
            fields.add(name)
for p in pathlib.Path(".").rglob("schemas.py"): walk(p, False)
for p in pathlib.Path("models").rglob("*.py"): walk(p, True)
for f in sorted(fields): print(f)
for l in skipped: print(l, file=sys.stderr)
PY
```

Two sources on purpose. Response schemas alone miss every endpoint that returns
row mappings selected straight from the ORM — the orders console is one, which
is why `order_number` and the `*_total_minor` columns are model-only.

Python 3.12 is required: `common/schemas.py` uses PEP 695 generics, which 3.11
cannot parse. The script reports files it had to skip rather than silently
narrowing the fixture.
