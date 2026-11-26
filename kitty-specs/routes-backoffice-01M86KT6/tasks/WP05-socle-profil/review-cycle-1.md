---
affected_files: []
cycle_number: 1
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T09:49:20Z'
reviewer_agent: claude
wp_id: WP05
---

# Relecture WP05 : retour

1. (a corriger, moyen) Mutation survivante. Dans `staff-profile.service.ts`, remplacer `WHERE id = $1` par une requete qui
   renvoie une autre ligne de `app_user` du meme prestataire (ex. `WHERE $1::uuid IS NOT NULL ORDER BY id DESC LIMIT 1`) :
   les 14 tests de `staff-profile.spec.ts` et `backoffice-isolation.spec.ts` restent verts, car toutes les personnes de test
   ont le meme `display_name` ('Personne de test'). Correction : donner un `display_name` distinct a chaque personne de
   `staff-profile.spec.ts` (multi, autre personne du meme prestataire) et asserter le nom exact ; rejouer la mutation et la noter.
2. (mineur) Detection des routes servies : avec `shape` rendu neutre (les `{x}` / `:x` non normalises), les 10 operations
   sont toutes « non servies » et le balayage reste vert, car seul `getStaffProfile` (sans parametre) est asserte servi. Ajouter
   un test de la detection sur une route a parametre deja servie (ex. une operation existante du contrat avec `{media_id}`).
3. (mineur, compte rendu) La note dit que `/staff/me` echoue dans le processus de personnalisation : mesure faite, elle y repond 200
   avec le seul profil de l'appelant (`cashless_perso` a SELECT sur `app_user`), sans fuite. Corriger la note de lane.
