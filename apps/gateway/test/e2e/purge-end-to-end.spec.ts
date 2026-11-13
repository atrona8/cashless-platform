// T116 / NFR-013 : purge de fin d'événement, de bout en bout (processus réels, deux bases).
//   - automatique : le central clôt l'événement, la passerelle l'apprend par la réplication, la
//     file
//     est acquittée, la purge part seule ;
//   - manuelle : ordre signé par DEUX responsables ; refusée tant que la file n'est pas acquittée
//     (rien n'est détruit) ; acceptée ensuite, et l'ordre est versé au central par un LOT D'ORDRES
//     SEULS (décision 50) AVANT la destruction ;
//   - dans les deux cas : les valeurs secrètes lues dans la base AVANT la purge (colis scellés,
//     clé de contenu, empreintes de jetons) ont disparu de `pg_dump` sous toutes leurs
//     représentations ; `sign` et `agree` sont refusés après coup (KEY_DESTROYED).
// Sensibilité : avant la purge, les mêmes valeurs SONT dans le `pg_dump` (sinon l'absence après ne
// prouverait rien).
import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { assertNoLeak, canaryOf, findIn, pgDump, type Canary, type Hit } from '../support/canary';
import { awaitLocalPacks, depositPacks, seedFreshMedia } from '../support/pack-delivery';
import { activateEdge, report } from '../support/load-support';
import { TwoProcessBench, until } from '../support/two-process-bench';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);

/** Valeurs secrètes réelles de la base locale : colis scellés, clé de contenu, empreintes. */
async function localSecrets(): Promise<Array<{ name: string; canary: Canary }>> {
  const packs = await bench.localQuery<{ pwd_pack_enc: Buffer }>(
    'SELECT pwd_pack_enc FROM edge_media WHERE pwd_pack_enc IS NOT NULL',
  );
  const keys = await bench.localQuery<{ sealed_key: Buffer }>(
    'SELECT sealed_key FROM edge_pwd_pack_key',
  );
  const families = await bench.localQuery<{ h: Buffer }>(
    'SELECT refresh_token_sha256_current AS h FROM edge_device_token_family ' +
      'WHERE refresh_token_sha256_current IS NOT NULL',
  );
  expect(families.length).toBeGreaterThan(0);
  return [
    ...packs.map((r, i) => ({ name: `colis ${i + 1}`, canary: canaryOf(r.pwd_pack_enc) })),
    ...keys.map((r, i) => ({ name: `clé de contenu ${i + 1}`, canary: canaryOf(r.sealed_key) })),
    ...families.map((r, i) => ({ name: `empreinte de jeton ${i + 1}`, canary: canaryOf(r.h) })),
  ];
}

function leaks(secrets: Array<{ name: string; canary: Canary }>): Hit[] {
  const dump = pgDump(bench.edgeDb.name);
  return secrets.flatMap(({ name, canary }) => {
    const found = findIn(canary, dump);
    return found.length ? [{ where: `pg_dump (${name})`, representations: found }] : [];
  });
}

async function prepare(
  options: { sale?: boolean } = {},
): Promise<{ secrets: Array<{ name: string; canary: Canary }> }> {
  const w = bench.world;
  const till = await w.terminal();
  const fresh = await seedFreshMedia(bench, 2);
  expect(await depositPacks(bench)).toBeGreaterThanOrEqual(1);
  await bench.startGateway();
  const paid = await w.media(1, 100_000);
  await activateEdge(bench, [paid[0]!.walletId]);
  await awaitLocalPacks(
    bench,
    fresh.map((m) => m.id),
  );
  // Un jeton de terminal pour la passerelle (famille et empreinte de rafraîchissement répliquées).
  await bench.gatewayToken(till);
  if (options.sale !== false) {
    const sale = await bench.gwPay(till, w.catalogBody(till, { tap: w.tap(paid[0]!) }, [[0, 1]]));
    expect(sale.status).toBe(201);
  }
  const secrets = await localSecrets();
  expect(secrets.length).toBeGreaterThanOrEqual(3);
  return { secrets };
}

async function release(): Promise<void> {
  await bench.releaseToCentral();
  await until(
    'rendu terminé',
    async () =>
      (
        await central<{ status: string }>(
          `SELECT status FROM debit_authority_handover
            WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
          [bench.ledgerId],
        )
      )[0]?.status === 'COMPLETED',
    180_000,
    300,
  );
}

const markerState = (): string | null => {
  const file = join(bench.dir, 'purge.marker');
  if (!existsSync(file)) return null;
  try {
    return String((JSON.parse(readFileSync(file, 'utf8')) as { state?: string }).state ?? null);
  } catch {
    return null;
  }
};

async function keysRefused(): Promise<void> {
  const store = new FakeHardwareKeystore({ keyFile: join(bench.dir, 'dev-keys.json') });
  for (const use of ['token', 'batch', 'snapshot'] as const)
    await expect(store.sign(use, Buffer.from('x'))).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
  const peer = new FakeHardwareKeystore();
  await expect(store.agree(await peer.publicKey('agreement'))).rejects.toMatchObject({
    code: 'KEY_DESTROYED',
  });
}

describe('NFR-013 : purge automatique après la clôture', () => {
  it('clôture au central, file acquittée : la purge part seule, plus de secret', async () => {
    bench = await TwoProcessBench.start({ startGateway: false });
    // Sans vente : la clôture de l'événement exige des droits nets soldés (règle du central).
    const { secrets } = await prepare({ sale: false });
    // Sensibilité : avant la purge, les valeurs secrètes SONT dans la base locale.
    expect(leaks(secrets).length).toBeGreaterThan(0);
    await release();
    // Le central clôt l'événement ; la passerelle l'apprend par la réplication.
    // La clôture réelle exige des droits nets soldés et des terminaux à jour (règles du central,
    // prouvées
    // ailleurs) : sur la base JETABLE du banc, seule la garde de transition est levée le temps du
    // changement ; le déclencheur du journal de référence reste actif, donc la passerelle l'apprend
    // par la réplication, comme pour une clôture ordinaire.
    await central('ALTER TABLE event DISABLE TRIGGER event_status_guard');
    try {
      await central("UPDATE event SET status = 'CLOSED' WHERE id = $1", [bench.eventId]);
    } finally {
      await central('ALTER TABLE event ENABLE TRIGGER event_status_guard');
    }
    await until(
      'purge terminée',
      async () => (markerState() === 'DONE' ? true : null),
      180_000,
      500,
    );
    assertNoLeak(leaks(secrets));
    const left = await bench.localQuery<{ n: string }>(
      'SELECT (SELECT count(*) FROM edge_media) + (SELECT count(*) FROM edge_pwd_pack_key) ' +
        '+ (SELECT count(*) FROM edge_device_token_family) AS n',
    );
    expect(Number(left[0]!.n)).toBe(0);
    await keysRefused();
    report('NFR-013 purge automatique', { valeursCherchees: secrets.length });
  }, 900_000);
});

describe('NFR-013 : purge manuelle à deux personnes', () => {
  const purgeSteps = () =>
    bench.localQuery<{ step: string; central: string | null; at: string }>(
      `SELECT detail->>'step' AS step, detail->>'central' AS central, at::text AS at
         FROM edge_audit WHERE kind = 'PURGE' ORDER BY id`,
    );

  it('refusée file non acquittée ; acceptée après le rendu (trace forcée)', async () => {
    await bench?.close();
    bench = await TwoProcessBench.start({ startGateway: false });
    const { secrets } = await prepare();

    // Une seule personne : refusée, rien n'est détruit.
    const single = await bench.localOrder('PURGE', { signers: [0] });
    expect(single.status).toBeGreaterThanOrEqual(400);
    expect(single.status).toBeLessThan(500);
    // Deux personnes, file NON acquittée (une vente attend d'être vidée) : refusée, rien détruit.
    const early = await bench.localOrder('PURGE');
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect(early.status).toBeLessThan(500);
    expect(markerState()).not.toBe('DONE');
    expect(leaks(secrets).length).toBeGreaterThan(0);

    // La file est vidée et acquittée par le rendu : l'autorité est revenue au central, l'époque de
    // la passerelle est périmée, le lot d'ordres seuls est refusé (limite écrite : OP-N119) ; la
    // purge est donc forcée au bout de l'attente, avec sa trace `CENTRAL_UNCONFIRMED`.
    await release();
    const done = await bench.localOrder('PURGE');
    expect({ status: done.status, body: done.body }).toMatchObject({ status: 200 });
    expect(markerState()).toBe('DONE');
    const steps = await purgeSteps();
    expect(steps.map((s) => s.step)).toEqual(
      expect.arrayContaining(['AWAITING_CENTRAL', 'CENTRAL_UNCONFIRMED', 'DONE']),
    );
    assertNoLeak(leaks(secrets));
    await keysRefused();
    // Plus rien n'est servi : un nouvel ordre n'est pas accepté.
    const again = await bench.localOrder('PURGE').catch(() => ({ status: 0 }));
    expect(again.status).not.toBe(200);
    report('NFR-013 purge manuelle après rendu', { valeursCherchees: secrets.length });
  }, 900_000);

  it('ACTIVE, file vide : ordre versé au central (lot d’ordres seuls) avant la purge', async () => {
    await bench?.close();
    bench = await TwoProcessBench.start({ startGateway: false });
    const { secrets } = await prepare({ sale: false });
    expect(leaks(secrets).length).toBeGreaterThan(0);
    const done = await bench.localOrder('PURGE');
    expect({ status: done.status, body: done.body }).toMatchObject({ status: 200 });
    // Un lot SANS opération (décision 50) a porté l'ordre au central, qui l'a consigné.
    const orderOnly = await central<{ received_at: string }>(
      `SELECT received_at::text FROM edge_sync_batch
        WHERE gateway_id = $1 AND edge_seq_to = edge_seq_from - 1`,
      [bench.gatewayId],
    );
    expect(orderOnly).toHaveLength(1);
    const recorded = await central<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'EDGE_LOCAL_ORDER_RECORDED'`,
    );
    expect(Number(recorded[0]!.n)).toBeGreaterThanOrEqual(1);
    // L'accusé du central précède la destruction, et la purge n'est pas « forcée ».
    const steps = await purgeSteps();
    expect(steps.some((s) => s.step === 'CENTRAL_UNCONFIRMED')).toBe(false);
    const destroyAt = steps.find((s) => s.step === 'DATA')!.at;
    expect(Date.parse(orderOnly[0]!.received_at)).toBeLessThanOrEqual(Date.parse(destroyAt));
    expect(markerState()).toBe('DONE');
    assertNoLeak(leaks(secrets));
    await keysRefused();
    report('NFR-013 purge manuelle avec lien', { valeursCherchees: secrets.length });
  }, 900_000);
});
