// Purge de fin d'événement (T108 ; FR-035, NFR-013 ; research R-27, ADR-161, OP-N106).
//
// Ordre, chaque étape journalisée dans `edge_audit` (`PURGE`, sans contenu) :
//   MARKER      marqueur hors base écrit et synchronisé, la porte des terminaux se ferme ;
//   QUIESCE     arrêt de la réplication, du vidage, des snapshots et du canal de contrôle ;
//   KEYS        HARDWARE_KEYSTORE.destroy('agreement') puis ('token') : les colis `pwd_pack_enc` et
//               la clé de contenu deviennent illisibles ;
//   DATA        colis, empreintes de jetons de rafraîchissement, clé de contenu
// (`purgeKeyMaterial`),
//               puis TRUNCATE de toutes les tables hors la liste PROTÉGÉE ci-dessous ;
//   VACUUM      VACUUM FULL des mêmes tables, hors transaction ;
//   FINAL_KEYS  destroy('batch') puis ('snapshot') ; marqueur DONE.
// Idempotente et reprenable : chaque étape peut être rejouée ; un arrêt laisse le marqueur STARTED
// que
// `PurgeRuntime.enforceAtStartup` termine avant tout service.
//
// TABLES PROTÉGÉES (jamais vidées, aucune matière secrète) : identité et enrôlement (`edge_meta`,
// `edge_site_order_key`), autorité et sa piste, horloge, tête de chaîne, opérations, lots de
// terminaux relayés et lots sortants
// (trigger d'ajout seul : elles seront versées ou ne le seront pas, jamais effacées), audit.
// Toute AUTRE table est vidée : une table ajoutée plus tard est purgée par défaut.
//
// LIMITE ÉCRITE (OP-N106, ADR-161) : un mini-PC volé AVANT la purge garde ses secrets ; après la
// purge, les blocs libérés du disque et le journal de transactions de PostgreSQL ne sont pas
// effacés octet par octet, seul le chiffrement du disque de l'hôte les protège.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GATEWAY_POOL, type GatewayPool } from '../db/pool';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import {
  HARDWARE_KEYSTORE,
  type KeyUse,
  type MaybeFakeKeystore,
} from '../key-store/hardware-keystore.port';
import { purgeKeyMaterial } from '../replication/pwd-pack-key';
import { PurgeGate, PurgeMarkerFile, type PurgeTriggerKind } from './purge-marker';

export const PURGE_MARKER = Symbol('PURGE_MARKER');
export const PURGE_GATE = Symbol('PURGE_GATE');
export const PURGE_QUIESCE = Symbol('PURGE_QUIESCE');
export const PURGE_STEP_HOOK = Symbol('PURGE_STEP_HOOK');

/**
 * Arrête les processus de fond qui réécriraient la base (réplication, vidage, snapshots, canal).
 */
export interface Quiescer {
  quiesce(): Promise<void>;
}

export type PurgeStep = 'MARKER' | 'QUIESCE' | 'KEYS' | 'DATA' | 'VACUUM' | 'FINAL_KEYS' | 'DONE';
export const PURGE_STEPS: readonly PurgeStep[] = [
  'MARKER',
  'QUIESCE',
  'KEYS',
  'DATA',
  'VACUUM',
  'FINAL_KEYS',
  'DONE',
];
/** Point d'arrêt de test (un test lève pour simuler un arrêt brutal) ; IGNORÉ en production. */
export type PurgeStepHook = (step: PurgeStep) => void | Promise<void>;

export const PROTECTED_TABLES: readonly string[] = [
  'edge_meta',
  'edge_site_order_key',
  'edge_authority',
  'edge_authority_transition',
  'edge_clock',
  'edge_chain_head',
  'edge_op',
  'edge_outgoing_batch',
  // Référencée par `edge_op` (relais des lots de terminaux) : en-têtes et signatures d'origine.
  'edge_device_batch',
  'edge_audit',
  'edge_schema_migration',
  // Une seule ligne, remise à zéro (pas vidée) : le curseur de réplication.
  'edge_replication_cursor',
];

export class PurgeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurgeRefusedError';
  }
}

export interface PurgeOrigin {
  trigger: Exclude<PurgeTriggerKind, 'UNKNOWN'>;
  holders?: string[];
  /** Ordre manuel : accusé du central reçu (`ACKED`) ou purge locale forcée (`UNCONFIRMED`). */
  central?: 'ACKED' | 'UNCONFIRMED';
}

@Injectable()
export class PurgeService {
  private readonly logger = new Logger('Purge');
  private running: Promise<void> | null = null;

  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_POOL) private readonly pool: GatewayPool,
    @Inject(HARDWARE_KEYSTORE) private readonly keystore: MaybeFakeKeystore,
    @Inject(PURGE_MARKER) private readonly marker: PurgeMarkerFile,
    @Inject(PURGE_GATE) private readonly gate: PurgeGate,
    @Optional() @Inject(PURGE_QUIESCE) private readonly quiescer?: Quiescer,
    @Optional() @Inject(PURGE_STEP_HOOK) private readonly stepHook?: PurgeStepHook,
  ) {}

  /** Une purge est en cours ou terminée (marqueur présent). */
  get engaged(): boolean {
    return this.gate.engaged;
  }

  /** Lance la purge (une seule à la fois) et rend quand elle est terminée. */
  execute(origin: PurgeOrigin): Promise<void> {
    if (this.running) return this.running;
    const run = this.runFrom(origin.trigger, origin.holders ?? [], false, origin.central).finally(
      () => {
        this.running = null;
      },
    );
    this.running = run;
    return run;
  }

  /** Reprise au démarrage : marqueur STARTED, on rejoue toutes les étapes. */
  resume(trigger: PurgeTriggerKind, holders: string[]): Promise<void> {
    if (this.running) return this.running;
    const run = this.runFrom(trigger, holders, true).finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private assertRealKeystore(): void {
    // Un faux ne détruit rien : en production il ne peut pas prétendre avoir purgé (le démarrage le
    // refuse déjà ; ceci est la seconde ceinture, sans toucher à la base).
    if (this.config.production && this.keystore.isFake === true) {
      throw new PurgeRefusedError('purge refusée : port matériel factice en production');
    }
  }

  private async step(step: PurgeStep, detail: Record<string, unknown>): Promise<void> {
    await this.gatewayTx.run((tx) => this.audit(tx, step, detail));
    if (this.stepHook && !this.config.production) await this.stepHook(step);
  }

  private async audit(
    tx: TxClient,
    step: PurgeStep,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await tx.query(`INSERT INTO edge_audit (kind, actor, detail) VALUES ('PURGE', $1, $2)`, [
      'gateway',
      JSON.stringify({ step, ...detail }),
    ]);
  }

  private async runFrom(
    trigger: PurgeTriggerKind,
    holders: string[],
    resuming = false,
    central?: 'ACKED' | 'UNCONFIRMED',
  ): Promise<void> {
    this.assertRealKeystore();
    const base = { trigger, holders, resumed: resuming, ...(central ? { central } : {}) };
    const existing = this.marker.read();
    if (existing?.state === 'DONE') return;
    if (existing === null) {
      this.marker.write({ state: 'STARTED', trigger, holders, at: new Date().toISOString() });
    }
    this.gate.engage();
    await this.step('MARKER', base);

    await this.quiescer?.quiesce();
    await this.step('QUIESCE', base);

    await this.keystore.destroy('agreement');
    await this.keystore.destroy('token');
    await this.step('KEYS', base);

    await this.wipeData();
    await this.step('DATA', base);

    await this.vacuum();
    await this.step('VACUUM', base);

    await this.keystore.destroy('batch');
    await this.keystore.destroy('snapshot');
    await this.step('FINAL_KEYS', base);

    const started = existing ?? this.marker.read();
    this.marker.write({
      state: 'DONE',
      trigger: started?.trigger ?? trigger,
      holders: started?.holders ?? holders,
      at: new Date().toISOString(),
    });
    await this.step('DONE', base);
    this.logger.warn('purge terminée : la passerelle ne sert plus rien');
  }

  /** Tables à vider : toutes celles du schéma public hors liste protégée. */
  async wipedTables(tx: Pick<TxClient, 'query'> = this.pool): Promise<string[]> {
    const { rows } = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    return rows.map((r) => r.tablename).filter((name) => !PROTECTED_TABLES.includes(name));
  }

  private async wipeData(): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      // Matière de clé d'abord (réutilise la purge du changement de rôle, WP18) ...
      await purgeKeyMaterial(tx);
      await tx.query(
        `UPDATE edge_snapshot_entry SET pwd_pack_enc = NULL WHERE pwd_pack_enc IS NOT NULL`,
      );
      // ... puis toutes les tables de service, en une instruction (clés étrangères internes).
      const tables = await this.wipedTables(tx);
      if (tables.length > 0) {
        await tx.query(`TRUNCATE ${tables.map((name) => `"${name}"`).join(', ')}`);
      }
      await tx.query(
        `UPDATE edge_replication_cursor SET last_replicated_posting_id = 0, last_change_seq = 0,
                last_edge_seq_applied = 0, last_applied_at = NULL`,
      );
    });
  }

  private async vacuum(): Promise<void> {
    const tables = await this.wipedTables();
    for (const name of tables) await this.pool.query(`VACUUM FULL "${name}"`);
  }
}

export const DESTROYED_USES: readonly KeyUse[] = ['agreement', 'token', 'batch', 'snapshot'];
