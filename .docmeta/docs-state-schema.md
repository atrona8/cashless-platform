# Schéma de `docs/docs-state.json`

> Fichier de réglage : ajuste ici le schéma si le format doit évoluer.
> `spec-kitty-docs-maintain` lit et écrit ce fichier pour éviter de
> revérifier des missions déjà connues comme à jour. Il ne remplace jamais
> `docs/06-docs-status.md` (le registre lisible par un humain, avec
> justifications et journal narratif) : c'est un cache machine, compact,
> qui sert uniquement à court-circuiter les vérifications redondantes.

## Pourquoi ce fichier existe, et où il ne sert à rien

Deux déclencheurs de `spec-kitty-docs-maintain` balaient TOUTES les missions
du dépôt à chaque exécution (vérification pré-conclusion, audit périodique) :
sans ce fichier, ils rappellent le statut CLI de chaque mission et relisent
`spec.md`/`plan.md` à chaque fois, y compris pour des missions mergées et
stables depuis longtemps. Ce fichier permet de sauter cette revérification
pour toute mission déjà connue comme à jour.

**Ce fichier n'apporte rien pour les autres déclencheurs** : les addenda
post-plan et post-review opèrent sur une seule mission à la fois (pas un
balayage), et le déclencheur "nouveau besoin en conversation" ne concerne
aucune mission existante. Ne l'utilise pas ailleurs que dans les deux
déclencheurs de balayage ci-dessus, sous peine d'ajouter une lecture inutile.

## Schéma

```json
{
  "derniere_verification_globale": "2026-08-10T14:20:00Z",
  "missions": {
    "recherche-filtre-candidatures-01KYQ1HX": {
      "statut": "mergée",
      "verifie_le": "2026-08-05T10:00:00Z",
      "addendum_plan_applique": true,
      "addendum_review_applique": true,
      "spec_index_a_jour": true
    }
  }
}
```

## Règles d'usage pour `spec-kitty-docs-maintain`

- **Addenda post-plan et post-review** : à la toute fin de l'addendum, mets à
  jour (ou crée) l'entrée de la mission traitée avec le statut réel constaté
  à ce moment, `verifie_le` à l'heure courante, et les deux booléens
  d'addendum appliqué. Une seule entrée à écrire, pas de lecture préalable
  nécessaire : l'addendum vient déjà de constater ce statut par lui-même.
- **Vérification pré-conclusion** : lis d'abord ce fichier. Pour chaque
  mission dont `verifie_le` est postérieur au dernier changement connu de
  cette mission (ou dont le statut enregistré est déjà "mergée" et stable),
  ne rappelle pas le CLI. Ne rappelle le CLI et ne compare aux documents que
  pour les missions absentes du fichier ou dont l'état semble incertain.
  Si le nombre de dossiers sous `kitty-specs/*/` ne correspond plus au
  nombre de clés dans `missions`, traite ça comme un signal de désynchronisation
  et fais un balayage complet une fois, quel que soit `verifie_le`.
- **Audit périodique** : même logique, à plus grande échelle. Ne relis
  `spec.md`/`plan.md` en entier que pour les missions absentes du fichier,
  ou dont `verifie_le` est antérieur à la dernière modification connue de
  leurs fichiers sources. Après l'audit, mets à jour
  `derniere_verification_globale` et toutes les entrées revérifiées.
- **Ne jamais laisser ce fichier dériver silencieusement** : toute
  correction appliquée pendant une vérification pré-conclusion ou un audit
  doit être répercutée ici, sinon la prochaine passe se fiera à une
  information déjà fausse.
