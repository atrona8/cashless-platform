// `edgeDecisionOf` (constat 5 du cycle 1 de WP25) : la décision locale jointe à l'opération relayée au
// central. Seule la passerelle la pose ; une `edge_decision` portée par le terminal n'est jamais reprise.
import 'reflect-metadata';
import { edgeDecisionOf } from '../../src/operations/offline/offline-batches.service';
import type { LocalVerdict } from '../../src/operations/offline/offline-rules-runner';

const verdict = (over: Partial<LocalVerdict> = {}): LocalVerdict => ({
  status: 'ACCEPTED',
  rejectReason: null,
  detail: [],
  tapResult: null,
  amount: 500n,
  covered: 500n,
  shortfall: 0n,
  shortfallReason: null,
  paid: 500n,
  promo: 0n,
  walletId: null,
  mediaId: null,
  deltas: [],
  reverses: null,
  ...over,
});

const FORGED = { status: 'ACCEPTED', charged_to_wallet: 1, shortfall_amount: 0 };

describe('edgeDecisionOf', () => {
  it('REVERSAL accepté : montant de la contre-passation chargé au portefeuille, aucun manque', () => {
    expect(
      edgeDecisionOf({ amount: 500 }, 'REVERSAL', verdict({ amount: 500n, covered: 0n })),
    ).toEqual({ status: 'ACCEPTED', charged_to_wallet: 500, shortfall_amount: 0 });
  });

  it('REVERSAL : une décision falsifiée du terminal n’est pas reprise', () => {
    const d = edgeDecisionOf(
      { amount: 500, edge_decision: FORGED },
      'REVERSAL',
      verdict({ amount: 500n }),
    );
    expect(d).toEqual({ status: 'ACCEPTED', charged_to_wallet: 500, shortfall_amount: 0 });
  });

  it.each([undefined, null])(
    'opération sans montant (%s) : aucune décision, même si le terminal en porte une',
    (amount) => {
      const raw: Record<string, unknown> = { edge_decision: FORGED };
      if (amount !== undefined) raw.amount = amount;
      expect(edgeDecisionOf(raw, 'PURCHASE', verdict())).toBeNull();
      expect(edgeDecisionOf(raw, 'REVERSAL', verdict())).toBeNull();
      expect(edgeDecisionOf(raw, 'VOID', verdict({ status: 'REJECTED' }))).toBeNull();
    },
  );

  it('REJECTED sans raison : MALFORMED_OPERATION, rien chargé', () => {
    expect(
      edgeDecisionOf(
        { amount: 500 },
        'PURCHASE',
        verdict({ status: 'REJECTED', rejectReason: null }),
      ),
    ).toEqual({
      status: 'REJECTED',
      charged_to_wallet: 0,
      shortfall_amount: 0,
      reject_reason: 'MALFORMED_OPERATION',
    });
  });

  it('REJECTED avec raison : la raison de la passerelle est reprise, rien chargé', () => {
    const d = edgeDecisionOf(
      { amount: 500, edge_decision: FORGED },
      'PURCHASE',
      verdict({ status: 'REJECTED', rejectReason: 'MALFORMED_OPERATION', covered: 500n }),
    );
    expect(d).toMatchObject({ status: 'REJECTED', charged_to_wallet: 0, shortfall_amount: 0 });
  });

  it('PURCHASE avec manque : ACCEPTED_WITH_SHORTFALL et sa raison', () => {
    expect(
      edgeDecisionOf(
        { amount: 500 },
        'PURCHASE',
        verdict({ covered: 200n, shortfall: 300n, shortfallReason: null }),
      ),
    ).toEqual({
      status: 'ACCEPTED_WITH_SHORTFALL',
      charged_to_wallet: 200,
      shortfall_amount: 300,
      shortfall_reason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('VOID avec montant hostile : la décision ne charge que ce que la passerelle a couvert', () => {
    expect(
      edgeDecisionOf({ amount: 10 ** 9 }, 'VOID', verdict({ amount: 0n, covered: 0n })),
    ).toEqual({ status: 'ACCEPTED', charged_to_wallet: 0, shortfall_amount: 0 });
  });
});
