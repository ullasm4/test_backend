#!/bin/bash

# Config — edit LEVELS / PARTS below, then run: bash scrapeBuyerEntities.sh
#
# Scrapes GeM buyer entity autocomplete in prefix order:
#   level 1 → single char   (a, b, c, …)
#   level 2 → double combo  (aa, ab, …)
#   level 3 → triple combo  (aaa, aab, …)
#   level 4 → quad combo    (aaaa, aaab, …)
#
# Opens one Terminal per (level × part):
#   node src/gem/department/scrapeBuyerEntities.js --level 1 --part 1 --parts 10

LEVELS=(
  1
  2
  3
  4
)

PARTS=10
DELAY=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Works from repo root (…/Test) or from backend (…/Test/backend)
if [[ -f "${SCRIPT_DIR}/src/gem/department/scrapeBuyerEntities.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/department/scrapeBuyerEntities.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/department/scrapeBuyerEntities.js"
NODE_BIN="$(command -v node)"

if [[ ! -f "$NODE_SCRIPT" ]]; then
  echo "script not found: $NODE_SCRIPT"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH"
  exit 1
fi

if [[ ${#LEVELS[@]} -eq 0 ]]; then
  echo 'Set LEVELS=( 1 2 3 4 ) at the top of this script'
  exit 1
fi

if ! [[ "$PARTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PARTS must be a positive integer (got: $PARTS)"
  exit 1
fi

if ! [[ "$DELAY" =~ ^[0-9]+$ ]]; then
  echo "DELAY must be a non-negative integer (got: $DELAY)"
  exit 1
fi

DELAY_ARG=""
if [[ "$DELAY" -gt 0 ]]; then
  DELAY_ARG=" --delay-${DELAY}"
fi

TOTAL=0
for LEVEL in "${LEVELS[@]}"; do
  if ! [[ "$LEVEL" =~ ^[1-4]$ ]]; then
    echo "Each LEVEL must be 1, 2, 3, or 4 (got: $LEVEL)"
    exit 1
  fi
  TOTAL=$((TOTAL + PARTS))
done

echo "Starting ${TOTAL} terminal(s)"
echo "  levels=${LEVELS[*]}"
echo "  parts=${PARTS} (per level)"
echo "  delay=${DELAY}"
echo

for LEVEL in "${LEVELS[@]}"
do
  for PART in $(seq 1 "$PARTS")
  do
    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'BUYER ENTITIES: level ${LEVEL} | part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --level ${LEVEL} --part ${PART} --parts ${PARTS}${DELAY_ARG}"
end tell
EOF

    echo "Opened terminal level ${LEVEL} part ${PART}/${PARTS}"
    sleep 1
  done
done

echo
echo "Done — ${TOTAL} Terminal window(s) launched."
