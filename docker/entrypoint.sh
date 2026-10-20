#!/bin/sh
set -e
# exec so node is PID 1 and receives SIGTERM directly (worker drains jobs on stop)
case "$1" in
  web) cd /app/apps/web && exec node ../../node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000 ;;
  worker) cd /app/apps/worker && exec node --import tsx src/index.ts ;;
  migrate) cd /app/packages/db && exec ../../node_modules/.bin/prisma migrate deploy ;;
  *) echo "usage: entrypoint.sh web|worker|migrate" >&2; exit 2 ;;
esac
