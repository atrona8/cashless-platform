// Vérification quotidienne des scellements (mission 9b, WP12 ; FR-020, SC-004, R-11). Couvre les DEUX chaînes : chaque
// grand livre (`ops_verify_ledger_seals`, qui recalcule les scellements et rend la référence de copie) et chaque
// chaîne du journal d'audit, plateforme comprise (`ops_verify_audit_chain`, ajoutée par WP05 à la liste de R-11).
// Écart de chaîne ou de copie (copie absente, introuvable ou différente, copie manquante depuis plus d'une heure) :
// alarme 8 et alerte critique, qui reste posée jusqu'au prochain passage conforme. Copie SIMULÉE (faux, jusqu'à la
// mission 12b) : état « copie simulée » dans le journal et `describe()`, jamais « conforme » et jamais un écart : un
// faux ne prouve rien. Aucune lecture de table.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { ALARM_INTEGRITY, errorCode, OpsAlerts, type AlertItem } from '../processes/ops-alerts';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { SEAL_COPY } from '../security/port-tokens';
import type { SealExternalCopy } from './seal-copy';
import { sealsSince, type SealRow } from './seal-common';

export const SEAL_VERIFY_INTERVAL_MS = 86_400_000;
/** Une copie encore absente après ce délai est un écart (NFR-005 : copie sous 10 minutes, marge incluse). */
export const MISSING_COPY_GRACE_MS = 3_600_000;

export type VerifyState = 'jamais exécuté' | 'conforme' | 'copie simulée' | 'ÉCART';

@Injectable()
export class SealVerifyWorker implements ProcessWorker {
  readonly name = 'seal-verify';
  private readonly log = new Logger(SealVerifyWorker.name);
  private nextRunAt = 0;
  private alarmCode = 0;
  private state: VerifyState = 'jamais exécuté';

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly alerts: OpsAlerts,
    @Inject(SEAL_COPY) private readonly copy: SealExternalCopy,
  ) {
    registry.register(this);
  }

  /** Dernier état connu (journal et `describe()`). Un faux ne rend jamais « conforme ». */
  lastState(): VerifyState {
    return this.state;
  }

  /** Rend le nombre de scellements vérifiés ; 0 avant l'échéance. */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + SEAL_VERIFY_INTERVAL_MS;
    const problems: AlertItem[] = [];
    let checked = 0;
    try {
      const seals = await sealsSince(this.tx, null);
      checked = seals.length;
      await this.verifyLedgers(seals, problems);
      await this.verifyAudit(seals, problems);
      await this.verifyCopies(seals, problems, now);
    } catch (error) {
      problems.push({
        key: 'run',
        detail: { worker: this.name, check: 'run', error: errorCode(error) },
      });
    }
    this.alarmCode = problems.length > 0 ? ALARM_INTEGRITY : 0;
    this.state = problems.length > 0 ? 'ÉCART' : this.copy.isFake ? 'copie simulée' : 'conforme';
    this.log.log(
      JSON.stringify({
        event: 'seal.verify',
        state: this.state,
        checked,
        problems: problems.length,
      }),
    );
    await this.alerts.sync(this.name, ALARM_INTEGRITY, problems, now);
    return checked;
  }

  private async verifyLedgers(seals: SealRow[], problems: AlertItem[]): Promise<void> {
    for (const ledger of new Set(seals.filter((s) => s.kind === 'LEDGER').map((s) => s.id))) {
      const rows = await this.tx.withoutTenant(async (client) => {
        const { rows: found } = await client.query<{ seal_no: number; ok: boolean }>(
          'SELECT seal_no, ok FROM ops_verify_ledger_seals($1::uuid, 1)',
          [ledger],
        );
        return found;
      });
      for (const row of rows.filter((r) => !r.ok))
        problems.push({
          key: `ledger:${ledger}:${row.seal_no}`,
          detail: {
            worker: this.name,
            check: 'ledger_chain',
            ledger_id: ledger,
            seal_no: row.seal_no,
          },
        });
    }
  }

  private async verifyAudit(seals: SealRow[], problems: AlertItem[]): Promise<void> {
    const pending = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ chain_key: string }>(
        'SELECT chain_key FROM ops_audit_chains_to_seal()',
      );
      return rows.map((row) => row.chain_key);
    });
    const chains = new Set([
      ...seals.filter((s) => s.kind === 'AUDIT').map((s) => s.id),
      ...pending,
    ]);
    for (const chain of chains) {
      const rows = await this.tx.withoutTenant(async (client) => {
        const { rows: found } = await client.query<{ seq: string; problem: string }>(
          "SELECT seq, problem FROM ops_verify_audit_chain($1::uuid, '-infinity')",
          [chain],
        );
        return found;
      });
      if (rows.length > 0)
        problems.push({
          key: `audit:${chain}`,
          detail: {
            worker: this.name,
            check: 'audit_chain',
            chain_key: chain,
            problems: rows.length,
            first_seq: Number(rows[0]!.seq),
          },
        });
    }
  }

  /** Copies : une copie simulée n'est pas relue (elle ne prouve rien) ; une copie réelle doit redonner l'empreinte. */
  private async verifyCopies(seals: SealRow[], problems: AlertItem[], now: number): Promise<void> {
    for (const seal of seals) {
      const base = {
        worker: this.name,
        check: 'copy',
        kind: seal.kind,
        id: seal.id,
        seal_no: seal.seal_no,
      };
      const key = `copy:${seal.kind}:${seal.id}:${seal.seal_no}`;
      if (seal.external_ref === null) {
        if (now - seal.sealed_at.getTime() > MISSING_COPY_GRACE_MS)
          problems.push({ key, detail: { ...base, reason: 'copie absente' } });
        continue;
      }
      if (this.copy.isFake) continue;
      try {
        const copied = await this.copy.read(seal.external_ref);
        if (copied === null)
          problems.push({ key, detail: { ...base, reason: 'copie introuvable' } });
        else if (!copied.equals(seal.seal_hash))
          problems.push({ key, detail: { ...base, reason: 'copie différente' } });
      } catch (error) {
        problems.push({
          key,
          detail: { ...base, reason: 'copie illisible', error: errorCode(error) },
        });
      }
    }
  }

  alarm(): number {
    return this.alarmCode;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : recalcul des scellements des grands livres et des chaînes d'audit, et comparaison aux ` +
        `copies, toutes les ${SEAL_VERIFY_INTERVAL_MS / 3_600_000} h ; copie externe ` +
        `${this.copy.isFake ? 'SIMULÉE (aucune garantie externe)' : 'réelle'} ; dernier état : ${this.state}`,
    ]);
  }
}
