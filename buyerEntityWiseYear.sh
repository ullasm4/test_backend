#!/bin/bash

# Config
# Run from backend:
#   bash buyerEntityWiseYear.sh
#
# PARTS=1  → one terminal, sequential pending loop:
#              entity complete → fetch next pending → stop when all done
# PARTS=N  → N parallel terminals (--worker-loop):
#              each takes a slice, re-query & re-assign until all done
#
# Prerequisites (run once):
#   npm --prefix backend run migrate
#
# PARTS=1 only: ENTITIES array = priority names first, then remaining pending.
# PARTS>1:      all pending entities split across workers (ENTITIES ignored).

PARTS=40
DELAY=1

# Optional years override (comma-separated). Empty = 2024,2025,2026
YEARS=""

# Priority entities (PARTS=1 only). Leave empty for all pending from DB, A→Z.
ENTITIES=(
  "Department of Agricultural Research and Education (DARE)"
)

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

cd "${BACKEND_DIR}"

DELAY_ARG=""
if [[ "$DELAY" -gt 0 ]]; then
  DELAY_ARG=" --delay-${DELAY}"
fi

YEARS_ARG=""
if [[ -n "${YEARS// /}" ]]; then
  YEARS_ARG=" --years ${YEARS}"
fi

echo "=============================================="
echo " buyerEntityWiseYear.sh"
echo "=============================================="
echo "Parts    : ${PARTS}"
echo "Delay    : ${DELAY}"
echo "Years    : ${YEARS:-2024,2025,2026 (default)}"
if [[ "$PARTS" -eq 1 && ${#ENTITIES[@]} -gt 0 ]]; then
  echo "Priority : ${ENTITIES[*]}"
elif [[ "$PARTS" -eq 1 ]]; then
  echo "Priority : (none — all pending from DB, A→Z)"
else
  echo "Priority : (PARTS>1 — workers split all pending from DB)"
fi
echo "Store    : new_contracts (buyer_entity_id → buyer_entities)"
echo "Script   : ${NODE_SCRIPT}"
if [[ "$PARTS" -eq 1 ]]; then
  echo "Mode     : sequential — entity done → next pending → stop when all done"
else
  echo "Mode     : ${PARTS} workers — --worker-loop re-assign until all done"
fi
echo "=============================================="
echo

if [[ "$PARTS" -gt 1 ]]; then
  for PART in $(seq 1 "$PARTS")
  do
    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'BUYER ENTITY YEAR: part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --auto --worker-loop --parts=${PARTS} --part=${PART} ${DELAY_ARG}${YEARS_ARG}"
end tell
EOF

    echo "Opened worker part ${PART}/${PARTS}"
    sleep 1
  done

  echo
  echo "Done — ${PARTS} worker Terminal window(s) launched."
  echo "Each stops when all buyer entities are listing_complete."
  exit 0
fi

# PARTS=1 — single terminal, sequential pending loop
ARGS=(--auto)

if [[ "$DELAY" -gt 0 ]]; then
  ARGS+=(--delay-"${DELAY}")
fi

if [[ -n "${YEARS// /}" ]]; then
  ARGS+=(--years "${YEARS}")
fi

if [[ ${#ENTITIES[@]} -gt 0 ]]; then
  PRIORITY=""
  for ENTITY in "${ENTITIES[@]}"; do
    [[ -z "${ENTITY// /}" ]] && continue
    if [[ -n "$PRIORITY" ]]; then
      PRIORITY+=",${ENTITY}"
    else
      PRIORITY="${ENTITY}"
    fi
  done
  if [[ -n "$PRIORITY" ]]; then
    ARGS+=(--priority-entities "${PRIORITY}")
  fi
fi

exec "${NODE_BIN}" "${NODE_SCRIPT}" "${ARGS[@]}"
