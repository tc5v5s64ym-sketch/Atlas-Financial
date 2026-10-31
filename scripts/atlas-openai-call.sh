#!/usr/bin/env bash
# Call the owner-authorized OpenAI Responses API with bounded 429/503 backoff.
# Usage: bash scripts/atlas-openai-call.sh <request.json> <response.json>
#
# A single 429 must not abort the trusted Atlas review. Immediate job re-runs
# make rate limits worse; this helper waits and retries instead.
set -euo pipefail

REQ="${1:?request json path required}"
RESP="${2:?response json path required}"
MAX=5

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is missing. Fail closed."
  exit 1
fi

for attempt in $(seq 1 "${MAX}"); do
  set +e
  http_code="$(curl -sS -o "${RESP}" -w '%{http_code}' \
    https://api.openai.com/v1/responses \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    --data-binary "@${REQ}")"
  curl_status=$?
  set -e
  if [[ "${curl_status}" -ne 0 && -z "${http_code}" ]]; then
    http_code="000"
  fi

  if [[ "${http_code}" == "200" ]]; then
    status="$(jq -r '.status // empty' "${RESP}")"
    if [[ "${status}" == "completed" ]]; then
      exit 0
    fi
    echo "OpenAI HTTP 200 but status=${status:-empty} on attempt ${attempt}."
  elif [[ "${http_code}" == "429" || "${http_code}" == "503" ]]; then
    echo "OpenAI HTTP ${http_code} on attempt ${attempt}; backing off."
  else
    echo "OpenAI HTTP ${http_code} on attempt ${attempt}. Fail closed."
    jq -r '.error.message // .incomplete_details.reason // "unknown response failure"' "${RESP}" 2>/dev/null || true
    exit 1
  fi

  if [[ "${attempt}" -eq "${MAX}" ]]; then
    echo "OpenAI review did not complete after ${MAX} attempts. Fail closed."
    jq -r '.error.message // .incomplete_details.reason // "unknown response failure"' "${RESP}" 2>/dev/null || true
    exit 1
  fi
  sleep $((attempt * 30))
done
