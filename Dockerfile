FROM node:24-trixie

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./

RUN chown node:node /app

RUN /usr/bin/timeout --version >/dev/null

USER node

# one-shot ingestion と migration service の実行に devDependencies が必要なため、runtime image にも含めます。
RUN npm ci

COPY --chown=node:node . .

CMD ["sleep", "infinity"]
