#!/bin/sh
# Copy backlog-spec's example backlogs (the sibling repo) into test/fixtures/, replacing what is
# there. Run it after the examples change, then commit. Copies, not links, so the tests and CI
# never need a backlog-spec checkout.
set -e
SPEC="$(cd "$(dirname "$0")/../../backlog-spec" && pwd)"
cd "$(dirname "$0")/.."
[ -d "$SPEC/examples" ] || { echo "sync-fixtures: no examples/ in $SPEC" >&2; exit 1; }
rm -rf test/fixtures
cp -R "$SPEC/examples" test/fixtures
echo "sync-fixtures: $(find test/fixtures -type f | wc -l | tr -d ' ') files from $SPEC/examples (backlog-spec $(git -C "$SPEC" rev-parse --short HEAD))"
