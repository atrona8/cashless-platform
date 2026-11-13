import 'reflect-metadata';
import { join } from 'node:path';
import { runGateway } from '../startup/_support/child';
import { toHandoverView } from '../../src/authority/authority.service';
import { handover, stateWith } from './_support/central';
import { authorityRow, forceAuthority, makeHarness, type Harness } from './_support/harness';

const NOW = new Date('2026-11-06T12:00:00Z');
const TO_EDGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TO_CENTRAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => h.close());

async function releasing(): Promise<void> {
  await forceAuthority(h.db, {
    state: 'RELEASING',
    epoch: 5,
    highest_epoch_seen: 5,
    handover_id: TO_CENTRAL,
    releasing_since: NOW,
    activated_at: NOW,
    edge_seq_at_activation: 0,
  });
}

/** Redémarrage = nouvelle instance sur la même base ; le central répond par `reply`. */
async function restartWith(reply: unknown): Promise<Harness['authority']> {
  h.central.script = () => ({ status: 200, body: reply });
  const { authority } = h.restart();
  await authority.recover();
  return authority;
}

describe('A13 : les quatre cas de redémarrage pendant RELEASING', () => {
  it('1. RELEASE_REQUESTED toujours ouvert : reste RELEASING (aucun débit)', async () => {
    await releasing();
    const authority = await restartWith(
      stateWith(
        handover({ handover_id: TO_CENTRAL, direction: 'TO_CENTRAL', state: 'RELEASE_REQUESTED' }),
        'EDGE',
        5,
      ),
    );
    expect((await authorityRow(h.db)).state).toBe('RELEASING');
    await expect(authority.assertCanDebit(5)).rejects.toMatchObject({
      code: 'DEBIT_AUTHORITY_MOVING',
    });
  });

  it(
    '1 bis. lecture « TO_EDGE ACTIVE, même époque » (le ' + 'mauvais handover) : reste RELEASING',
    async () => {
      // Détecteur du défaut visé : un recover() qui lirait « ACTIVE, même époque » au lieu de
      // RELEASING rendrait l'autorité à la passerelle en plein rendu.
      await releasing();
      const authority = await restartWith(
        stateWith(
          handover({ handover_id: TO_EDGE, direction: 'TO_EDGE', state: 'ACTIVE' }),
          'EDGE',
          5,
        ),
      );
      expect((await authorityRow(h.db)).state).toBe('RELEASING');
      await expect(authority.assertCanDebit(5)).rejects.toMatchObject({
        code: 'DEBIT_AUTHORITY_MOVING',
      });
    },
  );

  it('2. FAILED de la même époque, aucun TO_CENTRAL ouvert : retour ACTIVE', async () => {
    await releasing();
    const authority = await restartWith(
      stateWith(
        handover({ handover_id: TO_CENTRAL, direction: 'TO_CENTRAL', state: 'FAILED' }),
        'EDGE',
        5,
      ),
    );
    const row = await authorityRow(h.db);
    expect(row.state).toBe('ACTIVE');
    expect(row.handover_failed_epoch).toBe('5');
    await expect(authority.assertCanDebit(5)).resolves.toMatchObject({ state: 'ACTIVE' });
  });

  it('2 bis. FAILED pour une AUTRE époque, ou un autre handover : jamais ACTIVE', async () => {
    await releasing();
    await restartWith(
      stateWith(
        handover({ handover_id: TO_CENTRAL, direction: 'TO_CENTRAL', state: 'FAILED', epoch: 3 }),
        'EDGE',
        5,
      ),
    );
    expect((await authorityRow(h.db)).state).toBe('RELEASING');
    await restartWith(
      stateWith(
        handover({
          handover_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          direction: 'TO_CENTRAL',
          state: 'FAILED',
        }),
        'EDGE',
        5,
      ),
    );
    expect((await authorityRow(h.db)).state).toBe('RELEASING');
  });

  it('3. COMPLETED : RELEASED puis ARMED, highest_epoch_seen = e + 2', async () => {
    await releasing();
    await restartWith(
      stateWith(
        handover({ handover_id: TO_CENTRAL, direction: 'TO_CENTRAL', state: 'COMPLETED' }),
        'CENTRAL',
        6,
      ),
    );
    expect(await authorityRow(h.db)).toMatchObject({ state: 'ARMED', highest_epoch_seen: '7' });
  });

  it('3 bis. autorité revenue au central, aucun handover rendu : RELEASED puis ARMED', async () => {
    await releasing();
    await restartWith(stateWith(null, 'CENTRAL', 6));
    expect(await authorityRow(h.db)).toMatchObject({ state: 'ARMED', highest_epoch_seen: '7' });
  });

  it('4. central muet (aucun handover, autorité EDGE) : reste RELEASING, alerte', async () => {
    await releasing();
    await restartWith(stateWith(null, 'EDGE', 5));
    expect((await authorityRow(h.db)).state).toBe('RELEASING');
    const kinds = (await h.db.pool.query('SELECT kind FROM edge_audit')).rows.map((r) => r.kind);
    expect(kinds).toContain('AUTHORITY_RECOVERY_UNKNOWN');
  });

  it(
    'central injoignable au redémarrage : l’état ' + 'persisté reste (RELEASING, aucun débit)',
    async () => {
      await releasing();
      h.central.script = () => ({ destroy: true });
      const { authority } = h.restart();
      expect(await authority.recover()).toEqual({ contacted: false });
      expect((await authorityRow(h.db)).state).toBe('RELEASING');
    },
  );
});

describe('arrêt entre le 200 de l’accusé et l’écriture d’ACTIVE', () => {
  async function pending(cursor: number): Promise<void> {
    await forceAuthority(h.db, {
      state: 'GRANTED_PENDING',
      epoch: 5,
      highest_epoch_seen: 5,
      handover_id: TO_EDGE,
      watermark_posting_id: 100,
    });
    await h.db.pool.query('UPDATE edge_replication_cursor SET last_replicated_posting_id = $1', [
      cursor,
    ]);
  }

  it(
    'handover vu ACTIVE, même époque, curseur au ' + 'filigrane : ACTIVE sans nouvel accusé',
    async () => {
      await pending(100);
      const authority = await restartWith(stateWith(handover({ state: 'ACTIVE' }), 'EDGE', 5));
      expect((await authorityRow(h.db)).state).toBe('ACTIVE');
      expect(h.central.count('POST', '/ack')).toBe(0);
      await expect(authority.assertCanDebit(5)).resolves.toBeDefined();
    },
  );

  it('curseur sous le filigrane : reste GRANTED_PENDING (aucun débit)', async () => {
    await pending(99);
    await restartWith(stateWith(handover({ state: 'ACTIVE' }), 'EDGE', 5));
    expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
  });

  it('handover ACTIVE d’une autre époque : reste GRANTED_PENDING', async () => {
    await pending(100);
    await restartWith(stateWith(handover({ state: 'ACTIVE', epoch: 4 }), 'EDGE', 4));
    expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
  });
});

describe(
  'persistance avant action : SIGKILL juste après ' + 'RELEASING (after-releasing-persisted)',
  () => {
    it('le processus tué ne laisse aucun débit ; le redémarrage lit RELEASING', async () => {
      await forceAuthority(h.db, {
        state: 'ACTIVE',
        epoch: 5,
        highest_epoch_seen: 5,
        handover_id: TO_EDGE,
        activated_at: NOW,
        edge_seq_at_activation: 0,
      });
      const result = await runGateway(
        { NODE_ENV: 'test', GATEWAY_DATABASE_URL: h.db.url },
        { entry: join(__dirname, '_support', 'release-child.ts'), timeoutMs: 40_000 },
      );
      expect(result.signal).toBe('SIGKILL');
      expect(result.stdout).not.toContain('SURVIVED');
      const row = await authorityRow(h.db);
      expect(row.state).toBe('RELEASING');
      expect(row.handover_id).toBe(TO_CENTRAL);
      const { authority } = h.restart();
      await expect(authority.assertCanDebit(5)).rejects.toMatchObject({
        code: 'DEBIT_AUTHORITY_MOVING',
      });
    });
  },
);

it('toHandoverView conserve le filigrane en bigint', () => {
  expect(
    toHandoverView(handover({ central_watermark_posting_id: 7 }) as never, NOW)
      .centralWatermarkPostingId,
  ).toBe(7n);
});
