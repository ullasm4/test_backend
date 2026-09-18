#!/bin/bash

# After contracts are already checked (seller, buyer, PDF saved),
# load rows whose created_at is AFTER the date below, read each PDF,
# and set total_value from the PDF total label.
#
# Date is DD-MM-YYYY (10-9-2026 = 10 September 2026).
# "After" means created_at date is later than this day (that day itself is skipped).
#
# PARTS=10 opens 10 Terminal windows. Each window runs one part (1..PARTS)
# and only updates its slice of the matching contracts.
#
#   bash fixContractTotalValue.sh
#
# Preview only (no DB writes):
#   DRY_RUN=1 bash fixContractTotalValue.sh

AFTER_DATE="16-9-2026"
PARTS=5

DRY_RUN="${DRY_RUN:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/src/scripts/fixContractTotalValue.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/scripts/fixContractTotalValue.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/scripts/fixContractTotalValue.js"
NODE_BIN="$(command -v node)"

if [[ ! -f "$NODE_SCRIPT" ]]; then
  echo "script not found: $NODE_SCRIPT"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH"
  exit 1
fi

if [[ -z "${AFTER_DATE// /}" ]]; then
  echo "Set AFTER_DATE=\"10-9-2026\" at the top (DD-MM-YYYY)"
  exit 1
fi

if ! [[ "$AFTER_DATE" =~ ^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$ ]] && \
   ! [[ "$AFTER_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid AFTER_DATE: ${AFTER_DATE}"
  echo "  Use DD-MM-YYYY, for example 10-9-2026"
  exit 1
fi

if ! [[ "$PARTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PARTS must be a positive integer (got: $PARTS)"
  exit 1
fi

DRY_ARG=""
MODE_LABEL="write totals"
if [[ "$DRY_RUN" == "1" || "$DRY_RUN" == "true" ]]; then
  DRY_ARG=" --dry-run"
  MODE_LABEL="dry-run"
fi

echo "======================================================"
echo " Fix contract total_value from PDF"
echo "======================================================"
echo "After  : created_at > ${AFTER_DATE}"
echo "Parts  : ${PARTS}"
echo "Mode   : ${MODE_LABEL}"
echo "Only   : contracts that already have seller, buyer, and PDF"
echo "Script : ${NODE_SCRIPT}"
echo "======================================================"
echo

for PART in $(seq 1 "$PARTS")
do
  osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'FIX TOTAL VALUE: created_at after ${AFTER_DATE} | part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --after-created '${AFTER_DATE}' --parts=${PARTS} --part=${PART} --yes${DRY_ARG}"
end tell
EOF

  echo "Opened part ${PART}/${PARTS}"
  sleep 1
done

echo
echo "Done — ${PARTS} Terminal window(s) launched."
echo "Each part reads its slice of contracts created after ${AFTER_DATE} and sets total_value."
echo "Preview without writes: DRY_RUN=1 bash fixContractTotalValue.sh"
