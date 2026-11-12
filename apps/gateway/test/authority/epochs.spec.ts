import 'reflect-metadata';
import { PLAUSIBLE_EPOCH_WINDOW, toHandoverView } from '../../src/authority/authority.service';
import { handover, stateWith } from './_support/central';
import {
  appendAckedOps,
  auditKinds,
  authorityRow,
  forceAuthority,
  makeHarness,
  type Harness,
} from './_support/harness';

const NOW = new Date('2026-11-06T12:00:00Z');
const TO_CENTRAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
  await forceAuthority(h.db, {
    state: 'ACTIVE',
    epoch: 5,
    highest_epoch_seen: 5,
    handover_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    activated_at: NOW,
    edge_seq_at_activation: 0,
  });
});
afterEach(async () => h.close());

describe('A12 : époque vue dans une requête de terminal', () => {
  it(
    '9999 envoyé mille fois : les débits continuent, rien ' +
      'n’est persisté, une ligne d’audit au plus',
    async () => {
      for (let i = 0; i < 1000; i += 1) await h.authority.observeEpoch(9999, 'request');
      const row = await authorityRow(h.db);
      expect(row.state).toBe('ACTIVE');
      expect(row.highest_epoch_seen).toBe('5');
      expect(row.unconfirmed_epoch_seen).toBe('9999');
      expect((await auditKinds(h.db)).filter((k) => k === 'STALE_EPOCH_UNCONFIRMED')).toHaveLength(
        1,
      );
      // La requête forgée reçoit 409 pour elle seule ; la suivante, à l'époque réelle, passe.
      await expect(h.authority.assertCanDebit(9999)).rejects.toMatchObject({
        code: 'STALE_AUTHORITY_EPOCH',
      });
      await expect(h.authority.assertCanDebit(5)).resolves.toMatchObject({ state: 'ACTIVE' });
    },
  );

  it('epoch + 1 et epoch + 2 (plausibles) : STALE persistant', async () => {
    await h.authority.observeEpoch(6, 'request');
    expect(await authorityRow(h.db)).toMatchObject({ state: 'STALE', highest_epoch_seen: '6' });
    await expect(h.authority.assertCanDebit(5)).rejects.toMatchObject({
      code: 'STALE_AUTHORITY_EPOCH',
    });
  });

  it(
    'borne OP-N110 : la fenêtre est exactement epoch + ' + '2 (epoch + 3 ne fait pas STALE)',
    async () => {
      expect(PLAUSIBLE_EPOCH_WINDOW).toBe(2);
      await h.authority.observeEpoch(5 + 3, 'request');
      expect((await authorityRow(h.db)).state).toBe('ACTIVE');
      await h.authority.observeEpoch(5 + 2, 'request');
      expect(await authorityRow(h.db)).toMatchObject({ state: 'STALE', highest_epoch_seen: '7' });
    },
  );

  it(
    'époque confirmée par le canal de contrôle ' + '(central) : STALE même très au-dessus',
    async () => {
      await h.authority.observeEpoch(9999, 'central');
      expect(await authorityRow(h.db)).toMatchObject({
        state: 'STALE',
        highest_epoch_seen: '9999',
        central_confirmed_epoch: '9999',
      });
    },
  );

  it('une époque déjà retenue puis revue dans une requête n’ajoute rien', async () => {
    await h.authority.observeEpoch(6, 'request');
    const before = await auditKinds(h.db);
    await h.authority.observeEpoch(6, 'request');
    expect(await auditKinds(h.db)).toEqual(before);
  });

  it('époque inférieure ou égale à celle détenue : ignorée', async () => {
    await h.authority.observeEpoch(5, 'request');
    await h.authority.observeEpoch(2, 'central');
    expect((await authorityRow(h.db)).state).toBe('ACTIVE');
  });

  it('long-polling : un handover d’époque supérieure arrête le débit', async () => {
    await h.authority.handleCentralState(
      stateWith(
        handover({ epoch: 8, handover_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
        'EDGE',
        8,
      ) as never,
      NOW,
    );
    expect(await authorityRow(h.db)).toMatchObject({ state: 'STALE', highest_epoch_seen: '8' });
  });
});

describe('les époques ne reculent jamais en UPDATE direct (edge-0002)', () => {
  it('epoch', async () => {
    await expect(h.db.pool.query('UPDATE edge_authority SET epoch = 4')).rejects.toThrow(
      /époque détenue ne recule jamais/,
    );
  });

  it('highest_epoch_seen, hors levée locale de STALE', async () => {
    await forceAuthority(h.db, { highest_epoch_seen: 7 });
    await expect(
      h.db.pool.query('UPDATE edge_authority SET highest_epoch_seen = 5'),
    ).rejects.toThrow(/highest_epoch_seen ne recule que par levée locale/);
    // Même d'un état STALE, sans passer à ACTIVE avec highest = epoch : refusé.
    await forceAuthority(h.db, { state: 'STALE' });
    await expect(
      h.db.pool.query('UPDATE edge_authority SET highest_epoch_seen = 6'),
    ).rejects.toThrow();
    await expect(
      h.db.pool.query(`UPDATE edge_authority SET state = 'ACTIVE', highest_epoch_seen = 6`),
    ).rejects.toThrow();
    // Le seul recul permis : STALE -> ACTIVE avec highest_epoch_seen = epoch.
    await h.db.pool.query(`UPDATE edge_authority SET state = 'ACTIVE', highest_epoch_seen = epoch`);
    expect(await authorityRow(h.db)).toMatchObject({ state: 'ACTIVE', highest_epoch_seen: '5' });
  });

  it('central_confirmed_epoch', async () => {
    await h.db.pool.query('UPDATE edge_authority SET central_confirmed_epoch = 9');
    await expect(
      h.db.pool.query('UPDATE edge_authority SET central_confirmed_epoch = 8'),
    ).rejects.toThrow(/ne recule jamais/);
    await expect(
      h.db.pool.query('UPDATE edge_authority SET central_confirmed_epoch = NULL'),
    ).rejects.toThrow();
  });

  it(
    'le service ne ramène jamais highest_epoch_seen en ' +
      'dessous (ARMED reçoit un accord plus bas)',
    async () => {
      await forceAuthority(h.db, { state: 'ARMED', highest_epoch_seen: 9 });
      await h.authority.onHandover(toHandoverView(handover({ epoch: 6 }) as never, NOW));
      expect(await authorityRow(h.db)).toMatchObject({ state: 'ARMED', highest_epoch_seen: '9' });
    },
  );
});

describe('operations_count par cycle (A05) : deux cycles consécutifs', () => {
  async function cycle(ops: number, epoch: number, grant: string, release: string): Promise<void> {
    h.central.script = () => ({ status: 200, body: stateWith(null, 'EDGE', epoch) });
    h.setCatchUp({
      catchUpTo: async (w) => {
        await h.db.pool.query(
          'UPDATE edge_replication_cursor SET last_replicated_posting_id = $1',
          [w.toString()],
        );
      },
    });
    const { authority, channel } = h.restart();
    // Accord, rattrapage, accusé.
    await authority.onHandover(
      toHandoverView(handover({ handover_id: grant, epoch }) as never, NOW),
    );
    h.central.script = (r) =>
      r.path.endsWith('/ack')
        ? {
            status: 200,
            body: stateWith(
              handover({ handover_id: grant, epoch, state: 'ACTIVE' }),
              'EDGE',
              epoch,
            ),
          }
        : { status: 200, body: stateWith(null, 'EDGE', epoch) };
    await channel.ackStep();
    expect((await authorityRow(h.db)).state).toBe('ACTIVE');
    await appendAckedOps(h.db, ops);
    // Demande de rendu, file vide : rendu.
    await authority.onHandover(
      toHandoverView(
        handover({
          handover_id: release,
          epoch,
          direction: 'TO_CENTRAL',
          state: 'RELEASE_REQUESTED',
        }) as never,
        NOW,
      ),
    );
    h.central.script = () => ({ status: 200, body: stateWith(null, 'CENTRAL', epoch + 1) });
    await channel.releaseStep();
  }

  it(
    'premier cycle : ops = final_edge_seq ; second cycle ' + ': ops = final - numéro d’activation',
    async () => {
      await forceAuthority(h.db, { state: 'ARMED', handover_id: null, activated_at: null });
      await cycle(5, 5, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TO_CENTRAL);
      let release = h.central.requests.filter((r) => r.path.endsWith('/release')).at(-1)!;
      expect(release.body).toMatchObject({ epoch: 5, final_edge_seq: 5, operations_count: 5 });
      expect((release.body as { last_chain_hash: string }).last_chain_hash).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(await authorityRow(h.db)).toMatchObject({ state: 'ARMED', highest_epoch_seen: '7' });

      await cycle(
        3,
        7,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
      release = h.central.requests.filter((r) => r.path.endsWith('/release')).at(-1)!;
      expect(release.body).toMatchObject({ epoch: 7, final_edge_seq: 8, operations_count: 3 });
      const activation = await h.db.pool.query(
        `SELECT detail ->> 'edge_seq_at_activation' AS seq FROM edge_audit
        WHERE kind = 'AUTHORITY_TRANSITION' AND detail ->> 'to' = 'ACTIVE' ORDER BY id`,
      );
      expect(activation.rows.map((r) => r.seq)).toEqual(['0', '5']);
    },
  );

  it('le rendu attend la file vide et acquittée ; un rendu répété a le même effet', async () => {
    await forceAuthority(h.db, {
      state: 'RELEASING',
      handover_id: TO_CENTRAL,
      edge_seq_at_activation: 0,
    });
    await appendAckedOps(h.db, 1);
    await appendAckedOps(h.db, 1, false);
    h.central.script = () => ({ status: 200, body: stateWith(null, 'CENTRAL', 6) });
    await h.channel.releaseStep();
    expect(h.central.count('POST', '/release')).toBe(0); // 1 acquitté sur 2
    expect(h.drain.calls).toHaveLength(1);
    await h.db.pool.query(
      `UPDATE edge_chain_head SET acked_edge_seq = 2, acked_chain_hash = last_chain_hash`,
    );
    await h.channel.releaseStep();
    expect(h.central.count('POST', '/release')).toBe(1);
    expect((await authorityRow(h.db)).state).toBe('ARMED');
    await h.channel.releaseStep(); // déjà rendu : rien
    expect(h.central.count('POST', '/release')).toBe(1);
  });

  it(
    '409 EDGE_NOT_CAUGHT_UP : reste RELEASING et ' + 'demande le vidage des numéros manquants',
    async () => {
      await forceAuthority(h.db, {
        state: 'RELEASING',
        handover_id: TO_CENTRAL,
        edge_seq_at_activation: 0,
      });
      await appendAckedOps(h.db, 2);
      h.central.script = () => ({
        status: 409,
        body: { code: 'EDGE_NOT_CAUGHT_UP', missing_edge_seqs: [2] },
      });
      await h.channel.releaseStep();
      expect((await authorityRow(h.db)).state).toBe('RELEASING');
      expect(h.drain.calls.at(-1)).toEqual({ missingEdgeSeqs: [2] });
    },
  );

  it('409 CHAIN_BROKEN : reste RELEASING, alerte, aucune nouvelle tentative', async () => {
    await forceAuthority(h.db, {
      state: 'RELEASING',
      handover_id: TO_CENTRAL,
      edge_seq_at_activation: 0,
    });
    await appendAckedOps(h.db, 2);
    h.central.script = () => ({ status: 409, body: { code: 'CHAIN_BROKEN' } });
    await h.channel.releaseStep();
    await h.channel.releaseStep();
    expect(h.central.count('POST', '/release')).toBe(1);
    expect(await auditKinds(h.db)).toContain('RELEASE_CHAIN_BROKEN');
    expect((await authorityRow(h.db)).state).toBe('RELEASING');
  });
});
