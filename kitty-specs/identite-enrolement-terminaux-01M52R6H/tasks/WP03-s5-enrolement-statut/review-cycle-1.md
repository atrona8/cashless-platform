---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command:
reviewed_at: '2026-10-19T12:12:39Z'
reviewer_agent: claude
wp_id: WP03
---

# Relecture WP03 — cycle 1 — REJET (couverture de tests incomplète)

Relecteur : claude (indépendant). Lane `lane-c`, commits `b0ee25a` (feat) et `723be8e` (fix).

## Ce qui est conforme (rien à changer)

- Refus unique pour un code inconnu, utilisé ou d'un autre prestataire (CL025), dans `enroll_device`
  (0022:389-392) et `check_device_enrollment_code` (0022:319-322) ; le code est verrouillé `FOR UPDATE` (0022:387).
- `next_seq` borné au prestataire (0022:411-412), calculé sous verrou consultatif (prestataire, serial) (0022:405) ;
  ré-enrôlement conforme à sync_protocol §3.3 (plancher, chaîne repartie de l'origine).
- Aucune sortie de `REVOKED` : refusée par `set_device_status` (0022:476-479) et par la table d'historique
  (`device_status_history_final`).
- Les neuf fonctions sont `SECURITY DEFINER`, avec `search_path = public, pg_temp` et `REVOKE ALL … FROM PUBLIC` ;
  un test le fige (tests:111-131).
- RLS activée et forcée sur les quatre tables, avec `USING` et `WITH CHECK`. Le choix pour
  `device_enrollment_attempt` est justifié (0022:197-203).
- `serial` unique par prestataire (ADR-109), nom d'index conservé. Contrôles NULL-sûrs (commit fix).
- Écarts qui renforcent la sécurité : `device_admin_allowed`, `device_ios_no_topup_desk`, `device_enrolled_keys`,
  `device_attestation_os`, `device_enrollment_code_once`.

## Constat bloquant — B1 : refus et contraintes non testés (T015 et Definition of Done : « chaque contrainte et chaque refus »)

Fichier : `packages/ledger-sql/tests/tests_device_enrollment.sql`. Correction attendue : ajouter un `throws_ok`
(SQLSTATE attendu) pour chacun des points ci-dessous. La migration n'a pas à changer.

### Refus des fonctions sans test

1. `check_device_enrollment_code` avec un code **déjà utilisé** → `CL025`. C'est la propriété « refus unique »
   (NFR-006) que la guidance de relecture demande de vérifier. L'API l'appelle en premier (étape 3 du contrat), donc
   c'est elle qui donne la réponse vue par le terminal. Aujourd'hui, seul le code inconnu est testé (tests:297).
   Mettre le code utilisé et le code inconnu côte à côte, avec le même SQLSTATE et le même message (0022:319-322).
2. `check_device_enrollment_code` avec `p_os` inconnu ou NULL → `CL001` (0022:313-315).
3. `enroll_device`, paramètres revérifiés par la base (0022:355-382). Seuls l'attestation iOS avec un niveau,
   Android sans niveau et une clé d'accord de 33 octets sont testés. À ajouter :
   - `p_serial` NULL ou de plus de 64 caractères ;
   - `p_os` inconnu ;
   - `p_app_version` NULL ou trop longue ;
   - `p_public_key` hors 64 à 200 octets ;
   - `p_cert_sha256` différent de 32 octets ;
   - `p_cert_not_after` dans le passé ;
   - Android avec `IOS_APP_ATTEST` ;
   - `p_refresh_hash` invalide ou `p_refresh_expires` dans le passé.

   Dans chaque cas : `CL001`, et le code n'est pas consommé.
4. `set_device_status` : motif de plus de 500 caractères ; `p_device` NULL ; session sans prestataire → `P0002`
   (0022:462-470).
5. `record_device_heartbeat` : session sans prestataire → `P0002` (0022:500-502).
6. `create_device_enrollment_code` : `p_actor` NULL → `P0002` (0022:287).

### Contraintes de table sans test (écriture directe par le propriétaire, comme la section 2 des tests)

7. `device_refresh_token` : `device_refresh_token_successor` (successeur sans `consumed_at`),
   `device_refresh_token_grace` (grâce sans `consumed_at`), `device_refresh_token_not_self`,
   `device_refresh_token_expiry`, `device_refresh_token_hash` (longueur), `device_refresh_token_hash_key` (doublon).
   Ces contraintes portent la grâce de 60 s et la rotation de WP04 : elles doivent être figées ici, où elles naissent.
8. `device` :
   - `device_enrolled_keys` (`enrollment_code_id` posé sans clés ni certificat) ;
   - `device_attestation_level_kind` ;
   - `device_attestation_kind` (valeur hors liste) ;
   - `device_app_version` et `device_status_reason` (longueur) ;
   - `device_enrollment_code_once` (deux terminaux pour un même code).
9. `device_enrollment_code` : `device_enrollment_code_hash_key` (empreinte en double) et
   `device_enrollment_code_device_key`.
10. `device_status_history` :
    - `device_status_history_change` (from = to) ;
    - `device_status_history_origin` (NULL → SUSPENDED) ;
    - `device_status_history_actor` (transition sans auteur) ;
    - `_reason` vide ;
    - `_to` hors liste.
11. `device_enrollment_attempt_code_hash` (longueur différente de 32).

### Isolation : écriture

12. La section 9 teste l'isolation en lecture seulement. Ajouter, depuis le rôle sonde soumis à la RLS (avec un
    `INSERT` accordé pour le test), un `INSERT` dans une table S5 avec l'`operator_id` de B sous la session de A.
    Résultat attendu : `42501` (violation de la politique `WITH CHECK`). Au moins sur `device_enrollment_code` et
    `device_refresh_token`.

## Remarques non bloquantes (à consigner dans le compte rendu du lot ; aucune correction de code demandée)

- R1 — Écarts au plan à lister dans le compte rendu, avec leur sens :
  - `enroll_device` reçoit un paramètre de plus, `p_device_id`, par rapport à la signature de data-model : le
    certificat porte `CN=<device_id>` et il est émis avant l'appel. Écart neutre.
  - Nouvelle fonction `check_device_enrollment_code` : lecture sans compte, absente de la liste des fonctions de
    data-model. WP07 doit l'accorder explicitement.
  - `last_seq`, `contiguous_acked_seq` et `last_chain_seq` sont posés à `next_seq - 1` au ré-enrôlement.

  Signaler à WP07 que `device_admin_allowed` et `purge_device_enrollment_attempts` ne doivent pas être accordées à
  `cashless_app`.
- R2 — Codes `CL025` à `CL029` : vérifier qu'aucune autre lane (WP04, WP05, WP06) ne prend les mêmes avant la fusion.
- R3 — `enroll_device`, `check_device_enrollment_code`, `record_enrollment_attempt` et
  `enrollment_attempts_exceeded` lisent et écrivent des tables à RLS forcée sans prestataire de session. Elles ne
  marchent que si le propriétaire des fonctions ignore la RLS (superutilisateur, comme sur le poste local). Avec un
  propriétaire non superutilisateur, l'enrôlement échoue partout (échec fermé). Les limites R-16 ne verraient plus
  les essais sur codes inconnus. Le commentaire 0022:25-27 dit « ne s'appuie sur la RLS » : il faut ajouter que ces
  fonctions supposent que le propriétaire l'ignore. Même hypothèse que d'autres fonctions existantes ; à faire
  relire par une personne avec les droits de WP07.
- R4 — La limite par adresse compte l'adresse exacte : en IPv6, un /64 la contourne. Point à porter côté API
  (WP14), pas ici.
