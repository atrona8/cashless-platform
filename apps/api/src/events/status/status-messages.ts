// Textes des conditions de passage de statut (FR-017, NFR-005) : choisis par le `code` de la condition, en français
// et en anglais, jamais repris d'un message SQL. Deux textes par condition : remplie, non remplie.
import type { Language } from '../../http/language';

type Texts = Record<Language, { met: string; unmet: string }>;

const TEXTS: Record<string, Texts> = {
  TRANSITION_ALLOWED: {
    fr: { met: 'Ce passage est prévu depuis le statut actuel.', unmet: 'Ce passage n\'est pas prévu depuis le statut actuel (aucun retour en arrière).' },
    en: { met: 'This transition is allowed from the current status.', unmet: 'This transition is not allowed from the current status (no going back).' },
  },
  DEVICES_CAUGHT_UP: {
    fr: { met: 'Les terminaux ont tout remonté, ou la date limite de synchronisation est passée.', unmet: 'Des terminaux n\'ont pas encore tout remonté avant la date limite de synchronisation.' },
    en: { met: 'All devices have synced, or the sync deadline has passed.', unmet: 'Some devices have not finished syncing before the sync deadline.' },
  },
  DEBIT_AUTHORITY_CENTRAL: {
    fr: { met: 'L\'autorité de débit est au serveur central.', unmet: 'Une passerelle locale détient encore l\'autorité de débit : la rendre au central d\'abord.' },
    en: { met: 'Debit authority is held by the central server.', unmet: 'A local gateway still holds debit authority: hand it back to central first.' },
  },
  SUSPENSE_ZERO: {
    fr: { met: 'Le compte d\'attente est soldé.', unmet: 'Le compte d\'attente n\'est pas soldé : des anomalies restent à résoudre.' },
    en: { met: 'The suspense account is cleared.', unmet: 'The suspense account is not cleared: some anomalies are still open.' },
  },
  PARTY_POSITIONS_ZERO: {
    fr: { met: 'Commerçants, prestataire et plateforme sont soldés.', unmet: 'Un commerçant, le prestataire ou la plateforme a encore un droit net non nul.' },
    en: { met: 'Merchants, operator and platform are settled.', unmet: 'A merchant, the operator or the platform still has a non-zero net claim.' },
  },
  PAYOUT_PENDING_ZERO: {
    fr: { met: 'Aucun versement n\'est en cours.', unmet: 'Des versements initiés ne sont pas encore confirmés.' },
    en: { met: 'No payout is pending.', unmet: 'Some initiated payouts are not confirmed yet.' },
  },
  POSITIONS_SETTLED: {
    fr: { met: 'Toutes les positions sont soldées.', unmet: 'Des positions ne sont pas soldées, hors soldes restants autorisés.' },
    en: { met: 'All positions are settled.', unmet: 'Some positions are not settled, beyond the remaining balances allowed.' },
  },
  FUNDS_HOLDER_SET: {
    fr: { met: 'Le détenteur des fonds est désigné.', unmet: 'Le détenteur des fonds n\'est pas désigné (partie tierce manquante).' },
    en: { met: 'The funds holder is set.', unmet: 'The funds holder is not set (third party missing).' },
  },
  CONTRACT_IN_FORCE: {
    fr: { met: 'Un contrat prestataire–organisateur en vigueur est rattaché à l\'événement.', unmet: 'Aucun contrat prestataire–organisateur en vigueur n\'est rattaché à l\'événement.' },
    en: { met: 'An operator–organizer contract in force is attached to the event.', unmet: 'No operator–organizer contract in force is attached to the event.' },
  },
  JURISDICTION_SET: {
    fr: { met: 'Le profil de législation de l\'événement est en vigueur.', unmet: 'Le profil de législation de l\'événement n\'est pas encore en vigueur.' },
    en: { met: 'The event jurisdiction profile is in force.', unmet: 'The event jurisdiction profile is not in force yet.' },
  },
  LEDGER_OPEN: {
    fr: { met: 'Le grand livre de l\'événement est ouvert.', unmet: 'Le grand livre de l\'événement n\'est pas ouvert.' },
    en: { met: 'The event ledger is open.', unmet: 'The event ledger is not open.' },
  },
  CASH_DESKS_COUNTED: {
    fr: { met: '', unmet: 'Caisses comptées : pas encore calculable par le système.' },
    en: { met: '', unmet: 'Cash desks counted: not computable by the system yet.' },
  },
  PSP_RECONCILED: {
    fr: { met: '', unmet: 'Prestataires de paiement rapprochés : pas encore calculable par le système.' },
    en: { met: '', unmet: 'Payment providers reconciled: not computable by the system yet.' },
  },
  DEVICES_REPORTED: {
    fr: { met: '', unmet: 'Terminaux synchronisés : pas encore calculable par le système.' },
    en: { met: '', unmet: 'Devices synced: not computable by the system yet.' },
  },
};

export function conditionText(code: string, met: boolean | null, language: Language): string {
  const texts = TEXTS[code]?.[language];
  if (!texts) return code;
  return met === true ? texts.met : texts.unmet;
}

export const CONDITION_CODES: readonly string[] = Object.keys(TEXTS);
