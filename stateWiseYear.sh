#!/bin/bash

# Config
# Run from backend:
#   bash stateWiseYear.sh

YEARS=(2024 2025 2026)

STATES=(
  "Andaman & Nicobar"
  "Manipur"
  "Meghalaya"
  "Mizoram"
  "Nagaland"
  "Sikkim"
)

DELAY=3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/src/gem/state_wise_contract_details.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/state_wise_contract_details.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/state_wise_contract_details.js"
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

if [[ ${#STATES[@]} -eq 0 ]]; then
  echo "STATES array is empty — add at least one state"
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

TOTAL=0

# Calculate total terminals
for YEAR in "${YEARS[@]}"
do
  if [[ "$YEAR" == "2026" ]]; then
    MONTHS=(1 2 3 4 5 6 7 8)
  else
    MONTHS=(1 2 3 4 5 6 7 8 9 10 11 12)
  fi

  TOTAL=$((TOTAL + ${#MONTHS[@]} * ${#STATES[@]}))
done

echo "=============================================="
echo " Starting State Wise Contract Scraper"
echo "=============================================="
echo "Years  : ${YEARS[*]}"
echo "States : ${STATES[*]}"
echo "Delay  : ${DELAY}"
echo "Total terminals: ${TOTAL}"
echo "Script : ${NODE_SCRIPT}"
echo "=============================================="
echo

for YEAR in "${YEARS[@]}"
do
  # 2026 only Jan-Aug
  if [[ "$YEAR" == "2026" ]]; then
    MONTHS=(1 2 3 4 5 6 7 8)
  else
    # Other years Jan-Dec
    MONTHS=(1 2 3 4 5 6 7 8 9 10 11 12)
  fi

  echo
  echo "=============================================="
  echo " YEAR: ${YEAR}"
  echo " Months: ${MONTHS[*]}"
  echo "=============================================="

  for STATE in "${STATES[@]}"
  do
    echo
    echo "── ${STATE} | ${YEAR} ──"

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
    do script "cd '${BACKEND_DIR}' && echo 'STATE DETAILS: ${FROM} → ${TO} | ${STATE}' && '${NODE_BIN}' '${NODE_SCRIPT}' --state '${STATE}' --from ${FROM} --to ${TO} --down-to-top --delay-${DELAY}"
end tell
EOF

      echo "  Opened ${STATE}: ${FROM} → ${TO}"

      sleep 1
    done
  done
done

echo
echo "=============================================="
echo " Done — ${TOTAL} Terminal window(s) launched."
echo "=============================================="