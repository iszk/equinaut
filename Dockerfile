FROM node:24-trixie

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./

RUN chown node:node /app

USER node

# db:migrate と tsx scheduler 実行に devDependencies が必要なため、runtime image にも含めます。
RUN npm ci

COPY --chown=node:node . .

CMD ["sh", "-c", "npm run db:migrate && exec npm run ingest:scheduler -- --config config/ingestion.yaml"]
