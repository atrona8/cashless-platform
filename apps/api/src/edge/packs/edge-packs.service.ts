// Travailleur des colis de mots de passe (WP15, T068 ; R-22, R-27, ADR-160, ADR-183), dans le
// processus `tag-keys`
// (rôle `cashless_tagkeys`, seul droit sur le service de clés : déchiffrer). Pour chaque passerelle
// éligible :
// (1) dépose une fois la clé de contenu, scellée pour la clé d'accord de la passerelle
// (`deposit_edge_pwd_pack_key`) ;
//   (2) dépose les colis de bracelet chiffrés sous cette clé (`deposit_edge_pwd_pack`).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, secrets en mémoire).
//
// Éligibilité : décidée PAR LA BASE (`edge_gateways_awaiting_pack`, `edge_media_to_pack` : PRIMARY,
// non révoquée, délai
// `pack_delay_seconds` écoulé depuis l'inscription ou la promotion) ; le travailleur ne la
// recalcule pas (il n'a ni la
// date ni le droit de la lire) et ne dépose rien pour une passerelle dont la base ne rend rien. Une
// seconde barrière
// garde `deposit_edge_pwd_pack*` (passerelle révoquée refusée) et `edge_replication_page` (rien
// servi hors délai).
// Aucune clé maître (MAC) : seules la clé de données du prestataire et le port de déchiffrement
// servent (C-009). Aucun
// secret en journal : les messages ne portent que des compteurs. Tout tampon secret est mis à zéro
// dans un `finally` ;
// aucun appel au service de clés dans une transaction.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { openPwdPack, pwdPackAad } from '@cashless/tag-format';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { DECRYPT_PORT, type DecryptPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { DataKeyRepository } from '../../media/keys/data-key.repository';
import { DekCache } from '../../media/keys/dek-cache';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import {
  agreementKeySha256,
  deriveContentKey,
  sealContentKey,
  sealMediaPack,
} from './pack-sealing';

export const PACK_PAGE = 200;
const GATEWAYS_PER_OPERATOR = 100;
/** SQLSTATE nommés des fonctions de dépôt (0063). */
const REVOKED_OR_REFUSED = 'CL001';
const KEY_ALREADY_THERE = 'CL002';
const NOT_FOUND = 'P0002';

interface AwaitingGateway {
  gateway_id: string;
  event_id: string;
  agreement_public_key: Buffer;
}

interface MediaToPack {
  ledger_id: string;
  media_id: string | null;
  operator_id: string | null;
  nfc_uid: Buffer | null;
  key_index: number | null;
  media_version: bigint | null;
  pwd_pack_enc: Buffer | null;
  pwd_pack_dek_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID séparés par des virgules ; un UUID mal formé refuse le démarrage ; vide ou absent : []. */
export function parsePackOperators(raw: string | undefined): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  for (const item of items)
    if (!UUID.test(item)) throw new Error('EDGE_PACK_OPERATORS : UUID mal formé');
  return items.map((v) => v.toLowerCase());
}

const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

@Injectable()
export class EdgePacksService implements ProcessWorker {
  readonly name = 'edge-packs';
  private readonly logger = new Logger(EdgePacksService.name);
  private warned = false;
  /** Bracelets illisibles déjà journalisés : écartés des pages suivantes, journalisés une fois. */
  private readonly unreadable = new Set<string>();
  private readonly pageWarned = new Set<string>();
  private readonly configured: string[] = parsePackOperators(process.env.EDGE_PACK_OPERATORS);

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly keys: DataKeyRepository,
    private readonly cache: DekCache,
    @Inject(DECRYPT_PORT) private readonly kms: DecryptPort,
  ) {
    registry.register(this);
  }

  /**
   * Prestataires à parcourir : liste `EDGE_PACK_OPERATORS` (décision 43, ADR-184), lue au
   * démarrage ; `only` (appelant, tests) la remplace. Liste vide : rien n'est déposé (échec fermé).
   */
  private operators(only?: readonly string[]): string[] {
    if (only && only.length > 0) return [...only];
    if (this.configured.length > 0) return [...this.configured];
    if (!this.warned) {
      this.warned = true;
      this.logger.warn(
        'colis : aucun prestataire désigné, aucun colis déposé (EDGE_PACK_OPERATORS vide)',
      );
    }
    return [];
  }

  /** Un passage : rend le nombre de dépôts réussis (clés et colis). */
  async runOnce(only?: readonly string[]): Promise<number> {
    let deposited = 0;
    for (const operatorId of this.operators(only)) {
      const gateways = await this.tx.run(operatorId, async (client) => {
        const { rows } = await client.query<AwaitingGateway>(
          'SELECT gateway_id, event_id, agreement_public_key FROM edge_gateways_awaiting_pack($1)',
          [GATEWAYS_PER_OPERATOR],
        );
        return rows;
      });
      for (const gateway of gateways) {
        try {
          deposited += await this.serve(operatorId, gateway);
        } catch (error) {
          // Une passerelle en échec n'arrête pas les autres ; le message ne porte aucune valeur
          // secrète.
          this.logger.error(
            `colis : passerelle ${gateway.gateway_id} en échec (${
              error instanceof Error ? error.name : 'erreur'
            })`,
          );
        }
      }
    }
    if (deposited > 0) this.logger.log(`colis : ${deposited} dépôt(s)`);
    return deposited;
  }

  private async serve(operatorId: string, gateway: AwaitingGateway): Promise<number> {
    const first = await this.page(operatorId, gateway.gateway_id);
    if (first.length === 0) return 0; // la base ne la juge pas éligible : rien
    const ledgerId = first[0]!.ledger_id;
    let contentKey: Buffer | undefined;
    let done = 0;
    try {
      contentKey = await this.contentKey(operatorId, gateway);
      if (!contentKey) return 0; // le prestataire n'a encore aucune clé de données : rien à sceller
      if (await this.depositKey(operatorId, gateway, ledgerId, contentKey)) done += 1;
      let rows = first;
      for (let pass = 0; pass < 1000; pass += 1) {
        // OP-N115 : sans curseur, une page de 200 bracelets illisibles arrête le service de cette
        // passerelle (la fonction rend toujours les mêmes 200 premiers).
        const listed = rows.filter((r) => r.media_id !== null);
        const media = listed.filter((r) => !this.unreadable.has(r.media_id!));
        if (media.length === 0) {
          this.warnUnreadablePage(gateway.gateway_id, listed.length);
          break;
        }
        const outcome = await this.depositPage(operatorId, gateway.gateway_id, contentKey, media);
        done += outcome.deposited;
        if (listed.every((r) => this.unreadable.has(r.media_id!)))
          this.warnUnreadablePage(gateway.gateway_id, listed.length);
        if (outcome.stop || outcome.deposited === 0) break;
        rows = await this.page(operatorId, gateway.gateway_id);
      }
    } finally {
      zeroize(contentKey);
    }
    return done;
  }

  /** Page entièrement illisible : journalisée une fois par passerelle (ni UID, ni secret). */
  private warnUnreadablePage(gatewayId: string, count: number): void {
    if (count === 0 || this.pageWarned.has(gatewayId)) return;
    this.pageWarned.add(gatewayId);
    this.logger.error(
      `colis : page entièrement illisible, passerelle ${gatewayId}, ${count} bracelet(s) (OP-N115)`,
    );
  }

  private page(operatorId: string, gatewayId: string): Promise<MediaToPack[]> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<MediaToPack>('SELECT * FROM edge_media_to_pack($1, $2)', [
        gatewayId,
        PACK_PAGE,
      ]);
      return rows;
    });
  }

  /**
   * Clé de contenu de la passerelle, dérivée de la plus ancienne clé de données du prestataire
   * (stable : une rotation ouvre une version PLUS RECENTE, l'ancienne n'est jamais supprimée).
   * `undefined` : aucune clé de données.
   */
  private async contentKey(
    operatorId: string,
    gateway: AwaitingGateway,
  ): Promise<Buffer | undefined> {
    const stored = await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM tag_data_key WHERE operator_id = $1
          ORDER BY created_at, key_index, version, id LIMIT 1`,
        [operatorId],
      );
      return rows[0] ? this.keys.encrypted(client, rows[0].id) : null;
    });
    if (!stored) return undefined;
    const dek = await this.kms.decrypt(stored.wrappingKeyRef, stored.encrypted);
    try {
      return deriveContentKey({
        dek,
        gatewayId: gateway.gateway_id,
        agreementPublicKey: gateway.agreement_public_key,
      });
    } finally {
      zeroize(dek);
    }
  }

  /** Dépose la clé scellée ; `false` si elle existe déjà (même clé d'accord) ou refusée. */
  private async depositKey(
    operatorId: string,
    gateway: AwaitingGateway,
    ledgerId: string,
    contentKey: Buffer,
  ): Promise<boolean> {
    const wrapped = sealContentKey({
      contentKey,
      agreementPublicKey: gateway.agreement_public_key,
      ledgerId,
      gatewayId: gateway.gateway_id,
    });
    try {
      await this.tx.run(operatorId, (client) =>
        client.query('SELECT deposit_edge_pwd_pack_key($1, $2, $3::jsonb)', [
          gateway.gateway_id,
          agreementKeySha256(gateway.agreement_public_key),
          JSON.stringify(wrapped),
        ]),
      );
      return true;
    } catch (error) {
      // Déjà déposée pour cette clé d'accord (la dérivation donne la même clé) : on continue avec
      // les colis.
      if (sqlState(error) === KEY_ALREADY_THERE) return false;
      if (sqlState(error) === REVOKED_OR_REFUSED || sqlState(error) === NOT_FOUND) return false;
      throw error;
    }
  }

  /** Dépose les colis d'une page ; groupés par clé de données (un déchiffrement par clé). */
  private async depositPage(
    operatorId: string,
    gatewayId: string,
    contentKey: Buffer,
    media: MediaToPack[],
  ): Promise<{ deposited: number; stop: boolean }> {
    const byDek = new Map<string, MediaToPack[]>();
    for (const row of media) {
      const group = byDek.get(row.pwd_pack_dek_id!) ?? [];
      group.push(row);
      byDek.set(row.pwd_pack_dek_id!, group);
    }
    let deposited = 0;
    let stop = false;
    for (const [dekId, rows] of byDek) {
      await this.cache.withKey(
        dekId,
        () => this.loadDek(operatorId, dekId),
        async (dek) => {
          for (const row of rows) {
            if (stop) return;
            const outcome = await this.depositOne(operatorId, gatewayId, contentKey, dek, row);
            if (outcome === 'DONE') deposited += 1;
            else if (outcome === 'STOP') stop = true;
          }
        },
      );
    }
    return { deposited, stop };
  }

  private async depositOne(
    operatorId: string,
    gatewayId: string,
    contentKey: Buffer,
    dek: Buffer,
    row: MediaToPack,
  ): Promise<'DONE' | 'SKIP' | 'STOP'> {
    let pwdPack: Buffer | undefined;
    try {
      pwdPack = openPwdPack({
        dek,
        blob: row.pwd_pack_enc!,
        aad: pwdPackAad({
          mediaId: row.media_id!,
          operatorId,
          keyIndex: row.key_index!,
          uid: row.nfc_uid!,
        }),
      });
      const sealed = sealMediaPack({
        contentKey,
        pwdPack,
        mediaId: row.media_id!,
        operatorId,
        keyIndex: row.key_index!,
        uid: row.nfc_uid!,
      });
      await this.tx.run(operatorId, (client: TxClient) =>
        client.query('SELECT deposit_edge_pwd_pack($1, $2, $3, $4, $5)', [
          gatewayId,
          row.media_id,
          sealed.pack,
          sealed.sha256,
          row.media_version!.toString(),
        ]),
      );
      return 'DONE';
    } catch (error) {
      const state = sqlState(error);
      // Passerelle révoquée ou clé de contenu périmée entre le calcul et le dépôt : la base refuse,
      // on n'insiste pas.
      if (state === REVOKED_OR_REFUSED || state === NOT_FOUND) return 'STOP';
      // Mot de passe illisible (clé, chiffré ou AAD incorrect) : ce bracelet est ignoré, sans
      // valeur en journal.
      if (error instanceof Error && error.name === 'TagFormatError') {
        this.unreadable.add(row.media_id!);
        this.logger.error(`colis : bracelet ${row.media_id} illisible (${error.name})`);
        return 'SKIP';
      }
      throw error;
    } finally {
      zeroize(pwdPack);
    }
  }

  /** Charge la clé de données en clair ; le tampon est celui du DekCache, qui le met à zéro. */
  private async loadDek(operatorId: string, dekId: string): Promise<Buffer> {
    const stored = await this.tx.run(operatorId, (client) => this.keys.encrypted(client, dekId));
    if (!stored) throw new Error('Clé de données introuvable');
    return this.kms.decrypt(stored.wrappingKeyRef, stored.encrypted);
  }
}
