import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pkcs10CertificateRequest } from '@peculiar/x509';
import { edgeChainGenesis } from '@cashless/shared-rules';
import { GatewayTx } from '../../src/db/gateway-tx';
import { EnrollmentError, EnrollmentService } from '../../src/enrollment/enrollment.service';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { createTestDb, type TestDb } from './_support/db';
import { enrolledFixture, tempDir } from './_support/fixture';
import { runGateway } from './_support/child';
import { makeEnrollmentFile, makeSiteKey } from './_support/pki';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.drop();
});

const count = async (table: string): Promise<number> =>
  (await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

async function attempt(content: unknown, keystore = new FakeHardwareKeystore()) {
  const path = join(tempDir(), 'e.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  const service = new EnrollmentService(new GatewayTx(db.pool), keystore);
  return { path, service, result: service.enroll(path) };
}

describe('demande d’inscription (gateway request)', () => {
  it('JSON sans secret, demande PKCS#10 signée par le port, clés créées dans le port', async () => {
    const keystore = new FakeHardwareKeystore();
    const service = new EnrollmentService(new GatewayTx(db.pool), keystore);
    const out = join(tempDir(), 'request.json');
    await service.writeRequest(out, {
      serial: 'GW-9',
      role: 'PRIMARY',
      lanAuthority: 'gw.site.test:8443',
    });
    const raw = readFileSync(out, 'utf8');
    const request = JSON.parse(raw);
    expect(Object.keys(request).sort()).toEqual(
      [
        'serial',
        'role',
        'csr_pem',
        'batch_public_key',
        'snapshot_key_id',
        'snapshot_public_key',
        'token_public_key',
        'agreement_public_key',
        'lan_url',
      ].sort(),
    );
    expect(raw).not.toMatch(/PRIVATE/);
    expect(request.lan_url).toBe('https://gw.site.test:8443');
    expect(Buffer.from(request.agreement_public_key, 'base64url')).toHaveLength(65);
    const csr = new Pkcs10CertificateRequest(request.csr_pem);
    expect(await csr.verify()).toBe(true);
    expect(csr.subject).toBe('CN=GW-9');
    expect(Buffer.from(csr.publicKey.rawData).equals(await keystore.publicKey('batch'))).toBe(true);
    // Le fichier de demande existe déjà : pas d'écrasement.
    await expect(
      service.writeRequest(out, {
        serial: 'GW-9',
        role: 'PRIMARY',
        lanAuthority: 'gw.site.test:8443',
      }),
    ).rejects.toThrow();
  });

  it('adresse à joker ou rôle inconnu refusés', async () => {
    const service = new EnrollmentService(new GatewayTx(db.pool), new FakeHardwareKeystore());
    await expect(
      service.buildRequest({ serial: 'x', role: 'PRIMARY', lanAuthority: '*:8443' }),
    ).rejects.toBeInstanceOf(EnrollmentError);
    await expect(
      service.buildRequest({ serial: 'x', role: 'BOSS' as never, lanAuthority: 'a:1' }),
    ).rejects.toThrow();
  });
});

describe('enrôlement (gateway enroll)', () => {
  it('remplit edge_meta, deux clés de site, la tête de chaîne (genèse partagée) et l’autorité, puis supprime le fichier', async () => {
    const { file, path } = await enrolledFixture(db);
    expect(existsSync(path)).toBe(false);
    const meta = (await db.pool.query('SELECT * FROM edge_meta')).rows[0];
    expect(meta.gateway_id).toBe(file.gateway_id);
    expect(await count('edge_site_order_key')).toBe(2);
    const head = (await db.pool.query('SELECT last_chain_hash, last_edge_seq FROM edge_chain_head'))
      .rows[0];
    expect(head.last_chain_hash.equals(edgeChainGenesis(file.gateway_id))).toBe(true);
    expect(Number(head.last_edge_seq)).toBe(0);
    expect((await db.pool.query('SELECT state FROM edge_authority')).rows[0].state).toBe('ARMED');
    expect(await count("edge_audit WHERE kind = 'ENROLLED'")).toBe(1);
  });

  it('rôle STANDBY : autorité STANDBY', async () => {
    await enrolledFixture(db, { role: 'STANDBY' });
    expect((await db.pool.query('SELECT state FROM edge_authority')).rows[0].state).toBe('STANDBY');
  });

  it('déjà enrôlée : refus, rien n’est écrasé', async () => {
    const { file } = await enrolledFixture(db);
    const retry = await attempt(file);
    await expect(retry.result).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(await count('edge_meta')).toBe(1);
  });

  it('second enrôlement avec les bonnes clés : ALREADY_ENROLLED', async () => {
    const { keystore } = await enrolledFixture(db);
    const again = await makeEnrollmentFile(keystore);
    const retry = await attempt(again, keystore);
    await expect(retry.result).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' });
    expect(existsSync(retry.path)).toBe(true);
  });

  it('fichier illisible, JSON invalide : refusé', async () => {
    const service = new EnrollmentService(new GatewayTx(db.pool), new FakeHardwareKeystore());
    await expect(service.enroll('/nonexistent/enroll.json')).rejects.toMatchObject({
      code: 'FILE_UNREADABLE',
    });
    await expect((await attempt('{pas du json')).result).rejects.toMatchObject({
      code: 'FILE_INVALID',
    });
  });

  describe('fichier invalide refusé : rien en base, fichier conservé', () => {
    const cases: Array<[string, (f: Record<string, unknown>) => Promise<void> | void]> = [
      [
        'champ inconnu',
        (f) => {
          f.extra = 1;
        },
      ],
      [
        'champ manquant',
        (f) => {
          delete f.ledger_id;
        },
      ],
      [
        'UUID invalide',
        (f) => {
          f.gateway_id = 'pas-un-uuid';
        },
      ],
      [
        'rôle inconnu',
        (f) => {
          f.role = 'ADMIN';
        },
      ],
      [
        'une seule clé de site',
        (f) => {
          f.site_order_keys = (f.site_order_keys as unknown[]).slice(0, 1);
        },
      ],
      [
        'trois clés de site',
        async (f) => {
          f.site_order_keys = [
            ...(f.site_order_keys as unknown[]),
            { holder: 'C', public_key: await makeSiteKey() },
          ];
        },
      ],
      [
        'deux clés identiques',
        (f) => {
          const keys = f.site_order_keys as Array<{ holder: string; public_key: string }>;
          keys[1] = { holder: 'Autre', public_key: keys[0]!.public_key };
        },
      ],
      [
        'même responsable deux fois',
        (f) => {
          const keys = f.site_order_keys as Array<{ holder: string; public_key: string }>;
          keys[1]!.holder = keys[0]!.holder;
        },
      ],
      [
        'clé de site illisible',
        (f) => {
          (f.site_order_keys as Array<{ public_key: string }>)[0]!.public_key = 'zzz';
        },
      ],
      [
        'clé privée dans le fichier',
        (f) => {
          f.device_ca_pem = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----';
        },
      ],
      [
        'central en clair',
        (f) => {
          f.central_url = 'http://central.test';
        },
      ],
      [
        'autorité à joker',
        (f) => {
          f.lan_authority = '*:443';
        },
      ],
      [
        'certificat illisible',
        (f) => {
          f.client_cert_pem = 'nope';
        },
      ],
    ];
    it.each(cases)('%s', async (_name, mutate) => {
      const keystore = new FakeHardwareKeystore();
      const file = { ...(await makeEnrollmentFile(keystore)) } as Record<string, unknown>;
      file.site_order_keys = (file.site_order_keys as Array<Record<string, string>>).map((k) => ({
        ...k,
      }));
      await mutate(file);
      const run = await attempt(file, keystore);
      await expect(run.result).rejects.toBeInstanceOf(EnrollmentError);
      expect(existsSync(run.path)).toBe(true);
      expect(await count('edge_meta')).toBe(0);
      expect(await count('edge_site_order_key')).toBe(0);
      expect(await count('edge_chain_head')).toBe(0);
    });
  });

  it('certificat client qui ne porte pas la clé du matériel : KEY_MISMATCH', async () => {
    const file = await makeEnrollmentFile(new FakeHardwareKeystore());
    const run = await attempt(file, new FakeHardwareKeystore());
    await expect(run.result).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(await count('edge_meta')).toBe(0);
  });
});

describe('sans enrôlement, la passerelle refuse de servir', () => {
  it('assertEnrolled refuse puis accepte', async () => {
    const service = new EnrollmentService(new GatewayTx(db.pool), new FakeHardwareKeystore());
    await expect(service.assertEnrolled()).rejects.toMatchObject({ code: 'NOT_ENROLLED' });
    await enrolledFixture(db);
    await expect(service.assertEnrolled()).resolves.toBeUndefined();
  });

  it('démarrage réel sur une base non enrôlée : code non nul, aucun port ouvert', async () => {
    const r = await runGateway({
      NODE_ENV: 'test',
      GATEWAY_DATABASE_URL: db.url,
      GATEWAY_LISTEN_PORT: '0',
    });
    expect(r.code).toBe(1);
    expect(r.listening).toBe(false);
    expect(r.stderr).toMatch(/non enrôlée/);
  }, 60_000);
});
