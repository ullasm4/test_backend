#!/bin/bash

# Config — edit SETS below, then run: bash newContractStateWise.sh
#
# One entry per state. Format: "State Name|YEAR|month,month,..."
#
# Example:
#   Gujarat
#   month = 2,3,7
#   year = 2024
#   →  "Gujarat|2024|2,3,7"
#
# Opens one Terminal per month (and per part if PARTS > 1):
#   node src/gem/new_contract_scrapped.js --contract-date 02-2024 --state "Gujarat" --delay-1

SETS=(
  # "Uttar Pradesh|2026|7"

  "Assam|2026|2,3"

  "Jammu & Kashmir|2024|3"
)

PARTS=10
DELAY=1

# Optional page range (leave empty to scrape all pending pages)
# START_PAGE=0
# END_PAGE=10
# or: PAGES="1-50"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Works from repo root (…/Test) or from backend (…/Test/backend)
if [[ -f "${SCRIPT_DIR}/src/gem/new_contract_scrapped.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/new_contract_scrapped.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/new_contract_scrapped.js"
NODE_BIN="$(command -v node)"

if [[ ! -f "$NODE_SCRIPT" ]]; then
  echo "script not found: $NODE_SCRIPT"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH"
  exit 1
fi

if [[ ${#SETS[@]} -eq 0 ]]; then
  echo 'Set SETS=( ...) at the top — e.g. "Gujarat|2024|2,3,7"'
  exit 1
fi

if ! [[ "$PARTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PARTS must be a positive integer (got: $PARTS)"
  exit 1
fi

PAGE_ARGS=""
if [[ -n "${PAGES:-}" ]]; then
  PAGE_ARGS=" --pages ${PAGES}"
elif [[ -n "${START_PAGE:-}" && -n "${END_PAGE:-}" ]]; then
  PAGE_ARGS=" --start-page ${START_PAGE} --end-page ${END_PAGE}"
elif [[ -n "${START_PAGE:-}" || -n "${END_PAGE:-}" ]]; then
  echo "Set both START_PAGE and END_PAGE, or use PAGES=\"START-END\""
  exit 1
fi

# Parse SETS → STATE, YEAR, MONTH list; build launch jobs
declare -a JOBS=()   # each: "STATE|MM-YYYY"

for SET in "${SETS[@]}"; do
  [[ -z "${SET// /}" || "$SET" =~ ^[[:space:]]*# ]] && continue

  IFS='|' read -r STATE YEAR MONTHS_STR <<< "$SET"

  STATE="${STATE#"${STATE%%[![:space:]]*}"}"
  STATE="${STATE%"${STATE##*[![:space:]]}"}"
  YEAR="${YEAR#"${YEAR%%[![:space:]]*}"}"
  YEAR="${YEAR%"${YEAR##*[![:space:]]}"}"
  MONTHS_STR="${MONTHS_STR#"${MONTHS_STR%%[![:space:]]*}"}"
  MONTHS_STR="${MONTHS_STR%"${MONTHS_STR##*[![:space:]]}"}"

  if [[ -z "$STATE" || -z "$YEAR" || -z "$MONTHS_STR" ]]; then
    echo "Invalid set (use State|YEAR|month,month): $SET"
    exit 1
  fi

  if ! [[ "$YEAR" =~ ^[0-9]{4}$ ]]; then
    echo "Invalid year in set (use YYYY): $SET"
    exit 1
  fi

  IFS=',' read -ra MONTH_ARR <<< "$MONTHS_STR"
  for MONTH in "${MONTH_ARR[@]}"; do
    MONTH="${MONTH#"${MONTH%%[![:space:]]*}"}"
    MONTH="${MONTH%"${MONTH##*[![:space:]]}"}"

    if ! [[ "$MONTH" =~ ^[1-9]$|^1[0-2]$ ]]; then
      echo "Invalid month in set (use 1-12): $SET (month: $MONTH)"
      exit 1
    fi

    MM=$(printf "%02d" "$MONTH")
    JOBS+=("${STATE}|${MM}-${YEAR}")
  done
done

if [[ ${#JOBS[@]} -eq 0 ]]; then
  echo "No jobs — add entries like: \"Gujarat|2024|2,3,7\""
  exit 1
fi

TOTAL=$(( ${#JOBS[@]} * PARTS ))

echo "Starting ${TOTAL} terminal(s)"
echo "  sets=${#SETS[@]} state-month job(s)=${#JOBS[@]}"
for JOB in "${JOBS[@]}"; do
  IFS='|' read -r S D <<< "$JOB"
  echo "    ${S} | ${D}"
done
echo "  parts=${PARTS} (per job)"
echo "  delay=${DELAY}"
if [[ -n "$PAGE_ARGS" ]]; then
  echo "  pages=${PAGE_ARGS# }"
fi
echo

for JOB in "${JOBS[@]}"
do
  IFS='|' read -r STATE CONTRACT_DATE <<< "$JOB"

  for PART in $(seq 1 "$PARTS")
  do
    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'NEW CONTRACTS: ${CONTRACT_DATE} | ${STATE} | part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --contract-date '${CONTRACT_DATE}' --state '${STATE}' --parts=${PARTS} --part=${PART} --delay-${DELAY}${PAGE_ARGS}"
end tell
EOF

    echo "Opened terminal ${STATE} ${CONTRACT_DATE} part ${PART}/${PARTS}"
    sleep 1
  done
done

echo
echo "Done — ${TOTAL} Terminal window(s) launched."
