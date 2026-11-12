import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminListener } from '../../src/admin/admin-listener';
import { LocalOrdersController } from '../../src/admin/local-orders.controller';
import type { GatewayConfig } from '../../src/config/config';
import { makeCa } from '../startup/_support/pki';

const root = join(__dirname, '..', '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const compose = readFileSync(join(root, 'docker-compose.site.yml'), 'utf8');
const DIGEST = /@sha256:[0-9a-f]{64}/;

describe('image de la passerelle (sans Docker)', () => {
  const froms = dockerfile.split('\n').filter((l) => /^FROM /.test(l));
  const images = compose.split('\n').filter((l) => /^\s+image: postgres/.test(l));

  it('chaque FROM et l’image PostgreSQL sont épinglés par condensat (pas de latest)', () => {
    expect(froms.length).toBe(2);
    for (const line of [...froms, ...images]) {
      expect(line).toMatch(DIGEST);
      expect(line).not.toMatch(/:latest/);
      expect(line).not.toContain('REPLACE_WITH_DIGEST');
    }
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('postgres:17@');
    expect(froms[0]).toContain('node:22-bookworm-slim@');
  });

  it('utilisateur non-root, npm ci sans script, exécution par tsx, pas de port de débogage', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/^USER (root|0)\b/m);
    expect(dockerfile).toMatch(/npm ci --ignore-scripts/);
    expect(dockerfile).toMatch(/tsx\/cjs/);
    expect(dockerfile).not.toMatch(/--inspect|9229/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
  });

  it('aucun fichier de clé ou de secret copié, aucun ENV secret', () => {
    for (const line of dockerfile.split('\n').filter((l) => /^(COPY|ADD)\b/.test(l))) {
      expect(line).not.toMatch(/\.(key|pem|crt|env)\b|\.env|secret/i);
    }
    for (const line of dockerfile.split('\n').filter((l) => /^ENV\b/.test(l))) {
      expect(line).not.toMatch(/PASSWORD|SECRET|TOKEN|KEY|URL/i);
    }
  });

  it('PostgreSQL : paramètres de durabilité posés explicitement, rien dans les journaux', () => {
    for (const setting of [
      'fsync=on',
      'full_page_writes=on',
      'synchronous_commit=on',
      'log_statement=none',
    ]) {
      expect(compose).toContain(setting);
    }
    expect(compose).not.toMatch(/fsync=off|full_page_writes=off|synchronous_commit=off/);
  });

  it('compose : aucun mot de passe en clair, port d’administration non publié, production', () => {
    expect(compose).not.toMatch(/PASSWORD:\s*[^\s$]/);
    expect(compose).not.toMatch(/postgres:\/\/[^$\s]*:[^$\s@]+@/);
    expect(compose).toMatch(/NODE_ENV: production/);
    expect(compose).not.toMatch(/8444:8444/);
    expect(compose).toMatch(/GATEWAY_PURGE_MARKER_FILE/);
    expect(compose).not.toMatch(/HARDWARE_KEYSTORE: fake/);
    expect(compose).not.toMatch(
      /EDGE_ALLOW_FAILPOINTS|EDGE_FAILPOINT|GATEWAY_DEV_KEY_FILE|EDGE_CA:/,
    );
  });
});

// La sonde de vie du Dockerfile est EXÉCUTÉE contre l'écouteur d'administration réel (décision 47 :
// HTTPS en production, clair ailleurs). Une sonde en node:http échoue contre l'écouteur TLS.
describe('sonde de vie du HEALTHCHECK (exécutée)', () => {
  const line = dockerfile
    .split('\n')
    .join('\n')
    .match(/HEALTHCHECK[^\n]*\\\n\s*CMD (\[.*\])/)?.[1];
  const argv: string[] = JSON.parse(line ?? '[]');
  const config = (production: boolean, cert: string | null, key: string | null): GatewayConfig =>
    new Proxy(
      { production, adminPort: 0, adminTlsCertFile: cert, adminTlsKeyFile: key },
      { get: (t, name) => (name in t ? (t as never)[name] : null) },
    ) as unknown as GatewayConfig;
  // Asynchrone : le serveur tourne dans ce processus, un spawnSync bloquerait sa boucle.
  const probe = (command: string[], env: Record<string, string>) =>
    new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, command.slice(1), {
        env: { PATH: process.env.PATH ?? '', ...env },
        stdio: 'ignore',
        timeout: 10_000,
      });
      child.on('exit', (code) => resolve(code));
    });

  it(
    'la commande est extraite du Dockerfile et utilise node:https avec le certificat ' + 'monté',
    () => {
      expect(argv[0]).toBe('node');
      expect(argv[1]).toBe('-e');
      expect(argv[2]).toContain('node:https');
      expect(argv[2]).toContain('GATEWAY_ADMIN_TLS_CERT_FILE');
      expect(argv[2]).not.toContain('rejectUnauthorized');
    },
  );

  it(
    'écouteur en TLS : la sonde sort 0 (405) ; un autre certificat, ou le clair, la ' +
      'fait échouer',
    async () => {
      const pki = await makeCa('CN=localhost');
      const other = await makeCa('CN=localhost');
      const dir = mkdtempSync(join(tmpdir(), 'gw-probe-'));
      const cert = join(dir, 'a.crt');
      const key = join(dir, 'a.key');
      const otherCert = join(dir, 'b.crt');
      writeFileSync(cert, pki.certPem);
      writeFileSync(key, pki.keyPem, { mode: 0o600 });
      writeFileSync(otherCert, other.certPem);
      const listener = new AdminListener(config(true, cert, key), new LocalOrdersController());
      const port = await listener.start({ port: 0 });
      try {
        const env = { GATEWAY_ADMIN_PORT: String(port), GATEWAY_ADMIN_TLS_CERT_FILE: cert };
        expect(await probe(argv, env)).toBe(0);
        expect(await probe(argv, { ...env, GATEWAY_ADMIN_TLS_CERT_FILE: otherCert })).toBe(1);
        expect(await probe(argv, { GATEWAY_ADMIN_PORT: String(port) })).toBe(1);
        const old = [
          'node',
          '-e',
          "require('node:http').get({host:'127.0.0.1',port:process.env.GATEWAY_ADMIN_PORT," +
            "path:'/local/orders'},r=>process.exit(r.statusCode===405?0:1))" +
            ".on('error',()=>process.exit(1))",
        ];
        expect(await probe(old, env)).toBe(1);
      } finally {
        await listener.stop();
      }
    },
  );

  it('hors production (clair, sans certificat) : la sonde sort 0', async () => {
    const listener = new AdminListener(config(false, null, null), new LocalOrdersController());
    const port = await listener.start({ port: 0 });
    try {
      expect(await probe(argv, { GATEWAY_ADMIN_PORT: String(port) })).toBe(0);
    } finally {
      await listener.stop();
    }
  });
});
