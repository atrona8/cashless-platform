# NFR-003 : inventaire des allers-retours d'un lot (04/11/2026)

Décision du porteur (04/11) : tenir NFR-003 (lot de 500 opérations en 60 s au p95) en **réduisant les allers-retours**.

## Mesure

Lot de 100 ventes (après un lot de mise en route), requêtes comptées en interceptant `pg.Client.query` (test jetable,
supprimé) : **9,4 s, 4 850 requêtes, 48,5 par opération**, ~1,5 ms par requête vue du client (aller-retour hôte ↔ VM
colima compris). Seule requête coûteuse en base : `offline_device_exposure` (13 ms par opération).

| Groupe | Requêtes / op | Détail |
|---|---|---|
| Transactions | 6,3 | `BEGIN`, `set_config`, `COMMIT` × 2,1 : une transaction **rien que pour relire l'état du lot** (`currentStatus` dans `batch-runner.ts`, + `offline_batch_state`), puis celle de l'opération |
| Points de reprise | 2 | `SAVEPOINT` / `RELEASE` par opération |
| Verrou, registre | 3 | `lock_device`, recherche au registre, verrou consultatif `engine-key` |
| Entrées de conformité | ~13 | statut daté du terminal, politique hors ligne, méta du snapshot, plancher d'accusé, état du bracelet, session vendeur, exposition, dépensable, statut du portefeuille, média, terminal |
| Données de référence du moteur | ~15 | grand livre/événement (×2), contrat, juridiction, compte `PLT_REDEV`, `fee_rule`, `merchant_participation`, `config_version` (×3), `SELECT * FROM event`, comptes, soldes (×2) |
| Idempotence | 2 | `journal_transaction` par clé, lu **deux fois** (processeur, puis moteur) |
| Écritures | 6 | `post_transaction`, `register_tap`, `consume_tap`, attribution, `record_device_seq`, `record_offline_op_result` |

## Découpage proposé (chaque étape mesurée seule : comptage + série NFR-003)

1. **Sans effet sur les contrôles (~5 requêtes / op).** État du lot relu dans la transaction de l'opération (plus de
   transaction à part : −3) ; une seule lecture d'idempotence (−1) ; une seule lecture de l'événement (−1).
2. **Données de référence du lot (~10 requêtes / op).** Lues une fois par lot : grand livre, événement, contrat,
   juridiction, compte `PLT_REDEV`, participation. Uniquement des données qui ne dépendent pas de l'heure de
   l'opération. **Pas de mémoire** sur la configuration datée (`config_version` à l'heure de l'opération), ni sur
   les entrées de conformité (statut, limites, exposition, solde) : relues à chaque opération comme aujourd'hui.
3. **Entrées de conformité en une fonction SQL (~11 requêtes / op).** Déjà tenté en part F (`5a2d0414`) : durée ×3,
   annulé sans diagnostic. À ne reprendre qu'après avoir compris la cause (plan de la requête combinée), sinon écarté.

Gain estimé si 1 et 2 seuls : ~15 requêtes / op, soit ~20 ms par opération sur ce poste, ~10 s sur un lot de 500.
Le p95 local est de 68,3 s : 1 et 2 ne suffisent probablement pas seuls, l'étape 3 (ou son équivalent) sera
nécessaire.

Fichiers à faire relire par une personne : `offline-operation.processor.ts`, `compliance-input.reader.ts`, et toute
fonction SQL de l'étape 3.
