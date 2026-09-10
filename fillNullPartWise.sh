#!/bin/bash

# Config — edit these, then run: bash fillNullPartWise.sh
#
# Launches PARTS parallel Terminal workers for fill_null_contract_fields.js.
# Each worker:
#   1. Login (GeM cookie)
#   2. Loads new_contracts WHERE seller_id OR buyer_id OR contract_pdf_url IS NULL
#   3. Takes its slice (part K of N)
#   4. Fills order_id → PDF → S3 → seller/buyer/contract_pdf_url
#
# Example: PARTS=15 → 15 terminals, each running part K of 15.

PARTS=20
DELAY=1

# Optional filters (leave empty to process all pending null-field contracts)
# STATE="Gujarat"
# CONTRACT_DATE="01-2024"   # MM-YYYY or DD-MM-YYYY
# LIMIT=100                 # cap contracts per worker after part slice

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/src/gem/fill_null_contract_fields.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/fill_null_contract_fields.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/fill_null_contract_fields.js"
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

EXTRA_ARGS=""
if [[ -n "${STATE:-}" ]]; then
  EXTRA_ARGS+=" --state '${STATE}'"
fi
if [[ -n "${CONTRACT_DATE:-}" ]]; then
  EXTRA_ARGS+=" --contract-date '${CONTRACT_DATE}'"
fi
if [[ -n "${LIMIT:-}" ]]; then
  if ! [[ "$LIMIT" =~ ^[1-9][0-9]*$ ]]; then
    echo "LIMIT must be a positive integer (got: $LIMIT)"
    exit 1
  fi
  EXTRA_ARGS+=" --limit ${LIMIT}"
fi

echo "=============================================="
echo " Fill Null Fields Part-Wise (fillNullPartWise)"
echo "=============================================="
echo "Workers : ${PARTS}"
echo "Delay   : ${DELAY}"
echo "State   : ${STATE:-all}"
echo "Date    : ${CONTRACT_DATE:-all pending nulls}"
echo "Limit   : ${LIMIT:-none}"
echo "Script  : ${NODE_SCRIPT}"
echo "Target  : seller_id OR buyer_id OR contract_pdf_url NULL"
echo "Mode    : --parts / --part"
echo "=============================================="
echo

for PART in $(seq 1 "$PARTS")
do
  osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'FILL NULL WORKER: part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --parts=${PARTS} --part=${PART}${DELAY_ARG}${EXTRA_ARGS}"
end tell
EOF

  echo "Opened worker part ${PART}/${PARTS}"
  sleep 1
done

echo
echo "Done — ${PARTS} worker Terminal window(s) launched."
echo "Each processes its slice of new_contracts with null seller_id/buyer_id/contract_pdf_url."
