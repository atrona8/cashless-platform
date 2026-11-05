// Travailleur `journal-import` (mission 7, lot WP20, T085 ; FR-034, FR-035 ; R-30.10 ; ADR-140). Prend les imports
// `PROCESSING` de TOUS les prestataires par `device_journal_imports_processing()` (identifiants seulement : décision du
// porteur DM 01M667Y1J4DT3HY96ZBCXXMXBT, aucun SELECT direct sur la table), puis traite chaque import sous la RLS de
// son prestataire. Un import à la fois par instance ET entre instances (verrou de session, pool dédié de WP18).
//
// Pour chaque lot, dans l'ordre des numéros : `open_imported_batch` (terminal REVOKED, canal IMPORT), puis une
// opération par appel du processeur de WP19 (sa propre transaction ; reprise à la première sans résultat, jamais de
// retraitement), puis `complete_offline_batch`. L'état d'un lot ne se DÉDUIT jamais de ce que rend `open_imported_batch`
// (il peut rendre la ligne d'un autre import ou de la voie ordinaire) : avant `finish(APPLIED)` chaque lot est relu par
// `offline_batch_state` et doit être `COMPLETED`. Erreur non reprenable (lot refusé par la base, signature ou chaîne
// qui ne tiennent plus) : `FAILED`, import jamais rejoué tel quel. Erreur du processeur : l'import reste `PROCESSING`
// (reprise au prochain passage), `FAILED` après 5 échecs de suite dans ce processus ; alarme 2 tant qu'il y en a.
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service';
import { LOCK_BUSY } from '../../db/session-lock';
import { TenantTx } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { BatchLockPool, POOL_FULL } from '../batches/batch-lock-pool';
import { verifyChain } from '../batches/batch-chain';
import { BatchRunner } from '../batches/batch-runner';
import { OFFLINE_BATCH_LOCK, type BatchOpening, type ParsedBatch } from '../batches/batch.types';
import {
  parsedOperations,
  parseStoredBatches,
  readImportTerminal,
  verifyImportBatches,
  type ImportTerminal,
} from './journal-verify';

/** Alarme « constat métier » du contrat des processus (2). */
export const ALARM_IMPORT_STUCK = 2;
/** Échecs de suite (dans ce processus) avant de clore l'import `FAILED`. */
export const MAX_CONSECUTIVE_FAILURES = 5;

interface ProcessingRow {
  import_id: string;
  operator_id: string;
}

interface ImportRow {
  id: string;
  device_id: string;
  status: string;
  approved_by: string | null;
  batches: unknown;
}

/** Fin anormale d'un import : `FAILED` avec ce code stable (jamais une valeur reçue). */
class ImportFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

@Injectable()
export class JournalImportWorker implements ProcessWorker, OnModuleInit {
  readonly name = 'journal-import';
  private readonly log = new Logger(JournalImportWorker.name);
  private alarmCode = 0;
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tx: TenantTx,
    private readonly runner: BatchRunner,
    private readonly audit: AuditService,
    @Inject(OFFLINE_BATCH_LOCK) private readonly locks: BatchLockPool,
  ) {}

  /** S'inscrit au registre du processus qui l'héberge (l'API publique en a un ; un processus sans registre, non). */
  onModuleInit(): void {
    try {
      this.moduleRef.get(WorkerRegistry, { strict: false }).register(this);
    } catch {
      // Processus sans registre de travailleurs : le travailleur reste appelable (`runOnce`).
    }
  }

  private pending(): Promise<ProcessingRow[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<ProcessingRow>(
        'SELECT import_id, operator_id FROM device_journal_imports_processing()',
      );
      return rows;
    });
  }

  /** Rend le nombre d'imports menés à `APPLIED` ou `FAILED`. */
  async runOnce(): Promise<number> {
    let done = 0;
    let stuck = false;
    for (const row of await this.pending()) {
      try {
        if (await this.processImport(row.import_id, row.operator_id)) done += 1;
      } catch (error) {
        stuck = true;
        this.log.error(
          `import ${row.import_id} : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.alarmCode = stuck ? ALARM_IMPORT_STUCK : 0;
    return done;
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    return (await this.pending()).map(
      (row) => `${this.name} : import ${row.import_id} en cours (prestataire ${row.operator_id})`,
    );
  }

  /** `true` si l'import est clos (APPLIED ou FAILED) à l'issue du passage. */
  private async processImport(importId: string, operatorId: string): Promise<boolean> {
    const lock = await this.locks.acquire(`journal-import:${importId}`);
    if (lock === LOCK_BUSY || lock === POOL_FULL) return false;
    try {
      const row = await this.tx.run(operatorId, async (client) => {
        const { rows } = await client.query<ImportRow>(
          'SELECT id, device_id, status, approved_by, batches FROM device_journal_import_view($1, true)',
          [importId],
        );
        return rows[0];
      });
      if (!row || row.status !== 'PROCESSING') return false;
      try {
        const results = await this.apply(operatorId, row);
        await this.finish(operatorId, row, 'APPLIED', null, results);
        this.failures.delete(importId);
        return true;
      } catch (error) {
        if (error instanceof ImportFailure) {
          await this.finish(operatorId, row, 'FAILED', error.reason, []);
          this.failures.delete(importId);
          return true;
        }
        const count = (this.failures.get(importId) ?? 0) + 1;
        this.failures.set(importId, count);
        if (count >= MAX_CONSECUTIVE_FAILURES) {
          await this.finish(operatorId, row, 'FAILED', 'PROCESSING_ERROR', []);
          this.failures.delete(importId);
          return true;
        }
        throw error;
      }
    } finally {
      await lock.release();
    }
  }

  /** Traite tous les lots ; rend les `OfflineBatchResult` relus de la base. Lève `ImportFailure` si non reprenable. */
  private async apply(operatorId: string, row: ImportRow): Promise<unknown[]> {
    const terminal = await this.tx.run(operatorId, (client) =>
      readImportTerminal(client, row.device_id),
    );
    if (!terminal || terminal.ledgerId === null) throw new ImportFailure('DEVICE_UNAVAILABLE');
    let batches: ParsedBatch[];
    try {
      batches = parseStoredBatches(row.batches);
      // Signatures et chaîne revérifiées à l'exécution du travailleur aussi (rien n'est cru parce qu'une étape l'a fait).
      verifyImportBatches(batches, terminal);
    } catch (error) {
      if (error instanceof ProblemException) throw new ImportFailure(error.code);
      throw error;
    }
    const sorted = [...batches].sort((a, b) =>
      a.header.seqFrom < b.header.seqFrom ? -1 : a.header.seqFrom > b.header.seqFrom ? 1 : 0,
    );
    for (const batch of sorted) await this.applyBatch(operatorId, row.id, terminal, batch);
    // Chaque lot doit être COMPLETED, état relu (pas déduit de l'ouverture).
    const results: unknown[] = [];
    for (const batch of sorted) {
      const state = await this.runner.readState(operatorId, batch.header.batchId);
      if (!state || state.status !== 'COMPLETED') throw new ImportFailure('BATCH_NOT_COMPLETED');
      const body = await this.runner.response(operatorId, batch.header.batchId, false);
      if (body) results.push(body);
    }
    return results;
  }

  private async applyBatch(
    operatorId: string,
    importId: string,
    terminal: ImportTerminal,
    batch: ParsedBatch,
  ): Promise<void> {
    const { header } = batch;
    const chain = verifyChain(batch);
    const opened = await this.open(operatorId, importId, batch, chain.opHashes);
    if (opened.status === 'REJECTED')
      throw new ImportFailure(`BATCH_REJECTED_${opened.reject_reason ?? 'UNKNOWN'}`);
    // Lot déjà reçu par une autre voie (ou un autre import) : ses opérations ont leur résultat ; l'état final est
    // relu après la boucle, jamais déduit d'ici.
    if (opened.import_id !== importId || opened.status === 'COMPLETED') return;
    const ctx: BatchOpening = {
      batchId: header.batchId,
      deviceId: terminal.deviceId,
      operatorId,
      ledgerId: terminal.ledgerId!,
      serial: terminal.serial,
      receivedAt: opened.received_at,
      receivedVia: 'IMPORT',
      importId,
      authorityEpoch: header.authorityEpoch,
    };
    const { abandoned } = await this.runner.run(ctx, parsedOperations(batch));
    if (abandoned) throw new ImportFailure('BATCH_ABANDONED');
    try {
      await this.runner.complete(operatorId, header.batchId);
    } catch (error) {
      if (isSqlError(error) && error.code === 'CL001') throw new ImportFailure('BATCH_INCOMPLETE');
      throw error;
    }
  }

  private async open(
    operatorId: string,
    importId: string,
    batch: ParsedBatch,
    opHashes: Buffer[],
  ): Promise<{
    status: string;
    reject_reason: string | null;
    received_at: Date;
    import_id: string | null;
  }> {
    const { header } = batch;
    try {
      return await this.tx.run(operatorId, async (client) => {
        const { rows } = await client.query<{
          status: string;
          reject_reason: string | null;
          received_at: Date;
          import_id: string | null;
        }>(
          `SELECT status, reject_reason, received_at, import_id
             FROM open_imported_batch($1, $2, $3::bigint, $4, $5::bytea[], $6, $7)`,
          [
            importId,
            header.batchId,
            header.seqFrom.toString(),
            header.prevChainHash,
            opHashes,
            header.lastChainHash,
            Buffer.from(batch.signature, 'base64'),
          ],
        );
        return rows[0]!;
      });
    } catch (error) {
      // CL010 : un autre lot du terminal est en cours -> reprise au prochain passage (pas une fin).
      if (isSqlError(error) && error.code !== 'CL010') throw new ImportFailure(`SQL_${error.code}`);
      throw error;
    }
  }

  /** Clôture et audit dans la même transaction. */
  private async finish(
    operatorId: string,
    row: ImportRow,
    status: 'APPLIED' | 'FAILED',
    reason: string | null,
    results: unknown[],
  ): Promise<void> {
    await this.tx.run(operatorId, async (client) => {
      await client.query('SELECT finish_device_journal_import($1, $2, $3::jsonb)', [
        row.id,
        status,
        JSON.stringify({
          device_id: row.device_id,
          status,
          results,
          ...(reason !== null ? { reason } : {}),
        }),
      ]);
      await this.audit.record(client, {
        actorId: null,
        actorRole: null,
        origin: 'journal-import',
        requestId: null,
        operatorId,
        action: 'DEVICE_JOURNAL_IMPORTED',
        objectType: 'device_journal_import',
        objectId: row.id,
        approverId: row.approved_by,
        after: { import_id: row.id, device_id: row.device_id, status, reason },
      });
    });
  }
}
