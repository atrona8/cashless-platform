---
affected_files: []
cycle_number: 11
mission_slug: bracelets-nfc-01M4TD3W
reproduction_command:
reviewed_at: '2026-10-15T16:35:52Z'
reviewer_agent: claude
wp_id: WP20
---

# WP20 — réouverture après la vérification d'acceptation (15/10/2026) : documentation seulement

La vérification d'acceptation (`acceptance-matrix.json`) a donné 45 critères sur 46 en `pass`. Le porteur a tranché le 15/10/2026. **Ce cycle ne touche que la documentation : pas de code, pas de test, pas de droit de la base.** Seule exception : le test qui fige la limite d'OP-N61 (point 1), s'il est simple.

## 1. NFR-008 : écart consigné (décision du porteur)

La spécification demande que la clôture, le rattrapage du préchargement et le rechiffrement aillent au bout sur un lot de 5 000 bracelets. Ce qui est prouvé :
- la clôture sur 600 cautions (`batches.spec.ts`) ;
- le rechiffrement sur 1 200 bracelets en 3 tranches, avec reprise (`data-keys.spec.ts`) ;
- le rattrapage du préchargement sur 3 bracelets seulement.

À faire :
- Ouvrir **OP-N61** : risque, ce qui est en place (tranches, reprise, chiffres ci-dessus), mission qui le lève (**mission 13, recette V1** : preuve sur 5 000 bracelets), condition de levée. L'ajouter au tableau récapitulatif.
- Ajouter un **ADR** pour cet écart.
- Reporter dans `PROMPTS-A-ENVOYER.md` (mission 13) et dans `PRD.md` (héritages de la mission 4).
- Un test qui fige la limite n'a pas de sens ici, puisque la limite est un manque de preuve, pas un droit. Ne pas en écrire et dire pourquoi dans la fiche.

## 2. Points ouverts incomplets (règle 3 de CLAUDE.md)

Chaque écart accepté doit avoir une fiche complète : un ADR, une **mission** qui le lève, une condition de levée, et un report dans `PROMPTS-A-ENVOYER.md` et `PRD.md` pour cette mission.

- **OP-N54** (empreinte d'idempotence SHA-256 sans clé qui contient le code imprimé) : il manque l'ADR, la mission et les reports.
- **OP-N55** (espèces dues d'un bracelet remplacé) : il manque l'ADR. La mission 9 est déjà reportée dans le checkout principal ; vérifier que le report existe aussi dans les fichiers de la lane.
- **OP-N41, OP-N44, OP-N45, OP-N46, OP-N50** : leur champ « Levée par » nomme le porteur ou l'exploitation. Il faut le remplacer par la **mission du découpage** qui le lève (voir `PROMPTS-A-ENVOYER.md` et `PRD.md` §8), puis faire les reports.

Pour chaque mission choisie, écrire dans la fiche « proposé par l'agent, à confirmer par le porteur ». Choisir la mission la plus logique ; quelques pistes :
- l'adaptateur AWS KMS réel, après OP-N11 ;
- le registre d'idempotence, que touche la prochaine mission de paiement ;
- l'aiguillage des routes en déploiement, qui relève de la recette V1 ;
- l'`EXECUTE` via PUBLIC : la mission 5, avec OP-N59.

Ne pas modifier les fiches déjà complètes.

## Contraintes

- Fichiers : `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md` (numéros suivants libres, avec leurs lignes d'index), `PROMPTS-A-ENVOYER.md` et `PRD.md` dans la lane.
- Ne pas toucher au code.
- Lancer `lint` et `check:generated` pour vérifier que rien d'autre n'a bougé.
