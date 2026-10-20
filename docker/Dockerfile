# One image for web, worker and migrate; docker/entrypoint.sh picks the role.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# postinstall runs `prisma generate` (needs no database)
RUN npm ci
# Placeholders so env parsing at import succeeds during `next build`; the real values come from compose at runtime.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    ENCRYPTION_KEY="$(head -c 32 /dev/zero | base64)" \
    BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret-000000 \
    SETUP_TOKEN=build-time-placeholder \
    APP_URL=http://localhost:3000 \
    npm run build -w @rightnow/web
ENV NODE_ENV=production
RUN chmod +x docker/entrypoint.sh
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web"]
