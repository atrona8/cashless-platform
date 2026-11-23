-- Fonctions d'identification KYC (0096, mission 10a WP01) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_kyc_functions.sql
-- Fonctions prouvées en propriétaire (WP04 pose les EXECUTE) ; prestataire de session par app.operator_id.
-- Comptages limités au prestataire A (suites parallèles en CI).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Prestataire de la session : a (A) ou b (B).
CREATE FUNCTION pg_temp.as_op(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;
CREATE FUNCTION pg_temp.state(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- Résultat d'un appel : SQLSTATE (ou ok) puis ':' puis variation du nombre de lignes de A.
CREATE FUNCTION pg_temp.refus(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n0 int; n1 int; st text;
BEGIN
  SELECT count(*) INTO n0 FROM kyc_verification WHERE operator_id = pg_temp.id('96a001');
  st := pg_temp.state(p_sql);
  SELECT count(*) INTO n1 FROM kyc_verification WHERE operator_id = pg_temp.id('96a001');
  RETURN st || ':' || (n1 - n0);
END $$;
-- Appel de create_kyc_verification avec des valeurs valides par défaut ; identifiants courts.
CREATE FUNCTION pg_temp.mk(p_w text, p_c text, p_agent text DEFAULT '96e001',
                           p_type text DEFAULT 'PASSPORT', p_country text DEFAULT 'SN',
                           p_last4 text DEFAULT 'ab1c', p_exp date DEFAULT current_date + 30)
RETURNS kyc_verification LANGUAGE sql AS $$
  SELECT * FROM create_kyc_verification(pg_temp.id(p_w), pg_temp.id(p_c), p_type, p_country, p_last4,
                                        p_exp, pg_temp.id(p_agent))
$$;
CREATE FUNCTION pg_temp.lvl(p_w text, p_on date DEFAULT current_date) RETURNS text
LANGUAGE sql AS $$ SELECT wallet_kyc_level(pg_temp.id(p_w), p_on) $$;
CREATE FUNCTION pg_temp.rv(p_v text, p_by text, p_reason text) RETURNS kyc_verification
LANGUAGE sql AS $$
  SELECT * FROM revoke_kyc_verification(current_setting(p_v)::uuid, pg_temp.id(p_by), p_reason)
$$;

-- Données (propriétaire) -------------------------------------------------------------------------
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('96a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('96a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('96b001'), 'ORGANIZER', pg_temp.id('96a001'), 'Organisateur A'),
 (pg_temp.id('96b011'), 'ORGANIZER', pg_temp.id('96a002'), 'Organisateur B'),
 (pg_temp.id('96c001'), 'CUSTOMER', pg_temp.id('96a001'), 'Client A1'),
 (pg_temp.id('96c002'), 'CUSTOMER', pg_temp.id('96a001'), 'Client A2 sans numéro'),
 (pg_temp.id('96c003'), 'CUSTOMER', pg_temp.id('96a001'), 'Client A3'),
 (pg_temp.id('96c004'), 'CUSTOMER', pg_temp.id('96a001'), 'Client A4'),
 (pg_temp.id('96c011'), 'CUSTOMER', pg_temp.id('96a002'), 'Client B1');
INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES
 (pg_temp.id('96c001'), pg_temp.id('96a001'), '+221770000001'),
 (pg_temp.id('96c003'), pg_temp.id('96a001'), '+221770000003'),
 (pg_temp.id('96c004'), pg_temp.id('96a001'), '+221770000004'),
 (pg_temp.id('96c011'), pg_temp.id('96a002'), '+221770000011');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('96f001'), 'SN', 960096, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('96d001'), pg_temp.id('96a001'), pg_temp.id('96b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('96f001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('96d011'), pg_temp.id('96a002'), pg_temp.id('96b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('96f001'), 'ORGANIZER', 'LIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES
 (pg_temp.id('96cc01'), pg_temp.id('96a001'), 'EVENT', pg_temp.id('96d001'), 'XOF',
  pg_temp.id('96b001'), pg_temp.id('96b001')),
 (pg_temp.id('96cc11'), pg_temp.id('96a002'), 'EVENT', pg_temp.id('96d011'), 'XOF',
  pg_temp.id('96b011'), pg_temp.id('96b011'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id) VALUES
 (pg_temp.id('96cb01'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c001')),
 (pg_temp.id('96cb02'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c001')),
 (pg_temp.id('96cb03'), pg_temp.id('96a001'), pg_temp.id('96cc01'), NULL),
 (pg_temp.id('96cb04'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c002')),
 (pg_temp.id('96cb05'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c003')),
 (pg_temp.id('96cb06'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c004')),
 (pg_temp.id('96cb11'), pg_temp.id('96a002'), pg_temp.id('96cc11'), pg_temp.id('96c011'));
-- Donnée incohérente (aucune garde ne l'interdit) : portefeuille de A dont le client est celui de B.
INSERT INTO wallet (id, operator_id, ledger_id, customer_id)
VALUES (pg_temp.id('96cb07'), pg_temp.id('96a001'), pg_temp.id('96cc01'), pg_temp.id('96c011'));
-- Agents : e001 sans numéro ; e002 titulaire (numéro de A1) ; e003 autre numéro ; e004 numéro d'un
-- client de B ; e011 agent de B ; e012 personne de la plateforme.
INSERT INTO app_user (id, operator_id, issuer, subject, email, phone, display_name) VALUES
 (pg_temp.id('96e001'), pg_temp.id('96a001'), 'https://idp.test', 's96-1', 'a1@test', NULL, 'Agent 1'),
 (pg_temp.id('96e002'), pg_temp.id('96a001'), 'https://idp.test', 's96-2', NULL, '+221770000001',
  'Agent titulaire'),
 (pg_temp.id('96e003'), pg_temp.id('96a001'), 'https://idp.test', 's96-3', NULL, '+221770000099',
  'Agent autre numéro'),
 (pg_temp.id('96e004'), pg_temp.id('96a001'), 'https://idp.test', 's96-4', NULL, '+221770000011',
  'Agent numéro client de B'),
 (pg_temp.id('96e011'), pg_temp.id('96a002'), 'https://idp.test', 's96-11', 'b1@test', NULL,
  'Agent B'),
 (pg_temp.id('96e012'), NULL, 'https://idp.test', 's96-12', 'p1@test', NULL, 'Plateforme');
-- Identification posée par le propriétaire avec une pièce expirée hier (client A3).
INSERT INTO kyc_verification (operator_id, customer_id, wallet_id, agent_id, id_type, id_country,
                              id_last4, id_expires_on)
VALUES (pg_temp.id('96a001'), pg_temp.id('96c003'), pg_temp.id('96cb05'), pg_temp.id('96e001'),
        'PASSPORT', 'SN', '0003', current_date - 1);

-- 1. Forme -----------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('create_kyc_verification',
  'revoke_kyc_verification') AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 2,
  'les deux fonctions sont SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('create_kyc_verification',
  'revoke_kyc_verification') AND has_function_privilege('public', oid, 'EXECUTE')), 0,
  'EXECUTE retiré à PUBLIC pour les deux fonctions');

-- 2. Création par portefeuille : succès, valeurs lues en base ------------------------------------------
SELECT pg_temp.as_op('96a001');
SELECT is((SELECT count(*)::int FROM kyc_verification WHERE operator_id = pg_temp.id('96a001')
             AND customer_id = pg_temp.id('96c001')), 0, 'avant : aucune identification du client A1');
SELECT is(pg_temp.lvl('96cb01'), 'NONE', 'avant : niveau NONE');
SELECT set_config('t96.v1', (pg_temp.mk('96cb01', NULL)).id::text, true);
SELECT is((SELECT method || ':' || status || ':' || agent_id::text || ':' || customer_id::text || ':'
                  || wallet_id::text || ':' || id_last4 || ':' || id_type || ':' || id_country
                  || ':' || operator_id::text
             FROM kyc_verification WHERE id = current_setting('t96.v1')::uuid),
  'DESK:VERIFIED:' || pg_temp.id('96e001')::text || ':' || pg_temp.id('96c001')::text || ':'
  || pg_temp.id('96cb01')::text || ':AB1C:PASSPORT:SN:' || pg_temp.id('96a001')::text,
  'ligne DESK VERIFIED, agent, client, portefeuille, id_last4 ab1c rendu AB1C');
SELECT is(pg_temp.lvl('96cb01'), 'VERIFIED', 'après : niveau VERIFIED');
SELECT is(pg_temp.lvl('96cb02'), 'VERIFIED', 'après : second portefeuille du même client VERIFIED');
SELECT is(pg_temp.lvl('96cb01', current_date + 400), 'NONE', 'pièce expirée à +400 jours : NONE');
SELECT is(pg_temp.lvl('96cb05'), 'NONE', 'pièce expirée hier posée par le propriétaire : NONE');
SELECT is(pg_temp.lvl('96cb03'), 'NONE', 'portefeuille anonyme : NONE');

-- 3. Refus par portefeuille, rien d'écrit ---------------------------------------------------------------
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb03', NULL)$$), 'CL060:0', 'portefeuille anonyme : CL060');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb04', NULL)$$), 'CL060:0',
  'client sans customer_identity : CL060');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb07', NULL)$$), 'CL060:0',
  'portefeuille de A au client de B : CL060 (identité lue pour le prestataire de session)');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, '96e002')$$), 'CL061:0',
  'agent titulaire : CL061');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_exp => current_date - 1)$$), 'CL062:0',
  'pièce expirée hier : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_last4 => 'ab1c2')$$), 'CL062:0',
  'id_last4 de cinq caractères : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_last4 => '')$$), 'CL062:0',
  'id_last4 vide : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_last4 => 'ab 1')$$), 'CL062:0',
  'id_last4 avec espace : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_last4 => 'abé1')$$), 'CL062:0',
  'id_last4 accentué : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_type => 'LIBRARY_CARD')$$), 'CL062:0',
  'type de pièce inconnu : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_country => 'sn')$$), 'CL062:0',
  'pays en minuscules : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_country => 'SEN')$$), 'CL062:0',
  'pays de trois lettres : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, p_exp => NULL)$$), 'CL062:0',
  'pièce sans date d''expiration : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, '96e099')$$), 'P0002:0',
  'agent inconnu : no_data_found');
SELECT is(pg_temp.refus($$SELECT create_kyc_verification(pg_temp.id('96cb01'), NULL, 'PASSPORT',
  'SN', 'AB1C', current_date + 30, NULL)$$), 'CL001:0', 'agent absent : CL001');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, '96e011')$$), 'P0002:0',
  'agent d''un autre prestataire : no_data_found');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb06', NULL, '96e003', p_last4 => 'zz9z')$$), 'ok:1',
  'contrôle positif : agent à autre numéro, minuscules rendues en majuscules');
SELECT is((SELECT id_last4 FROM kyc_verification WHERE operator_id = pg_temp.id('96a001')
             AND agent_id = pg_temp.id('96e003') AND customer_id = pg_temp.id('96c004')), 'ZZ9Z', 'valeur normalisée lue en base');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb06', NULL, p_exp => current_date)$$), 'ok:1',
  'pièce expirant aujourd''hui : acceptée');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb06', NULL, '96e012')$$), 'ok:1',
  'personne de la plateforme : acceptée');

-- 4. Ordre des contrôles --------------------------------------------------------------------------------
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb03', NULL, '96e002', p_exp => current_date - 1)$$),
  'CL060:0', 'portefeuille anonyme + agent titulaire + pièce expirée : CL060 d''abord');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL, '96e002', p_exp => current_date - 1)$$),
  'CL061:0', 'agent titulaire + pièce expirée : CL061 avant CL062');

-- 5. Forme p_customer ------------------------------------------------------------------------------------
SELECT set_config('t96.v4', (pg_temp.mk(NULL, '96c004')).id::text, true);
SELECT is((SELECT customer_id::text || ':' || coalesce(wallet_id::text, 'NULL') || ':' || status
             FROM kyc_verification WHERE id = current_setting('t96.v4')::uuid),
  pg_temp.id('96c004')::text || ':NULL:VERIFIED', 'avec p_customer : wallet_id NULL lu en base');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c002')$$), 'CL060:0',
  'p_customer sans customer_identity : CL060');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001', '96e002')$$), 'CL061:0',
  'p_customer, agent titulaire : CL061');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c004', p_exp => current_date - 1)$$), 'CL062:0',
  'p_customer, pièce expirée : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', '96c001')$$), 'CL062:0',
  'p_wallet et p_customer ensemble : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, NULL)$$), 'CL062:0',
  'ni p_wallet ni p_customer : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96cb01')$$), 'P0002:0',
  'p_customer qui n''est pas une partie client : no_data_found');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c011')$$), 'P0002:0',
  'p_customer d''un autre prestataire : no_data_found');

-- 6. Isolation et session -----------------------------------------------------------------------------------
SELECT pg_temp.as_op('96a002');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL)$$), 'P0002:0',
  'session B, portefeuille de A : no_data_found');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001')$$), 'P0002:0',
  'session B, client de A : no_data_found');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v1', '96e011', 'motif assez long')$$), 'P0002:0',
  'session B, identification de A : révocation no_data_found');
SELECT is((SELECT status FROM kyc_verification WHERE id = current_setting('t96.v1')::uuid
            AND operator_id = pg_temp.id('96a001')), 'VERIFIED', 'identification de A inchangée');
SELECT set_config('app.operator_id', '', true);
SELECT is(pg_temp.refus($$SELECT pg_temp.mk('96cb01', NULL)$$), 'P0002:0',
  'session sans prestataire : création no_data_found');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v1', '96e001', 'motif assez long')$$), 'P0002:0',
  'session sans prestataire : révocation no_data_found');
SELECT pg_temp.as_op('96a001');

-- 7. Révocation ----------------------------------------------------------------------------------------------
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v4', '96e001', '123456789')$$), 'CL062:0',
  'motif de 9 caractères : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v4', '96e001', '            ')$$), 'CL062:0',
  'motif d''espaces : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v4', '96e001', NULL)$$), 'CL062:0',
  'motif nul : CL062');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v4', NULL, 'motif assez long')$$), 'CL001:0',
  'auteur nul : CL001');
SELECT is(pg_temp.refus($$SELECT revoke_kyc_verification(pg_temp.id('96ee99'), pg_temp.id('96e001'),
  'motif assez long')$$), 'P0002:0', 'identifiant inconnu : no_data_found');
SELECT is((SELECT status FROM kyc_verification WHERE id = current_setting('t96.v4')::uuid),
  'VERIFIED', 'les refus n''ont rien changé');
SELECT is(pg_temp.state($$SELECT pg_temp.rv('t96.v1', '96e001', '  Pièce perdue, signalée  ')$$), 'ok',
  'révocation acceptée');
SELECT is((SELECT status || ':' || revoked_by::text || ':' || revoked_reason
             FROM kyc_verification WHERE id = current_setting('t96.v1')::uuid),
  'REVOKED:' || pg_temp.id('96e001')::text || ':Pièce perdue, signalée',
  'statut, auteur et motif rogné lus en base');
SELECT is((SELECT (revoked_at IS NOT NULL)::text FROM kyc_verification
            WHERE id = current_setting('t96.v1')::uuid), 'true', 'revoked_at posé');
SELECT is(pg_temp.lvl('96cb01'), 'NONE', 'après révocation : NONE sur le portefeuille présenté');
SELECT is(pg_temp.lvl('96cb02'), 'NONE', 'après révocation : NONE sur le second portefeuille');
SELECT is(pg_temp.refus($$SELECT pg_temp.rv('t96.v1', '96e001', 'second motif long')$$), 'CL063:0',
  'deuxième révocation : CL063');

-- 8. Ajout seul intact ---------------------------------------------------------------------------------------
SELECT is(pg_temp.state($$UPDATE kyc_verification SET id_last4 = 'ZZZZ'
  WHERE id = current_setting('t96.v4')::uuid$$), 'P0001',
  'UPDATE d''id_last4 en propriétaire : refusé par le déclencheur d''ajout seul');

-- 9. Limite consignée C-005 ------------------------------------------------------------------------------------
-- Client A1 (+221770000001). Le bloc échoue si la règle s'élargit (agent sans numéro refusé) ou se
-- resserre en silence (préfixe, chiffres seuls, comparaison sans filtre de client).
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001', '96e001')$$), 'ok:1',
  'Limite consignée C-005 (1) : agent sans numéro accepté');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001', '96e003')$$), 'ok:1',
  'Limite consignée C-005 (2) : agent à autre numéro E.164 accepté');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001', '96e002')$$), 'CL061:0',
  'Limite consignée C-005 (3) : agent au numéro du client refusé (CL061)');
SELECT is(pg_temp.refus($$SELECT pg_temp.mk(NULL, '96c001', '96e004')$$), 'ok:1',
  'Limite consignée C-005 (4) : agent au numéro d''un client d''un autre prestataire accepté');

SELECT * FROM finish();
ROLLBACK;
