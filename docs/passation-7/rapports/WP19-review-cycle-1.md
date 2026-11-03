# Constats relecture WP19 (commit 603848fa)

1. BLOQUANT (fonctionnel) : une REVERSAL conforme au contrat (exemple openapi seq 88 : sans `tap`, sans `currency`,
   sans `amount`) est TOUJOURS rejetee (`CURRENCY_MISMATCH`, detail `MEDIA_NOT_IN_SNAPSHOT,PACK_NOT_VERIFIED`) :
   `complianceInput` n'alimente ni devise, ni bracelet, ni pack pour une annulation. Les tests ne couvrent qu'une
   annulation qui recopie le `tap` et la devise d'une vente. Correction : pour REVERSAL, devise = celle du grand
   livre / de la vente visee, bracelet = celui de la vente visee (`target.mediaId`), `pack_verified` non exige
   (la lecture n'existe pas) ; test avec l'operation EXACTE de l'exemple openapi.
2. AFFAIBLIT (porteur) : `detectInversions` jamais appele ; aucune anomalie `CLOCK_SKEW` pour une inversion de dates
   (FR-025, compliance.md l.45, R-30). Resultat inchange par la spec, donc pas d'argent en jeu, mais controle reporte
   sans accord. Options : (a) ajouter `inversions` a BatchContext / calcul par WP18 puis ouverture ici ; (b) calcul
   dans le processeur (lecture des numeros precedents du registre) ; (c) accepter la dette (ADR + POINTS_OUVERTS + test
   qui echoue si elle s'elargit, WP qui la leve).
3. Test M7 survivant : `reduceShortfallOfReversedSale(..., original, original)` (mauvaise tx d'annulation) passe tous
   les tests : asserter `detail.reductions[].reversal_tx` et `resolution_tx_id` = la transaction d'annulation, hors
   ligne ET via `reversal.service.ts`.
4. Test M6 survivant : tolerance de `p_before` dans `blockTime` non testee (blocage a +100 s / +130 s de l'operation).
5. Mineur : test `TOPUP_CASH` ne distingue pas l'arret anticipe du processeur de `checkCompliance` (mutant vivant,
   comportement equivalent sauf CONFIRMED + transaction existante => DUPLICATE au lieu de rejet).

## Décisions du porteur (03/11/2026) — à appliquer au cycle 2
1. Inversions de dates (FR-025) : BRANCHER VIA WP18. Ajouter la liste des inversions à `BatchContext`
   (`offline/batches/batch.types.ts`, calculée dans la boucle de WP18 par `detectInversions`) — retouche hors carte
   d'un lot approuvé, à lister au compte rendu — puis ouvrir l'anomalie `CLOCK_SKEW` d'inversion dans WP19 (codes
   seulement dans `detail`). Tests : inversion dans un lot → une anomalie, idempotente au renvoi ; résultat des
   opérations inchangé.
2. REVERSAL : SUIVRE LE CONTRAT (B1). Annulation acceptée sans tap re-présenté, sans devise ni montant (exemple
   `openapi.yaml`, seq 88) : devise du grand livre, bracelet de la vente visée (`target.mediaId`), pas de pack exigé ;
   cible limitée à une vente du même terminal (inchangé). Test avec l'opération exacte de l'exemple.
3. Tests à ajouter : M7 (vérifier `detail.reductions[].reversal_tx` et `resolution_tx_id`, hors ligne et via
   `reversal.service.ts`) ; M6 (blocage à +100 s et +130 s autour de la tolérance de `p_before`).
