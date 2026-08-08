#!/usr/bin/env bash
# Publish one freshly-rendered domain to the `data` branch, keeping the others.
#
# The branch stays a SINGLE orphan commit — 61 PNGs rewritten four times a day
# would otherwise grow the repository without bound, and nothing reads the
# history. So this pulls down whatever is currently published (which is where
# the OTHER domains live), swaps in this run's directory, rebuilds the root
# manifest from every domain.json present, and force-pushes a new orphan.
#
# Env: DOMAIN (e.g. hrrr, cams) or DOMAINS (space-separated, when one render
# writes several — the light and dark palettes of the same field are two
# directories), GITHUB_TOKEN, GITHUB_REPOSITORY.
# Both publishers share the `data-branch` concurrency group so they queue
# instead of overwriting each other's directory with a stale copy.
set -euo pipefail

: "${DOMAIN:?DOMAIN is required}"
# One render can produce several published directories; DOMAIN stays the name
# of the run for the commit message.
DOMAINS="${DOMAINS:-$DOMAIN}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

OUT_DIR="${OUT_DIR:-out}"
REPO="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
WORK="$(mktemp -d)/data"

for d in $DOMAINS; do
  if [ ! -d "${OUT_DIR}/${d}" ]; then
    echo "no ${OUT_DIR}/${d} to publish — the render step produced nothing" >&2
    exit 1
  fi
done

# Missing branch is the first-run case, not an error.
if git clone --quiet --depth 1 --branch data "$REPO" "$WORK"; then
  rm -rf "$WORK/.git"
else
  mkdir -p "$WORK"
fi

for d in $DOMAINS; do
  rm -rf "${WORK:?}/${d}"
  cp -r "${OUT_DIR}/${d}" "$WORK/${d}"
done

python scripts/render/assemble_manifest.py "$WORK"

cd "$WORK"
git init --quiet -b data
git config user.name "smokeshow-bot"
git config user.email "actions@users.noreply.github.com"
git add -A
git commit --quiet -m "${DOMAIN} frames $(date -u +%FT%H:%MZ)"

for attempt in 1 2 3 4; do
  if git push --quiet -f "$REPO" data; then
    echo "published ${DOMAIN} ($(du -sh . | cut -f1) on the branch)"
    exit 0
  fi
  echo "push failed, retrying in $((attempt * attempt * 2))s" >&2
  sleep $((attempt * attempt * 2))
done
exit 1
