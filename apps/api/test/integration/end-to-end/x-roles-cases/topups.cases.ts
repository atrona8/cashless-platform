// Cas de la matrice x-roles : topups (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'createCashTopup',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/topups/cash`,
      body: { tap: fx.tap(), amount: 1000, currency: 'XOF', occurred_at: new Date().toISOString() },
    }),
  },
  {
    operationId: 'initiatePspTopup',
    unplayable:
      'Le chemin de guichet de la garde PSP exige un marqueur de terminal (certificat client ou Signature) que le faux d’identité en clair ne présente pas : 401 avant tout contrôle de rôle. Preuve : topup-isolation (HTTPS, identité réelle) ; limite reprise en WP11.',
  },
  {
    operationId: 'getPspTopup',
    unplayable:
      'Le chemin de guichet de la garde PSP exige un marqueur de terminal (certificat client ou Signature) que le faux d’identité en clair ne présente pas : 401 avant tout contrôle de rôle. Preuve : topup-isolation (HTTPS, identité réelle) ; limite reprise en WP11.',
  },
  {
    operationId: 'cancelPspTopup',
    unplayable:
      'Le chemin de guichet de la garde PSP exige un marqueur de terminal (certificat client ou Signature) que le faux d’identité en clair ne présente pas : 401 avant tout contrôle de rôle. Preuve : topup-isolation (HTTPS, identité réelle) ; limite reprise en WP11.',
  },
];
