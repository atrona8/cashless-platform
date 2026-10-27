// Portée de règle de frais `PSP_CONFIGURATION` (mission 6, lot WP10, T052) : déclarée au service des règles de
// frais pour que `createFeeRule` / `replaceFeeRule` l'acceptent. Réglée par l'OPERATOR_ADMIN ; organisateur et pays
// lus sur la configuration (sans événement).
import { Injectable } from '@nestjs/common';
import { FeeRulesService } from '../organization/tenant/fee-rules.service';

@Injectable()
export class PspFeeScope {
  constructor(feeRules: FeeRulesService) {
    feeRules.registerScope('PSP_CONFIGURATION', async (client, scopeId) => {
      const { rows } = await client.query<{ organizer_id: string; country_code: string | null }>(
        `SELECT c.organizer_id, o.country_code
           FROM psp_configuration c JOIN party o ON o.id = c.operator_id
          WHERE c.psp_configuration_id = $1`,
        [scopeId],
      );
      return rows[0]
        ? {
            role: 'OPERATOR_ADMIN' as const,
            organizerId: rows[0].organizer_id,
            countryCode: rows[0].country_code,
          }
        : null;
    });
  }
}
