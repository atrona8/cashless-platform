---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-11T10:37:36Z'
reviewer_agent: claude
wp_id: WP24
---

# WP24 relecture, cycle 1 : constats

## 1. BLOQUANT (moyen) : le HEALTHCHECK du Dockerfile parle en clair a un port d'administration devenu TLS
`apps/gateway/Dockerfile` : le HEALTHCHECK utilise `node:http` sur `127.0.0.1:GATEWAY_ADMIN_PORT`
`/local/orders` et attend 405. Depuis 80d6f26d (decision 47), l'ecouteur est en HTTPS en production
(refus de demarrer sans la paire) : une requete en clair est fermee ou rejetee, le controle sort en erreur,
le conteneur passe `unhealthy` en permanence. `image.spec.ts` ne verifie que la presence du mot HEALTHCHECK.
Correction attendue : utiliser `node:https` avec `rejectUnauthorized: false` (boucle locale du conteneur,
aucune donnee envoyee, GET seul) ou `ca` sur le certificat monte ; attendre 405 ; ajouter dans `image.spec.ts`
ou `admin-tls.spec.ts` un test qui demarre l'ecouteur TLS et execute la commande de sante extraite du Dockerfile
(ou au minimum verifie `node:https` dans le HEALTHCHECK).

## Mineurs (non bloquants, a consigner)
2. `purge-canary.spec.ts`, controle positif : il reinsere la matiere APRES la purge, il ne mute pas la purge.
   Mutations faites par le relecteur (voir ci-dessous) : toutes detectees sauf `purgeKeyMaterial` (redondant avec
   le TRUNCATE, defense en profondeur) et `VACUUM FULL` -> `VACUUM` (non detecte, couvert par OP-N118).
3. Lignes de plus de 100 caracteres dans des fichiers touches (commentaires de `admin-listener.ts`,
   `authority.service.ts`) : en partie anterieures au lot.
