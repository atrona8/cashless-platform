// Registre des numéros d'un terminal (mission 5b, lot WP11, T052 ; A4, A14 ; docs/sync_protocol.md §3.2 et
// §3.3, PRIORITAIRE sur la SPECIFICATION ; contracts/payments.md « Clé et registre des numéros »). Fourni à
// WP12 (annulation) et WP13 (demande QR) sans modification.
//
// Toute réponse FINALE (2xx ou 4xx) d'une route de terminal à clé `<serial>:<seq>` est enregistrée par
// `record_device_seq` :
//   - réussite : dans la transaction de l'écriture (`accept`), le terminal étant déjà tenu FOR UPDATE (le
//     service prend `SELECT … FOR UPDATE` du terminal en première instruction : la fonction exige l'issue et
//     `transaction_id`, connus seulement à la fin, et le registre est immuable — voir le compte rendu du lot) ;
//   - refus définitif 4xx : dans une transaction SÉPARÉE et validée, après l'annulation de l'écriture
//     (`reject`), avec le code du problème comme raison ;
//   - refus NON définitifs (`NON_FINAL_CODES`), 5xx, et refus levés par `record_device_seq` lui-même (`CL002`
//     même numéro autre contenu, `CL021` hors plage) : rien n'est enregistré (`isRegistrable`).
//
// `content_sha256` = SHA-256(JCS(champs chaînés présents)), sync_protocol.md §3.3. Champs d'une vente
// (`purchaseContent`) : `seq`, `type` (`PURCHASE`), `occurred_at` (chaîne telle que reçue), `amount`,
// `currency`, `tap` (lecture embarquée, telle que reçue) et `lines` (telles que reçues). JAMAIS `tap_id`,
// `customer_qr_token`, `vendor_session_id` ni un champ d'état (`snapshot_version`, `config_id`,
// `online_*`…). La forme devra être celle des lots hors ligne (mission 7).
import { Injectable } from '@nestjs/common';
import { chainedContent, contentSha256 } from '@cashless/shared-rules';
import type { TxClient } from '../db/tenant-tx';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { NON_FINAL_CODES } from '../idempotency/device-key';
import { isSqlError } from '../errors/sqlstate-map';
import type { ResolvedProblem } from '../errors/problem.filter';

export type SeqChannel = 'ONLINE' | 'BATCH' | 'EDGE';

/** Ligne du registre rendue par `record_device_seq` / `lookup`. */
export interface RegistryRow {
  replayed: boolean;
  outcome: string;
  reason: string | null;
  transactionId: string | null;
  contiguousAckedSeq: bigint;
}

interface RegistryRecordInput {
  deviceId: string;
  seq: bigint;
  content: Buffer;
  outcome: 'ACCEPTED' | 'ACCEPTED_WITH_SHORTFALL' | 'DUPLICATE' | 'REJECTED' | 'VOID';
  reason?: string;
  transactionId?: string;
  batchId?: string;
}

interface RegistrySqlRow {
  replayed: boolean;
  outcome: string;
  reason: string | null;
  transaction_id: string | null;
  contiguous_acked_seq: string | number | bigint;
}

const toRow = (r: RegistrySqlRow): RegistryRow => ({
  replayed: r.replayed,
  outcome: r.outcome,
  reason: r.reason,
  transactionId: r.transaction_id,
  contiguousAckedSeq: BigInt(r.contiguous_acked_seq),
});

/** Champs chaînés d'une vente que le terminal a pu envoyer (noms de `OfflineOperation`). */
const PURCHASE_FIELDS = ['occurred_at', 'amount', 'currency', 'tap', 'lines'] as const;

/**
 * Contenu d'une vente `createPayment` : calculé sur le corps TEL QUE REÇU (même un corps mal formé a un
 * contenu, de sorte que son refus se range au registre). `null` si le corps n'est pas un objet JSON : aucun
 * contenu calculable, rien n'est enregistré.
 */
export function purchaseContent(seq: bigint, body: unknown): Buffer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of PURCHASE_FIELDS) picked[field] = raw[field];
  return contentSha256(chainedContent({ seq, type: 'PURCHASE', ...picked }));
}

/** Ce refus doit-il être rangé au registre ? Seuls les refus 4xx définitifs, sauf ceux du registre lui-même. */
export function isRegistrable(problem: ResolvedProblem, error: unknown): boolean {
  if (problem.status < 400 || problem.status >= 500) return false;
  if (NON_FINAL_CODES.has(problem.code)) return false;
  // `CL002` (même numéro, autre contenu) et `CL021` (hors plage) viennent du registre : traduits tels quels.
  if (isSqlError(error) && (error.code === 'CL002' || error.code === 'CL021')) return false;
  return true;
}

@Injectable()
export class DeviceSeqRegistry {
  constructor(private readonly tx: TenantTx) {}

  /**
   * Enregistre un numéro par `record_device_seq` (`seq` en texte). Ne lève PAS quand `replayed` est vrai :
   * l'appelant décide. `CL002` (autre contenu) et `CL021` (hors plage) remontent tels quels. Le terminal doit
   * être déjà verrouillé par l'appelant (`lock_device`).
   */
  async record(
    client: TxClient,
    input: RegistryRecordInput,
    channel: SeqChannel = 'BATCH',
  ): Promise<RegistryRow> {
    const { rows } = await client.query<RegistrySqlRow>(
      `SELECT replayed, outcome, reason, transaction_id, contiguous_acked_seq
         FROM record_device_seq($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.deviceId,
        input.seq.toString(),
        input.content,
        input.outcome,
        channel,
        input.transactionId ?? null,
        input.reason ?? null,
        input.batchId ?? null,
      ],
    );
    return toRow(rows[0]!);
  }

  /**
   * Lecture sans effet : la ligne du registre pour (terminal, numéro) et le `contiguous_acked_seq` du
   * terminal (SELECT sous RLS, droit déjà accordé à `cashless_app`). `null` si le numéro n'est pas rangé.
   */
  async lookup(client: TxClient, deviceId: string, seq: bigint): Promise<RegistryRow | null> {
    const { rows } = await client.query<RegistrySqlRow>(
      `SELECT false AS replayed, r.outcome, r.reason, r.transaction_id, d.contiguous_acked_seq
         FROM device_seq_registry r JOIN device d ON d.id = r.device_id
        WHERE r.device_id = $1 AND r.seq = $2`,
      [deviceId, seq.toString()],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Réussite : dans la transaction de l'écriture (terminal déjà tenu FOR UPDATE). */
  async accept(
    client: TxClient,
    input: { deviceId: string; seq: bigint; content: Buffer; transactionId: string },
    channel: SeqChannel = 'ONLINE',
  ): Promise<void> {
    const row = await this.record(
      client,
      {
        deviceId: input.deviceId,
        seq: input.seq,
        content: input.content,
        outcome: 'ACCEPTED',
        transactionId: input.transactionId,
      },
      channel,
    );
    // Numéro déjà rangé avec ce contenu : cette écriture n'aurait pas dû avoir lieu (l'idempotence aurait rejoué
    // la réponse). Tout annuler plutôt que lier deux ventes à un numéro.
    if (row.replayed !== false)
      throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
        detail: 'Ce numéro du terminal est déjà enregistré.',
      });
  }

  /**
   * Refus définitif : transaction séparée, validée, APRÈS l'annulation de l'écriture. `inside` s'exécute dans
   * cette même transaction (lecture du solde d'un refus `INSUFFICIENT_FUNDS`), après la prise du terminal.
   */
  async reject<T = void>(
    operatorId: string,
    input: { deviceId: string; seq: bigint; content: Buffer; reason: string },
    channel: SeqChannel = 'ONLINE',
    inside?: (client: TxClient) => Promise<T>,
  ): Promise<T | undefined> {
    return this.tx.run(operatorId, async (client) => {
      // Verrou par fonction DEFINER (cashless_app n'a aucun UPDATE sur device : FOR UPDATE direct refusé).
      await client.query("SELECT lock_device($1, 'UPDATE')", [input.deviceId]);
      const extra = inside ? await inside(client) : undefined;
      await this.record(
        client,
        {
          deviceId: input.deviceId,
          seq: input.seq,
          content: input.content,
          outcome: 'REJECTED',
          reason: input.reason,
        },
        channel,
      );
      return extra;
    });
  }
}
