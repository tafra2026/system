# Pamper Me — production image (Next.js 16 on Node 22).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# tsx + dotenv stay after pruning: they run migrations and the account scripts on the server.
RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund tsx dotenv

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Apply pending database migrations, then serve.
CMD ["sh", "-c", "npm run -s db:migrate && exec npx next start -H 0.0.0.0 -p 3000"]
