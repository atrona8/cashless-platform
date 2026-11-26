// Liste des modèles de téléphone (mission 11b, WP09 ; FR-015, FR-016, FR-018). Écriture par les
// fonctions de la base seules (`upsert_phone_model`, `delete_phone_model`), jamais par
// INSERT/UPDATE/DELETE direct ; chaque changement a sa ligne d'audit dans la chaîne de la
// plateforme, dans la même transaction.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { notFound, type PageRequest } from '../../organization/platform/platform.dto';
import {
  phoneModelDto,
  type PhoneModel,
  type PhoneModelRow,
  type PhoneModelUpsertInput,
} from './phone-models.dto';

const DATE_AS_TEXT = "to_char(measured_at, 'YYYY-MM-DD') AS measured_at";
const COLUMNS = `manufacturer, model, nfc_level, ${DATE_AS_TEXT}, updated_at`;

@Injectable()
export class PhoneModelsService {
  constructor(
    private readonly audit: AuditService,
    private readonly tenantTx: TenantTx,
  ) {}

  /**
   * Lecture par le pool applicatif : le rôle de plateforme n'a aucun `SELECT` sur la table (D9).
   * `phone_model` est une table de plateforme sans prestataire ni RLS, lisible par tout
   * administrateur que le contrôleur a autorisé.
   */
  read<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
    return this.tenantTx.withoutTenant(fn);
  }

  async list(page: PageRequest): Promise<PhoneModelRow[]> {
    return this.read(async (client) => {
      const { rows } = await client.query<PhoneModelRow>(
        `SELECT ${COLUMNS} FROM phone_model ORDER BY manufacturer, model OFFSET $1 LIMIT $2`,
        [page.offset, page.limit + 1],
      );
      return rows;
    });
  }

  /** Ligne actuelle (avant un retrait), pour le journal. */
  async current(manufacturer: string, model: string): Promise<PhoneModel | null> {
    const rows = await this.read(async (client) => {
      const result = await client.query<PhoneModelRow>(
        `SELECT ${COLUMNS} FROM phone_model
          WHERE manufacturer = normalize_phone_model($1) AND model = normalize_phone_model($2)`,
        [manufacturer, model],
      );
      return result.rows;
    });
    return rows[0] ? phoneModelDto(rows[0]) : null;
  }

  async upsert(
    client: TxClient,
    manufacturer: string,
    model: string,
    input: PhoneModelUpsertInput,
    actor: AuditContext,
  ): Promise<PhoneModel> {
    const { rows } = await client.query<PhoneModelRow>(
      `SELECT ${COLUMNS}
         FROM upsert_phone_model($1, $2, $3, $4::date, $5)`,
      [manufacturer, model, input.nfcLevel, input.measuredAt, actor.actorId],
    );
    const saved = phoneModelDto(rows[0]!);
    await this.audit.record(client, {
      ...actor,
      operatorId: null,
      action: 'PHONE_MODEL_UPSERTED',
      objectType: 'phone_model',
      objectId: `${saved.manufacturer}/${saved.model}`,
      after: {
        manufacturer: saved.manufacturer,
        model: saved.model,
        nfc_level: saved.nfc_level,
        measured_at: saved.measured_at,
      },
    });
    return saved;
  }

  async remove(
    client: TxClient,
    manufacturer: string,
    model: string,
    actor: AuditContext,
    previous: PhoneModel | null,
  ): Promise<void> {
    const removed = (
      await client.query<{ removed: boolean }>('SELECT delete_phone_model($1, $2, $3) AS removed', [
        manufacturer,
        model,
        actor.actorId,
      ])
    ).rows[0]!.removed;
    if (!removed) throw notFound();
    const names = (
      await client.query<{ manufacturer: string; model: string }>(
        'SELECT normalize_phone_model($1) AS manufacturer, normalize_phone_model($2) AS model',
        [manufacturer, model],
      )
    ).rows[0]!;
    await this.audit.record(client, {
      ...actor,
      operatorId: null,
      action: 'PHONE_MODEL_DELETED',
      objectType: 'phone_model',
      objectId: `${names.manufacturer}/${names.model}`,
      before: {
        manufacturer: names.manufacturer,
        model: names.model,
        nfc_level: previous?.nfc_level ?? null,
        measured_at: previous?.measured_at ?? null,
      },
    });
  }
}
