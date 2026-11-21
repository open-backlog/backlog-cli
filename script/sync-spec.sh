#!/bin/sh
# Copy from backlog-spec (the sibling repo), replacing what is here:
#   examples/          → test/fixtures/   the example backlogs, as test fixtures
#   schema/<version>/  → schema/          the JSON Schema the validator checks single files with
# Run it after either changes in backlog-spec, then commit. Copies, not links, so the tests, CI
# and the published package never need a backlog-spec checkout.
set -e
SPEC="$(cd "$(dirname "$0")/../../backlog-spec" && pwd)"
cd "$(dirname "$0")/.."
[ -d "$SPEC/examples" ] && [ -d "$SPEC/schema" ] || { echo "sync-spec: no examples/ or schema/ in $SPEC" >&2; exit 1; }
rm -rf test/fixtures schema
cp -R "$SPEC/examples" test/fixtures
mkdir -p schema
for d in "$SPEC"/schema/[0-9]*/; do cp -R "$d" "schema/$(basename "$d")"; done
echo "sync-spec: $(find test/fixtures -type f | wc -l | tr -d ' ') fixture files and $(find schema -name '*.schema.json' | wc -l | tr -d ' ') schema files from backlog-spec $(git -C "$SPEC" rev-parse --short HEAD)"
