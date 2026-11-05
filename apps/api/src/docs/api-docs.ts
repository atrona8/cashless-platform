// Documentation interactive de l'API (décision du porteur, 05/11/2026) : Swagger UI affiche `openapi.yaml` TEL QUEL
// (jamais un contrat généré depuis le code). HORS PRODUCTION SEULEMENT : en production les routes ne sont pas montées
// (404 comme toute route inconnue). Hors contrat comme `GET /v1/health` (C-009), et hors du préfixe global : les
// routes sont posées sur l'application express, avant le routeur de Nest, donc sans garde d'authentification ni
// préfixe `/v1`. Aucune dépendance npm : Swagger UI vient du CDN, version épinglée, avec intégrité SRI
// (`swagger-ui-dist` dépend de `@scarf/scarf`, script d'installation qui envoie des statistiques ; ADR-153).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/config';

/** Version de Swagger UI chargée depuis le CDN : à monter à la main, avec les deux empreintes ci-dessous. */
export const SWAGGER_UI_VERSION = '5.34.0';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;
export const SWAGGER_UI_CSS = {
  url: `${CDN}/swagger-ui.css`,
  integrity: 'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF',
};
export const SWAGGER_UI_BUNDLE = {
  url: `${CDN}/swagger-ui-bundle.js`,
  integrity: 'sha384-9Td7MKiIr2S83E1kZyyVi8KdJw/S8CpAvu0llLyMeg0xq/hDGiZJfVn0fV4llCmK',
};

/**
 * CSP des seules routes `/docs` ; aucune autre route n'en pose, et rien n'est global.
 * `style-src 'unsafe-inline'` : Swagger UI pose des attributs `style` (icônes SVG, coloration des exemples) que la
 * CSP bloque sans lui ; il ne vaut que pour les styles, jamais pour les scripts.
 */
export const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cashless : documentation de l'API</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CSS.url}" integrity="${SWAGGER_UI_CSS.integrity}" crossorigin="anonymous" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_BUNDLE.url}" integrity="${SWAGGER_UI_BUNDLE.integrity}" crossorigin="anonymous"></script>
    <script src="/docs/init.js"></script>
  </body>
</html>
`;

const INIT_SCRIPT = `window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({ url: '/docs/openapi.yaml', dom_id: '#swagger-ui' });
});
`;

/**
 * Cherche `packages/contracts/openapi.yaml` en remontant depuis ce fichier : même profondeur depuis `src/docs`
 * (développement, tests) et `dist/docs` (compilé), et dans l'archive « API exécutable » (`apps/api` et `packages/`).
 */
export function contractPath(from: string = __dirname): string {
  let dir = from;
  for (let level = 0; level < 8; level += 1) {
    const candidate = join(dir, 'packages', 'contracts', 'openapi.yaml');
    if (existsSync(candidate)) return candidate;
    dir = join(dir, '..');
  }
  throw new Error(
    'packages/contracts/openapi.yaml introuvable : documentation de l’API impossible',
  );
}

function send(res: Response, type: string, body: string | Buffer, secured: boolean): void {
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (secured) res.setHeader('Content-Security-Policy', DOCS_CONTENT_SECURITY_POLICY);
  res.send(body);
}

/**
 * Monte `/docs` sur l'application, avant `listen`/`init` (le routeur de Nest répondrait sinon 404 le premier).
 * En production : ne monte rien. Rend vrai si les routes sont montées.
 */
export function mountApiDocs(
  app: INestApplication,
  config: Pick<AppConfig, 'production'>,
): boolean {
  if (config.production) return false;
  const contract = readFileSync(contractPath());
  const express = app.getHttpAdapter().getInstance() as {
    get(path: string, handler: (req: Request, res: Response) => void): void;
  };
  express.get('/docs', (_req, res) => send(res, 'text/html; charset=utf-8', PAGE, true));
  express.get('/docs/init.js', (_req, res) =>
    send(res, 'text/javascript; charset=utf-8', INIT_SCRIPT, true),
  );
  express.get('/docs/openapi.yaml', (_req, res) =>
    send(res, 'application/yaml; charset=utf-8', contract, true),
  );
  return true;
}
