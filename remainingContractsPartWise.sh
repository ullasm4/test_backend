#!/bin/bash

# Config — edit these, then run: bash remainingContractsPartWise.sh
#
# Date options:
#   "01-01-2026"                         → single day (DD-MM-YYYY)
#   "(1,2,3)-2026"                       → months 01..03 of 2026
#   "(1,2,3,4,5,6,7,8,9,10,11,12)-25"    → all months of 2025
#
# Logic per date (PARTS=2):
#   part 1 → start → end   (gaps first+1 … last-1)
#   part 2 → end → start   (--reverse)
#   Already in new_contracts OR not_found_contracts → skip (no GeM curl on re-run)
#   Close + restart resumes from remaining_scrape_cursor (does not start at gap 1)
#   GeM miss / killed mid-call → not_found_contracts
#   hit + date in window → parse bid_number + buying_mode (Bid/RA|Direct) → new_contracts
#
#   bash remainingContractsPartWise.sh

CONTRACT_DATE_GROUPS=(
  "(1,2,3,4,5,6,7,8,9,10,11,12)-2025"
  # "01-08-2026"
  # "(1,2,3,4,5,6,7,8,9)-2026"
  # "(1,2,3,4,5,6,7,8,9,10,11,12)-25"
)

PARTS=2
DELAY=1
CONCURRENCY=8

# Optional: resume cursor (inclusive)
# START_FROM="GEMC-511687700003323"

# Optional: max probes per worker
# LIMIT=100

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Works from repo root (…/Test) or from backend (…/Test/backend)
if [[ -f "${SCRIPT_DIR}/src/gem/remaning_contracts_scrapper.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/backend/src/gem/remaning_contracts_scrapper.js" ]]; then
  BACKEND_DIR="${SCRIPT_DIR}/backend"
else
  echo "backend not found next to ${SCRIPT_DIR}"
  exit 1
fi

NODE_SCRIPT="${BACKEND_DIR}/src/gem/remaning_contracts_scrapper.js"
NODE_BIN="$(command -v node)"

if [[ ! -f "$NODE_SCRIPT" ]]; then
  echo "script not found: $NODE_SCRIPT"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH"
  exit 1
fi

# Expand "(1,2,3)-2026" / "(1,2,3)-25" / "01-01-2026" / "01-2026"
expand_contract_date_group() {
  local raw="$1"
  raw="${raw// /}"

  if [[ "$raw" =~ ^\(([0-9,]+)\)-([0-9]{2,4})$ ]]; then
    local months_csv="${BASH_REMATCH[1]}"
    local year_raw="${BASH_REMATCH[2]}"
    local year
    if [[ ${#year_raw} -eq 2 ]]; then
      year="20${year_raw}"
    elif [[ ${#year_raw} -eq 4 ]]; then
      year="$year_raw"
    else
      echo "Invalid year in group: $raw (use YY or YYYY)"
      return 1
    fi
    local IFS=','
    local month
    for month in $months_csv; do
      if ! [[ "$month" =~ ^[0-9]+$ ]] || (( month < 1 || month > 12 )); then
        echo "Invalid month '${month}' in group: $raw"
        return 1
      fi
      CONTRACT_DATES+=("$(printf '%02d-%s' "$month" "$year")")
    done
    return 0
  fi

  if [[ "$raw" =~ ^[0-9]{1,2}-[0-9]{4}$ ]] || \
     [[ "$raw" =~ ^[0-9]{4}-[0-9]{1,2}$ ]] || \
     [[ "$raw" =~ ^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$ ]] || \
     [[ "$raw" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    CONTRACT_DATES+=("$raw")
    return 0
  fi

  echo "Invalid CONTRACT_DATE_GROUPS entry: $raw"
  echo "  Use: \"01-01-2026\"  or  \"(1,2,3)-2026\"  or  \"(1,2,3)-25\""
  return 1
}

CONTRACT_DATES=()
if [[ ${#CONTRACT_DATE_GROUPS[@]} -eq 0 ]]; then
  echo "Set CONTRACT_DATE_GROUPS=( \"01-01-2026\" … ) at the top"
  exit 1
fi

for GROUP in "${CONTRACT_DATE_GROUPS[@]}"; do
  [[ -z "${GROUP// /}" ]] && continue
  if ! expand_contract_date_group "$GROUP"; then
    exit 1
  fi
done

if [[ ${#CONTRACT_DATES[@]} -eq 0 ]]; then
  echo "No dates expanded from CONTRACT_DATE_GROUPS"
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

if ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "CONCURRENCY must be a positive integer (got: $CONCURRENCY)"
  exit 1
fi

DELAY_ARG=""
if [[ "$DELAY" -gt 0 ]]; then
  DELAY_ARG=" --delay-${DELAY}"
fi

EXTRA_ARGS=" --concurrency ${CONCURRENCY}"

if [[ -n "${START_FROM:-}" ]]; then
  EXTRA_ARGS+=" --start-from '${START_FROM}'"
fi

if [[ -n "${LIMIT:-}" ]]; then
  if ! [[ "$LIMIT" =~ ^[1-9][0-9]*$ ]]; then
    echo "LIMIT must be a positive integer (got: $LIMIT)"
    exit 1
  fi
  EXTRA_ARGS+=" --limit ${LIMIT}"
fi

TOTAL=$(( ${#CONTRACT_DATES[@]} * PARTS ))

echo "======================================================"
echo " Remaining Contracts: part1 start→end | part2 end→start"
echo "======================================================"
echo "Groups      : ${CONTRACT_DATE_GROUPS[*]}"
echo "Dates       : ${CONTRACT_DATES[*]}"
echo "Workers     : ${TOTAL} (${#CONTRACT_DATES[@]} dates × ${PARTS} parts)"
echo "Delay       : ${DELAY} (after successful save only)"
echo "Concurrency : ${CONCURRENCY}"
echo "Start from  : ${START_FROM:-auto}"
echo "Limit       : ${LIMIT:-none}"
echo "Skip        : already in new_contracts or not_found_contracts"
echo "Resume      : saved cursor per date/part (restart does not re-curl)"
echo "Script      : ${NODE_SCRIPT}"
echo "======================================================"
echo

for CONTRACT_DATE in "${CONTRACT_DATES[@]}"
do
  for PART in $(seq 1 "$PARTS")
  do
    REVERSE_ARG=""
    # part 2 (and even parts) walk end → start
    if (( PART % 2 == 0 )); then
      REVERSE_ARG=" --reverse"
    fi

    DIR_LABEL="start→end"
    if [[ -n "$REVERSE_ARG" ]]; then
      DIR_LABEL="end→start"
    fi

    # Absolute node + script paths (relative paths caused EPERM uv_cwd).
    # Run directly in Terminal — do not use /tmp/*.command (macOS blocks Desktop reads).
    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'REMAINING CONTRACTS: ${CONTRACT_DATE} | part ${PART}/${PARTS} | ${DIR_LABEL}' && '${NODE_BIN}' '${NODE_SCRIPT}' --contract-date '${CONTRACT_DATE}' --parts=${PARTS} --part=${PART}${DELAY_ARG}${EXTRA_ARGS}${REVERSE_ARG}"
end tell
EOF

    echo "Opened terminal ${CONTRACT_DATE} part ${PART}/${PARTS} (${DIR_LABEL})"
    sleep 1
  done
done

echo
echo "Done — ${TOTAL} Terminal window(s) launched."
echo "PARTS=2: part1 start→end, part2 end→start (same FIRST/LAST window)."
echo "Skip if already in new_contracts or not_found_contracts (no re-curl)."
echo "Restart resumes from the saved cursor — it does not start at the first gap."
echo "Miss → not_found_contracts | Hit → PDF → new_contracts"
