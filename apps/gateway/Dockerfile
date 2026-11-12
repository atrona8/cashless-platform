# Image de la passerelle locale (WP24, T110 ; FR-033, research R-27, DIRECTIVE_051).
# Contexte de construction : la RACINE du dépôt (monorepo à espaces de travail) :
#   docker build -f apps/gateway/Dockerfile .
# Base épinglée par condensat (relevé au registre officiel le 10/11/2026 ; le balayage des
# vulnérabilités est à consigner dans docs/08-pile-logicielle.md par la CI). Aucun secret, aucune
# clé
# de bracelet, aucun certificat dans l'image : tout vient du volume et des fichiers montés au
# démarrage.
# Exécution par `tsx` comme l'API (ADR-78), utilisateur non-root, aucun port de débogage.

# ---- étage 1 : dépendances (npm ci sans script d'installation, .npmrc `ignore-scripts=true`) ----
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ledger-sql/package.json packages/ledger-sql/package.json
COPY packages/shared-rules/package.json packages/shared-rules/package.json
COPY packages/tag-format/package.json packages/tag-format/package.json
RUN npm ci --ignore-scripts --workspace @cashless/gateway

# ---- étage 2 : exécution ----
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.base.json ./
COPY --chown=node:node packages/shared-rules ./packages/shared-rules
COPY --chown=node:node packages/tag-format ./packages/tag-format
COPY --chown=node:node apps/gateway ./apps/gateway
# Le volume de la passerelle (marqueur de purge, fichiers montés) appartient à l'utilisateur
# non-root.
RUN mkdir -p /var/lib/gateway && chown node:node /var/lib/gateway
USER node
WORKDIR /app/apps/gateway
# Santé : l'écouteur d'administration (boucle locale du conteneur) répond 405 à un GET sur sa seule
# route ; aucune route n'est ajoutée pour cela (chemin non contractuel). En production il est en
# HTTPS (décision 47) : la sonde utilise node:https et épingle le certificat d'administration monté
# (GATEWAY_ADMIN_TLS_CERT_FILE comme `ca`), sans contrôle du nom d'hôte (boucle locale) ; elle
# n'envoie aucun secret. Sans cette variable (hors production), l'écoute est en clair : node:http.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "const e=process.env,f=e.GATEWAY_ADMIN_TLS_CERT_FILE,o={host:'127.0.0.1',port:e.GATEWAY_ADMIN_PORT||8444,path:'/local/orders'};if(f){o.ca=require('node:fs').readFileSync(f);o.servername='localhost';o.checkServerIdentity=()=>undefined}(f?require('node:https'):require('node:http')).get(o,r=>process.exit(r.statusCode===405?0:1)).on('error',()=>process.exit(1))"]
EXPOSE 8443
CMD ["node", "--require", "tsx/cjs", "src/main.ts"]
