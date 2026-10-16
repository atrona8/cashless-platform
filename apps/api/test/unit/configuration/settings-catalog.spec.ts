// Unitaires : catalogue des réglages (§4.2, §9.8, FR-010) — couverture du contrat, niveaux, rôle qui règle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  CONFIG_LEVELS,
  eventColumnKeys,
  regulatingRole,
  resolvedKeys,
  SETTINGS_CATALOG,
  settingOf,
} from '../../../src/configuration/settings-catalog';

const contract = parse(
  readFileSync(join(__dirname, '../../../../../packages/contracts/openapi.yaml'), 'utf8'),
) as {
  components: {
    schemas: Record<string, ContractSchema & { properties: Record<string, ContractSchema> }>;
  };
};
interface ContractSchema {
  $ref?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}
/** Schéma d'une propriété, référence suivie. */
const follow = (schema: ContractSchema): ContractSchema =>
  schema.$ref ? contract.components.schemas[schema.$ref.split('/').pop()!]! : schema;

describe('catalogue des réglages', () => {
  it('chaque clé de EventUpdate est au catalogue, portée par une colonne, au niveau EVENT', () => {
    const keys = Object.keys(contract.components.schemas.EventUpdate!.properties);
    expect(keys.length).toBeGreaterThan(20);
    const missing = keys.filter((key) => {
      const definition = settingOf(key);
      return (
        !definition ||
        definition.storage.kind !== 'EVENT_COLUMN' ||
        !definition.levels.includes('EVENT')
      );
    });
    expect(missing).toEqual([]);
  });

  it('bornes entières et énumérations identiques à celles du contrat', () => {
    const properties = contract.components.schemas.EventUpdate!.properties;
    const differences: string[] = [];
    for (const [key, property] of Object.entries(properties)) {
      const schema = follow(property);
      const { type } = settingOf(key)!;
      if (type.kind === 'int' && (schema.minimum !== type.min || schema.maximum !== type.max))
        differences.push(key);
      if (type.kind === 'enum' && JSON.stringify(schema.enum) !== JSON.stringify(type.values))
        differences.push(key);
    }
    expect(differences).toEqual([]);
  });

  it('une colonne ne se règle qu’au niveau EVENT ; les niveaux sont ceux de la cascade', () => {
    expect(eventColumnKeys().every((d) => d.levels.length === 1 && d.levels[0] === 'EVENT')).toBe(
      true,
    );
    for (const definition of SETTINGS_CATALOG.values()) {
      expect(definition.levels.every((level) => CONFIG_LEVELS.includes(level))).toBe(true);
    }
    expect(CONFIG_LEVELS).toEqual(['PLATFORM', 'OPERATOR', 'ORGANIZER', 'EVENT', 'PARTICIPATION']);
  });

  it('le détenteur des fonds et les attributs de l’événement sont hors de la configuration résolue', () => {
    const keys = resolvedKeys().map((d) => d.key);
    for (const key of [
      'funds_holder',
      'funds_holder_party_id',
      'name',
      'starts_at',
      'ends_at',
      'jurisdiction_id',
      'contract_id',
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(keys).toEqual(
      expect.arrayContaining([
        'spend_order',
        'psp_fee_bearer',
        'cash_refund_single_max',
        'refund_deadline',
        'sync_deadline_hours',
      ]),
    );
    expect(settingOf('funds_holder')?.default).toBeUndefined();
  });

  it('qui règle quoi : terminaux, synchronisation, cartes et autre numéro au prestataire ; le reste à l’organisateur', () => {
    const operatorKeys = [
      'tap_replay_window_seconds',
      'sync_deadline_hours',
      'refund_new_number_max',
      'refund_new_number_hold_hours',
      'card_topup_daily_max_per_card',
      'card_alert_cards_per_wallet',
      'online_connect_timeout_ms',
      'online_total_timeout_ms',
      'online_retries',
      'pending_sync_seconds',
      'reconcile_sync_seconds',
      'heartbeat_seconds',
      'local_retention_days',
    ];
    const organizerKeys = [
      'name',
      'starts_at',
      'ends_at',
      'refund_deadline',
      'identity_mode',
      'activation_modes',
      'lost_media_policy',
      'cash_refund_single_max',
      'reversal_window_minutes',
      'funds_holder',
      'issuer',
      'spend_order',
      'psp_fee_bearer',
    ];
    for (const key of operatorKeys)
      expect([key, regulatingRole(settingOf(key)!, 'EVENT')]).toEqual([key, 'OPERATOR_ADMIN']);
    for (const key of organizerKeys)
      expect([key, regulatingRole(settingOf(key)!, 'EVENT')]).toEqual([key, 'ORGANIZER_ADMIN']);
    const eventKeys = [...SETTINGS_CATALOG.values()]
      .filter((d) => d.levels.includes('EVENT'))
      .map((d) => d.key);
    expect(
      eventKeys
        .filter((key) => regulatingRole(settingOf(key)!, 'EVENT') === 'OPERATOR_ADMIN')
        .sort(),
    ).toEqual([...operatorKeys].sort());
  });

  it('chaque niveau supérieur est réglé par son propre rôle', () => {
    const spendOrder = settingOf('spend_order')!;
    expect(regulatingRole(spendOrder, 'PLATFORM')).toBe('PLATFORM_ADMIN');
    expect(regulatingRole(spendOrder, 'OPERATOR')).toBe('OPERATOR_ADMIN');
    expect(regulatingRole(spendOrder, 'ORGANIZER')).toBe('ORGANIZER_ADMIN');
    expect(settingOf('cash_refund_single_max_cap')?.levels).toEqual(['OPERATOR']);
    expect(settingOf('cash_refund_single_max')?.cappedBy).toBe('cash_refund_single_max_cap');
  });

  it('wallet_scope : seul EVENT est accepté dans cette mission (C-007)', () => {
    expect(settingOf('wallet_scope')?.type).toEqual({ kind: 'enum', values: ['EVENT'] });
  });
});
