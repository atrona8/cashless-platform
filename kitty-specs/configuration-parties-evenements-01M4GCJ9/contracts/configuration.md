# Contrat — Cascade, bornes, versions et actions à deux

## Cascade

- Résolution d'une clé à une date `t` : pour chaque niveau `PLATFORM → OPERATOR → ORGANIZER → EVENT →
  PARTICIPATION`, dernière `config_version` avec `valid_from ≤ t` ; la valeur du niveau le plus précis qui définit la
  clé l'emporte ; sinon le défaut du catalogue (marqué `provisional` s'il vient de §17.2).
- Chaque écriture d'un niveau crée la version n+1 (contenu complet du niveau, pas un différentiel) et une ligne
  d'audit (avant = version n, après = version n+1). Conflit de version : `409 CONFLICT_STATE`.
- L'événement : chaque `PATCH` accepté (ou chaque exécution d'approbation) met à jour les colonnes et crée une
  version `EVENT` dont `settings` contient aussi l'instantané des réglages portés par des colonnes.

## Bornes

Ordre des contrôles d'une valeur : type → bornes fixes (catalogue, = CHECK du schéma) → maximum fixé par un niveau
supérieur (configuration résolue) → profil de législation de l'événement. Premier échec : `422 VALIDATION_FAILED`,
`detail` localisé, extension `violations[]` : `{ field, rule, requested, limit, source }` (ex. `{ field:
"refund_deadline", rule: "jurisdiction.min_refund_window_days", requested: "2027-01-30T00:00:00Z", limit:
"2027-03-31T00:00:00Z", source: "SN v1" }`).

## Qui règle quoi

Une clé modifiée par un rôle qui ne la règle pas : `403 FORBIDDEN`, aucune modification. Une requête qui mêle des
clés de deux rôles : `422` (deux demandes distinctes).

## Actions à deux de la mission

Liste et rôles : `research.md` R-09. Le `payload` figé contient la modification exacte et la version de
configuration (ou de contrat, ou de profil) en vigueur à la demande ; à l'exécution, si cette version n'est plus la
dernière, la demande passe `FAILED` (`CONFLICT_STATE`, « la configuration a changé depuis la demande »).

## Immuabilité

Contrats, versions de configuration, profils de législation, règles de frais : jamais modifiés. Remplacer une règle
de frais = fermer l'ancienne (`valid_to` = date d'effet de la nouvelle) et créer la nouvelle (version + 1), dans la
même transaction.
