// Décor commun des suites de levée de trou et d'import du journal (mission 7, lot WP20). Jeu d'essai du traitement
// (WP19) auquel s'ajoutent des superviseurs, les appels de personne (jeton d'accès), la révocation d'un terminal et
// l'attente du travailleur. Chaque suite crée son PROPRE prestataire, terminaux et personnes : aucune affirmation
// globale (le travailleur `journal-import` traite toute la base, y compris l'import d'une autre suite en parallèle).
import { randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { JournalImportWorker } from '../../../src/offline/journal/journal-import.worker';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';
import type { PayMedia } from '../payments/payments-fixtures';
import { ProcessingWorld, type OfflineTerminal } from './processing-fixtures';

export interface ImportRow {
  id: string;
  status: string;
  approved_by: string | null;
  requested_by: string;
  result: { results?: unknown[]; reason?: string } | null;
}

export class JournalWorld {
  pw!: ProcessingWorld;
  sup1!: TestPerson;
  sup2!: TestPerson;
  sup3!: TestPerson;
  /** SUPERVISOR d'un AUTRE prestataire. */
  supForeign!: TestPerson;

  static async create(): Promise<JournalWorld> {
    const world = new JournalWorld();
    world.pw = await ProcessingWorld.create();
    const { w } = world.pw.pw;
    await withOwner(async (db) => {
      const supervisor = (operatorId: string, scopeId: string) =>
        w.idp.createPerson(db, {
          operatorId,
          roles: [{ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId }],
        });
      world.sup1 = await supervisor(w.ops.a, w.ids.organizerA);
      world.sup2 = await supervisor(w.ops.a, w.ids.organizerA);
      world.sup3 = await supervisor(w.ops.a, w.ids.organizerA);
      world.supForeign = await supervisor(w.ops.b, w.ids.organizerB);
    });
    return world;
  }

  close(): Promise<void> {
    return this.pw.close();
  }

  get w() {
    return this.pw.pw.w;
  }
  get api() {
    return this.pw.pw.api;
  }
  get worker(): JournalImportWorker {
    return this.api.app.get(JournalImportWorker, { strict: false });
  }

  /** Appel d'une personne (jeton d'accès) ; `body` chaîne = texte envoyé tel quel. */
  bo(
    method: 'GET' | 'POST',
    path: string,
    who: TestPerson,
    body?: unknown,
    key: string | null = method === 'POST' ? randomUUID() : null,
    extra: Record<string, string> = {},
  ): Promise<TerminalResponse> {
    const payload =
      method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body ?? {})) : '';
    return send(
      {
        url: new URL(`${this.api.baseUrl}${path}`),
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
          ...extra,
        },
        body: payload,
        cert: null,
        key: null,
      },
      this.api.tls.serverCaPem,
    );
  }

  approve(id: unknown, who: TestPerson): Promise<TerminalResponse> {
    return this.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  }

  async revoke(t: OfflineTerminal): Promise<void> {
    await withOwner((db) => t.t.setStatus(db, 'REVOKED'));
  }

  requestImport(
    who: TestPerson,
    deviceId: string,
    batches: unknown[],
    reason = 'Import du journal après perte du terminal',
    key: string = randomUUID(),
  ): Promise<TerminalResponse> {
    return this.bo('POST', `/devices/${deviceId}/journal-imports`, who, { batches, reason }, key);
  }

  importRow(importId: string): Promise<ImportRow | undefined> {
    return ownerRows<ImportRow>(
      'SELECT id, status, approved_by, requested_by, result FROM device_journal_import WHERE id = $1',
      [importId],
    ).then((r) => r[0]);
  }

  requestRow(requestId: unknown) {
    return ownerRows<{
      status: string;
      failure_code: string | null;
      target_id: string;
      payload: Record<string, unknown>;
      result: Record<string, unknown> | null;
    }>(
      'SELECT status, failure_code, target_id, payload, result FROM approval_request WHERE id = $1',
      [requestId],
    ).then((r) => r[0]!);
  }

  /** Passe le travailleur jusqu'à ce que l'import soit clos (un autre travailleur peut le prendre en parallèle). */
  async runUntilFinal(importId: string, timeoutMs = 90_000): Promise<ImportRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.worker.runOnce();
      const row = await this.importRow(importId);
      if (row && (row.status === 'APPLIED' || row.status === 'FAILED')) return row;
      if (Date.now() > deadline) throw new Error(`import ${importId} non clos : ${row?.status}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Terminal doté de bracelets, d'un snapshot et d'une politique : prêt à exporter des ventes. */
  async seller(count = 2, funds = 20_000) {
    const t = await this.pw.terminal();
    const media = await this.pw.pw.media(count, funds);
    const version = await this.pw.snapshot(t, media);
    return { t, media, version };
  }

  /** Export d'un terminal : un lot signé par tranche d'opérations (non envoyé au serveur). */
  exportBatches(
    t: OfflineTerminal,
    groups: Array<Array<Record<string, unknown> & { type: string; occurred_at: string }>>,
    options: { batchIds?: string[] } = {},
  ) {
    return groups.map((ops, i) =>
      t.t.buildBatch(ops, {
        ledgerId: this.pw.ledgerId,
        ...(options.batchIds?.[i] ? { batchId: options.batchIds[i] } : {}),
      }),
    );
  }

  sale(
    t: OfflineTerminal,
    m: PayMedia,
    amount: number,
    version: number,
    agoSeconds = 30,
  ): Record<string, unknown> & { type: string; occurred_at: string } {
    return this.pw.sale(t, m, amount, version, {}, agoSeconds);
  }

  /** Empreinte attendue d'un export (JCS des lots tels que stockés). */
  static sha(stored: unknown): string {
    return createHash('sha256').update(canonicalize(stored)!, 'utf8').digest('hex');
  }
}
