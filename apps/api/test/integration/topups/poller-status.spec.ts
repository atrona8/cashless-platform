// Intégration : interrogation des recharges PSP en attente (lot WP12, T062 ; R-12, A15, A33).
import { WebhookWorld, startPoller, type PollerProcess } from '../webhooks/webhook-fixtures';
import { ownerRows } from '../../support/media-fixtures';

describe('interrogation des recharges PSP', () => {
  let w: WebhookWorld;
  let proc: PollerProcess;

  beforeAll(async () => {
    w = await WebhookWorld.create();
    proc = await startPoller(w);
  }, 240_000);
  afterAll(async () => {
    await proc.close();
    await w.close();
  });

  /** Recharge assez ancienne pour être interrogée (créée il y a plus de 2 minutes, heure de la base). */
  async function aged(spec: Parameters<typeof w.p.topup>[0] = {}) {
    const t = await w.p.topup(spec);
    await ownerRows(
      `UPDATE psp_topup SET created_at = clock_timestamp() - interval '5 minutes' WHERE psp_topup_id = $1`,
      [t.row.topupId],
    );
    return t;
  }

  it('processus démarré, rien à faire : 0 et aucun code d’alerte', async () => {
    expect(await proc.workers.drain()).toBe(0);
    expect(proc.workers.alarm()).toBe(0);
    expect(proc.workers.names().sort()).toEqual(['psp-event-purge', 'psp-event-retry', 'psp-poller']);
  });
});
