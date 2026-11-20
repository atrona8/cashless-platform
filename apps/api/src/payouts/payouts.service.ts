// Lectures, export CSV et résultat des versements (mission 9b, lot WP08, T035, T037, T038 ; FR-009,
// FR-011, FR-012).
// L'IBAN et le numéro ne sortent QUE du CSV de `exportBatch` ; aucune autre lecture ne les
// sélectionne. L'API ne
// verse rien (C-003) : `confirm` enregistre le résultat d'un paiement fait hors système, par
// `settle_payout`.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Csv, type CsvRow } from '../common/csv';
import { IbanVault, IbanVaultError } from '../common/iban-vault';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { exercisedRole, resolveChain, type ScopeLink } from '../identity/scope-resolver';
import { isUuid, notFound } from '../organization/platform/platform.dto';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { EntitlementService, PAYEE_KINDS, type PayeeKind } from './entitlements';
import { ledgerScope, missingRole, PAYOUT_ROLES, readLedger } from './payout-action';
import {
  decodeCursor,
  encodeCursor,
  entitlementDto,
  EXPORT_COLUMNS,
  PAYOUT_COLUMNS,
  payoutDto,
  type ConfirmInput,
  type PayoutRow,
} from './payouts.dto';

export interface PageOut<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly vault: IbanVault,
  ) {}

  /**
   * Grand livre (404 si inconnu ou d'un autre prestataire) et rôle tenu sur sa portée (403 sinon).
   * */
  private async scoped(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
  ): Promise<{ ledgerId: string; chain: ScopeLink[] }> {
    const ledger = await readLedger(client, ledgerId);
    const chain = await resolveChain(client, ledgerScope(ledger));
    if (!exercisedRole(actor.principal, PAYOUT_ROLES, chain))
      throw new ProblemException('FORBIDDEN');
    return { ledgerId: ledger.id, chain };
  }

  /** Route 5 : droits nets, une page par identifiant de partie. */
  async listEntitlements(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
    page: { cursor: string | undefined; limit: number },
  ) {
    const ledger = await this.scoped(client, actor, ledgerId);
    const after = decodeCursor(page.cursor, false)?.[1] ?? null;
    const rows = await this.entitlements.forLedger(client, ledger.ledgerId, {
      after,
      limit: page.limit + 1,
    });
    const kept = rows.slice(0, page.limit);
    const hasMore = rows.length > page.limit;
    const last = kept[kept.length - 1];
    return {
      data: kept.map(entitlementDto),
      next_cursor: hasMore && last ? encodeCursor([null, last.partyId]) : null,
      has_more: hasMore,
    };
  }

  /** Route 7 : versements, du plus récent au plus ancien ; jamais de destination. */
  async listPayouts(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
    filters: { status?: string; approvalRequestId?: string },
    page: { cursor: string | undefined; limit: number },
  ): Promise<PageOut<ReturnType<typeof payoutDto>>> {
    const ledger = await this.scoped(client, actor, ledgerId);
    const after = decodeCursor(page.cursor, true);
    const { rows } = await client.query<PayoutRow & { initiated_key: string }>(
      `SELECT ${PAYOUT_COLUMNS}, po.initiated_at::text AS initiated_key
         FROM payout po JOIN ledger l ON l.id = po.ledger_id
        WHERE po.ledger_id = $1
          AND ($2::text IS NULL OR po.status = $2)
          AND ($3::uuid IS NULL OR po.approval_request_id = $3)
          AND ($4::timestamptz IS NULL OR (po.initiated_at, po.id) < ($4::timestamptz, $5::uuid))
        ORDER BY po.initiated_at DESC, po.id DESC
        LIMIT $6`,
      [
        ledger.ledgerId,
        filters.status ?? null,
        filters.approvalRequestId ?? null,
        after?.[0] ?? null,
        after?.[1] ?? null,
        page.limit + 1,
      ],
    );
    const kept = rows.slice(0, page.limit);
    const hasMore = rows.length > page.limit;
    const last = kept[kept.length - 1];
    return {
      data: kept.map(payoutDto),
      next_cursor: hasMore && last ? encodeCursor([last.initiated_key, last.id]) : null,
      has_more: hasMore,
    };
  }

  /**
   * Route 8 : CSV d'un lot exécuté. Lot inconnu, d'un autre grand livre ou non exécuté : 404. Rôle
   * de chaque classe
   * de bénéficiaire du lot exigé (403). Audité : nombre de lignes, jamais une destination.
   */
  async exportBatch(
    client: TxClient,
    actor: TenantActor,
    ledgerId: string,
    batchId: string,
  ): Promise<string> {
    const ledger = await this.scoped(client, actor, ledgerId);
    if (!isUuid(batchId)) throw notFound();
    const request = await client.query(
      `SELECT 1 FROM approval_request
        WHERE id = $1 AND action = 'PAYOUT' AND target_id = $2 AND status = 'EXECUTED'`,
      [batchId, ledger.ledgerId],
    );
    if (!request.rows[0]) throw notFound();
    const { rows } = await client.query<{
      id: string;
      kind: PayeeKind;
      legal_name: string;
      method: string;
      msisdn: string | null;
      iban: string | null;
      amount: string;
      currency: string;
    }>(
      `SELECT po.id, p.kind::text AS kind, p.legal_name, po.method, po.msisdn, po.iban,
              po.amount::text AS amount, trim(l.currency) AS currency
         FROM payout po JOIN party p ON p.id = po.beneficiary_id JOIN ledger l ON l.id = po.ledger_id
        WHERE po.ledger_id = $1 AND po.approval_request_id = $2
        ORDER BY po.initiated_at, po.id`,
      [ledger.ledgerId, batchId],
    );
    if (rows.length === 0) throw notFound();
    const absent = missingRole(
      actor.principal,
      rows.map((r) => r.kind),
      ledger.chain,
    );
    if (absent) throw new ProblemException('FORBIDDEN');
    // Seul endroit où l'IBAN est rouvert (OP-N140). Une enveloppe illisible, ou un IBAN non chiffré
    // en base, lève une erreur nommée sans valeur : ni repli sur le clair, ni CSV partiel.
    const openIban = (iban: string): string => {
      if (!this.vault.isSealed(iban)) throw new IbanVaultError('IBAN_VAULT_BAD_FORMAT');
      return this.vault.open(iban, actor.operatorId);
    };
    const csv: CsvRow[] = rows.map((r) => ({
      beneficiary: r.legal_name,
      method: r.method,
      // Numéro en chiffres seuls (sans « + », décision 9) ; la neutralisation de Csv.write reste active.
      destination: r.iban ? openIban(r.iban) : r.msisdn ? r.msisdn.replace(/^\+/, '') : null,
      amount: Number(r.amount),
      currency: r.currency,
      reference: r.id,
    }));
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'PAYOUT_BATCH_EXPORTED',
      objectType: 'approval_request',
      objectId: batchId,
      after: { ledger_id: ledger.ledgerId, lines: rows.length },
    });
    return Csv.write(csv, EXPORT_COLUMNS);
  }

  /**
   * Route 9 : résultat d'une ligne. La ligne est verrouillée (verrou consultatif) : deux résultats
   * simultanés se suivent.
   * `settle_payout` écrit la transaction `PAYOUT_CONFIRMED` ou `PAYOUT_FAILED` une seule fois ; un
   * résultat
   * identique rejoué rend la ligne sans écrire (ni transaction, ni audit) ; un autre résultat :
   * `409`.
   */
  async confirm(client: TxClient, actor: TenantActor, id: string, input: ConfirmInput) {
    if (!isUuid(id)) throw notFound();
    // Verrou de la ligne (le rôle applicatif n'a pas UPDATE sur `payout` : `FOR UPDATE` lui est
    // refusé) : deux
    // résultats simultanés se suivent, le second voit la ligne réglée et n'audite pas une seconde
    // fois.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `payout-confirm:${id}`,
    ]);
    const found = await client.query<{
      ledger_id: string;
      status: string;
      kind: PayeeKind;
      initiated_by: string;
      approved_by: string;
    }>(
      `SELECT po.ledger_id, po.status, p.kind::text AS kind, po.initiated_by, po.approved_by
         FROM payout po JOIN party p ON p.id = po.beneficiary_id
        WHERE po.id = $1`,
      [id],
    );
    const current = found.rows[0];
    if (!current) throw notFound();
    const ledger = await this.scoped(client, actor, current.ledger_id);
    if (!(PAYEE_KINDS as readonly string[]).includes(current.kind))
      throw new ProblemException('FORBIDDEN');
    if (missingRole(actor.principal, [current.kind], ledger.chain))
      throw new ProblemException('FORBIDDEN');
    const confirmed = input.outcome === 'CONFIRMED';
    // Décision 18 : un échec recrédite le droit ; il n'est jamais déclaré par qui a préparé (auteur de la demande) ou
    // validé le lot (sinon une seule personne ferait sortir puis rentrer l'argent). `CONFIRMED` reste ouvert. La
    // base refuse aussi (CL041) : ce contrôle donne le refus clair avant toute écriture.
    if (!confirmed && [current.initiated_by, current.approved_by].includes(actor.principal.userId))
      throw new ProblemException('FORBIDDEN', {
        detail:
          'Un échec ne peut être déclaré par la personne qui a préparé ou validé le lot de versements.',
      });
    await client.query('SELECT settle_payout($1, $2, $3, $4, $5)', [
      id,
      input.outcome,
      confirmed ? input.externalReference : null,
      confirmed ? null : input.failureReason,
      actor.principal.userId,
    ]);
    if (current.status !== 'INITIATED')
      // Rejeu identique (clé d'idempotence différente) : aucune écriture comptable, une trace.
      await this.audit.record(client, {
        ...actor.audit,
        operatorId: actor.operatorId,
        action: 'PAYOUT_CONFIRM_REPLAYED',
        objectType: 'payout',
        objectId: id,
        after: { ledger_id: current.ledger_id, outcome: input.outcome, replay: true },
      });
    else
      await this.audit.record(client, {
        ...actor.audit,
        operatorId: actor.operatorId,
        action: confirmed ? 'PAYOUT_CONFIRMED' : 'PAYOUT_FAILED',
        objectType: 'payout',
        objectId: id,
        // Jamais de destination : grand livre et issue seulement.
        after: { ledger_id: current.ledger_id, outcome: input.outcome },
      });
    const { rows } = await client.query<PayoutRow>(
      `SELECT ${PAYOUT_COLUMNS} FROM payout po JOIN ledger l ON l.id = po.ledger_id WHERE po.id = $1`,
      [id],
    );
    return payoutDto(rows[0]!);
  }
}
