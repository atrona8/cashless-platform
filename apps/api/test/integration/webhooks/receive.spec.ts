// Intégration : réception des notifications (lot WP12, T060, T061 ; FR-014, FR-015 ; A2, A4, A13, A19).
import { WebhookWorld } from './webhook-fixtures';

describe('réception des notifications de PSP', () => {
  let w: WebhookWorld;

  beforeAll(async () => {
    w = await WebhookWorld.create();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });

  it('succès Wave : 200, un TOPUP, recharge SUCCEEDED, événement PROCESSED', async () => {
    const t = await w.p.topup({ method: 'WAVE' });
    const res = await w.post(w.event(t.row), { method: 'WAVE' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    const events = await w.events(t.row.configurationId);
    expect(events.at(-1)).toMatchObject({ status: 'PROCESSED', outcome: 'CREDITED' });
  });
});
