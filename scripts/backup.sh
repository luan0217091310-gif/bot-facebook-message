#!/usr/bin/env bash
set -euo pipefail
umask 077

data_dir="${1:-/opt/bothieu/data}"
backup_dir="${2:-/opt/bothieu/backups}"

if [[ ! -d "$data_dir" ]]; then
  printf 'Data directory does not exist: %s\n' "$data_dir" >&2
  exit 1
fi

data_dir="$(cd -- "$data_dir" && pwd -P)"
mkdir -p -- "$backup_dir"
backup_dir="$(cd -- "$backup_dir" && pwd -P)"
case "$backup_dir/" in
  "$data_dir/"*) printf 'Backup directory must be outside the data directory.\n' >&2; exit 1 ;;
esac

archive="$(mktemp "$backup_dir/bothieu-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.tar.gz")"
trap 'rm -f -- "$archive"' ERR
tar -czf "$archive" -C "$data_dir" .
printf 'Backup created: %s\n' "$archive"
