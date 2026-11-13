// Purge MANUELLE à deux personnes (T108). Pas de route propre : le traitement `PURGE` s'enregistre
// sur l'écouteur d'administration local (`POST /local/orders`, boucle locale seule, WP17), jamais
// dans la liste des 16 opérations des terminaux.
// Ordre : `{ kind: 'PURGE', gateway_id, issued_at, nonce }` (aucun autre champ), signé par deux
// responsables distincts (`verifyTwoPersonOrder('PURGE', ...)`, validité 10 minutes, lien avec
// `gateway_id`, nonce à usage unique). Refusée si la file n'est pas acquittée : RIEN n'est détruit.
// DÉCISION 48 : l'ordre est versé au central AVANT la destruction. Le nonce accepté laisse une
// ligne
// `SITE_ORDER_ACCEPTED` (`local_orders` du prochain lot, décision 33) ; on attend que le central
// l'ait
// accusée (`sent_in_batch` posé à la réception des résultats du lot), en réveillant le vidage : la
// file étant vide, le vidage envoie un LOT D'ORDRES SEULS (sans opération, décision 50, ADR-187).
// Avec lien, rien n'est détruit avant cet accusé. Sans accusé dans le délai (lien coupé, ou lot
// refusé), la purge locale est FORCÉE avec trace (`PURGE` étape `CENTRAL_UNCONFIRMED`) : la
// ligne
// reste dans `edge_audit` (table protégée, jamais vidée) et partira au premier lot suivant.
// Le nonce est consigné (et commité) AVANT toute destruction : un arrêt en cours de route est
// repris
// au démarrage sans rejouer l'ordre.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LocalOrdersController } from '../admin/local-orders.controller';
import { AuthorityService } from '../authority/authority.service';
import { DRAIN_SIGNAL, QUEUE_PROBE, type DrainSignal, type QueueProbe } from '../authority/ports';
import {
  consumeOrderNonce,
  loadSiteOrderKeys,
  parseOrderPayload,
  parseSignatures,
  SiteOrderError,
  verifyTwoPersonOrder,
} from '../authority/site-order';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx } from '../db/gateway-tx';
import { PurgeService } from './purge.service';

const PURGE_FIELDS = 'gateway_id,issued_at,kind,nonce';

export const PURGE_CENTRAL_WAIT = Symbol('PURGE_CENTRAL_WAIT');
/** Attente de l'accusé du central : délai maximal et pas d'interrogation (ms). */
export interface CentralWait {
  graceMs: number;
  pollMs: number;
}
export const DEFAULT_CENTRAL_WAIT: CentralWait = { graceMs: 30_000, pollMs: 500 };

@Injectable()
export class ManualPurgeController {
  private readonly logger = new Logger('ManualPurge');
  private readonly wait: CentralWait;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AuthorityService) private readonly authority: AuthorityService,
    @Inject(QUEUE_PROBE) private readonly queue: QueueProbe,
    @Inject(PurgeService) private readonly purge: PurgeService,
    @Inject(LocalOrdersController) private readonly orders: LocalOrdersController,
    @Optional() @Inject(DRAIN_SIGNAL) private readonly drain?: DrainSignal,
    @Optional() @Inject(PURGE_CENTRAL_WAIT) wait?: CentralWait,
  ) {
    this.wait = wait ?? DEFAULT_CENTRAL_WAIT;
    this.orders.registerOrderHandler('PURGE', (body) => this.handle(body));
  }

  async handle(body: { order: unknown; signatures: unknown }): Promise<{ purged: true }> {
    const order = parseOrderPayload(body.order);
    let holders: string[];
    let orderSha: string;
    try {
      const signatures = parseSignatures(body.signatures);
      [holders, orderSha] = await this.gatewayTx.run(async (tx) => {
        const meta = await tx.query<{ gateway_id: string }>('SELECT gateway_id FROM edge_meta');
        const keys = await loadSiteOrderKeys(tx);
        const verified = verifyTwoPersonOrder(
          'PURGE',
          order,
          signatures,
          keys,
          this.clock.now(),
          meta.rows[0]?.gateway_id ?? '',
        );
        if (Object.keys(order).sort().join(',') !== PURGE_FIELDS) {
          throw new SiteOrderError('MALFORMED', 'ordre : champs de PURGE attendus');
        }
        if (this.purge.engaged) throw new SiteOrderError('REFUSED', 'purge déjà commencée');
        if (!(await this.queue.isEmpty())) {
          throw new SiteOrderError('REFUSED', 'purge refusée : la file n’est pas acquittée');
        }
        await consumeOrderNonce(tx, order, verified);
        return [[...verified.holders], verified.orderSha256] as [string[], string];
      });
    } catch (error) {
      if (error instanceof SiteOrderError) {
        await this.authority.refusedOrder('PURGE', error, order);
      } else if ((error as { code?: string }).code === '23505') {
        const replay = new SiteOrderError('NONCE_REPLAYED', 'ordre : nonce déjà utilisé');
        await this.authority.refusedOrder('PURGE', replay, order);
        throw replay;
      }
      throw error;
    }
    // Décision 48 : versement au central AVANT toute destruction.
    const central = await this.awaitCentral(orderSha, holders);
    // La file a pu se remplir pendant l'attente : rien n'est détruit tant qu'elle n'est pas
    // acquittée.
    if (!(await this.queue.isEmpty())) {
      throw new SiteOrderError('REFUSED', 'purge refusée : la file n’est pas acquittée');
    }
    await this.purge.execute({ trigger: 'MANUAL', holders, central });
    return { purged: true };
  }

  private async acked(orderSha: string): Promise<boolean> {
    const { rowCount } = await this.gatewayTx.run((tx) =>
      tx.query(
        `SELECT 1 FROM edge_audit
          WHERE kind = 'SITE_ORDER_ACCEPTED' AND detail->>'order_sha256' = $1
            AND sent_in_batch IS NOT NULL`,
        [orderSha],
      ),
    );
    return (rowCount ?? 0) > 0;
  }

  private async mark(step: string, orderSha: string, holders: string[]): Promise<void> {
    await this.gatewayTx.run((tx) =>
      tx.query(`INSERT INTO edge_audit (kind, actor, detail) VALUES ('PURGE', 'gateway', $1)`, [
        JSON.stringify({ step, trigger: 'MANUAL', holders, order_sha256: orderSha }),
      ]),
    );
  }

  /**
   * Attend l'accusé du central pour l'ordre ; `UNCONFIRMED` après le délai (purge locale forcée).
   */
  private async awaitCentral(
    orderSha: string,
    holders: string[],
  ): Promise<'ACKED' | 'UNCONFIRMED'> {
    await this.mark('AWAITING_CENTRAL', orderSha, holders);
    this.logger.warn('purge en suspens : ordre à verser au central avant destruction');
    const deadline = Date.now() + this.wait.graceMs;
    for (;;) {
      if (await this.acked(orderSha)) {
        await this.mark('CENTRAL_ACKED', orderSha, holders);
        return 'ACKED';
      }
      if (Date.now() >= deadline) break;
      await this.drain?.requestDrain();
      await new Promise<void>((resolve) => setTimeout(resolve, this.wait.pollMs));
    }
    await this.mark('CENTRAL_UNCONFIRMED', orderSha, holders);
    this.logger.error(
      'ordre de purge non accusé par le central : purge locale forcée, trace gardée',
    );
    return 'UNCONFIRMED';
  }
}
