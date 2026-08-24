#!/bin/bash

# Config — edit YEAR / STATES, then run from backend:
#   bash stateWiseYear.sh
#
# Opens one Terminal window per state × month:
#   2026 → Jan–Aug (8 terminals per state)
#   other years → Jan–Dec (12 terminals per state)
#   node src/gem/state_wise_contract_details.js --state "Gujarat" \
#     --from 01-MM-YYYY --to LAST-MM-YYYY --down-to-top --delay-3

YEAR=2026
STATES=(
  "Delhi"
  "Haryana"
  "Punjab"
  "Himachal Pradesh"
  "Jammu & Kashmir"
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

if ! [[ "$YEAR" =~ ^[0-9]{4}$ ]]; then
  echo "YEAR must be YYYY (got: $YEAR)"
  exit 1
fi

if [[ ${#STATES[@]} -eq 0 ]]; then
  echo "STATES array is empty — add at least one state"
  exit 1
fi

if [[ "$YEAR" == "2026" ]]; then
  MONTHS=(1 2 3 4 5 6 7 8)
else
  MONTHS=(1 2 3 4 5 6 7 8 9 10 11 12)
fi

last_day_of_month() {
  local month=$1
  case $month in
    1|3|5|7|8|10|12) echo 31 ;;
    4|6|9|11) echo 30 ;;
    2)
      if (( YEAR % 400 == 0 || (YEAR % 4 == 0 && YEAR % 100 != 0) )); then
        echo 29
      else
        echo 28
      fi
      ;;
  esac
}

MONTH_COUNT=${#MONTHS[@]}
STATE_COUNT=${#STATES[@]}
TOTAL=$((MONTH_COUNT * STATE_COUNT))

echo "Starting ${TOTAL} terminal(s) for ${STATE_COUNT} state(s) × ${MONTH_COUNT} month(s) in ${YEAR}"
echo "  states=${STATES[*]}"
echo "  months=${MONTHS[*]}"
echo "  script=${NODE_SCRIPT}"
echo "  delay=${DELAY}"
echo

for STATE in "${STATES[@]}"
do
  echo "── ${STATE} ──"

  for MONTH in "${MONTHS[@]}"
  do
    if ! [[ "$MONTH" =~ ^[1-9]$|^1[0-2]$ ]]; then
      echo "Invalid month: $MONTH (use 1–12)"
      exit 1
    fi

    MM=$(printf "%02d" "$MONTH")
    LAST_DAY=$(last_day_of_month "$MONTH")
    FROM="01-${MM}-${YEAR}"
    TO="${LAST_DAY}-${MM}-${YEAR}"

    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'STATE DETAILS: ${FROM} → ${TO} | ${STATE}' && '${NODE_BIN}' '${NODE_SCRIPT}' --state '${STATE}' --from ${FROM} --to ${TO} --down-to-top --delay-${DELAY}"
end tell
EOF

    echo "  Opened ${FROM} → ${TO}"
    sleep 1
  done
done

echo
echo "Done — ${TOTAL} Terminal window(s) launched for ${YEAR}."
