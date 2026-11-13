import 'reflect-metadata';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminListener } from '../../src/admin/admin-listener';
import { LocalOrdersController } from '../../src/admin/local-orders.controller';
import type { GatewayConfig } from '../../src/config/config';
import { loadConfig } from '../../src/config/config';
import { adminTlsOptions } from '../../src/purge/admin-tls';
import { evaluateConfigRules } from '../../src/processes/startup-guard';
import { makeCa } from '../startup/_support/pki';

// Décision 47 : TLS sur le port d'administration. Hors production le clair reste permis (même
// convention que l'écoute des terminaux) ; en production, aucune écoute sans certificat ni clé.
describe('TLS du port d’administration (décision 47)', () => {
  let cert: string;
  let key: string;
  let ca: string;
  beforeAll(async () => {
    const pki = await makeCa('CN=localhost');
    const dir = mkdtempSync(join(tmpdir(), 'gw-admin-tls-'));
    cert = join(dir, 'admin.crt');
    key = join(dir, 'admin.key');
    ca = pki.certPem;
    writeFileSync(cert, pki.certPem);
    writeFileSync(key, pki.keyPem, { mode: 0o600 });
  });

  const config = (production: boolean, tls: boolean): GatewayConfig =>
    new Proxy(
      {
        production,
        adminPort: 0,
        adminTlsCertFile: tls ? cert : null,
        adminTlsKeyFile: tls ? key : null,
        centralUrl: 'https://central.example.test',
        edgeCa: null,
        failpoint: null,
        allowFailpoints: null,
        tlsCertFile: cert,
        tlsKeyFile: key,
        requestAuthority: 'gw.test:8443',
        databaseUrl: 'postgres://edge_app:Un-secret-long-9z@127.0.0.1:5432/x',
      },
      // Toute autre réglage vaut « absent » : seule la règle d'administration est examinée ici.
      { get: (target, name) => (name in target ? (target as never)[name] : null) },
    ) as unknown as GatewayConfig;

  it('production sans certificat ni clé : l’écouteur refuse, aucun port ouvert', async () => {
    const listener = new AdminListener(config(true, false), new LocalOrdersController());
    await expect(listener.start({ port: 0 })).rejects.toThrow(/sans TLS/);
  });

  it('la configuration de production sans TLS d’administration est refusée par la garde', () => {
    const violations = evaluateConfigRules({
      config: config(true, false),
      env: {},
    });
    expect(violations.join('\n')).toContain('GATEWAY_ADMIN_TLS_CERT_FILE');
    const ok = evaluateConfigRules({ config: config(true, true), env: {} });
    expect(ok.join('\n')).not.toContain('GATEWAY_ADMIN_TLS');
  });

  it('la paire est lue par loadConfig et va par deux', () => {
    const base = {
      NODE_ENV: 'test',
      GATEWAY_DATABASE_URL: 'postgres://edge_app:x@127.0.0.1:5432/x',
      GATEWAY_REQUEST_AUTHORITY: 'gw.test:8443',
      GATEWAY_LISTEN_PORT: '0',
      GATEWAY_ADMIN_PORT: '0',
    };
    expect(
      loadConfig({ ...base, GATEWAY_ADMIN_TLS_CERT_FILE: '/c', GATEWAY_ADMIN_TLS_KEY_FILE: '/k' })
        .adminTlsCertFile,
    ).toBe('/c');
    expect(() => loadConfig({ ...base, GATEWAY_ADMIN_TLS_CERT_FILE: '/c' })).toThrow(
      /vont ensemble/,
    );
    expect(adminTlsOptions({ adminTlsCertFile: null, adminTlsKeyFile: null })).toBeUndefined();
  });

  it('avec la paire : le serveur d’administration répond en TLS 1.3, pas en clair', async () => {
    const orders = new LocalOrdersController();
    const listener = new AdminListener(config(true, true), orders);
    const port = await listener.start({ port: 0 });
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/local/orders',
            method: 'POST',
            ca,
            servername: 'localhost',
            checkServerIdentity: () => undefined,
            minVersion: 'TLSv1.3',
            headers: { 'content-type': 'application/json' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(status).toBe(400);
      const { request: plain } = await import('node:http');
      await expect(
        new Promise((resolve, reject) => {
          const req = plain(
            { host: '127.0.0.1', port, method: 'POST', path: '/local/orders' },
            (r) => {
              r.resume();
              resolve(r.statusCode);
            },
          );
          req.on('error', reject);
          req.end('{}');
        }),
      ).rejects.toBeDefined();
    } finally {
      await listener.stop();
    }
  });

  it('hors production, le clair reste permis', async () => {
    const listener = new AdminListener(config(false, false), new LocalOrdersController());
    expect(await listener.start({ port: 0 })).toBeGreaterThan(0);
    await listener.stop();
  });
});
