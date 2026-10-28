// Frais PSP par configuration (mission 6, lot WP10, T052 ; FR-023) : la règle est celle de la configuration figée
// par la recharge, jamais celle que l'événement a choisie ensuite ; la convention EVENT + PSP:<canal> est retirée.
import { SqlConfigResolver } from '../../../src/configuration/sql-config-resolver';
import { TenantTx } from '../../../src/db/tenant-tx';
import { CONFIG_RESOLVER } from '../../../src/ledger/ledger.module';
import { createPspWorld, type PspWorld } from './psp-config-fixtures';

jest.setTimeout(240_000);

describe('frais PSP par configuration', () => {
  let w: PspWorld;
  beforeAll(async () => {
    w = await createPspWorld();
  });
  afterAll(async () => {
    await w?.close();
  });
  const resolve = (configId?: string, at = new Date()) =>
    w.app.get(TenantTx).run(w.fx.parties.OPE, (client) =>
      w.app.get<SqlConfigResolver>(CONFIG_RESOLVER).resolve({
        ledgerId: w.fx.ledgerId,
        eventId: w.fx.eventId,
        occurredAt: at,
        pspConfigurationId: configId,
        client,
      }),
    );

  it('1,5 % WAVE par la configuration de la recharge, même si l’événement en a choisi une autre', async () => {
    const mine = await w.createConfig(w.op1);
    await w.addFeeRule(w.op1, mine, 150);
    const other = await w.activeConfig();
    await w.api(w.org1, 'put', `/events/${w.fx.eventId}/psp-selections/WAVE`, {
      psp_config_id: other,
    });
    const config = await resolve(mine);
    expect(Object.keys(config.pspFees)).toEqual(['WAVE']);
    expect(config.pspFees.WAVE).toMatchObject({ rateBps: 150n });
    expect(Object.keys((await resolve(other)).pspFees)).toEqual(['WAVE']);
    expect((await resolve()).pspFees).toEqual({});
  });

  it('canaux : ORANGE_MONEY → OM, CARD → CARTE', async () => {
    const om = await w.createConfig(w.op1, { method: 'ORANGE_MONEY', provider: 'ORANGE_MONEY' });
    const card = await w.createConfig(w.op1, { method: 'CARD', provider: 'PAYDUNYA' });
    await w.addFeeRule(w.op1, om, 100);
    await w.addFeeRule(w.op1, card, 200);
    expect(Object.keys((await resolve(om)).pspFees)).toEqual(['OM']);
    expect(Object.keys((await resolve(card)).pspFees)).toEqual(['CARTE']);
  });

  it('une règle EVENT + PSP:WAVE n’a plus aucun effet', async () => {
    const res = await w.api(w.org1, 'post', `/operators/${w.fx.parties.OPE}/fee-rules`, {
      scope_type: 'EVENT',
      scope_id: w.fx.eventId,
      payer_purpose: 'ORG_FPSP',
      beneficiary_purpose: 'PSP:WAVE',
      basis: 'TOPUP_AMOUNT',
      rate_bps: 999,
      trigger: 'REALTIME',
      valid_from: '2026-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const bare = await w.createConfig(w.op1);
    expect((await resolve(bare)).pspFees).toEqual({});
    expect((await resolve()).pspFees).toEqual({});
  });

  it('règle remplacée : l’ancienne avant la date d’effet, la plus haute version ensuite', async () => {
    const id = await w.createConfig(w.op1);
    const rule = await w.addFeeRule(w.op1, id, 150);
    const res = await w.api(
      w.op1,
      'post',
      `/operators/${w.fx.parties.OPE}/fee-rules/${rule}/replacements`,
      {
        scope_type: 'PSP_CONFIGURATION',
        scope_id: id,
        payer_purpose: 'ORG_FPSP',
        beneficiary_purpose: 'PSP_FRAIS',
        basis: 'TOPUP_AMOUNT',
        rate_bps: 300,
        trigger: 'REALTIME',
        valid_from: '2027-06-01T00:00:00Z',
      },
    );
    expect(res.status).toBe(201);
    expect((await resolve(id, new Date('2027-01-01T00:00:00Z'))).pspFees.WAVE).toMatchObject({
      rateBps: 150n,
    });
    expect((await resolve(id, new Date('2027-07-01T00:00:00Z'))).pspFees.WAVE).toMatchObject({
      rateBps: 300n,
    });
  });

  it('configuration d’un autre organisateur : aucune règle (frais nuls), pas une erreur', async () => {
    const foreign = await w.createConfig(w.op1, {}, w.organizer2);
    await w.addFeeRule(w.op1, foreign, 500);
    expect((await resolve(foreign)).pspFees).toEqual({});
  });

  it('identifiant malformé : refusé 422, jamais des frais nuls en silence', async () => {
    await expect(resolve('pas-un-uuid')).rejects.toMatchObject({ status: 422 });
  });
});
