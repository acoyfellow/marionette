#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
npx vite build >/dev/null
npx wrangler deploy --config dist/client/marionette/wrangler.json 2>&1 | grep -E "Uploaded|Deployed|customer0|Version ID|ERROR|✘" 
