#!/bin/sh
# Builds the Chrome Web Store upload: dist/bettermobius-<version>.zip, holding
# only what the extension runs on. Checks first, so a broken or over-long
# manifest never gets as far as the store's own rejection.
set -eu

cd "$(dirname "$0")/.."

node --check content.js

# The store's limits, checked here rather than discovered on upload.
VERSION=$(python3 - <<'EOF'
import json, re, sys
m = json.load(open("manifest.json"))
problems = []
if len(m.get("name", "")) > 75:
    problems.append("name is over 75 characters")
if len(m.get("description", "")) > 132:
    problems.append("description is %d characters; the store allows 132" % len(m["description"]))
if not re.fullmatch(r"\d+(\.\d+){0,3}", m.get("version", "")):
    problems.append("version must be 1-4 dot-separated numbers")
for size, path in m.get("icons", {}).items():
    try:
        open(path, "rb").close()
    except OSError:
        problems.append("icon %s is missing: %s" % (size, path))
if problems:
    sys.exit("manifest.json: " + "; ".join(problems))
print(m["version"])
EOF
)

mkdir -p dist
OUT="dist/bettermobius-$VERSION.zip"
rm -f "$OUT"
# -X leaves out macOS extended attributes; the glob keeps .DS_Store out.
zip -q -X -r "$OUT" manifest.json content.js icons -x "*.DS_Store"

echo "Built $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' ')):"
unzip -l "$OUT" | sed -n '4,$p'
echo "Upload it at https://chrome.google.com/webstore/devconsole"
