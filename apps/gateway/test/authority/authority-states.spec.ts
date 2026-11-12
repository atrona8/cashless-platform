import 'reflect-metadata';
import {
  AUTHORITY_STATES,
  AUTHORITY_TRANSITIONS,
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from '../../src/authority/authority-transitions';
import {
  AuthorityRefusal,
  toHandoverView,
  type AuthorityRow,
} from '../../src/authority/authority.service';
import { unavailableCatchUp, type ReplicationCatchUp } from '../../src/authority/ports';
import { handover, stateWith } from './_support/central';
import {
  auditKinds,
  authorityRow,
  forceAuthority,
  makeHarness,
  type Harness,
} from './_support/harness';

const NOW = new Date('2026-11-06T12:00:00Z');
const view = (over: Record<string, unknown>) => toHandoverView(handover(over) as never, NOW);

let h: Harness;
afterEach(async () => h.close());

describe('table de transitions (B.8)', () => {
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('la table du code égale edge_authority_transition (SQL), ni plus ni moins', async () => {
    const { rows } = await h.db.pool.query(
      'SELECT from_state, to_state FROM edge_authority_transition ORDER BY 1, 2',
    );
    const sql = rows.map(
      (r: { from_state: string; to_state: string }) => `${r.from_state}>${r.to_state}`,
    );
    const code = AUTHORITY_TRANSITIONS.map(([a, b]) => `${a}>${b}`).sort();
    expect(code).toEqual([...sql].sort());
    expect(code).toHaveLength(13);
  });

  it('une transition absente de la table est refusée par le code, puis par la base', async () => {
    const absent = AUTHORITY_STATES.flatMap((a) =>
      AUTHORITY_STATES.map((b) => [a, b] as const),
    ).filter(([a, b]) => a !== b && !canTransition(a, b));
    expect(absent.length).toBe(8 * 7 - 13);
    expect(() => assertTransition('RELEASING', 'STALE')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('REVOKED', 'ARMED')).toThrow(IllegalTransitionError);
    await expect(h.db.pool.query(`UPDATE edge_authority SET state = 'STALE'`)).rejects.toThrow(
      /transition ARMED -> STALE absente/,
    );
  });
});

describe('chaque ligne du tableau B.8', () => {
  beforeEach(async () => {
    h = await makeHarness();
  });

  it(
    'GRANTED vu : GRANTED_PENDING persisté (handover, ' + 'époque, filigrane), aucun débit',
    async () => {
      await h.authority.onHandover(view({}));
      const row = await authorityRow(h.db);
      expect(row).toMatchObject({
        state: 'GRANTED_PENDING',
        epoch: '5',
        handover_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        watermark_posting_id: '100',
        highest_epoch_seen: '5',
      });
      await expect(h.authority.assertCanDebit(5)).rejects.toMatchObject({
        code: 'DEBIT_AUTHORITY_MOVING',
      });
    },
  );

  it('GRANTED vu deux fois : sans effet de plus', async () => {
    await h.authority.onHandover(view({}));
    const before = await auditKinds(h.db);
    await h.authority.onHandover(view({}));
    expect(await auditKinds(h.db)).toEqual(before);
  });

  it(
    'accusé 200 : ACTIVE, activated_at central, 12 h ' + 'de tolérance, numéro d’activation',
    async () => {
      await h.authority.onHandover(view({}));
      const central = new Date('2026-11-06T12:00:07Z');
      await h.authority.markActive({
        handoverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        epoch: 5,
        centralTime: central,
        edgeSeqAtActivation: null,
      });
      const row = await authorityRow(h.db);
      expect(row.state).toBe('ACTIVE');
      expect(new Date(row.activated_at).toISOString()).toBe('2026-11-06T12:00:07.000Z');
      expect(new Date(row.token_tolerance_until).toISOString()).toBe('2026-11-07T00:00:07.000Z');
      expect(row.edge_seq_at_activation).toBe('0');
      const after = await h.authority.assertCanDebit(5);
      expect(after.state).toBe('ACTIVE');
    },
  );

  it(
    'accusé répété (A17) : idempotent, aucune écriture ' + 'de plus, tolérance non prolongée',
    async () => {
      await h.authority.onHandover(view({}));
      const args = {
        handoverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        epoch: 5,
        centralTime: new Date('2026-11-06T12:00:07Z'),
        edgeSeqAtActivation: null,
      };
      await h.authority.markActive(args);
      const first = await authorityRow(h.db);
      const audits = await auditKinds(h.db);
      await h.authority.markActive({ ...args, centralTime: new Date('2026-11-06T18:00:00Z') });
      expect(await authorityRow(h.db)).toEqual(first);
      expect(await auditKinds(h.db)).toEqual(audits);
    },
  );

  it('handover FAILED (accord) : retour ARMED', async () => {
    await h.authority.onHandover(view({}));
    await h.authority.onHandover(view({ state: 'FAILED' }));
    expect((await authorityRow(h.db)).state).toBe('ARMED');
  });

  it('RELEASE_REQUESTED vu : RELEASING persisté, signal au vidage, MOVING', async () => {
    await activate();
    await h.authority.onHandover(
      view({
        handover_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        direction: 'TO_CENTRAL',
        state: 'RELEASE_REQUESTED',
      }),
    );
    const row = await authorityRow(h.db);
    expect(row.state).toBe('RELEASING');
    expect(row.handover_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(row.releasing_since).not.toBeNull();
    expect(h.drain.calls).toHaveLength(1);
    await expect(h.authority.assertCanDebit(5)).rejects.toMatchObject({
      code: 'DEBIT_AUTHORITY_MOVING',
    });
  });

  it('rendu COMPLETED : RELEASED (highest = e + 2) puis ARMED', async () => {
    await release();
    await h.authority.onHandover(
      view({
        handover_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        direction: 'TO_CENTRAL',
        state: 'COMPLETED',
      }),
    );
    expect(await authorityRow(h.db)).toMatchObject({ state: 'ARMED', highest_epoch_seen: '7' });
    const transitions = (
      await h.db.pool.query(
        `SELECT detail ->> 'to' AS to_state FROM edge_audit WHERE kind = 'AUTHORITY_TRANSITION'`,
      )
    ).rows.map((r) => r.to_state);
    expect(transitions.slice(-2)).toEqual(['RELEASED', 'ARMED']); // deux commits distincts
  });

  it(
    'époque supérieure vue au long-polling : STALE ' + 'persistant, confirmée par le central',
    async () => {
      await activate();
      await h.authority.observeEpoch(6, 'central');
      expect(await authorityRow(h.db)).toMatchObject({
        state: 'STALE',
        highest_epoch_seen: '6',
        central_confirmed_epoch: '6',
      });
      await expect(h.authority.assertCanDebit(5)).rejects.toMatchObject({
        code: 'STALE_AUTHORITY_EPOCH',
      });
    },
  );

  it('STALE : un nouvel accord sur une époque supérieure seulement', async () => {
    await activate();
    await h.authority.observeEpoch(6, 'central');
    await h.authority.onHandover(
      view({ handover_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', epoch: 6 }),
    );
    expect((await authorityRow(h.db)).state).toBe('STALE'); // 6 n'est pas > 6
    await h.authority.onHandover(
      view({ handover_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', epoch: 7 }),
    );
    expect(await authorityRow(h.db)).toMatchObject({ state: 'GRANTED_PENDING', epoch: '7' });
  });

  it('certificat refusé : REVOKED persistant depuis ACTIVE et depuis ARMED, terminal', async () => {
    await h.authority.markRevoked();
    expect((await authorityRow(h.db)).state).toBe('REVOKED');
    await h.authority.onHandover(view({}));
    expect((await authorityRow(h.db)).state).toBe('REVOKED');
    await expect(h.authority.assertCanDebit(null)).rejects.toMatchObject({
      code: 'STALE_AUTHORITY_EPOCH',
    });
  });

  it('REVOKED depuis ACTIVE', async () => {
    await activate();
    await h.authority.markRevoked();
    expect((await authorityRow(h.db)).state).toBe('REVOKED');
  });

  it('STANDBY : aucun accord accepté ; la promotion donne ARMED', async () => {
    await forceAuthority(h.db, { state: 'STANDBY' });
    await h.authority.onHandover(view({}));
    expect((await authorityRow(h.db)).state).toBe('STANDBY');
    await h.authority.onRoleChanged('STANDBY');
    expect((await authorityRow(h.db)).state).toBe('STANDBY');
    await h.authority.onRoleChanged('PRIMARY');
    expect((await authorityRow(h.db)).state).toBe('ARMED');
  });

  it('horloge incohérente (A14) : accord ignoré, état ARMED, audit', async () => {
    h.clock.ackRefused = true;
    await h.authority.onHandover(view({}));
    expect((await authorityRow(h.db)).state).toBe('ARMED');
    expect(await auditKinds(h.db)).toContain('ACK_REFUSED_CLOCK');
  });

  it('un accord d’époque inférieure à highest_epoch_seen est refusé', async () => {
    await forceAuthority(h.db, { highest_epoch_seen: 9 });
    await h.authority.onHandover(view({ epoch: 5 }));
    expect((await authorityRow(h.db)).state).toBe('ARMED');
    expect(await auditKinds(h.db)).toContain('GRANT_REFUSED_EPOCH');
  });

  async function activate(): Promise<void> {
    await h.authority.onHandover(view({}));
    await h.authority.markActive({
      handoverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      epoch: 5,
      centralTime: NOW,
      edgeSeqAtActivation: null,
    });
  }
  async function release(): Promise<void> {
    await activate();
    await h.authority.onHandover(
      view({
        handover_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        direction: 'TO_CENTRAL',
        state: 'RELEASE_REQUESTED',
      }),
    );
  }
});

describe('assertCanDebit : un cas par état, rien d’écrit', () => {
  beforeEach(async () => {
    h = await makeHarness();
  });

  const cases: Array<{
    state: string;
    extra?: Record<string, number>;
    expected: { code: string; detail?: string } | null;
  }> = [
    { state: 'ACTIVE', expected: null },
    { state: 'GRANTED_PENDING', expected: { code: 'DEBIT_AUTHORITY_MOVING' } },
    { state: 'RELEASING', expected: { code: 'DEBIT_AUTHORITY_MOVING' } },
    { state: 'STALE', expected: { code: 'STALE_AUTHORITY_EPOCH' } },
    { state: 'REVOKED', expected: { code: 'STALE_AUTHORITY_EPOCH' } },
    { state: 'ARMED', expected: { code: 'CONFLICT_STATE', detail: 'GATEWAY_NOT_AUTHORITY' } },
    { state: 'STANDBY', expected: { code: 'CONFLICT_STATE', detail: 'GATEWAY_NOT_AUTHORITY' } },
    { state: 'RELEASED', expected: { code: 'CONFLICT_STATE', detail: 'GATEWAY_NOT_AUTHORITY' } },
    {
      state: 'ACTIVE',
      extra: { epoch: 4, highest_epoch_seen: 5 },
      expected: { code: 'STALE_AUTHORITY_EPOCH' },
    },
  ];

  it.each(cases)('$state $extra', async ({ state, extra, expected }) => {
    await forceAuthority(h.db, { state, epoch: 5, highest_epoch_seen: 5, ...(extra ?? {}) });
    const before = { row: await authorityRow(h.db), audit: await auditKinds(h.db) };
    if (expected === null) {
      const row: AuthorityRow = await h.authority.assertCanDebit(5);
      expect(row.state).toBe('ACTIVE');
    } else {
      const error = (await h.authority.assertCanDebit(5).catch((e) => e)) as AuthorityRefusal;
      expect(error).toBeInstanceOf(AuthorityRefusal);
      expect(error.code).toBe(expected.code);
      expect(error.detail).toBe(expected.detail);
      expect(error.httpStatus).toBe(409);
    }
    expect(await authorityRow(h.db)).toEqual(before.row);
    expect(await auditKinds(h.db)).toEqual(before.audit);
  });

  it(
    'en-tête différent de l’époque détenue : ' +
      'STALE_AUTHORITY_EPOCH pour la requête, état intact',
    async () => {
      await forceAuthority(h.db, { state: 'ACTIVE', epoch: 5, highest_epoch_seen: 5 });
      await expect(h.authority.assertCanDebit(4)).rejects.toMatchObject({
        code: 'STALE_AUTHORITY_EPOCH',
      });
      await expect(h.authority.assertCanDebit(6)).rejects.toMatchObject({
        code: 'STALE_AUTHORITY_EPOCH',
      });
      await expect(h.authority.assertCanDebit(null)).resolves.toMatchObject({ state: 'ACTIVE' });
    },
  );

  it(
    'dans la transaction de l’opération : une transition ' +
      'attend la fin de l’opération (FOR SHARE)',
    async () => {
      await forceAuthority(h.db, { state: 'ACTIVE', epoch: 5, highest_epoch_seen: 5 });
      const order: string[] = [];
      let transition: Promise<unknown> = Promise.resolve();
      await h.tx.run(async (tx) => {
        await h.authority.assertCanDebit(5, tx);
        // RELEASING (FOR UPDATE) ne passe pas tant que l’opération tient FOR SHARE.
        transition = h.authority
          .onHandover(
            toHandoverView(
              handover({
                handover_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                direction: 'TO_CENTRAL',
                state: 'RELEASE_REQUESTED',
              }) as never,
              NOW,
            ),
          )
          .then(() => order.push('releasing'));
        await new Promise((r) => setTimeout(r, 300));
        expect(order).toEqual([]);
        order.push('operation');
      });
      await transition;
      expect(order).toEqual(['operation', 'releasing']);
    },
  );
});

describe('accusé : seulement après le rattrapage (REPLICATION_CATCH_UP)', () => {
  async function grant(): Promise<void> {
    h.central.script = () => ({ status: 200, body: stateWith(null, 'EDGE', 5) });
    await h.authority.onHandover(view({}));
  }

  it(
    'sans WP18 (fabrique qui refuse) : aucun accusé ne ' + 'part, l’état reste GRANTED_PENDING',
    async () => {
      h = await makeHarness({ catchUp: unavailableCatchUp });
      await grant();
      await h.channel.ackStep();
      expect(h.central.count('POST', '/ack')).toBe(0);
      expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
    },
  );

  it('rattrapage revenu mais curseur sous le filigrane : aucun accusé', async () => {
    h = await makeHarness({ catchUp: { catchUpTo: async () => undefined } });
    await grant();
    await h.channel.ackStep();
    expect(h.central.count('POST', '/ack')).toBe(0);
  });

  it(
    'rattrapage revenu, curseur au filigrane : accusé ' +
      'envoyé une fois, ACTIVE, rejoué sans effet',
    async () => {
      const catchUp: ReplicationCatchUp = {
        catchUpTo: async (watermark) => {
          await h.db.pool.query(
            'UPDATE edge_replication_cursor SET last_replicated_posting_id = $1',
            [watermark.toString()],
          );
        },
      };
      h = await makeHarness({ catchUp });
      await grant();
      h.central.script = (r) =>
        r.path.endsWith('/ack')
          ? {
              status: 200,
              body: stateWith(handover({ state: 'ACTIVE' }), 'EDGE', 5),
              headers: { Date: 'Fri, 06 Nov 2026 12:00:09 GMT' },
            }
          : { status: 200, body: emptyish() };
      await h.channel.ackStep();
      expect(h.central.count('POST', '/ack')).toBe(1);
      expect(h.central.requests.find((r) => r.path.endsWith('/ack'))!.body).toEqual({
        epoch: 5,
        replicated_posting_id: 100,
      });
      const row = await authorityRow(h.db);
      expect(row.state).toBe('ACTIVE');
      expect(new Date(row.activated_at).toISOString()).toBe('2026-11-06T12:00:09.000Z');
      await h.channel.ackStep(); // déjà ACTIVE : rien
      expect(h.central.count('POST', '/ack')).toBe(1);
    },
  );

  it('horloge incohérente (A14) : l’accusé ne part pas, retour ARMED', async () => {
    h = await makeHarness({
      catchUp: { catchUpTo: async () => undefined },
    });
    await grant();
    h.clock.ackRefused = true;
    await h.channel.ackStep();
    expect(h.central.count('POST', '/ack')).toBe(0);
    expect((await authorityRow(h.db)).state).toBe('ARMED');
  });

  it('409 EDGE_NOT_CAUGHT_UP : reste GRANTED_PENDING, aucune activation', async () => {
    h = await makeHarness({
      catchUp: {
        catchUpTo: async (w) => {
          await h.db.pool.query(
            'UPDATE edge_replication_cursor SET last_replicated_posting_id = $1',
            [w.toString()],
          );
        },
      },
    });
    await grant();
    h.central.script = () => ({
      status: 409,
      body: { code: 'EDGE_NOT_CAUGHT_UP', missing_edge_seqs: [3] },
    });
    await h.channel.ackStep();
    expect((await authorityRow(h.db)).state).toBe('GRANTED_PENDING');
  });
});

function emptyish(): Record<string, unknown> {
  return stateWith(null, 'CENTRAL', 0);
}
