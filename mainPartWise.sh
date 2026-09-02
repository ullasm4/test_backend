#!/bin/bash

# Config — edit these, then run: bash mainPartWise.sh
#
# Launches PARTS parallel Terminal workers for buyer entity contract listing.
# Each worker:
#   1. Queries pending buyer_entities (listing_complete = false)
#   2. Takes its slice (part K of N)
#   3. Scrapes 2024 → 2025 → 2026 (Jan–Aug) for that batch
#   4. Marks entities listing_complete
#   5. Re-queries count, re-assigns parts, continues
#   6. Stops only when ALL buyer entities are complete
#
# Example: PARTS=10 → 10 terminals, ~10 entities each per round;
#          when a batch finishes, workers pick up the next pending slice.

PARTS=10
DELAY=3

# Optional years override (comma-separated). Default: 2024,2025,2026
YEARS=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/src/gem/buyer_entity_wise_contract_details.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/buyer_entity_wise_contract_details.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/buyer_entity_wise_contract_details.js"
NODE_BIN="$(command -v node)"

if [[ ! -f "$NODE_SCRIPT" ]]; then
  echo "script not found: $NODE_SCRIPT"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH"
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

YEARS_ARG=""
if [[ -n "${YEARS// /}" ]]; then
  YEARS_ARG=" --years ${YEARS}"
fi

echo "=============================================="
echo " Buyer Entity Part-Wise Workers (mainPartWise)"
echo "=============================================="
echo "Workers : ${PARTS}"
echo "Delay   : ${DELAY}"
echo "Years   : ${YEARS:-2024,2025,2026 (default)}"
echo "Script  : ${NODE_SCRIPT}"
echo "Mode    : --auto --worker-loop (re-query & re-assign until all done)"
echo "=============================================="
echo

for PART in $(seq 1 "$PARTS")
do
  osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'BUYER ENTITY WORKER: part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --auto --worker-loop --parts=${PARTS} --part=${PART} ${DELAY_ARG}${YEARS_ARG}"
end tell
EOF

  echo "Opened worker part ${PART}/${PARTS}"
  sleep 1
done

echo
echo "Done — ${PARTS} worker Terminal window(s) launched."
echo "Each stops automatically when all buyer entities are listing_complete."
