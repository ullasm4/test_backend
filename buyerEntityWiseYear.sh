#!/bin/bash

# Config
# Run from backend:
#   bash buyerEntityWiseYear.sh
#
# Opens one Terminal per calendar month:
#   2024 → 12 terminals (Jan–Dec)
#   2025 → 12 terminals (Jan–Dec)
#   2026 → 9 terminals  (Jan–Sep)
#
# Each Terminal is locked to that month (--from / --to) and:
#   1. Scrapes next pending buyer entity for that month
#   2. When that entity finishes the month → picks next pending entity
#   3. Same dates again (e.g. 01-09-2024 → 30-09-2024)
#   4. Stops when every buyer entity is done for that month
#
# Optional PRIORITY_ENTITIES: those names first, then remaining from DB.

# One year at a time — avoids flooding GeM (timeouts).
# After 2024 finishes, switch to YEARS=(2025), then YEARS=(2026).
YEARS=(2024)

# Leave empty to process all pending by name order.
PRIORITY_ENTITIES=(
  "Department of Agricultural Research and Education (DARE)"
)

DELAY=3
# Seconds between opening each month Terminal (stagger GeM load)
LAUNCH_STAGGER_SEC=5

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

if [[ ${#YEARS[@]} -eq 0 ]]; then
  echo "YEARS array is empty"
  exit 1
fi

if ! [[ "$DELAY" =~ ^[0-9]+$ ]]; then
  echo "DELAY must be a non-negative integer (got: $DELAY)"
  exit 1
fi

if ! [[ "$LAUNCH_STAGGER_SEC" =~ ^[0-9]+$ ]]; then
  echo "LAUNCH_STAGGER_SEC must be a non-negative integer (got: $LAUNCH_STAGGER_SEC)"
  exit 1
fi

last_day_of_month() {
  local year=$1
  local month=$2

  case $month in
    1|3|5|7|8|10|12)
      echo 31
      ;;
    4|6|9|11)
      echo 30
      ;;
    2)
      if (( year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) )); then
        echo 29
      else
        echo 28
      fi
      ;;
  esac
}

DELAY_ARG=""
if [[ "$DELAY" -gt 0 ]]; then
  DELAY_ARG=" --delay-${DELAY}"
fi

PRIORITY_ARG=""
PRIORITY_LABEL="(all pending by name)"
if [[ ${#PRIORITY_ENTITIES[@]} -gt 0 ]]; then
  PRIORITY_CSV=$(IFS=,; echo "${PRIORITY_ENTITIES[*]}")
  PRIORITY_ESC=$(printf '%s' "$PRIORITY_CSV" | sed "s/'/'\\\\''/g")
  PRIORITY_ARG=" --priority-entities '${PRIORITY_ESC}'"
  PRIORITY_LABEL="${PRIORITY_ENTITIES[*]} → then remaining pending"
fi

TOTAL=0
for YEAR in "${YEARS[@]}"
do
  if [[ "$YEAR" == "2026" ]]; then
    MONTHS=(1 2 3 4 5 6 7 8 9)
  else
    MONTHS=(1 2 3 4 5 6 7 8 9 10 11 12)
  fi
  TOTAL=$((TOTAL + ${#MONTHS[@]}))
done

echo "=============================================="
echo " Starting Buyer Entity Wise Contract Scraper"
echo "=============================================="
echo "Years     : ${YEARS[*]}"
echo "Priority  : ${PRIORITY_LABEL}"
echo "Delay     : ${DELAY}s per request"
echo "Stagger   : ${LAUNCH_STAGGER_SEC}s between Terminal opens"
echo "Terminals : ${TOTAL}  (one per month; next entity when month done)"
echo "Script    : ${NODE_SCRIPT}"
echo "Mode      : --month-worker (fixed dates → next entity → same dates)"
echo "=============================================="
echo

for YEAR in "${YEARS[@]}"
do
  if [[ "$YEAR" == "2026" ]]; then
    MONTHS=(1 2 3 4 5 6 7 8 9)
  else
    MONTHS=(1 2 3 4 5 6 7 8 9 10 11 12)
  fi

  echo
  echo "=============================================="
  echo " YEAR: ${YEAR}"
  echo " Months: ${MONTHS[*]}"
  echo "=============================================="

  for MONTH in "${MONTHS[@]}"
  do
    if ! [[ "$MONTH" =~ ^[1-9]$|^1[0-2]$ ]]; then
      echo "Invalid month: $MONTH"
      exit 1
    fi

    MM=$(printf "%02d" "$MONTH")
    LAST_DAY=$(last_day_of_month "$YEAR" "$MONTH")

    FROM="01-${MM}-${YEAR}"
    TO="${LAST_DAY}-${MM}-${YEAR}"

    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'BUYER ENTITY MONTH: ${FROM} → ${TO} | next entity when this month completes' && '${NODE_BIN}' '${NODE_SCRIPT}' --month-worker --from ${FROM} --to ${TO} --down-to-top${DELAY_ARG}${PRIORITY_ARG}"
end tell
EOF

    echo "  Opened: ${FROM} → ${TO}"
    sleep "${LAUNCH_STAGGER_SEC}"
  done
done

echo
echo "=============================================="
echo " Done — ${TOTAL} Terminal window(s) launched."
echo " Each month worker: entity done → next buyer entity (same dates)."
echo "=============================================="
