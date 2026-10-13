-- Intégrité de la configuration (migration 0007) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_configuration.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire) : plateforme, prestataires A et B, organisateurs, commerçants, tiers, profils.
INSERT INTO party (id, kind, legal_name) VALUES ('00000000-0000-0000-0000-00000007a000','PLATFORM','Plateforme 0007')
ON CONFLICT DO NOTHING;
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000007a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000007a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000007a011','ORGANIZER','00000000-0000-0000-0000-00000007a001','Organisateur A','SN'),
 ('00000000-0000-0000-0000-00000007a012','ORGANIZER','00000000-0000-0000-0000-00000007a001','Organisateur A2','SN'),
 ('00000000-0000-0000-0000-00000007a013','ORGANIZER','00000000-0000-0000-0000-00000007a002','Organisateur B','CI'),
 ('00000000-0000-0000-0000-00000007a021','MERCHANT','00000000-0000-0000-0000-00000007a001','Commerçant A','SN'),
 ('00000000-0000-0000-0000-00000007a022','MERCHANT','00000000-0000-0000-0000-00000007a002','Commerçant B','CI'),
 ('00000000-0000-0000-0000-00000007a031','THIRD_PARTY','00000000-0000-0000-0000-00000007a001','Compte cantonné A','SN'),
 ('00000000-0000-0000-0000-00000007a032','THIRD_PARTY','00000000-0000-0000-0000-00000007a002','Compte cantonné B','CI');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, min_refund_window_days) VALUES
 ('00000000-0000-0000-0000-00000007a041','SN', 70001, '2026-01-01', 'ORGANIZER', 90),
 ('00000000-0000-0000-0000-00000007a042','SN', 70002, '2026-01-01', 'ORGANIZER', NULL);
INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps) VALUES
 ('00000000-0000-0000-0000-00000007a051','00000000-0000-0000-0000-00000007a001','OPERATOR_ORGANIZER','00000000-0000-0000-0000-00000007a011','2026-01-01','ORGANIZER','ORGANIZER',8000),
 ('00000000-0000-0000-0000-00000007a052','00000000-0000-0000-0000-00000007a001','OPERATOR_ORGANIZER','00000000-0000-0000-0000-00000007a012','2026-01-01','ORGANIZER','ORGANIZER',8000);
INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, platform_fee_mode) VALUES
 ('00000000-0000-0000-0000-00000007a053','00000000-0000-0000-0000-00000007a001','PLATFORM_OPERATOR','00000000-0000-0000-0000-00000007a000','2026-01-01','IN_POOL');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, contract_id) VALUES
 ('00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011',
  'Événement A','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER','00000000-0000-0000-0000-00000007a051');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type) VALUES
 ('00000000-0000-0000-0000-00000007a071','00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061',
  '00000000-0000-0000-0000-00000007a021','EXTERNAL');

-- 1. Structure ---------------------------------------------------------------------------------------------------
SELECT has_column('event', 'issuer', 'event.issuer');
SELECT has_column('event', 'funds_holder_party_id', 'event.funds_holder_party_id');
SELECT has_column('merchant_participation', 'pitch_fee', 'merchant_participation.pitch_fee');
SELECT has_column('merchant_participation', 'pitch_fee_reference', 'merchant_participation.pitch_fee_reference');
SELECT has_table('currency_exponent');
SELECT results_eq($$SELECT code::text, exponent::int FROM currency_exponent ORDER BY code$$,
  $$VALUES ('EUR',2), ('USD',2), ('XAF',0), ('XOF',0)$$, 'devises connues et leur exposant ISO 4217');
SELECT is((SELECT issuer FROM event WHERE id = '00000000-0000-0000-0000-00000007a061'), 'ORGANIZER', 'émetteur par défaut : organisateur');

-- 2. Colonnes : contraintes ---------------------------------------------------------------------------------------
SELECT throws_ok($$UPDATE event SET issuer = 'PLATFORM' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  '23514', NULL, 'émetteur hors liste refusé');
SELECT throws_ok($$UPDATE event SET funds_holder = 'THIRD_PARTY' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  '23514', NULL, 'THIRD_PARTY sans tiers désigné refusé');
SELECT throws_ok($$UPDATE event SET funds_holder_party_id = '00000000-0000-0000-0000-00000007a031' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  '23514', NULL, 'tiers désigné sans THIRD_PARTY refusé');
SELECT lives_ok($$UPDATE event SET funds_holder = 'THIRD_PARTY', funds_holder_party_id = '00000000-0000-0000-0000-00000007a031'
  WHERE id = '00000000-0000-0000-0000-00000007a061'$$, 'THIRD_PARTY avec tiers du prestataire accepté');
SELECT throws_ok($$UPDATE event SET funds_holder_party_id = '00000000-0000-0000-0000-00000007a032' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'CL001', NULL, 'tiers d''un autre prestataire refusé');
SELECT throws_ok($$UPDATE event SET funds_holder_party_id = '00000000-0000-0000-0000-00000007a021' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'CL001', NULL, 'tiers qui n''est pas une partie THIRD_PARTY refusé');
UPDATE event SET funds_holder = 'ORGANIZER', funds_holder_party_id = NULL WHERE id = '00000000-0000-0000-0000-00000007a061';
SELECT throws_ok($$UPDATE merchant_participation SET pitch_fee = -1 WHERE id = '00000000-0000-0000-0000-00000007a071'$$,
  '23514', NULL, 'droit de place négatif refusé');
SELECT throws_ok($$UPDATE merchant_participation SET pitch_fee_mode = 'PREPAID', pitch_fee = 50000 WHERE id = '00000000-0000-0000-0000-00000007a071'$$,
  '23514', NULL, 'droit de place payé d''avance sans référence refusé');
SELECT lives_ok($$UPDATE merchant_participation SET pitch_fee_mode = 'PREPAID', pitch_fee = 50000, pitch_fee_reference = 'VIR-2026-001'
  WHERE id = '00000000-0000-0000-0000-00000007a071'$$, 'droit de place payé d''avance avec référence accepté');
SELECT throws_ok($$INSERT INTO currency_exponent VALUES ('xof', 0)$$, '23514', NULL, 'code de devise hors format refusé');
SELECT throws_ok($$INSERT INTO currency_exponent VALUES ('JPY', 5)$$, '23514', NULL, 'exposant hors bornes refusé');

-- 3. Événement : références ---------------------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a013','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER')$$,
  'CL001', NULL, 'organisateur d''un autre prestataire refusé');
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a021','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER')$$,
  'CL001', NULL, 'organisateur qui est un commerçant refusé');
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011','X','GBP','Europe/London','00000000-0000-0000-0000-00000007a041','ORGANIZER')$$,
  'CL001', 'Événement : devise inconnue (GBP)', 'devise inconnue refusée');
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, contract_id)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER','00000000-0000-0000-0000-00000007a052')$$,
  'CL001', NULL, 'contrat d''un autre organisateur refusé');
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, contract_id)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER','00000000-0000-0000-0000-00000007a053')$$,
  'CL001', NULL, 'contrat plateforme–prestataire refusé comme contrat d''événement');
SELECT lives_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, contract_id)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a012','X','EUR','Europe/Paris','00000000-0000-0000-0000-00000007a041','OPERATOR','00000000-0000-0000-0000-00000007a052')$$,
  'événement avec contrat de son organisateur accepté');

-- 4. Événement : borne de la législation et dates -------------------------------------------------------------------
SELECT throws_ok($$UPDATE event SET starts_at = '2026-07-10', ends_at = '2026-07-09' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'CL001', 'Événement : la fin précède le début', 'fin avant début refusée');
SELECT lives_ok($$UPDATE event SET starts_at = '2026-07-10', ends_at = '2026-07-12' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'dates cohérentes acceptées');
SELECT throws_like($$UPDATE event SET refund_deadline = '2026-08-11' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'Règle jurisdiction.min_refund_window_days%', 'remboursement à 30 jours refusé quand la loi impose 90 jours');
SELECT lives_ok($$UPDATE event SET refund_deadline = '2026-10-10' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'remboursement à 90 jours accepté');
SELECT throws_like($$UPDATE event SET ends_at = '2026-07-20' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'Règle jurisdiction.min_refund_window_days%', 'fin repoussée sans repousser le remboursement refusée');
SELECT lives_ok($$UPDATE event SET jurisdiction_id = '00000000-0000-0000-0000-00000007a042', refund_deadline = '2026-07-13'
  WHERE id = '00000000-0000-0000-0000-00000007a061'$$, 'sans délai légal : date libre');
UPDATE event SET jurisdiction_id = '00000000-0000-0000-0000-00000007a041', refund_deadline = NULL WHERE id = '00000000-0000-0000-0000-00000007a061';
SELECT throws_ok($$UPDATE event SET status = 'LIVE' WHERE id = '00000000-0000-0000-0000-00000007a061'$$,
  'CL018', NULL, 'statut toujours protégé (set_event_status seulement)');

-- 5. Participation ----------------------------------------------------------------------------------------------
SELECT is((SELECT payout_to FROM merchant_participation WHERE id = '00000000-0000-0000-0000-00000007a071'),
  '00000000-0000-0000-0000-00000007a021'::uuid, 'EXTERNAL : versements au commerçant (posé par la base)');
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a021','INTERNAL')$$,
  '23505', NULL, 'une participation par commerçant et par événement');
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a022','EXTERNAL')$$,
  'CL001', NULL, 'commerçant d''un autre prestataire refusé');
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a011','EXTERNAL')$$,
  'CL001', NULL, 'organisateur inscrit comme commerçant refusé');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000007a023','MERCHANT','00000000-0000-0000-0000-00000007a001','Bar interne');
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type, payout_to)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a023','INTERNAL','00000000-0000-0000-0000-00000007a023')$$,
  'CL001', NULL, 'INTERNAL versé au commerçant refusé');
SELECT lives_ok($$INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a072','00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a023','INTERNAL')$$,
  'INTERNAL sans bénéficiaire accepté');
SELECT is((SELECT payout_to FROM merchant_participation WHERE id = '00000000-0000-0000-0000-00000007a072'),
  '00000000-0000-0000-0000-00000007a011'::uuid, 'INTERNAL : versements à l''organisateur (posé par la base)');
SELECT throws_ok($$UPDATE merchant_participation SET link_type = 'EXTERNAL' WHERE id = '00000000-0000-0000-0000-00000007a072'$$,
  'CL001', NULL, 'type de participation immuable');
-- Événement clôturé : plus de participation (statut posé hors de set_event_status, garde suspendue par le propriétaire).
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-00000007a062','00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011',
  'Événement clos','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER');
ALTER TABLE event DISABLE TRIGGER event_status_guard;
UPDATE event SET status = 'CLOSED' WHERE id = '00000000-0000-0000-0000-00000007a062';
ALTER TABLE event ENABLE TRIGGER event_status_guard;
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a062','00000000-0000-0000-0000-00000007a021','EXTERNAL')$$,
  'CL001', 'Participation : événement clôturé', 'participation à un événement clôturé refusée');

-- 6. Point de vente -----------------------------------------------------------------------------------------------
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 ('00000000-0000-0000-0000-00000007a081','00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a071','Stand 1');
SELECT lives_ok($$UPDATE point_of_sale SET name = 'Stand principal' WHERE id = '00000000-0000-0000-0000-00000007a081'$$, 'point de vente renommé');
SELECT throws_ok($$UPDATE point_of_sale SET participation_id = '00000000-0000-0000-0000-00000007a072' WHERE id = '00000000-0000-0000-0000-00000007a081'$$,
  'CL001', NULL, 'rattachement d''un point de vente immuable');
SELECT throws_ok($$INSERT INTO point_of_sale (operator_id, participation_id, name) VALUES ('00000000-0000-0000-0000-00000007a002','00000000-0000-0000-0000-00000007a071','Stand B')$$,
  'CL001', NULL, 'point de vente d''un autre prestataire que la participation refusé');
SELECT throws_ok($$INSERT INTO point_of_sale (operator_id, participation_id, name) VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a071','  ')$$,
  'CL001', NULL, 'point de vente sans nom refusé');

-- 7. Règles de frais ----------------------------------------------------------------------------------------------
INSERT INTO fee_rule (id, operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from) VALUES
 ('00000000-0000-0000-0000-00000007a091','00000000-0000-0000-0000-00000007a001','PARTICIPATION','00000000-0000-0000-0000-00000007a071',
  'MERCHANT','ORG_COM','SALE_AMOUNT', 1000, 'REALTIME', '2026-01-01');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','PARTICIPATION','00000000-0000-0000-0000-00000007a071','MERCHANT','ORG_COM','SALE_AMOUNT', 10001, 'REALTIME', now())$$,
  '23514', NULL, 'taux au-delà de 100 % refusé');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, min_amount, max_amount, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','EVENT','00000000-0000-0000-0000-00000007a061','ORG_FPREST','OPE_FRAIS','TOPUP_AMOUNT', 500, 100, 'CLOSING', now())$$,
  '23514', NULL, 'minimum supérieur au maximum refusé');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, fixed_amount, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','EVENT','00000000-0000-0000-0000-00000007a061','ORG_FPREST','OPE_FRAIS','FIXED', -1, 'CLOSING', now())$$,
  '23514', NULL, 'montant fixe négatif refusé');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','PARTICIPATION','00000000-0000-0000-0000-00000007a061','MERCHANT','ORG_COM','SALE_AMOUNT', 'REALTIME', now())$$,
  'CL001', NULL, 'portée PARTICIPATION visant un événement refusée');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a002','EVENT','00000000-0000-0000-0000-00000007a061','ORG_FPREST','OPE_FRAIS','TOPUP_AMOUNT', 'CLOSING', now())$$,
  'CL001', NULL, 'règle d''un autre prestataire que l''objet refusée');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','OPERATOR_CONTRACT','00000000-0000-0000-0000-00000007a053','ORG_FPREST','OPE_FRAIS','TOPUP_AMOUNT', 'CLOSING', now())$$,
  'CL001', NULL, 'OPERATOR_CONTRACT visant un contrat plateforme refusé');
SELECT lives_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','PLATFORM_CONTRACT','00000000-0000-0000-0000-00000007a053','OPE_REDEV','PLT_REDEV','FEE_AMOUNT', 1000, 'CLOSING', now())$$,
  'redevance de plateforme sur son contrat acceptée');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000007a001','PARTICIPATION','00000000-0000-0000-0000-00000007a071','MERCHANT','ORG_COM','SALE_AMOUNT', 900, 'REALTIME', now())$$,
  '23505', NULL, 'même règle, même version : refusée (remplacement = nouvelle version)');
SELECT throws_ok($$UPDATE fee_rule SET rate_bps = 900 WHERE id = '00000000-0000-0000-0000-00000007a091'$$,
  'CL001', NULL, 'règle de frais jamais modifiée');
SELECT throws_ok($$UPDATE fee_rule SET valid_to = '2025-12-31' WHERE id = '00000000-0000-0000-0000-00000007a091'$$,
  '23514', NULL, 'fermeture avant la date d''effet refusée');
SELECT lives_ok($$UPDATE fee_rule SET valid_to = '2026-06-01' WHERE id = '00000000-0000-0000-0000-00000007a091'$$,
  'fermeture d''une règle acceptée');
SELECT throws_ok($$UPDATE fee_rule SET valid_to = '2026-07-01' WHERE id = '00000000-0000-0000-0000-00000007a091'$$,
  'CL001', NULL, 'règle déjà fermée : plus de modification');
SELECT throws_ok($$DELETE FROM fee_rule WHERE id = '00000000-0000-0000-0000-00000007a091'$$,
  'CL001', NULL, 'règle de frais jamais supprimée');
SELECT lives_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from, version)
  VALUES ('00000000-0000-0000-0000-00000007a001','PARTICIPATION','00000000-0000-0000-0000-00000007a071','MERCHANT','ORG_COM','SALE_AMOUNT', 900, 'REALTIME', '2026-06-01', 2)$$,
  'remplacement par une version 2 accepté');

-- 8. Contrats, versions de configuration, profils : immuables, numérotés par la base ---------------------------------
SELECT throws_ok($$UPDATE contract SET breakage_organizer_bps = 5000 WHERE id = '00000000-0000-0000-0000-00000007a051'$$,
  'CL001', NULL, 'contrat jamais modifié');
SELECT throws_ok($$DELETE FROM contract WHERE id = '00000000-0000-0000-0000-00000007a051'$$, 'CL001', NULL, 'contrat jamais supprimé');
INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps, version) VALUES
 ('00000000-0000-0000-0000-00000007a054','00000000-0000-0000-0000-00000007a001','OPERATOR_ORGANIZER','00000000-0000-0000-0000-00000007a011','2026-03-01','OPERATOR','ORGANIZER',7000, 1);
SELECT is((SELECT version FROM contract WHERE id = '00000000-0000-0000-0000-00000007a054'), 2, 'nouvelle version de contrat numérotée par la base (2)');
SELECT throws_ok($$INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
  VALUES ('00000000-0000-0000-0000-00000007a001','OPERATOR_ORGANIZER','00000000-0000-0000-0000-00000007a011','2026-02-01','OPERATOR','ORGANIZER',7000)$$,
  'CL001', NULL, 'nouvelle version datée avant la précédente refusée');
INSERT INTO config_version (id, operator_id, scope_type, scope_id, version, valid_from, settings) VALUES
 ('00000000-0000-0000-0000-00000007a101','00000000-0000-0000-0000-00000007a001','EVENT','00000000-0000-0000-0000-00000007a061', 7, '2026-01-01', '{"spend_order":"PROMO_FIRST"}'),
 ('00000000-0000-0000-0000-00000007a102','00000000-0000-0000-0000-00000007a001','EVENT','00000000-0000-0000-0000-00000007a061', 7, '2026-02-01', '{"spend_order":"PAID_FIRST"}');
SELECT results_eq($$SELECT version FROM config_version WHERE scope_id = '00000000-0000-0000-0000-00000007a061' ORDER BY version$$,
  $$VALUES (1), (2)$$, 'versions de configuration numérotées par la base (1, 2)');
SELECT throws_ok($$UPDATE config_version SET settings = '{}' WHERE id = '00000000-0000-0000-0000-00000007a101'$$,
  'CL001', NULL, 'version de configuration jamais modifiée');
SELECT throws_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000007a001','EVENT','00000000-0000-0000-0000-00000007a061', 1, '2026-01-15', '{}')$$,
  'CL001', NULL, 'version de configuration datée avant la précédente refusée');
SELECT throws_ok($$UPDATE jurisdiction_profile SET min_refund_window_days = 30 WHERE id = '00000000-0000-0000-0000-00000007a041'$$,
  'CL001', NULL, 'profil de législation jamais modifié');
SELECT throws_ok($$DELETE FROM jurisdiction_profile WHERE id = '00000000-0000-0000-0000-00000007a042'$$,
  'CL001', NULL, 'profil de législation jamais supprimé');

-- 9. Sous le rôle applicatif : mêmes contrôles, et les objets d'un autre prestataire restent invisibles ---------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000007a001', true);
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a013','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER')$$,
  'CL001', NULL, 'rôle applicatif : organisateur d''un autre prestataire refusé');
SELECT lives_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a011','Y','XOF','Africa/Dakar','00000000-0000-0000-0000-00000007a041','ORGANIZER')$$,
  'rôle applicatif : événement de son organisateur accepté');
SELECT lives_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000007a001','ORGANIZER','00000000-0000-0000-0000-00000007a011', 1, now(), '{}')$$,
  'rôle applicatif : version de configuration de son organisateur acceptée');
SELECT throws_ok($$UPDATE contract SET breakage_organizer_bps = 1 WHERE id = '00000000-0000-0000-0000-00000007a051'$$,
  'CL001', NULL, 'rôle applicatif : contrat jamais modifié');
SELECT throws_ok($$INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
  VALUES ('00000000-0000-0000-0000-00000007a001','00000000-0000-0000-0000-00000007a061','00000000-0000-0000-0000-00000007a022','EXTERNAL')$$,
  'CL001', NULL, 'rôle applicatif : commerçant d''un autre prestataire refusé');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
