# Instructions projet — Cashless Platform (système cashless multi-tenant)

Ce projet suit une méthodologie de documentation continue décrite dans
`docs/00-README-onboarding.md`. Les réglages de comportement (quel outil de
diagramme utiliser, forme des docs de mission, logique des mises à jour) sont
dans `.docmeta/` — à consulter/éditer si le comportement doit être ajusté.

Ce projet dispose aussi d'un skill `spec-kitty-docs-maintain` (dans
`.claude/skills/`) qui doit se déclencher automatiquement dès qu'une mission
franchit un jalon clé (plan finalisé, review terminée, acceptée, mergée) pour
maintenir la documentation à jour.

**Important, quel que soit le skill ou la méthode que tu utilises pour piloter
une mission** : ce déclenchement automatique est fiable si tu utilises les
slash-commands (`/spec-kitty.plan`, `/spec-kitty.review`). Si tu pilotes la
mission autrement — boucle CLI bas niveau (`spec-kitty agent action
implement/review`, `spec-kitty accept`, `spec-kitty merge`) ou un autre skill
d'orchestration (ex: `spec-kitty-implement-review`) — **rien ne garantit que
`spec-kitty-docs-maintain` se déclenche tout seul**. Dans ce cas, invoque-le
toi-même explicitement juste après le jalon "plan finalisé" et juste après le
jalon "review terminée", avant `spec-kitty accept`/`spec-kitty merge`. C'est
une défaillance déjà observée sur ce type de projet : une mission menée en
boucle CLI, correctement implémentée et mergée, mais dont la documentation
n'a jamais été mise à jour parce que le déclencheur automatique n'a
littéralement jamais eu l'occasion de s'activer.

Si tu n'es pas certain que la doc d'une mission a déjà été traitée, vérifie la
section "Journal des mises à jour" de `docs/06-docs-status.md` plutôt que de
supposer — et si une mission apparaît acceptée ou mergée côté Spec Kitty sans
ligne "Résultat: Mis à jour" correspondante pour son jalon post-review,
traite-la comme en retard de documentation et rattrape l'addendum
immédiatement.

## Nouveau cas d'usage évoqué en conversation, avant même une mission

Tout ce qui précède couvre la chaîne une fois une mission déjà lancée
(specify→plan→tasks→implement→review→accept→merge). **Il existe une étape
encore plus en amont, non couverte par les déclencheurs habituels** : quand
l'utilisateur propose, au fil de la conversation, un nouveau besoin
fonctionnel susceptible de devenir une mission — avant tout `/spec-kitty.specify`,
donc avant qu'aucune commande Spec Kitty n'ait encore été exécutée pour ce
besoin.

**Dès qu'un tel besoin est identifié comme suffisamment concret pour devenir
une mission**, avant ou au moment du `/spec-kitty.specify` correspondant, fais
les deux mises à jour suivantes **dans le même geste**, pas après coup :
1. Ajoute une nouvelle entrée à `PROMPTS-A-ENVOYER.md` (section "Mission N"
   dupliquée depuis le modèle en fin de fichier), avec les commandes réelles
   déjà rédigées comme pour les missions du découpage initial.
2. Enrichis la section correspondante de `PRD.md` (périmètre fonctionnel,
   flux critiques, etc.) avec ce nouveau besoin, pour que `PRD.md` reste la
   source de vérité du besoin plutôt qu'un instantané figé du jour de
   l'initialisation.

Ne compte pas sur un audit ultérieur pour rattraper ça : un besoin décidé en
conversation et jamais reporté dans `PROMPTS-A-ENVOYER.md`/`PRD.md` reste
invisible à toute vérification de cohérence basée sur ces fichiers, y compris
l'audit périodique de `spec-kitty-docs-maintain`, qui compare l'état réel des
missions à la documentation mais ne peut pas détecter une mission qui n'a
jamais été consignée nulle part avant son lancement.

## Sources normatives du projet

Avant toute mission, lire `README.md` (kit de départ, à la racine) puis `docs/SPECIFICATION.md`. En cas de
contradiction, appliquer la règle de priorité de `SPECIFICATION.md` §0.3 (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`) et signaler la contradiction, sans choisir en
silence. Ne jamais modifier les fichiers `.sql` générés de `packages/ledger-sql/` : modifier les générateurs
(`gen_tests.py`, `gen_golden.py`) ou `scenario_reference.json`.
