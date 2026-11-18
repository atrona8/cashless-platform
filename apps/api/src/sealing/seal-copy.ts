// Port de la copie externe des scellements (mission 9b, WP12 ; FR-020, NFR-005, interfaces.md IC-08). Un scellement
// (grand livre ou chaîne d'audit) laisse une empreinte dans la base ; la copie externe, hors de portée de la base,
// permet de détecter une réécriture complète de la base. L'adaptateur réel (stockage à écriture unique) est la
// mission 12b : seul `FakeSealCopy` existe, refusé en production (`createSealCopy`, `assertProcessIsSafe`).
export type SealKind = 'LEDGER' | 'AUDIT';

/** Identité d'un scellement : type, identifiant (grand livre ou chaîne d'audit) et numéro. */
export interface SealIdentity {
  kind: SealKind;
  id: string;
  sealNo: number;
}

export interface SealExternalCopy {
  /** Un faux ne prouve rien : la vérification rend « copie simulée », jamais « conforme ». */
  readonly isFake?: boolean;
  /** Écrit l'empreinte du scellement ; rend la référence externe (clé d'objet, jamais un secret). */
  write(seal: SealIdentity, sealHash: Buffer): Promise<string>;
  /** Relit l'empreinte copiée par sa référence ; `null` si la copie est introuvable. */
  read(ref: string): Promise<Buffer | null>;
}
