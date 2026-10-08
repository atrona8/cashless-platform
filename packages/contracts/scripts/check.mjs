// Vérifie que generated/ correspond exactement à ce que produit openapi.yaml (FR-022, utilisé par la CI).
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { GENERATED_DIR, render } from './generate.mjs';

const files = await render();
const stale = Object.entries(files)
  .filter(([name, expected]) => {
    const url = new URL(name, GENERATED_DIR);
    return !existsSync(url) || readFileSync(url, 'utf8') !== expected;
  })
  .map(([name]) => `generated/${name}`);

if (stale.length) {
  console.error(`[contracts] types périmés : ${stale.join(', ')} — lancer npm run generate -w @cashless/contracts`);
  process.exitCode = 1;
} else {
  console.log('[contracts] types à jour');
}
