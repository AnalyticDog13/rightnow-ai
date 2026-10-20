# sourced by the other scripts: cd to repo root, set $P to the compose profile flag for VPS mode
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env missing: copy .env.example and fill it in" >&2; exit 1; }
P=; if grep -q "^MODE=vps" .env; then P="--profile vps"; fi
