// Ordres locaux signés (T119 ; interfaces.md § 13.3). Route unique `POST /local/orders`, servie
// par l'écouteur d'administration (boucle locale seule), JAMAIS par le serveur des terminaux.
// Corps : `{ order, signatures }` (format de `authority/site-order.ts`). Types : `LOCAL_UNSTALE`
// (WP17) et `PURGE` (WP24, qui enregistre seulement son traitement par `registerOrderHandler`).
// Un type sans traitement enregistré est refusé : aucun ordre n'est accepté « à vide ».
import { Injectable, Logger } from '@nestjs/common';
import {
  parseOrderPayload,
  SITE_ORDER_KINDS,
  SiteOrderError,
  type SiteOrderKind,
} from '../authority/site-order';

export type OrderHandler = (body: { order: unknown; signatures: unknown }) => Promise<unknown>;

export interface LocalOrderResult {
  status: number;
  body: Record<string, unknown>;
}

/** Statut HTTP d'un refus d'ordre (corps : code seulement, jamais de matière sensible). */
const STATUS_BY_CODE: Record<string, number> = {
  MALFORMED: 400,
  KIND_MISMATCH: 400,
  SIGNATURE_COUNT: 400,
  NO_SITE_KEYS: 409,
  REFUSED: 409,
  WRONG_GATEWAY: 403,
  SAME_SIGNER: 403,
  UNKNOWN_HOLDER: 403,
  BAD_SIGNATURE: 403,
  EXPIRED: 403,
  FROM_THE_FUTURE: 403,
  NONCE_REPLAYED: 409,
};

@Injectable()
export class LocalOrdersController {
  private readonly logger = new Logger('LocalOrders');
  private readonly handlers = new Map<SiteOrderKind, OrderHandler>();

  /** WP17 enregistre `LOCAL_UNSTALE`, WP24 `PURGE`. Un type ne s'enregistre qu'une fois. */
  registerOrderHandler(kind: SiteOrderKind, handler: OrderHandler): void {
    if (!SITE_ORDER_KINDS.includes(kind)) throw new Error(`type d'ordre inconnu : ${kind}`);
    if (this.handlers.has(kind)) throw new Error(`traitement déjà enregistré : ${kind}`);
    this.handlers.set(kind, handler);
  }

  async handle(body: unknown): Promise<LocalOrderResult> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { status: 400, body: { code: 'MALFORMED' } };
    }
    const { order, signatures } = body as Record<string, unknown>;
    let kind: SiteOrderKind;
    try {
      const parsed = parseOrderPayload(order);
      if (!SITE_ORDER_KINDS.includes(parsed.kind as SiteOrderKind)) {
        return { status: 400, body: { code: 'UNKNOWN_KIND' } };
      }
      kind = parsed.kind as SiteOrderKind;
    } catch (error) {
      return this.refusal(error);
    }
    const handler = this.handlers.get(kind);
    if (!handler) return { status: 501, body: { code: 'NO_HANDLER' } };
    try {
      await handler({ order, signatures });
      return { status: 200, body: { code: 'ACCEPTED', kind } };
    } catch (error) {
      return this.refusal(error);
    }
  }

  private refusal(error: unknown): LocalOrderResult {
    if (error instanceof SiteOrderError) {
      return { status: STATUS_BY_CODE[error.code] ?? 400, body: { code: error.code } };
    }
    this.logger.error('ordre local : erreur interne');
    return { status: 500, body: { code: 'INTERNAL' } };
  }
}
