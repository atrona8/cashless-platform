# Relecture WP02, cycle 2 : verdict APPROUVÉ

Lot : `0031_vendors.sql` et `tests_vendors.sql` (lane-b, diff `b5641a30..f08f1394` ; depuis f08f1394 la tête de
lane n'a reçu que des commits du runtime et une fusion, aucun changement sous `packages/` ni `apps/`). Le relecteur
n'est pas l'implémenteur.

## Constats du cycle 1

### 1. BLOQUANT : corrigé
- `set_vendor_pin`, `set_vendor_status` (passage à DISABLED) et `begin_vendor_pin_check` (au blocage, 5e essai)
  font maintenant `DELETE FROM vendor_pin_check WHERE vendor_id = v.id AND operator_id = v_operator AND used_at
  IS NULL`. Le DELETE vient après le `FOR UPDATE` du vendeur et avant la fermeture des sessions. Les checks déjà
  utilisés restent (historique).
- Verrous : chaque site prend le vendeur, puis les checks, puis les sessions. `open_vendor_session` prend le
  terminal en FOR SHARE, puis le vendeur en FOR UPDATE, puis le check en FOR UPDATE : c'est le même sens. Si une
  transaction B attend le vendeur pendant que `set_vendor_pin` tourne, son `SELECT … FOR UPDATE` du check est une
  nouvelle instruction (READ COMMITTED), lue sur une nouvelle photo : elle ne trouve plus le check et rend `CL033`.
  Si B a pris le vendeur en premier, la session ouverte est ensuite fermée en `PIN_CHANGED` ou `VENDOR_DISABLED`.
  Aucun cycle n'apparaît avec la purge, qui ne touche que les checks de plus de 24 h et ne tient aucun autre
  verrou. Aucun cycle non plus avec `set_device_status`, qui prend le terminal puis les sessions : les deux se
  sérialisent sur le terminal, et `begin_vendor_pin_check` peut au plus attendre une ligne de session, sans en
  tenir une que l'autre attend.
- Signatures inchangées : WP04, WP07 et WP09 ne sont pas touchés.

### 3. MINEUR : corrigé
Le check du 5e essai (`t_lock5`), passé à `open_vendor_session`, rend `CL033`. Le vendeur reste bloqué, compteur
à 5. Ce check rend aussi `CL033` après le déblocage par `set_vendor_pin`, ce qui couvre le scénario « déblocage ».

### 2. MINEUR : rien n'est codé, c'est conforme
Le report vers WP09 est consigné dans le compte rendu de l'implémenteur et dans le commit `fe742bb5`.

## Point à trancher : pas de purge des essais dans `set_device_status`. Décision : sans effet, accepté.

Scénario : essai A fait sur le terminal T alors qu'il est ACTIVE, puis T suspendu, puis T réactivé, puis B
appelée moins de 30 s après A.

Analyse du risque :
- L'essai est lié au terminal. `open_vendor_session` exige `c.device_id = d.id` et `d.status = 'ACTIVE'` au moment
  de B. Une ouverture pendant la suspension est donc refusée (`CL033`). B et `set_device_status` se sérialisent sur
  le terminal (FOR SHARE contre FOR UPDATE) : si B passe avant, la session est fermée en `DEVICE_SUSPENDED`.
- L'essai a été vérifié contre l'empreinte courante. Le vendeur n'a changé ni de PIN ni de statut : sinon le
  check aurait été retiré, et c'est le constat 1. L'essai a aussi été compté. Après la réactivation, la même
  personne, sur le même terminal, avec le même PIN, obtient la même session par un essai neuf. Le check périmé ne
  donne donc aucune capacité nouvelle. À la différence du constat 1, ici aucun secret n'a été déclaré compromis :
  on ne change de PIN que lorsqu'il a fuité, alors qu'une suspension ne touche ni au PIN ni au vendeur.
- Qui peut réactiver : seul un administrateur habilité par `device_admin_allowed`. `REVOKED` est terminal, la
  transition vers ACTIVE est refusée (`CL029`) : le cas d'un terminal volé puis révoqué n'est pas concerné. La
  suspension ne révoque pas les jetons du terminal. Un terminal réactivé a donc de toute façon retrouvé tous ses
  moyens.
- Rien dans la spécification ne demande cette purge. FR-005, spec §90 et data-model §136-137 parlent des
  sessions : elles sont fermées, et aucune n'est rouverte au retour à ACTIVE (testé).

Faisabilité : un `DELETE … WHERE device_id = p_device` placé dans `set_device_status` irait du terminal aux checks
en sautant le vendeur. Ce saut est permis vers le bas (A7). En revanche, les suppressions par vendeur
(`set_vendor_pin`, blocage) prennent les mêmes lignes `(vendeur, terminal)` dans un autre ordre de parcours :
l'interblocage 40P01 est possible, comme le dit l'implémenteur. On pourrait s'en passer sans aucun verrou, en
refusant dans `open_vendor_session` un check plus ancien que le dernier changement de statut du terminal. Mais
cela ajoute de la complexité pour un risque nul. Rien n'est exigé. Je ne le consigne pas comme écart de sécurité,
parce que ce n'est pas un affaiblissement par rapport à la spécification ou au plan.

## Contrôles faits
- Contre-épreuve : j'ai remis les trois fonctions du cycle 1 (`b5641a30`) sur la base corrigée, puis rejoué la
  nouvelle suite. Résultat : 11 échecs sur 166 (tests 61-62, 65, 77, 124, 126, 130-131, 133, 135-136), dont les
  quatre `CL033` des scénarios du cycle 1. C'est bien le chiffre annoncé par l'implémenteur.
- Fragilité : les tests du déblocage et de l'ancien PIN dépendent de la fenêtre de 30 s. La suite dure environ 1 s,
  la marge est donc suffisante. La purge (§13) utilise maintenant deux essais neufs : les dates restent relatives
  (`clock_timestamp()`).
- Lignes : au plus 100 caractères (comptées en caractères), sauf les lignes 473 et 488 de 0031. Ce sont les deux
  exceptions déjà déclarées (copie de 0022).
- Seuls les deux fichiers du lot sont touchés. Aucun `.sql` généré n'est modifié.

## Tests rejoués (base `cashless_wp02r`, supprimée)
- `reset-db` : 0001 à 0031, roles.sql et post-roles.sql appliqués, OK.
- `pg_prove tests/tests_vendors.sql` : 166 tests, PASS.
- `reset-db`, puis `scripts/test-pgtap.sh` : 34 fichiers, 2 249 tests, PASS.

## Grille anti-motifs
Tout est PASS, comme au cycle 1. Le trou de couverture de FR-005 relevé au constat 1 est comblé.

## Défauts antérieurs à la mission
Aucun relevé.

## Écarts de sécurité ouverts
Aucun. Les corrections du cycle 2 sont des renforcements et sont consignées dans le compte rendu.

## À faire relire par une personne
`0031_vendors.sql` : SECURITY DEFINER, ordre des verrous, les trois DELETE ajoutés sous le verrou du vendeur, et
`set_device_status` remplacée.
