// Corps complet du `409 DEBIT_AUTHORITY_EDGE` (mission passerelle-locale, lot WP11, T049 ; edge-routes.md « Corps du
// 409 »). Chaque chemin HTTP de débit de `DEBIT_PATHS`, sous EDGE, répond avec `edge_base_url` et `authority_epoch`
// exacts et `retryable: true` ; le corps respecte le schéma `Problem` ; sans certitude sur le grand livre ou sans
// autorité EDGE, le corps garde son ancienne forme ; `DEBIT_AUTHORITY_MOVING` ne change pas. Aucun code ni statut.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { DEBIT_PATHS } from '../../../src/debit-authority/debit-paths';
import {
  EdgeConflictEnricher,
  edgeConflictExtensions,
} from '../../../src/debit-authority/edge-conflict';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { ProblemFilter } from '../../../src/errors/problem.filter';
import { contractViolations } from '../../support/contract-schema';
import { DebitCases, HTTP_DEBIT_CASES } from './debit-cases';
import { DebitWorld } from './debit-authority-world';

jest.setTimeout(300_000);

describe('corps du 409 DEBIT_AUTHORITY_EDGE (WP11, T049)', () => {
  let dw: DebitWorld;
  let cases: DebitCases;
  beforeAll(async () => {
    dw = await DebitWorld.create();
    cases = new DebitCases(dw);
    await cases.init();
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  it('la suite couvre exactement les chemins HTTP de débit de la liste', () => {
    const listed = DEBIT_PATHS.filter((p) => p.kind === 'DEBIT' && p.layer === 'HTTP')
      .map((p) => p.operationId)
      .sort();
    expect(listed).toEqual([...HTTP_DEBIT_CASES].sort());
  });

  it.each(HTTP_DEBIT_CASES)(
    '%s : edge_base_url, authority_epoch exacts, retryable: true',
    async (op) => {
      const prepared = await cases.prepare(op);
      const { gateway } = await dw.edgeActive();
      const { authority_epoch: epoch } = await dw.authority();
      const res = await prepared.run(epoch);
      expect([op, res.status, res.body.code]).toEqual([op, 409, 'DEBIT_AUTHORITY_EDGE']);
      expect(res.body).toMatchObject({
        edge_base_url: gateway.lanUrl,
        authority_epoch: epoch,
        retryable: true,
      });
      // Schéma `Problem` : `request_id` est posé par le filtre sous `instance` (écart antérieur, voir payments.spec),
      // et `edge_base_url` n'est pas une propriété déclarée de `Problem` bien que l'exemple `edge` du contrat la porte
      // (`additionalProperties` ouvert) : seules ces deux remarques sont tolérées, rien d'autre.
      expect(
        contractViolations('Problem', { ...res.body, request_id: randomUUID() }).filter(
          (violation) => violation !== 'Problem.edge_base_url : hors contrat',
        ),
      ).toEqual([]);
      expect(res.headers['content-type']).toContain('application/problem+json');
    },
  );

  describe('jamais un champ faux', () => {
    it('grand livre CENTRAL à la lecture : aucune extension', async () => {
      const tx = dw.pw.api.app.get(TenantTx, { strict: false });
      expect(
        await tx.run(dw.pw.w.ops.a, (client) => edgeConflictExtensions(client, dw.ledger)),
      ).toBeNull();
      await dw.edgeActive();
      const { authority_epoch: epoch } = await dw.authority();
      expect(
        await tx.run(dw.pw.w.ops.a, (client) => edgeConflictExtensions(client, dw.ledger)),
      ).toEqual({
        edge_base_url: expect.stringMatching(/^https:\/\/10\.0\.0\./),
        authority_epoch: epoch,
      });
    });

    const run = async (error: unknown, req: Partial<Request>, enrich = true) => {
      const moduleRef = {
        get: (token: unknown) => {
          if (!enrich) throw new Error('lecture interdite');
          if (token === TenantTx) return dw.pw.api.app.get(TenantTx, { strict: false });
          return { current: () => ({ operatorId: dw.pw.w.ops.a }) };
        },
      } as unknown as ModuleRef;
      const sent: { status?: number; body?: Record<string, unknown> } = {};
      const res = {
        setHeader: () => undefined,
        status(code: number) {
          sent.status = code;
          return this;
        },
        type() {
          return this;
        },
        send(text: string) {
          sent.body = JSON.parse(text) as Record<string, unknown>;
        },
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ header: () => undefined, params: {}, ...req }),
          getResponse: () => res,
        }),
      };
      const config = { problemTypeBase: 'https://errors.cashless/' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await new ProblemFilter(config as any, moduleRef).catch(error, host as any);
      return sent;
    };

    it('grand livre non retrouvé (plusieurs EDGE, aucun chemin ni terminal) : ancienne forme du corps', async () => {
      await dw.edgeActive();
      // Le prestataire n'a qu'un grand livre EDGE : retrouvé. Sans contexte de prestataire : rien.
      const found = await run(new ProblemException('DEBIT_AUTHORITY_EDGE'), {});
      expect(found.body).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', retryable: true });
      const lost = await run(new ProblemException('DEBIT_AUTHORITY_EDGE'), {}, false);
      expect(lost.status).toBe(409);
      expect(lost.body).not.toHaveProperty('edge_base_url');
      expect(lost.body).not.toHaveProperty('authority_epoch');
      expect(lost.body).not.toHaveProperty('retryable');
    });

    it('sous CENTRAL (bascule rendue entre-temps) : aucune extension', async () => {
      const sent = await run(new ProblemException('DEBIT_AUTHORITY_EDGE'), {
        params: { ledger_id: dw.ledger },
      });
      expect(sent.body).not.toHaveProperty('edge_base_url');
      expect(sent.body).not.toHaveProperty('authority_epoch');
    });

    it('DEBIT_AUTHORITY_MOVING et les autres codes : corps inchangés, aucune lecture', async () => {
      await dw.edgeActive();
      for (const code of [
        'DEBIT_AUTHORITY_MOVING',
        'STALE_AUTHORITY_EPOCH',
        'CONFLICT_STATE',
      ] as const) {
        const sent = await run(
          new ProblemException(code),
          { params: { ledger_id: dw.ledger } },
          false,
        );
        expect(sent.body).toMatchObject({ code });
        expect(sent.body).not.toHaveProperty('edge_base_url');
        expect(sent.body).not.toHaveProperty('retryable');
      }
    });

    it('un CL006 brut de la base est complété comme le refus levé à la main', async () => {
      await dw.edgeActive();
      const { authority_epoch: epoch } = await dw.authority();
      const sent = await run(Object.assign(new Error('x'), { code: 'CL006' }), {
        params: { ledger_id: dw.ledger },
      });
      expect(sent.status).toBe(409);
      expect(sent.body).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', authority_epoch: epoch });
    });

    it('l’enrichisseur ne lit rien sans contexte de prestataire (requête non authentifiée)', async () => {
      const moduleRef = {
        get: (token: unknown) => {
          if (token === TenantTx) return dw.pw.api.app.get(TenantTx, { strict: false });
          return {
            current: () => {
              throw new ProblemException('UNAUTHENTICATED');
            },
          };
        },
      } as unknown as ModuleRef;
      expect(
        await new EdgeConflictEnricher(moduleRef).extensionsFor({ params: {} } as Request),
      ).toBeNull();
    });
  });
});
