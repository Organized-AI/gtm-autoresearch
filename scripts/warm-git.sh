#!/usr/bin/env bash
# warm-git.sh — force iCloud to materialize .git/ files before git runs mmap().
#
# Problem:
#   This repo lives inside an iCloud-synced folder. macOS evicts "cold" files
#   to cloud-only, leaving a placeholder on disk. Git uses mmap() for index
#   and pack files; mmap() on an evicted file fails with
#     fatal: .git/index: unable to map index file: Operation timed out
#
# Fix:
#   Read every git-critical file cover-to-cover so iCloud materialises it
#   locally before git touches it. Cheap on already-local files.
#
# Usage:
#   bash scripts/warm-git.sh            # just warm, then exit
#   bash scripts/warm-git.sh -- git st  # warm, then run the trailing command
#   alias gg='bash scripts/warm-git.sh --'   # in your shell rc
#
# For a permanent fix, relocate .git outside iCloud and symlink it back:
#   bash scripts/warm-git.sh relocate /Users/you/.git-store/<repo>

set -euo pipefail

cd "$(dirname "$0")/.."
GIT_DIR="${GIT_DIR:-.git}"

# ── subcommand: relocate .git out of iCloud via symlink ─────────────────
if [[ "${1:-}" == "relocate" ]]; then
  target="${2:-}"
  if [[ -z "$target" ]]; then
    echo "usage: warm-git.sh relocate <absolute-path-outside-icloud>" >&2
    exit 2
  fi
  if [[ -L "$GIT_DIR" ]]; then
    echo "$GIT_DIR is already a symlink → $(readlink "$GIT_DIR")"
    exit 0
  fi
  if [[ ! -d "$GIT_DIR" ]]; then
    echo "no $GIT_DIR to relocate" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$target")"
  echo "==> moving $GIT_DIR → $target"
  mv "$GIT_DIR" "$target"
  ln -s "$target" "$GIT_DIR"
  echo "==> done. $GIT_DIR now points at $target (outside iCloud sync)"
  exit 0
fi

# ── default path: warm the critical files, then optionally exec ─────────
warm() {
  local f=$1
  [[ -f "$f" ]] || return 0
  # brctl download (if present) nudges iCloud's sync daemon to fetch it.
  if command -v brctl >/dev/null 2>&1; then
    brctl download "$f" >/dev/null 2>&1 || true
  fi
  # Then force a full read so mmap() will succeed afterwards.
  cat "$f" >/dev/null 2>&1 || true
}

# Index + refs + HEAD are the ones git mmap()s most eagerly.
for f in \
  "$GIT_DIR/index" \
  "$GIT_DIR/HEAD" \
  "$GIT_DIR/packed-refs" \
  "$GIT_DIR/config" \
  "$GIT_DIR/ORIG_HEAD" \
  "$GIT_DIR/FETCH_HEAD"
do
  warm "$f"
done

# Pack files — these are the big ones. Evicted pack files wreck any command
# that touches history (log, diff, fetch).
if [[ -d "$GIT_DIR/objects/pack" ]]; then
  while IFS= read -r -d '' pack; do
    warm "$pack"
  done < <(find "$GIT_DIR/objects/pack" -type f \( -name '*.pack' -o -name '*.idx' \) -print0)
fi

# Loose objects under objects/??/ — cheap to walk, rarely evicted, but catch
# the straggler cases where a recent commit was cold-stored.
if [[ -d "$GIT_DIR/objects" ]]; then
  while IFS= read -r -d '' obj; do
    warm "$obj"
  done < <(find "$GIT_DIR/objects" -mindepth 2 -maxdepth 2 -type f -print0 2>/dev/null | head -c 200000)
fi

# If invoked with `-- <cmd ...>`, run the tail command.
if [[ "${1:-}" == "--" ]]; then
  shift
  exec "$@"
fi
