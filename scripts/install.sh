#!/bin/sh
# tickmark installer — downloads the latest prebuilt package from GitHub Releases,
# installs runtime dependencies via npm, and symlinks the CLI into PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/havoc-rao/tickmark/main/scripts/install.sh | sh
#
# Requirements: node >= 18, npm, curl, tar.
set -eu

OWNER="havoc-rao"
REPO="tickmark"
BIN="tickmark"

log() { echo "tickmark: $*" >&2; }
err() { echo "tickmark: ERROR: $*" >&2; exit 1; }

# ---- prerequisites ----
command -v node >/dev/null 2>&1 || err "node not found (need >= 18). install from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || err "npm not found."
node -e 'process.version.split(".").map(Number).reduce((a,b,i)=>i? a : (a[0]>=18 ? 0 : (process.exit(1))), [0])' \
  >/dev/null 2>&1 || err "node >= 18 required (current: $(node -v))."

# ---- install dirs ----
PREFIX="${PREFIX:-$HOME/.local}"
LIBDIR="${LIBDIR:-$PREFIX/share/tickmark}"
BINDIR="${BINDIR:-$PREFIX/bin}"
mkdir -p "$LIBDIR" "$BINDIR"

# ---- resolve latest release tag ----
# Follow github.com redirect (releases/latest → releases/tag/vX.Y.Z); not subject to api rate limits.
log "resolving latest release..."
TAG=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  "https://github.com/$OWNER/$REPO/releases/latest" 2>/dev/null \
  | sed 's|.*/tag/||' || true)

# Fallback: query the API (authenticated if GITHUB_TOKEN / GH_TOKEN set).
if [ -z "$TAG" ] || [ "$TAG" = "https://github.com/$OWNER/$REPO/releases/latest" ]; then
  API_URL="https://api.github.com/repos/$OWNER/$REPO/releases/latest"
  TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -n "$TOKEN" ]; then
    TAG=$(curl -fsSL -H "Authorization: Bearer $TOKEN" "$API_URL" 2>/dev/null \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' || true)
  else
    TAG=$(curl -fsSL "$API_URL" 2>/dev/null \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' || true)
  fi
fi

[ -z "$TAG" ] && err "could not resolve latest release (network or API rate limit). set GITHUB_TOKEN to bypass."

VERSION="${TAG#v}"
URL="https://github.com/$OWNER/$REPO/releases/download/$TAG/tickmark_${VERSION}.tar.gz"

# ---- download & extract ----
log "downloading $URL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
curl -fsSL -o archive.tar.gz "$URL" || {
  log "download failed."
  log "browse available assets:  https://github.com/$OWNER/$REPO/releases/tag/$TAG"
  exit 1
}
tar -xzf archive.tar.gz

# ---- install into LIBDIR ----
# Clear previous install (keep dir for stable symlink targets).
rm -rf "$LIBDIR"/* 2>/dev/null || true
cp -R bin media out package.json README.md "$LIBDIR/"

# ---- install runtime dependencies ----
log "installing dependencies (this may take a moment)..."
(cd "$LIBDIR" && npm install --omit=dev --no-audit --no-fund --silent) || {
  err "npm install failed. you may retry inside $LIBDIR manually."
}

# ---- symlink into PATH ----
ln -sf "$LIBDIR/bin/tickmark.js" "$BINDIR/$BIN"
# timd alias
ln -sf "$LIBDIR/bin/tickmark.js" "$BINDIR/timd"

log "installed -> $BINDIR/$BIN (v$VERSION)"
log "           -> $BINDIR/timd"

# ---- PATH guard (for eval usage) ----
if [ -t 1 ]; then
  case ":$PATH:" in
    *":$BINDIR:"*) ;;
    *) log "add $BINDIR to your PATH to use tickmark:" ;;
       log "  export PATH=\"$BINDIR:\$PATH\""
       log "(or restart your shell after adding it to ~/.zshrc / ~/.bashrc)" ;;
  esac
  log "done. run:  tickmark --help"
else
  # eval "$(... | sh)" — emit PATH guard for immediate activation
  printf 'case ":$PATH:" in *":%s:"*) ;; *) export PATH="%s:$PATH" ;; esac\n' "$BINDIR" "$BINDIR"
fi
