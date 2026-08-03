#!/usr/bin/env bash
# Publish one renderer's output into its own subdirectory of the `data` branch.
#
#   publish-data.sh <subdir> <source-dir>
#
# The HRRR job used to `git init` a fresh branch in out/ and force-push it,
# which is correct with exactly one producer and destructive with two: whichever
# renderer ran last would delete the other's frames. Now each job clones the
# branch, replaces only its own subdirectory, and pushes a normal commit.
#
# Both workflows share a `data-branch` concurrency group so these pushes cannot
# interleave. The retry below covers the case where they do anyway.
set -euo pipefail

SUBDIR="$1"
SRC="$2"
REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
WORK="$(mktemp -d)"

git config --global user.name "smokeshow-bot"
git config --global user.email "actions@users.noreply.github.com"

publish() {
  rm -rf "$WORK/data"
  if ! git clone --depth 1 --branch data "$REMOTE" "$WORK/data" 2>/dev/null; then
    # First ever publish: the branch does not exist yet.
    mkdir -p "$WORK/data"
    git -C "$WORK/data" init -b data
    git -C "$WORK/data" remote add origin "$REMOTE"
  fi

  rm -rf "${WORK:?}/data/${SUBDIR:?}"
  mkdir -p "$WORK/data/$SUBDIR"
  cp -r "$SRC/." "$WORK/data/$SUBDIR/"

  git -C "$WORK/data" add -A
  if git -C "$WORK/data" diff --quiet --cached; then
    echo "no change in $SUBDIR — nothing to publish"
    return 0
  fi
  git -C "$WORK/data" commit -m "$SUBDIR frames $(date -u +%FT%H:%MZ)"
  git -C "$WORK/data" push origin data
}

for attempt in 1 2 3; do
  if publish; then
    exit 0
  fi
  echo "publish attempt $attempt failed (likely a concurrent push) — retrying"
  sleep $((attempt * 5))
done

echo "could not publish $SUBDIR after 3 attempts" >&2
exit 1
