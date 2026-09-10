#!/usr/bin/env bash
# Runs the backfill in the background with a persistent log, auto-restarting
# on crash. Safe because progress is committed per-activity/per-segment (see
# README's "Known limitation"-adjacent note on resumability) — a restart just
# picks up where the last attempt left off, it never repeats work.
#
# Usage:
#   ./scripts/backfill.sh          # start in the background, print PID + log path
#   tail -f logs/backfill-*.log    # watch progress
#   kill $(cat logs/backfill.pid)  # stop it
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p logs
timestamp="$(date +%Y%m%d-%H%M%S)"
log_file="logs/backfill-${timestamp}.log"
pid_file="logs/backfill.pid"
max_restarts=20
restart_delay=30

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Backfill already running (PID $(cat "$pid_file")). Check $log_file or logs/backfill.pid." >&2
  exit 1
fi

run_loop() {
  local attempt=0
  while (( attempt < max_restarts )); do
    attempt=$((attempt + 1))
    echo "[$(date -u +%FT%TZ)] launcher: starting attempt ${attempt}/${max_restarts}"
    if npm run --silent sync:backfill; then
      echo "[$(date -u +%FT%TZ)] launcher: backfill completed successfully"
      return 0
    fi
    echo "[$(date -u +%FT%TZ)] launcher: backfill exited non-zero, retrying in ${restart_delay}s"
    sleep "$restart_delay"
  done
  echo "[$(date -u +%FT%TZ)] launcher: giving up after ${max_restarts} attempts"
  return 1
}

nohup bash -c "$(declare -f run_loop); max_restarts=${max_restarts}; restart_delay=${restart_delay}; run_loop" \
  >> "$log_file" 2>&1 &

echo $! > "$pid_file"
echo "Backfill launched in background (PID $(cat "$pid_file"))."
echo "Log: $log_file"
echo "Tail it with: tail -f $log_file"
