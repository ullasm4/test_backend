#!/bin/bash

# Config — edit these, then run: bash mainPartWise.sh
#
# Option A: list contract dates directly (MM-YYYY or DD-MM-YYYY)
CONTRACT_DATES=(

  # 2021
  "01-2021"
  "02-2021"
  "03-2021"
  "04-2021"
  "05-2021"
  "06-2021"
  "07-2021"
  "08-2021"
  "09-2021"
  "10-2021"
  "11-2021"
  "12-2021"

  # 2022
  "01-2022"
  "02-2022"
  "03-2022"
  "04-2022"
  "05-2022"
  "06-2022"
  "07-2022"
  "08-2022"
  "09-2022"
  "10-2022"
  "11-2022"
  "12-2022"

  # 2023
  "01-2023"
  "02-2023"
  "03-2023"
  "04-2023"
  "05-2023"
  "06-2023"
  "07-2023"
  "08-2023"
  "09-2023"
  "10-2023"
  "11-2023"
  "12-2023"

  # 2024
  # "01-2024"
  "02-2024"
  "03-2024"
  # "04-2024"
  # "05-2024"
  # "06-2024"
  # "07-2024"
  # "08-2024"
  # "09-2024"
  # "10-2024"
  # "11-2024"
  # "12-2024"

  # 2025
  # "01-2025"
  # "02-2025"
  # "03-2025"
  # "04-2025"
  # "05-2025"
  # "06-2025"
  # "07-2025"
  # "08-2025"
  # "09-2025"
  # "10-2025"
  # "11-2025"
  # "12-2025"

  # 2026
  # "01-2026"
  # "02-2026"
  # "03-2026"
  # "04-2026"
  # "05-2026"
  # "06-2026"
  # "07-2026"
  # "08-2026"
  # "09-2026"

)

# Option B: or set YEAR + MONTHS (script builds MM-YYYY for each month)
# Comment out CONTRACT_DATES above and uncomment below instead:
# YEAR=2026
# MONTHS=(1 2 3 4 5 6 7 8)

PARTS=1
DELAY=3

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

# Build CONTRACT_DATES from YEAR + MONTHS when array is empty
if [[ ${#CONTRACT_DATES[@]} -eq 0 && -n "${YEAR:-}" && -n "${MONTHS[*]:-}" ]]; then
  if ! [[ "$YEAR" =~ ^[0-9]{4}$ ]]; then
    echo "YEAR must be YYYY (got: $YEAR)"
    exit 1
  fi
  CONTRACT_DATES=()
  for MONTH in "${MONTHS[@]}"; do
    MM=$(printf "%02d" "$MONTH")
    CONTRACT_DATES+=("${MM}-${YEAR}")
  done
fi

if [[ ${#CONTRACT_DATES[@]} -eq 0 ]]; then
  echo "Set CONTRACT_DATES=( ...) or YEAR + MONTHS at the top of this script"
  exit 1
fi

if ! [[ "$PARTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PARTS must be a positive integer (got: $PARTS)"
  exit 1
fi

TOTAL=$(( ${#CONTRACT_DATES[@]} * PARTS ))

echo "Starting ${TOTAL} terminal(s)"
echo "  contract-dates=${CONTRACT_DATES[*]}"
echo "  parts=${PARTS} (per date)"
echo "  delay=${DELAY}"
echo

for CONTRACT_DATE in "${CONTRACT_DATES[@]}"
do
  for PART in $(seq 1 "$PARTS")
  do
    # Absolute node + script paths (relative paths caused EPERM uv_cwd).
    # Run directly in Terminal — do not use /tmp/*.command (macOS blocks Desktop reads).
    osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '${BACKEND_DIR}' && echo 'NEW CONTRACTS: ${CONTRACT_DATE} | part ${PART}/${PARTS}' && '${NODE_BIN}' '${NODE_SCRIPT}' --contract-date '${CONTRACT_DATE}' --parts=${PARTS} --part=${PART} --delay-${DELAY}"
end tell
EOF

    echo "Opened terminal ${CONTRACT_DATE} part ${PART}/${PARTS}"
    sleep 1
  done
done

echo
echo "Done — ${TOTAL} Terminal window(s) launched."