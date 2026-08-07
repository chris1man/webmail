#!/usr/bin/env sh
# Run once per minute from the host. Requires: curl, df, awk, sed.
set -eu

: "${MAIL_ALERTS_URL:?Set MAIL_ALERTS_URL, e.g. https://alerts.example.com}"
: "${WEBHOOK_SECRET:?Set WEBHOOK_SECRET}"

STATE_DIR="${MAIL_ALERTS_MONITOR_STATE_DIR:-/var/lib/mail-alerts-monitor}"
DISK_PATH="${MAIL_ALERTS_DISK_PATH:-/}"
WARNING_PERCENT="${MAIL_ALERTS_DISK_WARNING_PERCENT:-80}"
CRITICAL_PERCENT="${MAIL_ALERTS_DISK_CRITICAL_PERCENT:-90}"
CHECK_URLS="${MAIL_ALERTS_CHECK_URLS:-}"

mkdir -p "$STATE_DIR"

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'
}

post_event() {
  event_type="$1"
  severity="$2"
  message="$3"
  curl --fail --silent --show-error --max-time 10 \
    -X POST "$MAIL_ALERTS_URL/webhook/system" \
    -H 'Content-Type: application/json' \
    -H "X-Alert-Secret: $WEBHOOK_SECRET" \
    --data "{\"type\":\"$(escape_json "$event_type")\",\"severity\":\"$(escape_json "$severity")\",\"message\":\"$(escape_json "$message")\"}" >/dev/null
}

check_url() {
  name="$1"
  target="$2"
  key=$(printf '%s' "$name" | tr -c 'A-Za-z0-9_.-' '_')
  state_file="$STATE_DIR/service-$key"
  previous=$(cat "$state_file" 2>/dev/null || printf 'unknown')
  if curl --fail --silent --show-error --max-time 15 -o /dev/null "$target"; then current=up; else current=down; fi
  if [ "$previous" = unknown ] && [ "$current" = up ]; then
    printf '%s' "$current" > "$state_file"
    return
  fi
  if [ "$current" != "$previous" ]; then
    if [ "$current" = up ]; then post_event "service.recovered" info "$name is available again"; else post_event "service.down" critical "$name is unavailable: $target"; fi
    printf '%s' "$current" > "$state_file"
  fi
}

check_disk() {
  used=$(df -P "$DISK_PATH" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
  [ -n "$used" ] || return 0
  if [ "$used" -ge "$CRITICAL_PERCENT" ]; then current=critical; elif [ "$used" -ge "$WARNING_PERCENT" ]; then current=warning; else current=ok; fi
  state_file="$STATE_DIR/disk-$(printf '%s' "$DISK_PATH" | tr -c 'A-Za-z0-9_.-' '_')"
  previous=$(cat "$state_file" 2>/dev/null || printf 'unknown')
  if [ "$current" != "$previous" ]; then
    case "$current" in
      critical) post_event disk.capacity critical "Disk $DISK_PATH is ${used}% full" ;;
      warning) post_event disk.capacity warning "Disk $DISK_PATH is ${used}% full" ;;
      ok) [ "$previous" != unknown ] && post_event disk.recovered info "Disk $DISK_PATH recovered to ${used}%" ;;
    esac
    printf '%s' "$current" > "$state_file"
  fi
}

printf '%s' "$CHECK_URLS" | tr ';' '\n' | while IFS='|' read -r name target; do
  [ -n "$name" ] && [ -n "$target" ] && check_url "$name" "$target"
done
check_disk
