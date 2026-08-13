#!/bin/sh
# tickmark release — patch +1 on package.json version, then add / commit / push.
#
#   sh scripts/release.sh        # 0.1.0 → 0.1.1
#   sh scripts/release.sh minor  # 0.1.0 → 0.2.0
#   sh scripts/release.sh major  # 0.1.0 → 1.0.0
#   sh scripts/release.sh 1.5.0  # specify exact version
set -eu

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# ---- resolve version bump ----
BUMP="${1:-patch}"
CUR=$(node -p 'require("./package.json").version')

case "$BUMP" in
  major)
    MAJOR=$(echo "$CUR" | cut -d. -f1)
    MINOR=0
    PATCH=0
    ;;
  minor)
    MAJOR=$(echo "$CUR" | cut -d. -f1)
    MINOR=$(echo "$CUR" | cut -d. -f2)
    PATCH=0
    ;;
  patch)
    MAJOR=$(echo "$CUR" | cut -d. -f1)
    MINOR=$(echo "$CUR" | cut -d. -f2)
    PATCH=$(echo "$CUR" | cut -d. -f3)
    PATCH=$((PATCH + 1))
    ;;
  *)
    # custom version (e.g. 1.5.0) — validate format X.Y.Z
    case "$BUMP" in
      *[!0-9.]*) echo "release: invalid version '$BUMP' (expected X.Y.Z)" >&2; exit 1 ;;
    esac
    MAJOR=$(echo "$BUMP" | cut -d. -f1)
    MINOR=$(echo "$BUMP" | cut -d. -f2)
    PATCH=$(echo "$BUMP" | cut -d. -f3)
    ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

[ "$NEW" = "$CUR" ] && { echo "release: version unchanged ($CUR)" >&2; exit 1; }

echo "release: $CUR → $NEW"

# ---- bump version in package.json (preserves formatting via node) ----
node -e "
const fs = require('fs');
const s = fs.readFileSync('package.json', 'utf8');
fs.writeFileSync('package.json', s.replace(
  /\"version\":\s*\"[^\"]+\"/,
  '\"version\": \"' + process.argv[1] + '\"'
));
" "$NEW"

# ---- stage & commit ----
git add package.json
git commit -m "chore: release v$NEW" --no-verify
git tag "v$NEW"

# ---- push commits & tag ----
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
git push origin "v$NEW"

echo "✓ v$NEW released (pushed $BRANCH + tag v$NEW)"
