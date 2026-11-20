# Relecture WP03 (commit ca6b44cb) : changements demandés

## Constat 1 (BLOQUANT) : un lot d'un autre grand livre masque une attente (faux `false`)
`0098` calcule le dernier lot du terminal sur `offline_batch WHERE device_id = d.id`, tous grands livres
confondus. `offline_batch` porte `ledger_id`, et un événement peut avoir plusieurs grands livres
(EVENT en devises différentes, ou EVENT + ORGANIZER : `offline_snapshot_ack` de 0048 accepte les deux
portées pour le même terminal). Un lot remonté sur le grand livre A après l'accusé du grand livre B
rend `false` pour un portefeuille de B dont les achats hors ligne sont encore attendus : l'avis
(FR-010, US4 scénario 2) ment par défaut, dans le sens dangereux.
Preuve rejouée : dans la fixture du test, ajout de `batch(aa04, f001, 2 h)` alors que `aa04` a un
accusé sans lot sur `f009` à 1 h : `pending_offline_notice(98cb009)` rend `false` au lieu de `true`.
Correction : `WHERE b.device_id = d.id AND b.ledger_id = w.ledger_id` dans la sous-requête `max`.
(l'index `offline_batch (device_id, received_at)` peut devenir `(device_id, ledger_id, received_at)`.)
Test à ajouter : lot d'un autre grand livre du même événement après l'accusé : reste `true`
(contrôle positif : lot sur le bon grand livre : `false`). Avec la correction seule, la mutation
« filtre ledger retiré » doit faire échouer ce test (aujourd'hui la mutation inverse passe sans
qu'aucun test ne bouge : le cas n'est pas couvert).

## Constat 2 (mineur) : `l.scope_type = 'EVENT'` non prouvé
Retirer `AND l.scope_type = 'EVENT'` ne casse aucun test (rejoué). En données réelles il est quasi
redondant (`scope_id` d'un ORGANIZER est un id de partie, jamais un id d'événement), mais c'est une
défense en profondeur qui n'est pas prouvée. Soit ajouter un test (grand livre ORGANIZER dont
`scope_id` = id d'un événement non clos avec accusé en attente : faux), soit assumer et le noter.

## Constat 3 (mineur) : test « accusé d'un autre grand livre » faible
Il lit `98cb001`, que l'accusé de `f009` ne touche pas de toute façon ; il n'échoue pas si le filtre
`a.ledger_id = w.ledger_id` est retiré. À durcir (portefeuille qui n'a QUE un accusé d'un autre
grand livre du même événement : faux).

## Vérifié sans écart
0099 : ajout seul, aucune migration existante modifiée (diff : 0098 et 0099 uniquement), `UNIQUE (id,
operator_id)` sans réécriture de ligne ; colonnes sans code, empreinte, numéro, bytea ; RLS forcée ;
`failed_reason` borné (mutation `DROP CONSTRAINT` : tests 12-17 échouent ; mutation NO FORCE : test 4
échoue) ; FK composite refuse un défi d'un autre prestataire (23503) ; isolation A/B sous
`cashless_app` avec contrôle positif. 0098 : mutations REVOKED, `>=`, coalesce, CLOSED rejouées :
chacune fait échouer un test. Aucun GRANT dans les migrations (le `roles.sql` rejoué donne
INSERT/SELECT/UPDATE à `cashless_app` : WP04 doit restreindre l'UPDATE). EXPLAIN : les deux index
sont utilisés. Fichier à faire relire par une personne : `0099_otp_channel_attempt.sql`.
