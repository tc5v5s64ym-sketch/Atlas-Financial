#!/bin/sh
# Trusted git wrapper for the Cursor repair step only.
# Cursor may inspect the tree; commit/push/merge stay with the workflow.
set -eu
real_git="${ATLAS_REAL_GIT:-/usr/bin/git}"
for arg in "$@"; do
  case "$arg" in
    push|merge|rebase|cherry-pick|reset|commit)
      echo "atlas-cursor-repair: git $arg is disabled for Cursor" >&2
      exit 126
      ;;
  esac
done
exec "$real_git" "$@"
