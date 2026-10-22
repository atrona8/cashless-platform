// Limites d'enrôlement sous requêtes simultanées et en IPv6 (ADR-117, relecture de WP14 cycle 2 ;
// migration 0030 ; lot WP18). N-b : une rafale de requêtes simultanées sur un code fuité, qui passe
// tout entière le contrôle préalable, n'écrit que 10 refus et une trace RATE_LIMITED (verrous du
// code pris avant le contrôle, dans la transaction qui écrit). N-c : la limite par adresse vaut
// pour un /64 IPv6. N-a : la trace RATE_LIMITED nomme la limite franchie (`limit`).
// Isolation (relecture de WP14, N1) : adresses tirées dans 2001:db8::/32 (documentation), un /48
// par exécution, et codes neufs ; la suite n'efface que ses propres essais.
import 'reflect-metadata';
import { createHmac, randomInt } from 'node:crypto';
import { loadConfig } from '../../../src/config/config';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  createEnrollmentCode,
  postJson,
  type RouteServer,
  type TerminalResponse,
} from '../../support/test-terminal';

const BURST = 40;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Code bien formé tiré au hasard (60 bits) : inconnu. */
const unknownCode = () => {
  let code = '';
  for (let i = 0; i < 12; i += 1) code += ALPHABET[randomInt(32)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
};

describe('limites d’enrôlement : rafale simultanée, /64 IPv6 (ADR-117)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let codeKey: Buffer;
  /** Préfixe /48 propre à l'exécution, écrit sous forme canonique (comme `host()` en base). */
  const prefix = `2001:db8:${(randomInt(0xfff) + 1).toString(16)}`;
  /** Adresse n du /64 numéro `net` du préfixe de la suite. */
  const v6 = (net: number, n: number) => `${prefix}:${net.toString(16)}::${n.toString(16)}`;
  const hashes: Buffer[] = [];

  const hashOf = (code: string) => {
    const hash = createHmac('sha256', codeKey).update(code.replace(/-/g, '')).digest();
    hashes.push(hash);
    return hash;
  };
  /** Corps invalide (aucune clé) mais code bien formé : refus VALIDATION_FAILED compté. */
  const refuse = (code: string, from: string): Promise<TerminalResponse> =>
    postJson(server, '/device-enrollments', { enrollment_code: code }, { 'x-forwarded-for': from });
  const audits = (sql: string, params: unknown[]) =>
    ownerRows<{ operator_id: string | null; after: Record<string, unknown> }>(
      `SELECT operator_id, after FROM audit_log
        WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND ${sql} ORDER BY id`,
      params,
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    codeKey = loadConfig().enrollmentCodeHmacKey;
    api = await startHttpsApp(undefined, { identity: w.idp, trustProxyHops: 1 });
    server = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
  }, 60_000);

  afterAll(async () => {
    await withOwner((db) =>
      db.query(
        `DELETE FROM device_enrollment_attempt
          WHERE code_hash = ANY($1) OR address << $2::inet`,
        [hashes, `${prefix}::/48`],
      ),
    );
    await api?.close();
  });

  it('N-b : rafale simultanée sur un code fuité → 10 refus et une trace RATE_LIMITED', async () => {
    const code = await createEnrollmentCode(server, w.operatorAdminA.token, {
      event_id: w.ids.eventA,
    });
    const hash = hashOf(code);
    // Chaque requête d'un /64 différent : seule la limite du code joue.
    const responses = await Promise.all(
      Array.from({ length: BURST }, (_, i) => refuse(code, v6(0x100 + i, 1))),
    );
    for (const res of responses) expect([400, 429]).toContain(res.status);
    const attempts = await ownerRows<{ result: string }>(
      'SELECT result FROM device_enrollment_attempt WHERE code_hash = $1',
      [hash],
    );
    expect(attempts).toHaveLength(11);
    expect(attempts.filter((a) => a.result === 'RATE_LIMITED')).toHaveLength(1);
    const codeId = (
      await ownerRows<{ id: string }>(
        'SELECT id FROM device_enrollment_code WHERE code_hash = $1',
        [hash],
      )
    )[0]!.id;
    const lines = await audits(`after->>'enrollment_code_id' = $1`, [codeId]);
    expect(lines).toHaveLength(11);
    expect(lines.every((a) => a.operator_id === w.ops.a)).toBe(true);
    const limited = lines.filter((a) => a.after.result === 'RATE_LIMITED');
    expect(limited).toHaveLength(1);
    expect(limited[0]!.after.limit).toBe('code');
    // Le code n'est pas consommé.
    const used = await ownerRows<{ used_at: Date | null }>(
      'SELECT used_at FROM device_enrollment_code WHERE id = $1',
      [codeId],
    );
    expect(used[0]!.used_at).toBeNull();
  }, 60_000);

  it('N-c : 30 refus depuis un /64 IPv6 → 429 dans tout le /64, pas ailleurs', async () => {
    for (let n = 1; n <= 30; n += 1)
      expect((await refuse(unknownCode(), v6(1, n))).status).toBe(400);
    const limited = await refuse(unknownCode(), v6(1, 0xbeef));
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('3600');
    // Un autre /64 du même /48 n'est pas limité.
    expect((await refuse(unknownCode(), v6(2, 1))).status).toBe(400);
    // N-a : la trace nomme la limite de l'adresse, avec l'adresse complète.
    const traces = await audits(`after->>'result' = 'RATE_LIMITED' AND after->>'address' = $1`, [
      v6(1, 0xbeef),
    ]);
    expect(traces.map((a) => [a.operator_id, a.after.limit])).toEqual([[null, 'address']]);
  });

  it('N-b : rafale de codes inconnus depuis un /64 → 30 refus et une trace', async () => {
    const responses = await Promise.all(
      Array.from({ length: BURST }, (_, i) => refuse(unknownCode(), v6(3, i + 1))),
    );
    for (const res of responses) expect([400, 429]).toContain(res.status);
    const attempts = await ownerRows<{ result: string }>(
      'SELECT result FROM device_enrollment_attempt WHERE address << $1::inet',
      [`${prefix}:3::/64`],
    );
    expect(attempts).toHaveLength(31);
    expect(attempts.filter((a) => a.result === 'RATE_LIMITED')).toHaveLength(1);
    const traces = await audits(`(after->>'address')::inet << $1::inet`, [`${prefix}:3::/64`]);
    expect(traces).toHaveLength(31);
    expect(
      traces.filter((a) => a.after.result === 'RATE_LIMITED').map((a) => a.after.limit),
    ).toEqual(['address']);
  }, 60_000);
});
