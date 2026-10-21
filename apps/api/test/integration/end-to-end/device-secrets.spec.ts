// Aucun secret des terminaux en clair (mission 5a, lot WP18, T084 ; NFR-005, SC-005 ;
// contracts/enrollment.md et device-tokens.md, « Tests imposés »). Après un parcours complet par
// l'API (codes émis, essais refusés puis enrôlements Android et iPhone, configuration, battement de
// cœur, rafraîchissements, représentation d'un jeton consommé qui révoque la famille, preuves
// fausses, suspension et révocation au back-office), chaque code d'enrôlement, chaque jeton de
// rafraîchissement et chaque jeton d'appareil émis est recherché, sous toutes ses formes (texte,
// sans tirets ni préfixe, octets en hexadécimal comme les montre `bytea`), dans TOUTES les tables
// du schéma (audit, registre d'idempotence et essais d'enrôlement compris), dans tout ce qui part
// au journal (`Logger` de Nest, `console`, sorties standard) et dans les réponses d'erreur : 0.
//
// Recherche parallèle sûre : les valeurs cherchées sont aléatoires et propres à la suite ; les
// lignes des autres suites ne peuvent pas les contenir. Écritures directes en base : amorçage
// seulement (jeu d'essai commun).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ATTESTATION_VERIFIER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  adoptRefresh,
  asPerson,
  enrollFrom,
  issueCode,
  realAttestation,
  refresh,
  testAddress,
  type RealAttestation,
} from '../../support/device-e2e';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal, type RouteServer, type TerminalResponse } from '../../support/test-terminal';

jest.setTimeout(180_000);

const LOGGER_METHODS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/**
 * Formes d'un secret, chacune la plus courte qui le trahit : texte (le jeton entier contient sa
 * partie aléatoire), sans séparateur ni préfixe, octets en hexadécimal (forme texte d'un `bytea`).
 */
function formsOf(kind: 'code' | 'refresh' | 'access', value: string): string[] {
  const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex');
  if (kind === 'code') {
    const bare = value.replace(/-/g, '');
    return [value, bare, hex(value), hex(bare)];
  }
  if (kind === 'refresh') {
    // `drt_` puis 256 bits en base64url : la partie aléatoire suffit à trahir le jeton.
    const body = value.replace(/^drt_/, '');
    return [body, hex(body), Buffer.from(body, 'base64url').toString('hex')];
  }
  // Jeton d'appareil : sa signature lui est propre (en-tête et revendications ne sont pas secrets).
  const signature = value.split('.')[2]!;
  return [signature, hex(signature), Buffer.from(signature, 'base64url').toString('hex')];
}

describe('NFR-005, SC-005 : aucun code ni jeton en clair après le parcours', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let attestation: RealAttestation;
  const address = testAddress();
  const secrets: Array<{ label: string; forms: string[] }> = [];
  const refusals: Array<{ step: string; res: TerminalResponse }> = [];
  const journal: string[] = [];

  const remember = (kind: 'code' | 'refresh' | 'access', label: string, value: string) => {
    if (value) secrets.push({ label, forms: formsOf(kind, value) });
  };
  const rememberTerminal = (t: TestTerminal, label: string) => {
    remember('refresh', `${label} : jeton de rafraîchissement`, t.refreshToken);
    remember('access', `${label} : jeton d’appareil`, t.token);
  };
  const refused = (step: string, res: TerminalResponse) => {
    expect([step, res.status >= 400]).toEqual([step, true]);
    refusals.push({ step, res });
  };

  /** Parcours complet, journaux capturés ; rend après avoir tout restauré. */
  async function journey(): Promise<void> {
    const pkis = { androidPki: attestation.androidPki, iosPki: attestation.iosPki };
    const admin = asPerson(server, w.operatorAdminA.token);
    // Codes : un par terminal, un refusé puis employé, un jamais employé.
    const codes = await Promise.all(
      ['android', 'iphone', 'troisième', 'jamais employé'].map(async (label) => {
        const { code } = await issueCode(server, w.operatorAdminA.token, {
          event_id: w.ids.eventA,
        });
        remember('code', `code ${label}`, code);
        return code;
      }),
    );
    const android = new TestTerminal('ANDROID');
    const iphone = new TestTerminal('IOS');
    const third = new TestTerminal('ANDROID');
    // Essai refusé (défi calculé sur un autre code), code inconnu, puis enrôlements.
    refused(
      'attestation sur un autre défi',
      await enrollFrom(server, third, codes[2]!, address, {
        ...pkis,
        challengeCode: 'ABCDEFGHJKLM',
      }),
    );
    expect((await enrollFrom(server, android, codes[0]!, address, pkis)).status).toBe(201);
    expect((await enrollFrom(server, iphone, codes[1]!, address, pkis)).status).toBe(201);
    expect((await enrollFrom(server, third, codes[2]!, address, pkis)).status).toBe(201);
    refused(
      'code déjà utilisé',
      await enrollFrom(server, new TestTerminal(), codes[0]!, address, pkis),
    );
    // Rejeu de la clé d'idempotence d'une création de code : 409 sans le code.
    const key = randomUUID();
    const first = await admin.post(
      '/device-enrollment-codes',
      { event_id: w.ids.eventA, app_mode: 'CATALOG_POS', kind: 'POS', personal_phone: false },
      { key },
    );
    expect(first.status).toBe(201);
    remember('code', 'code d’une création rejouée', String(first.body.code));
    refused(
      'rejeu de la création d’un code',
      await admin.post(
        '/device-enrollment-codes',
        { event_id: w.ids.eventA, app_mode: 'CATALOG_POS', kind: 'POS', personal_phone: false },
        { key },
      ),
    );
    for (const [t, label] of [
      [android, 'android'],
      [iphone, 'iphone'],
      [third, 'troisième'],
    ] as const)
      rememberTerminal(t, `${label}, enrôlement`);

    // Configuration et battement de cœur.
    for (const t of [android, iphone]) {
      const get = (path: string) =>
        t.request(api.baseUrl, api.tls.serverCaPem, { method: 'GET', path });
      expect((await get('/device/config')).status).toBe(200);
      expect(
        (
          await t.request(api.baseUrl, api.tls.serverCaPem, {
            method: 'POST',
            path: '/device/heartbeat',
            body: {
              device_time: new Date().toISOString(),
              snapshot_version: null,
              last_local_seq: 0,
              pending_operations: 0,
              pending_exposure: 0,
              battery_percent: 40,
            },
          })
        ).status,
      ).toBe(200);
    }

    // Rafraîchissements : deux rotations de l'Android, chaque génération retenue.
    for (let i = 1; i <= 2; i += 1) {
      adoptRefresh(android, await refresh(server, android));
      rememberTerminal(android, `android, rotation ${i}`);
    }
    // iPhone : rotation, représentation sous 60 s (grâce), seconde représentation → famille
    // révoquée et audit DEVICE_TOKEN_REUSE.
    const consumed = iphone.refreshToken;
    adoptRefresh(iphone, await refresh(server, iphone));
    rememberTerminal(iphone, 'iphone, rotation');
    const grace = await refresh(server, iphone, { token: consumed });
    adoptRefresh(iphone, grace);
    rememberTerminal(iphone, 'iphone, grâce');
    refused('seconde représentation', await refresh(server, iphone, { token: consumed }));
    refused('famille révoquée', await refresh(server, iphone));

    // Preuves fausses : jeton d'un autre terminal, jeton falsifié, rafraîchissement d'un autre.
    const config = (t: TestTerminal, proofs: Parameters<TestTerminal['request']>[3]) =>
      t.request(
        api.baseUrl,
        api.tls.serverCaPem,
        { method: 'GET', path: '/device/config' },
        proofs,
      );
    refused('jeton d’un autre terminal', await config(android, { token: third.token }));
    refused(
      'jeton falsifié',
      await config(android, { token: `${android.token.slice(0, -4)}AAAA` }),
    );
    refused(
      'jeton de rafraîchissement d’un autre terminal',
      await refresh(server, android, { token: third.refreshToken }),
    );

    // Back-office : suspension et révocation, puis requêtes refusées.
    const change = (t: TestTerminal, verb: string, reason: string) =>
      admin.post(`/devices/${t.deviceId}/${verb}`, { reason });
    expect((await change(third, 'suspend', 'Contrôle des secrets (suspension).')).status).toBe(200);
    refused('rafraîchissement suspendu', await refresh(server, third));
    expect((await change(android, 'revoke', 'Contrôle des secrets (révocation).')).status).toBe(
      200,
    );
    refused('configuration révoquée', await config(android, {}));
    refused('rafraîchissement révoqué', await refresh(server, android));
  }

  beforeAll(async () => {
    w = await createMediaWorld();
    attestation = await realAttestation();
    api = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: ATTESTATION_VERIFIER, useValue: attestation.verifier }],
      trustProxyHops: 1,
    });
    server = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
    const text = (args: unknown[]) =>
      args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack : JSON.stringify(a)))
        .join(' ');
    const spies = [
      ...LOGGER_METHODS.map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...LOGGER_METHODS.map((m) =>
        jest.spyOn(Logger, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...CONSOLE_METHODS.map((m) =>
        jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...[process.stdout, process.stderr].map((stream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
          journal.push(String(chunk));
          return true;
        }),
      ),
    ];
    try {
      await journey();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }, 180_000);

  afterAll(async () => {
    await api?.close();
    attestation?.dispose();
  });

  it('le parcours a bien produit des secrets et des refus à chercher', () => {
    expect(secrets.filter((s) => s.label.startsWith('code')).length).toBe(5);
    expect(secrets.length).toBeGreaterThanOrEqual(5 + 2 * 7);
    expect(refusals.length).toBeGreaterThanOrEqual(10);
  });

  it('base : aucune table ne contient un code ou un jeton, sous aucune forme', async () => {
    const all = secrets.flatMap((s) => s.forms);
    const found = await withOwner(async (db) => {
      const { rows: tables } = await db.query<{ name: string }>(
        `SELECT format('%I.%I', schemaname, tablename) AS name
           FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
      );
      // Tables attendues dans la recherche : sinon le balayage ne prouve rien.
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'public.audit_log',
          'public.api_idempotency',
          'public.device',
          'public.device_enrollment_code',
          'public.device_enrollment_attempt',
          'public.device_refresh_token',
          'public.device_status_history',
          'public.device_request_nonce',
        ]),
      );
      const hits: string[] = [];
      for (const { name } of tables) {
        // Texte de chaque ligne calculé une fois (MATERIALIZED), puis chaque forme cherchée.
        const { rows } = await db.query<{ form: string }>(
          `WITH r AS MATERIALIZED (SELECT t::text AS x FROM ${name} t)
           SELECT DISTINCT s.form FROM r JOIN unnest($1::text[]) AS s(form)
             ON strpos(r.x, s.form) > 0`,
          [all],
        );
        for (const { form } of rows)
          for (const secret of secrets.filter((s) => s.forms.includes(form)))
            hits.push(`${name} : ${secret.label}`);
      }
      return hits;
    });
    expect(found).toEqual([]);
  });

  it('journaux : aucun code ni jeton dans ce qui part au journal', () => {
    const text = journal.join('\n');
    expect(
      secrets.filter((s) => s.forms.some((form) => text.includes(form))).map((s) => s.label),
    ).toEqual([]);
  });

  it('réponses d’erreur : aucun code ni jeton', () => {
    const leaks = refusals.flatMap(({ step, res }) =>
      secrets
        .filter((s) => s.forms.some((form) => res.text.includes(form)))
        .map((s) => `${step} : ${s.label}`),
    );
    expect(leaks).toEqual([]);
  });

  it('contrôle du balayage : les codes employés sont bien en base (empreintes)', async () => {
    // Le balayage n'est pas vide : les empreintes des jetons de la suite sont bien en base.
    const rows = await withOwner(
      async (db) =>
        (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM device_enrollment_code c
             JOIN device d ON d.id = c.device_id WHERE c.event_id = $1`,
            [w.ids.eventA],
          )
        ).rows,
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(3);
  });
});
