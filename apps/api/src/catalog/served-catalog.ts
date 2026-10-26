// Catalogue servi à un terminal dans sa configuration (mission 5b, lot WP10, T046 ; FR-008, part
// « version servie » de FR-012 ; contracts/catalog.md ; research R-04 révisé par A2 ; décision du
// porteur DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD). Appelé par `DeviceConfigService.build`, dans sa
// transaction,
// APRÈS le verrou du terminal et `record_config_served` (ordre inchangé).
//
// `record_device_catalog_served` (0032) est la seule écriture : elle lit la DERNIÈRE version du
// point
// de vente du terminal et l'inscrit dans `device_catalog_served` si elle n'y est pas déjà pour ce
// terminal et ce point de vente (une ligne par terminal, point de vente et version). Ce service ne
// fait
// que lire ensuite les articles de CETTE version : une version jamais servie n'est jamais écrite
// (A2),
// une version servie l'est toujours (sinon une vente au prix affiché serait refusée, FR-012).
// Terminal sans point de vente, ou point de vente sans version : `{version: 0, items: []}`, rien
// écrit.
// Libellés de l'article et de sa catégorie lus dans la version (0032 copie ceux de la catégorie) ;
// ordre : rang de la catégorie, puis libellé dans la langue servie.
import { Injectable } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import type { TxClient } from '../db/tenant-tx';
import type { Language } from '../http/language';

export type ServedCatalogBody = { version: number; items: components['schemas']['CatalogItem'][] };

interface ServedItemRow {
  item_id: string;
  label_fr: string;
  label_en: string;
  category_label_fr: string;
  category_label_en: string;
  unit_price: string;
  vat_rate_bps: number;
}

@Injectable()
export class ServedCatalog {
  /**
   * Version servie et ses articles (terminal `CATALOG_POS` ; prestataire de la transaction).
   * `record` : vrai seulement quand la configuration est remise au terminal
   * (`GET /device/config`) ; faux pour le battement de cœur, qui ne sert que l'ETag : même version (la dernière du point
   * de vente), lue sans rien inscrire — une version dont le terminal n'a reçu que l'empreinte n'est
   * pas une version servie (A2).
   */
  async serve(
    client: TxClient,
    target: { operatorId: string; deviceId: string; posId: string | null },
    language: Language,
    record: boolean,
  ): Promise<ServedCatalogBody> {
    const head = record
      ? await this.record(client, target.deviceId)
      : await this.latest(client, target.operatorId, target.posId);
    if (!head || head.pos_id === null || head.version === 0) return { version: 0, items: [] };
    const operatorId = target.operatorId;
    const { rows } = await client.query<ServedItemRow>(
      `SELECT item_id, label_fr, label_en, category_label_fr, category_label_en,
              unit_price::text AS unit_price, vat_rate_bps
         FROM catalog_version_item
        WHERE operator_id = $1 AND pos_id = $2 AND version = $3
        ORDER BY category_position, category_id,
                 CASE WHEN $4 = 'en' THEN label_en ELSE label_fr END, item_id`,
      [operatorId, head.pos_id, head.version, language],
    );
    const en = language === 'en';
    const items = rows.map((row) => ({
      product_id: row.item_id,
      name: en ? row.label_en : row.label_fr,
      unit_price: Number(row.unit_price),
      category: en ? row.category_label_en : row.category_label_fr,
      vat_rate_bps: row.vat_rate_bps,
    }));
    return { version: head.version, items };
  }

  /** Inscription par la base (0032) : dernière version, écrite si absente pour ce terminal. */
  private async record(client: TxClient, deviceId: string) {
    const { rows } = await client.query<{ pos_id: string | null; version: number }>(
      'SELECT pos_id, version FROM record_device_catalog_served($1)',
      [deviceId],
    );
    return rows[0];
  }

  /** Lecture seule : même choix que `record_device_catalog_served` (plus grand numéro). */
  private async latest(client: TxClient, operatorId: string, posId: string | null) {
    if (posId === null) return undefined;
    const { rows } = await client.query<{ version: number }>(
      `SELECT coalesce(max(version), 0)::int AS version FROM catalog_version
        WHERE pos_id = $1 AND operator_id = $2`,
      [posId, operatorId],
    );
    return { pos_id: posId, version: rows[0]!.version };
  }
}
