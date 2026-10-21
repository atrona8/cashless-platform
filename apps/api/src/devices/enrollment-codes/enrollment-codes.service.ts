// Codes d'enrôlement (contracts/enrollment.md, lot WP14) : émission par
// `create_device_enrollment_code` (SECURITY DEFINER, qui revérifie la portée de l'auteur) et liste
// des codes en cours. Le code en clair n'existe que dans la réponse de la création (route
// `transient`) : la base n'en garde que l'empreinte HMAC-SHA256 à clé (`ENROLLMENT_CODE_HMAC_KEY`,
// jamais un SHA simple), l'audit ne le porte pas, et aucune ligne lue ne rend l'empreinte.
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { TxClient } from '../../db/tenant-tx';
import {
  enrollmentCodeHash,
  formatEnrollmentCode,
  generateEnrollmentCode,
} from '../../enrollment-code/enrollment-code';
import type { TenantActor } from '../../organization/tenant/tenant-access';
import type { EnrollmentCodeInput, EnrollmentCodeRow } from './enrollment-codes.dto';

export interface CreatedEnrollmentCode {
  enrollment_code_id: string;
  code: string;
  expires_at: string;
  app_mode: string;
}

export interface EnrollmentCodeFilter {
  eventId?: string;
  /** Organisateurs lisibles ; `null` : tout le prestataire (OPERATOR_ADMIN). */
  organizers: string[] | null;
}

@Injectable()
export class EnrollmentCodesService {
  constructor(
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'enrollmentCodeHmacKey'>,
  ) {}

  async create(
    client: TxClient,
    actor: TenantActor,
    input: EnrollmentCodeInput,
  ): Promise<CreatedEnrollmentCode> {
    const code = generateEnrollmentCode();
    const { rows } = await client.query<{ id: string }>(
      'SELECT create_device_enrollment_code($1, $2, $3, $4, $5, $6, $7) AS id',
      [
        enrollmentCodeHash(code, this.config.enrollmentCodeHmacKey),
        input.eventId,
        input.posId,
        input.appMode,
        input.personalPhone,
        input.expiresInSeconds,
        actor.principal.userId,
      ],
    );
    const id = rows[0]!.id;
    const created = (
      await client.query<{ expires_at: Date; app_mode: string }>(
        'SELECT expires_at, app_mode FROM device_enrollment_code WHERE id = $1',
        [id],
      )
    ).rows[0]!;
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'DEVICE_ENROLLMENT_CODE_CREATED',
      objectType: 'device_enrollment_code',
      objectId: id,
      // Ni le code ni son empreinte.
      after: {
        event_id: input.eventId,
        pos_id: input.posId,
        app_mode: created.app_mode,
        personal_phone: input.personalPhone,
        expires_at: created.expires_at.toISOString(),
      },
    });
    return {
      enrollment_code_id: id,
      code: formatEnrollmentCode(code),
      expires_at: created.expires_at.toISOString(),
      app_mode: created.app_mode,
    };
  }

  /** Codes non utilisés et non expirés du prestataire (RLS), triés par création. */
  async list(
    client: TxClient,
    filter: EnrollmentCodeFilter,
    offset: number,
    limit: number,
  ): Promise<EnrollmentCodeRow[]> {
    const { rows } = await client.query<EnrollmentCodeRow>(
      `SELECT c.id, c.event_id, c.pos_id, c.app_mode, c.personal_phone, c.created_by, c.created_at,
              c.expires_at
         FROM device_enrollment_code c
         JOIN event e ON e.id = c.event_id AND e.operator_id = c.operator_id
        WHERE c.used_at IS NULL AND c.expires_at > now()
          AND ($1::uuid IS NULL OR c.event_id = $1)
          AND ($2::uuid[] IS NULL OR e.organizer_id = ANY ($2))
        ORDER BY c.created_at, c.id
        OFFSET $3 LIMIT $4`,
      [filter.eventId ?? null, filter.organizers, offset, limit],
    );
    return rows;
  }
}
