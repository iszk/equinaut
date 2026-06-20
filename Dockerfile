FROM node:24-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
# db:migrate と tsx scheduler 実行に devDependencies が必要なため、runtime image にも含めます。
RUN npm ci

COPY --chown=node:node . .

USER node

CMD ["sh", "-c", "npm run db:migrate && exec npm run ingest:scheduler -- --config config/ingestion.yaml"]
