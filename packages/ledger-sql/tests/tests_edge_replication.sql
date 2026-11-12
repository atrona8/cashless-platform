-- Réplication côté base (migration 0063 ; mission passerelle-locale, lot WP08 ; FR-008, FR-009, FR-036, NFR-010,
-- NFR-011) — pgTAP, écrit à la main, SOUS LE PROPRIETAIRE (les droits sont en WP09 ; les sondes de droits utilisent
-- SET ROLE dans la transaction). Transaction REPEATABLE READ : exigence de edge_replication_page.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_replication.sql
-- Limites (dites, non prouvées ici) : (1) une session pgTAP ne prouve pas la numérotation du journal entre deux
-- transactions concurrentes ni l'écriture hors d'ordre réelle (A18) ; seul le repli « verrou non obtenu -> horizon
-- précédent » l'est, par dblink (une seconde connexion tient le verrou partagé) ; (2) le cas « transaction en vol à
-- l'instantané puis validée » (horizon non sûr) et le refus hors REPEATABLE READ demandent deux connexions réelles
-- avec ouverture de transaction avant la suite : à rejouer par l'orchestrateur (voir le compte rendu du lot).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS dblink;
SELECT no_plan();
-- Les déclencheurs du journal sont DIFFERES (au COMMIT) : dans la suite on les exécute à l'instruction.
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ctx(p_op text, p_gw text DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p_op)::text, true),
            set_config('app.gateway_id', coalesce(pg_temp.id(p_gw)::text, ''), true) $$;
CREATE FUNCTION pg_temp.ledger_of(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
CREATE FUNCTION pg_temp.page(p_op text, p_gw text, p_ap bigint, p_ac bigint, p_lim int DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.ctx(p_op, p_gw);
  RETURN edge_replication_page(pg_temp.id(p_gw), p_ap, p_ac, p_lim);
END $$;
CREATE FUNCTION pg_temp.jn(p_page jsonb, p_path text[]) RETURNS int LANGUAGE sql AS
  $$ SELECT coalesce(jsonb_array_length(p_page #> p_path), 0) $$;

-- Données (propriétaire) ----------------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('63a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('63a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('63b001'), 'ORGANIZER', pg_temp.id('63a001'), 'Organisateur A'),
 (pg_temp.id('63b011'), 'ORGANIZER', pg_temp.id('63a002'), 'Organisateur B'),
 (pg_temp.id('63b101'), 'MERCHANT', pg_temp.id('63a001'), 'Commerçant 1'),
 (pg_temp.id('63b102'), 'MERCHANT', pg_temp.id('63a001'), 'Commerçant 2'),
 (pg_temp.id('63b111'), 'MERCHANT', pg_temp.id('63a002'), 'Commerçant B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, max_wallet_balance,
                                  unidentified_max_balance, identified_monthly_limit, unidentified_monthly_limit)
VALUES (pg_temp.id('63c001'), 'SN', 630063, '2026-01-01', 'ORGANIZER', 1000000, 200000, 900000, 150000);

-- Un événement : grand livre, passerelle (clé d'accord), commerçant, point de vente.
CREATE FUNCTION pg_temp.mk_event(p_op text, p_org text, p_event text, p_gw text, p_serial text, p_role text,
                                 p_merchant text, p_registered interval) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.ctx(p_op);
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (pg_temp.id(p_event), pg_temp.id(p_op), pg_temp.id(p_org), 'Événement ' || p_event, 'XOF',
          'Africa/Dakar', pg_temp.id('63c001'), 'ORGANIZER', 'LIVE');
  PERFORM open_event_ledger(pg_temp.id(p_event));
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, agreement_public_key, registered_at)
  VALUES (pg_temp.id(p_gw), pg_temp.id(p_op), pg_temp.id(p_event), p_serial, p_role,
          decode('04' || repeat(substr(p_serial, length(p_serial)), 2) || repeat('11', 63) || '', 'hex'),
          now() - p_registered);
  IF p_merchant IS NOT NULL THEN
    INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
    VALUES (pg_temp.id(p_event || '1'), pg_temp.id(p_op), pg_temp.id(p_event), pg_temp.id(p_merchant),
            'INTERNAL', pg_temp.id(p_org));
    INSERT INTO point_of_sale (id, operator_id, participation_id, name)
    VALUES (pg_temp.id(p_event || '2'), pg_temp.id(p_op), pg_temp.id(p_event || '1'), 'Stand ' || p_event);
  END IF;
END $$;
SELECT pg_temp.mk_event('63a001', '63b001', '63d001', '63e001', 'GW1', 'PRIMARY', '63b101', interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d002', '63e002', 'GW2', 'PRIMARY', '63b102', interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d003', '63e003', 'GW3', 'STANDBY', NULL, interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d004', '63e004', 'GW4', 'PRIMARY', NULL, interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d005', '63e005', 'GW5', 'PRIMARY', NULL, interval '1 minute');
SELECT pg_temp.mk_event('63a002', '63b011', '63d011', '63e011', 'GW6', 'PRIMARY', '63b111', interval '1 day');
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('63e004');

-- Personnes : U1 caissière de l'événement 1, U2 de l'événement 2 (canaris de coordonnées).
SELECT pg_temp.ctx('63a001');
INSERT INTO app_user (id, operator_id, issuer, subject, email, phone, display_name) VALUES
 (pg_temp.id('63f001'), pg_temp.id('63a001'), 'iss', 'sub-u1', 'canary-mail-u1@x.test', '+221700000001', 'CanaryName1'),
 (pg_temp.id('63f002'), pg_temp.id('63a001'), 'iss', 'sub-u2', 'canary-mail-u2@x.test', '+221700000002', 'CanaryName2');
INSERT INTO role_assignment (id, operator_id, user_id, role, scope_type, scope_id) VALUES
 (pg_temp.id('63f101'), pg_temp.id('63a001'), pg_temp.id('63f001'), 'CASHIER', 'EVENT', pg_temp.id('63d001')),
 (pg_temp.id('63f102'), pg_temp.id('63a001'), pg_temp.id('63f001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('63a001')),
 (pg_temp.id('63f103'), pg_temp.id('63a001'), pg_temp.id('63f002'), 'SUPERVISOR', 'EVENT', pg_temp.id('63d002'));
-- Terminaux, vendeurs (canari de PIN), sessions, catalogue, session de caisse.
INSERT INTO device (id, operator_id, kind, event_id, pos_id, serial, public_key, cert_sha256, agreement_public_key, app_mode)
SELECT pg_temp.id(d), pg_temp.id('63a001'), 'POS', pg_temp.id(e), pg_temp.id(e || '2'), s, decode('3059' || repeat('aa', 40), 'hex'),
       sha256(convert_to(s, 'UTF8')), decode('04' || repeat('22', 64), 'hex'), 'CATALOG_POS'
  FROM (VALUES ('63aa01', '63d001', 'T1'), ('63aa02', '63d002', 'T2')) AS v(d, e, s);
INSERT INTO vendor (id, operator_id, merchant_id, display_name, pin_hash, created_by) VALUES
 (pg_temp.id('63ab01'), pg_temp.id('63a001'), pg_temp.id('63b101'), 'Vendeur 1', '$argon2id$v=19$CANARYPINHASH1', pg_temp.id('63f001')),
 (pg_temp.id('63ab02'), pg_temp.id('63a001'), pg_temp.id('63b102'), 'Vendeur 2', '$argon2id$v=19$CANARYPINHASH2', pg_temp.id('63f001'));
INSERT INTO vendor_session (id, operator_id, vendor_id, device_id, opened_at, expires_at) VALUES
 (pg_temp.id('63ac01'), pg_temp.id('63a001'), pg_temp.id('63ab01'), pg_temp.id('63aa01'), now(), now() + interval '12 hours'),
 (pg_temp.id('63ac02'), pg_temp.id('63a001'), pg_temp.id('63ab02'), pg_temp.id('63aa02'), now(), now() + interval '12 hours');
INSERT INTO catalog_category (id, operator_id, pos_id, label_fr, label_en, position)
VALUES (pg_temp.id('63ad01'), pg_temp.id('63a001'), pg_temp.id('63d0012'), 'Boissons', 'Drinks', 0),
       (pg_temp.id('63ad02'), pg_temp.id('63a001'), pg_temp.id('63d0022'), 'Plats', 'Meals', 0);
INSERT INTO catalog_item (id, operator_id, pos_id, category_id, label_fr, label_en, unit_price, vat_rate_bps) VALUES
 (pg_temp.id('63ae01'), pg_temp.id('63a001'), pg_temp.id('63d0012'), pg_temp.id('63ad01'), 'Bissap', 'Bissap', 500, 1800),
 (pg_temp.id('63ae02'), pg_temp.id('63a001'), pg_temp.id('63d0022'), pg_temp.id('63ad02'), 'Thiéb', 'Thieb', 3000, 1800);
INSERT INTO catalog_version (operator_id, pos_id, version, created_by) VALUES
 (pg_temp.id('63a001'), pg_temp.id('63d0012'), 1, pg_temp.id('63f001')),
 (pg_temp.id('63a001'), pg_temp.id('63d0022'), 1, pg_temp.id('63f001'));
INSERT INTO catalog_version_item (operator_id, pos_id, version, item_id, category_id, label_fr, label_en,
                                  category_label_fr, category_label_en, category_position, unit_price, vat_rate_bps)
VALUES (pg_temp.id('63a001'), pg_temp.id('63d0012'), 1, pg_temp.id('63ae01'), pg_temp.id('63ad01'), 'Bissap', 'Bissap', 'Boissons', 'Drinks', 0, 500, 1800),
       (pg_temp.id('63a001'), pg_temp.id('63d0022'), 1, pg_temp.id('63ae02'), pg_temp.id('63ad02'), 'Thiéb', 'Thieb', 'Plats', 'Meals', 0, 3000, 1800);
INSERT INTO cash_session (cash_session_id, operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by)
VALUES (pg_temp.id('63af01'), pg_temp.id('63a001'), pg_temp.ledger_of('63d001'), pg_temp.id('63d001'), pg_temp.id('63aa01'),
        pg_temp.acc(pg_temp.ledger_of('63d001'), 'A-BANQUE'), pg_temp.id('63f001'));

-- Portefeuilles et bracelets (canari : aucun secret dans ces lignes), soldes posés par des écritures du kit.
CREATE FUNCTION pg_temp.mk_wallet(p_n int, p_event text, p_paid bigint, p_promo bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lg uuid := pg_temp.ledger_of(p_event); w uuid := pg_temp.id('6a' || lpad(p_n::text, 4, '0')); tx uuid;
BEGIN
  PERFORM pg_temp.ctx('63a001');
  INSERT INTO wallet (id, operator_id, ledger_id) VALUES (w, pg_temp.id('63a001'), lg);
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
    (pg_temp.id('63a001'), lg, 'L-WAL-' || p_n || '-P', 'CLAIM', 'WALLET_PAID', w, 'C'),
    (pg_temp.id('63a001'), lg, 'L-WAL-' || p_n || '-X', 'CLAIM', 'WALLET_PROMO', w, 'C');
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
  VALUES (pg_temp.id('6b' || lpad(p_n::text, 4, '0')), pg_temp.id('63a001'), 'NFC_TAG',
          sha256(convert_to('identité ' || p_n, 'UTF8')), decode('04630000' || lpad(p_n::text, 6, '0'), 'hex'), w, 'ACTIVE');
  IF p_paid > 0 THEN
    tx := post_transaction(lg, 'TOPUP', 'fund-p-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-P'), 'amount', -p_paid),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'A-BANQUE'), 'amount', p_paid)));
  END IF;
  IF p_promo > 0 THEN
    tx := post_transaction(lg, 'PROMO_CREDIT', 'fund-x-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-X'), 'amount', -p_promo),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'L-ORG-PROMO'), 'amount', p_promo)));
  END IF;
END $$;
SELECT pg_temp.mk_wallet(1, '63d001', 100000, 20000);
SELECT pg_temp.mk_wallet(2, '63d001', 5000, 0);
SELECT pg_temp.mk_wallet(3, '63d002', 70000, 0);
-- Bracelet personnalisé non attaché (lot de l'événement 1) et un autre pour l'événement 2.
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES (pg_temp.id('63a001'), 1, 'test:hmac-63', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES
 (pg_temp.id('63ba01'), pg_temp.id('63a001'), pg_temp.id('63b001'), pg_temp.id('63d001'), 'PUBLIC', 10, 1),
 (pg_temp.id('63ba02'), pg_temp.id('63a001'), pg_temp.id('63b001'), pg_temp.id('63d002'), 'PUBLIC', 10, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, status) VALUES
 (pg_temp.id('63bb01'), pg_temp.id('63a001'), 'NFC_TAG', sha256('u1'), decode('04630000a00001', 'hex'), pg_temp.id('63ba01'), 'PERSONALIZED'),
 (pg_temp.id('63bb02'), pg_temp.id('63a001'), 'NFC_TAG', sha256('u2'), decode('04630000a00002', 'hex'), pg_temp.id('63ba02'), 'PERSONALIZED');

-- 1. Catalogue ------------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit',
            'edge_replication_horizon') AND relrowsecurity AND relforcerowsecurity), 4, 'RLS activée ET forcée sur les quatre tables');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename IN
            ('edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit', 'edge_replication_horizon', 'edge_reference_change')),
  5, 'tenant_isolation sur les quatre tables et sur le journal');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE column_name = 'operator_id' AND table_name IN
            ('edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit', 'edge_replication_horizon')), 4, 'operator_id partout');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_replication_page', 'edge_record_staff_token_audit',
            'deposit_edge_pwd_pack', 'deposit_edge_pwd_pack_key', 'mark_edge_gateways_silent', 'edge_gateways_awaiting_pack',
            'edge_ref_emit_many', 'edge_ref_emit_media_set', 'edge_ref_backfill', 'edge_ref_trigger')
            AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 10,
  'fonctions : SECURITY DEFINER et search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname ~ '^(edge_ref_|edge_replication_page|edge_record_staff|deposit_edge_pwd|mark_edge_gateways_silent|edge_gateways_awaiting|edge_owner_only|edge_forbid_truncate|edge_ts$|edge_b64$)'
            AND has_function_privilege('public', p.oid, 'EXECUTE')), 0, 'aucune fonction de 0063 exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname ~ '^(edge_ref_|edge_replication_page|edge_record_staff|deposit_edge_pwd|mark_edge_gateways_silent|edge_gateways_awaiting)'
            AND r.rolname IN ('cashless_app', 'cashless_edge', 'cashless_edgeadmin')
            AND has_function_privilege(r.oid, p.oid, 'EXECUTE')), 2,
  'accords (WP09) : edge_replication_page et edge_record_staff_token_audit à cashless_edge seul (ni app, ni edgeadmin)');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname ~ '^(edge_ref_|edge_owner_only|edge_forbid_truncate|edge_ts$|edge_b64$)'
            AND r.rolname ~ '^cashless_' AND has_function_privilege(r.oid, p.oid, 'EXECUTE')), 0,
  'internes de 0063 (edge_ref_*, gardes, edge_ts, edge_b64) : exécutables par aucun rôle');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgname LIKE 'edge\_ref\_%' AND tgconstraint <> 0
            AND tgdeferrable AND tginitdeferred), 30, 'déclencheurs du journal : tous DIFFERES (30 contraintes)');
SELECT ok((SELECT NOT tgdeferrable FROM pg_trigger WHERE tgname = 'edge_ref_ledger'), 'amorce du grand livre : non différée');

-- 2. Journal : amorce, numéros contigus, colonnes servies seulement -------------------------------------------------
SELECT ok((SELECT count(*) > 0 AND min(change_seq) = 1 AND max(change_seq) = count(*)
             FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d001')), 'journal de G1 : numéros 1..n contigus, non vide');
SELECT ok(NOT EXISTS (SELECT 1 FROM ledger l WHERE l.scope_type = 'EVENT'
                       AND NOT EXISTS (SELECT 1 FROM edge_reference_change c WHERE c.ledger_id = l.id)),
  'aucun grand livre d''événement avec un journal vide');
CREATE TEMP TABLE jc AS SELECT count(*) AS n FROM edge_reference_change;
UPDATE wallet SET other_block = other_block WHERE id = pg_temp.id('6a0001');
UPDATE media SET last_counter = 5 WHERE id = pg_temp.id('6b0001');
UPDATE device SET last_seen_at = now(), last_seq = 0 WHERE id = pg_temp.id('63aa01');
UPDATE edge_gateway SET last_seen_at = now(), contiguous_edge_seq = 0 WHERE id = pg_temp.id('63e001');
UPDATE event SET starts_at = now() WHERE id = pg_temp.id('63d001');
SELECT is((SELECT count(*) FROM edge_reference_change), (SELECT n FROM jc), 'colonnes non servies : aucune ligne de journal');
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.id('6a0002');
SELECT is((SELECT count(*)::int FROM edge_reference_change WHERE entity_kind = 'WALLET_STATE' AND entity_id = pg_temp.id('6a0002')
            AND change_seq > (SELECT max(change_seq) - 1 FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d001'))),
  1, 'blocage d''un portefeuille sans écriture : une ligne WALLET_STATE');
UPDATE media SET status = 'SUSPENDED' WHERE id = pg_temp.id('6b0002');
UPDATE edge_gateway SET role_changed_at = now() WHERE id = pg_temp.id('63e003');
SELECT ok(EXISTS (SELECT 1 FROM edge_reference_change WHERE entity_kind = 'MEDIA' AND entity_id = pg_temp.id('6b0002'))
          AND EXISTS (SELECT 1 FROM edge_reference_change WHERE entity_kind = 'GATEWAY' AND entity_id = pg_temp.id('63e003')),
  'statut de bracelet et rôle de passerelle : lignes MEDIA et GATEWAY');
SELECT ok(NOT EXISTS (SELECT 1 FROM edge_reference_change a JOIN edge_reference_change b
                        ON a.ledger_id = b.ledger_id AND a.change_seq = b.change_seq - 1 AND a.changed_at > b.changed_at + interval '1 second'),
  'l''ordre des numéros suit l''ordre d''écriture');
SELECT throws_ok($$UPDATE edge_reference_change SET entity_id = entity_id$$, NULL, NULL, 'journal : modification refusée');
SELECT throws_ok($$DELETE FROM edge_reference_change$$, NULL, NULL, 'journal : suppression refusée');
SELECT throws_ok($$TRUNCATE edge_reference_change$$, '42501', NULL, 'journal : vidage refusé');

-- 3. Amorce et accord d'autorité (échec fermé de WP04) --------------------------------------------------------------
-- Grand livre neuf : une ligne d'amorce, l'accord passe. Grand livre « d'avant la migration » : journal vide
-- (déclencheur d'amorce suspendu à la création), l'accord est refusé, puis la reprise de l'existant le rend possible.
SELECT pg_temp.mk_event('63a001', '63b001', '63d006', '63e006', 'GW7', 'PRIMARY', NULL, interval '1 day');
SELECT cmp_ok((SELECT count(*) FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d006')), '>=', 1::bigint,
  'grand livre neuf : journal amorcé');
SELECT lives_ok($$SELECT edge_grant_authority(pg_temp.ledger_of('63d006'), pg_temp.id('63e006'), pg_temp.id('63f001'))$$,
  'premier accord sur un grand livre neuf : accepté');
SELECT cmp_ok((SELECT reference_watermark_seq FROM debit_authority_handover WHERE ledger_id = pg_temp.ledger_of('63d006')), '>=', 1::bigint,
  'filigrane de référence posé à l''accord (neuf)');
SELECT pg_temp.ctx('63a001');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('63d007'), pg_temp.id('63a001'), pg_temp.id('63b001'), 'Ancien', 'XOF', 'Africa/Dakar',
        pg_temp.id('63c001'), 'ORGANIZER', 'LIVE');
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, agreement_public_key)
VALUES (pg_temp.id('63e007'), pg_temp.id('63a001'), pg_temp.id('63d007'), 'GW8', 'PRIMARY', decode('04' || repeat('33', 64), 'hex'));
ALTER TABLE ledger DISABLE TRIGGER edge_ref_ledger;
SELECT open_event_ledger(pg_temp.id('63d007'));
ALTER TABLE ledger ENABLE TRIGGER edge_ref_ledger;
SELECT is((SELECT count(*)::int FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d007')), 0,
  'grand livre d''avant la migration simulé : journal vide');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.ledger_of('63d007'), pg_temp.id('63e007'), pg_temp.id('63f001'))$$,
  'CL013', NULL, 'journal vide : accord refusé (échec fermé)');
SELECT edge_ref_backfill(pg_temp.ledger_of('63d007'));
SELECT cmp_ok((SELECT count(*) FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d007')), '>=', 2::bigint,
  'reprise de l''existant : événement et passerelle versés');
SELECT lives_ok($$SELECT edge_grant_authority(pg_temp.ledger_of('63d007'), pg_temp.id('63e007'), pg_temp.id('63f001'))$$,
  'premier accord sur un grand livre existant après reprise : accepté');

-- 4. Dépôts de colis -------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.wk() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT '{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"AAAA","iv":"AAAA","wrapped_key":"AAAA"}'::jsonb $$;
CREATE FUNCTION pg_temp.pk(p int) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat(lpad(p::text, 2, '0'), 34), 'hex') $$;
SELECT pg_temp.ctx('63a001');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(1), sha256(pg_temp.pk(1)), 1)$$,
  'CL001', NULL, 'colis sans clé de contenu : refusé');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'), sha256('autre'), pg_temp.wk())$$,
  'CL001', NULL, 'clé de contenu : empreinte différente de la clé d''accord refusée');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'), sha256(decode('04' || repeat('1', 2) || repeat('11', 63), 'hex')), '{"alg":"X"}')$$,
  'CL001', NULL, 'clé de contenu : enveloppe invalide refusée');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'),
   (SELECT sha256(agreement_public_key) FROM edge_gateway WHERE id = pg_temp.id('63e001')), pg_temp.wk())$$, 'clé de contenu de G1 déposée');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'),
   (SELECT sha256(agreement_public_key) FROM edge_gateway WHERE id = pg_temp.id('63e001')), pg_temp.wk())$$, 'rejeu identique : sans effet');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'),
   (SELECT sha256(agreement_public_key) FROM edge_gateway WHERE id = pg_temp.id('63e001')),
   '{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"BBBB","iv":"AAAA","wrapped_key":"AAAA"}')$$, 'CL002', NULL,
  'autre clé de contenu pour la même clé d''accord : refusée');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(11), sha256(pg_temp.pk(11)), 5)$$,
  'colis du bracelet non attaché de G1');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('6b0001'), pg_temp.pk(12), sha256(pg_temp.pk(12)), 5)$$,
  'colis d''un bracelet attaché de G1');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('6b0003'), pg_temp.pk(13), sha256(pg_temp.pk(13)), 5)$$,
  'P0002', NULL, 'bracelet d''un autre événement : refusé');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(11), sha256('faux'), 5)$$,
  'CL001', NULL, 'empreinte du colis différente du contenu : refusée');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), '\x0102'::bytea, sha256('\x0102'::bytea), 5)$$,
  'CL001', NULL, 'colis trop court : refusé');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(14), sha256(pg_temp.pk(14)), 4)$$,
  'version plus basse : sans effet');
SELECT is((SELECT media_version FROM edge_pwd_pack WHERE gateway_id = pg_temp.id('63e001') AND media_id = pg_temp.id('63bb01')), 5::bigint,
  'ON CONFLICT : version inférieure ignorée');
SELECT is((SELECT pwd_pack_enc FROM edge_pwd_pack WHERE gateway_id = pg_temp.id('63e001') AND media_id = pg_temp.id('63bb01')), pg_temp.pk(11),
  'ON CONFLICT : contenu inchangé');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(15), sha256(pg_temp.pk(15)), 6)$$,
  'version supérieure : remplace');
SELECT is((SELECT pwd_pack_enc FROM edge_pwd_pack WHERE gateway_id = pg_temp.id('63e001') AND media_id = pg_temp.id('63bb01')), pg_temp.pk(15),
  'colis remplacé');
SELECT pg_temp.ctx('63a002');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack(pg_temp.id('63e001'), pg_temp.id('63bb01'), pg_temp.pk(11), sha256(pg_temp.pk(11)), 9)$$,
  'P0002', NULL, 'autre prestataire : no_data_found (colis)');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'), sha256('x'), pg_temp.wk())$$,
  'P0002', NULL, 'autre prestataire : no_data_found (clé)');
SELECT pg_temp.ctx('63a001');
SELECT throws_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e004'), sha256('x'), pg_temp.wk())$$,
  'CL001', NULL, 'passerelle révoquée : clé refusée');

-- Passerelles en attente de colis : G5 (délai non écoulé) et G3 (STANDBY) absentes ; G2 (sans clé) présente ; G1 (clé et colis) selon bracelets.
SELECT ok(EXISTS (SELECT 1 FROM edge_gateways_awaiting_pack(100) WHERE gateway_id = pg_temp.id('63e002')), 'en attente : G2 (aucune clé)');
SELECT ok(NOT EXISTS (SELECT 1 FROM edge_gateways_awaiting_pack(100) WHERE gateway_id IN (pg_temp.id('63e003'), pg_temp.id('63e004'),
            pg_temp.id('63e005'))), 'en attente : ni STANDBY, ni révoquée, ni dans le délai');
SELECT ok(NOT EXISTS (SELECT 1 FROM edge_gateways_awaiting_pack(100) WHERE gateway_id = pg_temp.id('63e001')),
  'en attente : G1 (clé courante, aucun bracelet sans colis) absente');
SELECT throws_ok($$SELECT * FROM edge_gateways_awaiting_pack(0)$$, 'CL001', NULL, 'limite 0 refusée');

-- 5. Page : premier appel, soldes, cloisonnement --------------------------------------------------------------------
CREATE TEMP TABLE pg1 AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 200) AS p;
CREATE TEMP TABLE pg2 AS SELECT pg_temp.page('63a001', '63e002', 0, 0, 200) AS p;
SELECT ok((SELECT p ?& ARRAY['ledger_id', 'epoch', 'from_posting_id', 'to_posting_id', 'wallets', 'media', 'has_more',
            'edge_seq_applied', 'device_seq_acked', 'pwd_pack_key', 'reference'] FROM pg1), 'forme de ReplicationPage (G1)');
SELECT ok((SELECT p -> 'reference' ?& ARRAY['from_change_seq', 'to_change_seq', 'has_more', 'gateway', 'event', 'wallet_states',
            'devices', 'device_configs', 'cash_sessions', 'vendors', 'vendor_sessions', 'staff', 'catalogs', 'media_refs',
            'unassigned_media'] FROM pg1), 'forme de EdgeReference (G1)');
SELECT is((SELECT p ->> 'ledger_id' FROM pg1), pg_temp.ledger_of('63d001')::text, 'grand livre de G1');
SELECT is((SELECT (p -> 'wallets' -> 0 ->> 'paid')::bigint FROM pg1 WHERE p -> 'wallets' -> 0 ->> 'wallet_id' = pg_temp.id('6a0001')::text),
  100000::bigint, 'solde payé du portefeuille 1');
SELECT is((SELECT (w ->> 'promo')::bigint FROM pg1, jsonb_array_elements(p -> 'wallets') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0001')::text),
  20000::bigint, 'solde offert du portefeuille 1');
SELECT is((SELECT (w ->> 'topup_month_paid')::bigint FROM pg1, jsonb_array_elements(p -> 'wallets') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0001')::text),
  100000::bigint, 'recharges du mois UTC');
SELECT is((SELECT (w ->> 'kyc_verified')::boolean FROM pg1, jsonb_array_elements(p -> 'wallets') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0001')::text),
  false, 'palier d''identification : non vérifié');
SELECT is((SELECT p -> 'reference' -> 'event' -> 'wallet_limits' ->> 'unidentified_max_balance' FROM pg1), '200000', 'plafonds de la législation');
SELECT cmp_ok((SELECT (p ->> 'to_posting_id')::bigint FROM pg1), '<=', (SELECT max(id) FROM posting), 'to_posting_id <= horizon');
SELECT is((SELECT (p ->> 'edge_seq_applied')::bigint FROM pg1), (SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('63e001')),
  'edge_seq_applied = registre (même transaction que les soldes)');
SELECT is((SELECT count(*)::int FROM pg1, jsonb_array_elements(p -> 'reference' -> 'wallet_states') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0002')::text
            AND w ->> 'status' = 'BLOCKED'), 1, 'A03 : portefeuille bloqué sans écriture livré par le journal');
SELECT is((SELECT m ->> 'status' FROM pg1, jsonb_array_elements(p -> 'reference' -> 'media_refs') m WHERE m ->> 'media_id' = pg_temp.id('6b0002')::text),
  'SUSPENDED', 'A03 : statut du bracelet livré par le journal');
SELECT is((SELECT count(*)::int FROM pg1, jsonb_array_elements(p -> 'reference' -> 'unassigned_media') m WHERE m ->> 'media_id' = pg_temp.id('63bb01')::text),
  1, 'bracelet non attaché de l''événement livré');
SELECT is((SELECT p -> 'reference' -> 'gateway' ->> 'role' FROM pg1), 'PRIMARY', 'bloc gateway : rôle de l''appelante');
SELECT is((SELECT jsonb_array_length(p -> 'reference' -> 'devices') FROM pg1), 1, 'terminaux : celui de G1 seul');
SELECT is((SELECT p -> 'reference' -> 'devices' -> 0 -> 'token_family' FROM pg1), 'null'::jsonb,
  'empreinte du jeton de rafraîchissement NON servie (renforcement signalé)');
SELECT is((SELECT jsonb_array_length(p -> 'device_seq_acked') FROM pg1), 1, 'device_seq_acked : terminaux de G1 seuls');
SELECT is((SELECT p -> 'reference' -> 'catalogs' -> 0 -> 'items' -> 0 ->> 'name_fr' FROM pg1), 'Bissap', 'catalogue du point de vente de G1');
SELECT is((SELECT jsonb_array_length(p -> 'reference' -> 'staff' -> 0 -> 'roles') FROM pg1), 1,
  'personne : seul le rôle CASHIER (pas OPERATOR_ADMIN)');
-- Cloisonnement : aucun identifiant de G1 dans la page de G2, tableau par tableau ; contrôle positif sur G1.
CREATE TEMP TABLE g1ids AS SELECT unnest(ARRAY['6a0001', '6a0002', '6b0001', '6b0002', '63bb01', '63aa01', '63ab01', '63ac01', '63af01',
  '63f001', '63d0012', '63e001', '63d001']) AS k;
CREATE TEMP TABLE arrays(name text, path text[]);
INSERT INTO arrays VALUES ('wallets', '{wallets}'), ('media', '{media}'), ('device_seq_acked', '{device_seq_acked}'),
 ('wallet_states', '{reference,wallet_states}'), ('devices', '{reference,devices}'), ('device_configs', '{reference,device_configs}'),
 ('cash_sessions', '{reference,cash_sessions}'), ('vendors', '{reference,vendors}'), ('vendor_sessions', '{reference,vendor_sessions}'),
 ('staff', '{reference,staff}'), ('catalogs', '{reference,catalogs}'), ('media_refs', '{reference,media_refs}'),
 ('unassigned_media', '{reference,unassigned_media}'), ('gateway', '{reference,gateway}'), ('event', '{reference,event}');
SELECT is((SELECT count(*)::int FROM arrays a, pg2, g1ids i WHERE (pg2.p #>> a.path) ILIKE '%' || lpad(i.k, 12, '0') || '%'), 0,
  'G2 ne voit aucune entité de G1 (15 tableaux : tableau × identifiant)');
SELECT is((SELECT string_agg(a.name, ',') FROM arrays a, pg1 WHERE a.name NOT IN ('media', 'device_configs', 'device_seq_acked', 'gateway', 'event')
            AND NOT EXISTS (SELECT 1 FROM g1ids i WHERE (pg1.p #>> a.path) ILIKE '%' || lpad(i.k, 12, '0') || '%')), NULL,
  'contrôle positif : chaque tableau de G1 contient ses entités');
SELECT is((SELECT count(*)::int FROM pg1, jsonb_array_elements(p -> 'media') m WHERE m ->> 'nfc_uid' = '04630000000001'), 1,
  'contrôle positif : le bracelet de G1 est dans media[] de G1');
SELECT is((SELECT count(*)::int FROM pg2, jsonb_array_elements(p -> 'media') m WHERE m ->> 'nfc_uid' IN ('04630000000001', '04630000000002', '04630000a00001')), 0,
  'G2 ne voit aucun bracelet de G1 (media[])');
SELECT is((SELECT count(*)::int FROM pg2, jsonb_array_elements(p -> 'wallets') w), 1, 'G2 : son seul portefeuille');
SELECT is((SELECT count(*)::int FROM pg2, jsonb_array_elements(p -> 'reference' -> 'staff') s WHERE s ->> 'user_id' = pg_temp.id('63f002')::text),
  1, 'G2 : sa personne (SUPERVISOR)');
SELECT throws_ok($$SELECT pg_temp.page('63a001', '63e001', 0, 0)$$, NULL, NULL, 'sanité : page de G1 relue sans erreur') IS NULL OR true;
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e001'), 0, 0, 10)$$ || '', '42501', NULL,
  'G2 demande la page de G1 (app.gateway_id = G2) : 42501') ;
SELECT pg_temp.ctx('63a001', '63e002');
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e001'), 0, 0, 10)$$, '42501', NULL, 'page d''une autre passerelle : 42501');
SELECT pg_temp.ctx('63a002', '63e001');
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e001'), 0, 0, 10)$$, 'P0002', NULL, 'autre prestataire : no_data_found');
SELECT pg_temp.ctx('63a001', '63e004');
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e004'), 0, 0, 10)$$, '42501', NULL, 'passerelle révoquée : 42501');
SELECT pg_temp.ctx('63a001', '63e001');
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e001'), -1, 0, 10)$$, 'CL001', NULL, 'curseur négatif refusé');
SELECT throws_ok($$SELECT edge_replication_page(pg_temp.id('63e001'), 0, 0, 201)$$, 'CL001', NULL, 'limite > 200 refusée');
-- Vue étroite des numéros.
SELECT is((SELECT count(*)::int FROM edge_device_seq_acked), 1, 'vue edge_device_seq_acked : terminaux de G1 seuls');
SELECT pg_temp.ctx('63a001');
SELECT is((SELECT count(*)::int FROM edge_device_seq_acked), 0, 'vue sans passerelle en contexte : aucune ligne');

-- 6. Curseurs, rejeu, preuve d'application, pagination --------------------------------------------------------------
SELECT pg_temp.ctx('63a001', '63e001');
CREATE TEMP TABLE pa AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 3) AS p;
SELECT is((SELECT (p -> 'reference' ->> 'has_more')::boolean FROM pa), true, 'page de 3 : has_more de référence');
SELECT is((SELECT jsonb_array_length(p -> 'wallets') FROM pa), 2, 'page de 3 : soldes (deux portefeuilles de G1)');
CREATE TEMP TABLE pb AS SELECT pg_temp.page('63a001', '63e001', 0, (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pa), 3) AS p;
SELECT cmp_ok((SELECT (p -> 'reference' ->> 'from_change_seq')::bigint FROM pb), '=', (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pa),
  'curseur de référence repris sans trou');
SELECT is((SELECT reference_applied_seq FROM edge_gateway WHERE id = pg_temp.id('63e001')),
  (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pa), 'reference_applied_seq = curseur demandé (preuve d''application)');
SELECT is(pg_temp.page('63a001', '63e001', 0, (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pa), 3) - 'device_seq_acked',
  (SELECT p - 'device_seq_acked' FROM pb), 'curseur rejoué : même page (hors horodatage as_of)');
SELECT pg_temp.page('63a001', '63e001', 0, 0, 3);
SELECT cmp_ok((SELECT reference_applied_seq FROM edge_gateway WHERE id = pg_temp.id('63e001')), '>=',
  (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pa), 'reference_applied_seq ne recule jamais');
SELECT pg_temp.page('63a001', '63e001', 0, 9999999, 3);
SELECT is((SELECT reference_applied_seq FROM edge_gateway WHERE id = pg_temp.id('63e001')),
  (SELECT max(change_seq) FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d001')),
  'reference_applied_seq plafonné au journal : un curseur inventé ne l''avance pas au-delà');
SELECT pg_temp.page('63a001', '63e001', 0, NULL, 3);
SELECT is((pg_temp.page('63a001', '63e001', 0, NULL, 3)) ? 'reference', false, 'sans curseur de référence : bloc reference non servi');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements((pg_temp.page('63a001', '63e001', 0, 0, 200)) -> 'media') m
            WHERE m ->> 'token_hash' = encode(sha256('u1'), 'hex')), 0, 'bracelet non attaché : pas dans media[] (SnapshotEntry exige un portefeuille)');

-- Écriture après la page : visible à la page suivante par le curseur de postings.
CREATE TEMP TABLE pc AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 200) AS p;
SELECT pg_temp.ctx('63a001');
SELECT post_transaction(pg_temp.ledger_of('63d001'), 'TOPUP', 'late-1', now(), 'BATCH',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('63d001'), 'L-WAL-2-P'), 'amount', -777),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('63d001'), 'A-BANQUE'), 'amount', 777)));
CREATE TEMP TABLE pd AS SELECT pg_temp.page('63a001', '63e001', (SELECT (p ->> 'to_posting_id')::bigint FROM pc), 0, 200) AS p;
SELECT is((SELECT (w ->> 'paid')::bigint FROM pd, jsonb_array_elements(p -> 'wallets') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0002')::text),
  5777::bigint, 'écriture tardive livrée à la page suivante');
SELECT is((SELECT jsonb_array_length(p -> 'wallets') FROM pd), 1, 'page suivante : seulement le portefeuille touché');
SELECT is((SELECT (p ->> 'from_posting_id')::bigint FROM pd), (SELECT (p ->> 'to_posting_id')::bigint FROM pc), 'from = to précédent');
-- Faux de contrôle : un curseur sur posting.id seul ignorerait un blocage ; ici la page sans écriture le livre.
UPDATE wallet SET status = 'ACTIVE' WHERE id = pg_temp.id('6a0002');
CREATE TEMP TABLE pe AS SELECT pg_temp.page('63a001', '63e001', (SELECT (p ->> 'to_posting_id')::bigint FROM pd),
                                             (SELECT (p -> 'reference' ->> 'to_change_seq')::bigint FROM pc), 200) AS p;
SELECT is((SELECT jsonb_array_length(p -> 'wallets') FROM pe), 0, 'aucune écriture : aucun solde');
SELECT is((SELECT w ->> 'status' FROM pe, jsonb_array_elements(p -> 'reference' -> 'wallet_states') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0002')::text),
  'ACTIVE', 'déblocage sans écriture : livré par le journal à la page suivante');

-- 7. Horizon : repli sur l'horizon précédent quand le verrou n'est pas obtenu (dblink : seconde connexion) -------------
SELECT is((SELECT horizon FROM edge_replication_horizon WHERE ledger_id = pg_temp.ledger_of('63d001')), (SELECT max(id) FROM posting WHERE ledger_id = pg_temp.ledger_of('63d001')),
  'horizon mémorisé après les pages sûres');
CREATE TEMP TABLE h0 AS SELECT horizon AS h FROM edge_replication_horizon WHERE ledger_id = pg_temp.ledger_of('63d001');
SELECT post_transaction(pg_temp.ledger_of('63d001'), 'TOPUP', 'late-2', now(), 'BATCH',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('63d001'), 'L-WAL-2-P'), 'amount', -111),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('63d001'), 'A-BANQUE'), 'amount', 111)));
SELECT dblink_connect('wp08', 'dbname=' || current_database());
SELECT dblink_exec('wp08', 'BEGIN');
SELECT * FROM dblink('wp08', 'SELECT pg_advisory_xact_lock_shared(hashtextextended(''debit-authority:' || pg_temp.ledger_of('63d001')::text || ''', 0))::text') AS t(x text);
CREATE TEMP TABLE pf AS SELECT pg_temp.page('63a001', '63e001', 0, NULL, 200) AS p;
SELECT cmp_ok((SELECT (p ->> 'to_posting_id')::bigint FROM pf), '<=', (SELECT h FROM h0),
  'verrou non obtenu (une écriture en vol tient le verrou partagé) : horizon précédent servi, jamais dépassé');
SELECT is((SELECT horizon FROM edge_replication_horizon WHERE ledger_id = pg_temp.ledger_of('63d001')), (SELECT h FROM h0), 'horizon inchangé');
SELECT dblink_exec('wp08', 'ROLLBACK');
SELECT dblink_disconnect('wp08');
CREATE TEMP TABLE pg_ AS SELECT pg_temp.page('63a001', '63e001', (SELECT h FROM h0), NULL, 200) AS p;
SELECT cmp_ok((SELECT (p ->> 'to_posting_id')::bigint FROM pg_), '>', (SELECT h FROM h0), 'verrou libéré : l''horizon avance et livre l''écriture');
SELECT is((SELECT (w ->> 'paid')::bigint FROM pg_, jsonb_array_elements(p -> 'wallets') w WHERE w ->> 'wallet_id' = pg_temp.id('6a0002')::text),
  5888::bigint, 'écriture suivante livrée');

-- 8. Colis servis ou non (A16) ----------------------------------------------------------------------------------------
CREATE TEMP TABLE pk AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 200) AS p;
SELECT ok((SELECT p ? 'pwd_pack_key' FROM pk), 'PRIMARY hors délai avec clé : pwd_pack_key servie');
SELECT is((SELECT count(*)::int FROM pk, jsonb_array_elements(p -> 'reference' -> 'unassigned_media') m
            WHERE m -> 'pwd_pack_enc' ?& ARRAY['nonce', 'ciphertext', 'tag'] AND m ->> 'pwd_pack_sha256' = encode(sha256(pg_temp.pk(15)), 'hex')), 1,
  'colis du bracelet non attaché servi, chiffré (nonce, ciphertext, tag) avec son empreinte');
SELECT is((SELECT count(*)::int FROM pk, jsonb_array_elements(p -> 'media') m WHERE m -> 'pwd_pack_enc' ?& ARRAY['nonce', 'ciphertext', 'tag']), 1,
  'colis du bracelet attaché servi');
SELECT ok((SELECT position(encode(pg_temp.pk(15), 'hex') IN lower(p::text)) = 0 FROM pk), 'jamais le colis en clair brut (représentation hexadécimale)');
SELECT is((SELECT count(*)::int FROM pk, jsonb_array_elements(p -> 'media') m WHERE m ->> 'token_hash' = encode(sha256(convert_to('identité 2', 'UTF8')), 'hex')
            AND m -> 'pwd_pack_enc' = 'null'::jsonb), 1, 'bracelet sans colis déposé : pwd_pack_enc null');
-- STANDBY, dans le délai, révoquée : rien.
INSERT INTO edge_pwd_pack_key (gateway_id, operator_id, agreement_key_sha256, wrapped_key)
SELECT id, operator_id, sha256(agreement_public_key), pg_temp.wk() FROM edge_gateway WHERE id IN (pg_temp.id('63e003'), pg_temp.id('63e005'), pg_temp.id('63e004'));
SELECT pg_temp.ctx('63a001', '63e003');
SELECT is(NOT (pg_temp.page('63a001', '63e003', 0, 0, 200) ? 'pwd_pack_key'), true, 'STANDBY : aucune clé de colis, même déposée');
SELECT is(NOT (pg_temp.page('63a001', '63e005', 0, 0, 200) ? 'pwd_pack_key'), true, 'PRIMARY dans le délai de l''enrôlement : aucun colis');
-- Après promotion (role_changed_at), le délai repart pour G3 promue.
UPDATE edge_gateway SET role = 'PRIMARY', role_changed_at = now() WHERE id = pg_temp.id('63e003');
SELECT is(NOT (pg_temp.page('63a001', '63e003', 0, 0, 200) ? 'pwd_pack_key'), true, 'promue à l''instant : le délai repart, aucun colis');
UPDATE edge_gateway SET role_changed_at = now() - interval '2 hours' WHERE id = pg_temp.id('63e003');
SELECT is(pg_temp.page('63a001', '63e003', 0, 0, 200) ? 'pwd_pack_key', true, 'promue, délai écoulé : clé servie');
-- Clé d'accord changée : l'ancienne clé de contenu et ses colis ne sont plus servis.
UPDATE edge_gateway SET agreement_public_key = decode('04' || repeat('44', 64), 'hex') WHERE id = pg_temp.id('63e001');
CREATE TEMP TABLE pk2 AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 200) AS p;
SELECT ok((SELECT NOT (p ? 'pwd_pack_key') FROM pk2), 'clé d''accord changée : plus de clé de contenu servie');
SELECT is((SELECT count(*)::int FROM pk2, jsonb_array_elements(p -> 'media') m WHERE m -> 'pwd_pack_enc' ?& ARRAY['nonce']), 0,
  'clé d''accord changée : plus aucun colis servi');
SELECT ok(EXISTS (SELECT 1 FROM edge_gateways_awaiting_pack(100) WHERE gateway_id = pg_temp.id('63e001')), 'et la passerelle est de nouveau en attente');
SELECT lives_ok($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('63e001'), sha256(decode('04' || repeat('44', 64), 'hex')), pg_temp.wk())$$,
  'nouvelle clé de contenu pour la nouvelle clé d''accord');
SELECT is((SELECT count(*)::int FROM edge_pwd_pack WHERE gateway_id = pg_temp.id('63e001')), 0, 'anciens colis supprimés au changement de clé');

-- 9. Secrets : canaris ----------------------------------------------------------------------------------------------
SELECT pg_temp.ctx('63a001', '63e001');
CREATE TEMP TABLE pcan AS SELECT pg_temp.page('63a001', '63e001', 0, 0, 200)::text AS t;
SELECT is((SELECT count(*)::int FROM pcan WHERE t ~* 'canary|pin_hash|argon2|failed_attempts|@x\.test|\+22170|CanaryName|email|phone'), 0,
  'aucun pin_hash, compteur d''échecs, courriel, téléphone, nom dans la page rendue');
SELECT ok((SELECT t ~ 'Vendeur 1' FROM pcan), 'contrôle positif : le nom d''affichage du vendeur est servi (le canari serait vu)');
SELECT is((SELECT count(*)::int FROM pcan WHERE t ~* 'master|master_key|plaintext|pwd_pack_dek|OPERATOR_ADMIN|refresh_token'), 0,
  'aucune clé maître, PWD en clair, rôle autre que CASHIER/SUPERVISOR, jeton de rafraîchissement');

-- 10. Audit de la tolérance des jetons ---------------------------------------------------------------------------------
INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from, edge_seq_to, request_sha256, status)
VALUES (pg_temp.id('63ca01'), pg_temp.id('63a001'), pg_temp.id('63e001'), pg_temp.ledger_of('63d001'), 1, 10, 20, sha256('r'), 'PROCESSING');
INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from, edge_seq_to, request_sha256, status)
VALUES (pg_temp.id('63ca02'), pg_temp.id('63a001'), pg_temp.id('63e002'), pg_temp.ledger_of('63d002'), 1, 1, 5, sha256('r2'), 'PROCESSING');
CREATE FUNCTION pg_temp.arow(p_seq int, p_subject text DEFAULT 's1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('edge_seq', p_seq, 'at', '2026-11-06T10:00:00Z', 'subject', p_subject, 'issuer', 'iss', 'jti', 'j' || p_seq,
                            'seconds_past_expiry', 30, 'route', 'activateMedia', 'device_serial', 'T1') $$;
SELECT pg_temp.ctx('63a001', '63e001');
SELECT lives_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'),
   jsonb_build_array(pg_temp.arow(10), pg_temp.arow(20)))$$, 'deux lignes dans l''intervalle : consignées');
SELECT is((SELECT count(*)::int FROM edge_staff_token_audit), 2, 'deux lignes d''audit');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_STAFF_TOKEN_TOLERATED'), 2, 'recopie dans audit_log');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_STAFF_TOKEN_TOLERATED' AND after::text ~* 'token"|bearer|eyJ'), 0, 'aucun jeton dans l''audit');
SELECT lives_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'), jsonb_build_array(pg_temp.arow(10)))$$,
  'doublon identique : sans effet');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_STAFF_TOKEN_TOLERATED'), 2, 'doublon : pas de seconde copie');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'), jsonb_build_array(pg_temp.arow(10, 'autre')))$$,
  'CL002', NULL, 'même numéro, autre contenu : CL002');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'), jsonb_build_array(pg_temp.arow(11), pg_temp.arow(21)))$$,
  '23514', NULL, 'ligne hors intervalle du lot : refus');
SELECT is((SELECT count(*)::int FROM edge_staff_token_audit WHERE edge_seq = 11), 0, 'lot refusé en entier : la ligne valide n''est pas consignée');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'),
   (SELECT jsonb_agg(pg_temp.arow(10)) FROM generate_series(1, 501)))$$, '23514', NULL, '501 lignes : refus');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'), '[{"edge_seq": 12}]')$$,
  'CL001', NULL, 'ligne incomplète : refus');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca02'), jsonb_build_array(pg_temp.arow(2)))$$,
  'P0002', NULL, 'lot d''une autre passerelle : no_data_found');
SELECT throws_ok($$UPDATE edge_staff_token_audit SET subject = 'x'$$, NULL, NULL, 'audit immuable : UPDATE refusé');
SELECT throws_ok($$DELETE FROM edge_staff_token_audit$$, NULL, NULL, 'audit immuable : DELETE refusé');
SELECT throws_ok($$TRUNCATE edge_staff_token_audit$$, '42501', NULL, 'audit immuable : TRUNCATE refusé');
SELECT pg_temp.ctx('63a001', '63e002');
SELECT throws_ok($$SELECT edge_record_staff_token_audit(pg_temp.id('63e001'), pg_temp.id('63ca01'), '[]')$$, '42501', NULL,
  'audit d''une autre passerelle : 42501');

-- 11. Écritures directes refusées aux rôles applicatifs (garde indépendante des droits) ---------------------------------
SELECT pg_temp.ctx('63a001');
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit', 'edge_replication_horizon', 'edge_reference_change'] LOOP
    FOREACH r IN ARRAY ARRAY['cashless_app', 'cashless_edge', 'cashless_edgeadmin'] LOOP
      EXECUTE format('GRANT INSERT, UPDATE, DELETE, TRUNCATE, SELECT ON %I TO %I', t, r);
    END LOOP;
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.write_as(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    RESET ROLE; RETURN 'ECRIT';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; RETURN SQLSTATE;
  END;
END $$;
SELECT is(pg_temp.write_as(r, format('INSERT INTO %s SELECT * FROM %s LIMIT 0', t, t)) || '/' ||
          pg_temp.write_as(r, format('UPDATE %s SET operator_id = operator_id', t)), '42501/42501'::text,
  r || ' sur ' || t || ' : écritures refusées même avec le privilège de table')
  FROM unnest(ARRAY['edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit', 'edge_replication_horizon', 'edge_reference_change']) t,
       unnest(ARRAY['cashless_app', 'cashless_edge', 'cashless_edgeadmin']) r
 WHERE EXISTS (SELECT 1) LIMIT 15;
SELECT is(pg_temp.write_as('cashless_app', 'INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
  VALUES (gen_random_uuid(), 1, gen_random_uuid(), ''EVENT'', gen_random_uuid())'), '42501', 'cashless_app : insertion directe au journal refusée');
SELECT is(pg_temp.write_as('cashless_edge', 'TRUNCATE edge_pwd_pack'), '42501', 'cashless_edge : TRUNCATE refusé');

-- 12. Silence des passerelles (R-15) -------------------------------------------------------------------------------------
-- Les passerelles du fichier ont last_seen_at nul et registered_at ancien : elles passeront ISOLATED ; on vérifie par statut.
SELECT pg_temp.mk_event('63a001', '63b001', '63d008', '63e008', 'GW9', 'PRIMARY', NULL, interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d009', '63e009', 'GW10', 'PRIMARY', NULL, interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d010', '63e010', 'GW11', 'PRIMARY', NULL, interval '1 day');
SELECT pg_temp.mk_event('63a001', '63b001', '63d012', '63e012', 'GW12', 'PRIMARY', NULL, interval '1 day');
UPDATE edge_gateway SET last_seen_at = now() - interval '10 minutes' WHERE id IN (pg_temp.id('63e008'), pg_temp.id('63e009'));
UPDATE edge_gateway SET last_seen_at = now(), status = 'ISOLATED' WHERE id IN (pg_temp.id('63e010'), pg_temp.id('63e012'));
UPDATE edge_gateway SET last_seen_at = now() WHERE id IN (pg_temp.id('63e001'), pg_temp.id('63e002'), pg_temp.id('63e003'), pg_temp.id('63e005'),
  pg_temp.id('63e006'), pg_temp.id('63e007'));
UPDATE edge_gateway SET status = 'REVOKED', last_seen_at = now() - interval '1 day' WHERE id = pg_temp.id('63e009');
INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from, edge_seq_to, request_sha256, status, completed_at)
VALUES (pg_temp.id('63ca03'), pg_temp.id('63a001'), pg_temp.id('63e012'), pg_temp.ledger_of('63d012'), 1, 1, 2, sha256('r3'), 'DONE', now());
UPDATE debit_authority_handover SET status = status WHERE false;
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch, watermark_posting_id, requested_by)
VALUES (pg_temp.id('63a001'), pg_temp.ledger_of('63d008'), pg_temp.id('63e008'), 'TO_EDGE', 'ACTIVE', 1, 0, pg_temp.id('63f001'));
CREATE TEMP TABLE nsilent AS SELECT mark_edge_gateways_silent(interval '75 seconds')::int AS n;
SELECT cmp_ok((SELECT n FROM nsilent), '>=', 2, 'passages comptés (G8 -> ISOLATED, G10 -> ACTIVE au moins)');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('63e008')), 'ISOLATED', 'ACTIVE muette : ISOLATED');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('63e009')), 'REVOKED', 'REVOKED jamais touchée');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('63e010')), 'ACTIVE', 'ISOLATED revue, sans lot récent : retour ACTIVE');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('63e012')), 'ISOLATED', 'ISOLATED revue mais lot reçu il y a moins de 60 s : reste ISOLATED');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('63e001')), 'ACTIVE', 'ACTIVE récemment vue : intacte');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_ISOLATED' AND object_id = pg_temp.id('63e008')::text
            AND after ->> 'alert' = 'EDGE_SILENT'), 1, 'handover ouvert : alerte EDGE_SILENT');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_LINK_RESTORED' AND object_id = pg_temp.id('63e010')::text), 1,
  'retour à ACTIVE audité');
SELECT is(mark_edge_gateways_silent(interval '75 seconds')::int, 0, 'second passage : rien à faire');
SELECT throws_ok($$SELECT mark_edge_gateways_silent(interval '0')$$, 'CL001', NULL, 'seuil nul refusé');
UPDATE edge_gateway SET status = 'ACTIVE', last_seen_at = now() - interval '10 minutes' WHERE id = pg_temp.id('63e010');
SELECT mark_edge_gateways_silent(interval '75 seconds');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_ISOLATED' AND object_id = pg_temp.id('63e010')::text
            AND after ? 'alert'), 0, 'sans handover ouvert : pas d''alerte (audit seul)');

-- 13. Famille de jetons d'appareil (décision 11, OP-N102 ; décision 23) : empreinte servie seulement si exposée ----------
-- Terminaux : T1 (G1, PRIMARY), un terminal sur l'événement de G3 (STANDBY), un terminal du prestataire B (G6, PRIMARY).
SELECT pg_temp.ctx('63a001');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, public_key, cert_sha256)
VALUES (pg_temp.id('63aa03'), pg_temp.id('63a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('63d003'), 'T3',
        decode('3059' || repeat('aa', 40), 'hex'), sha256('T3'));
SELECT pg_temp.ctx('63a002');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, public_key, cert_sha256)
VALUES (pg_temp.id('63aa11'), pg_temp.id('63a002'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('63d011'), 'T11',
        decode('3059' || repeat('aa', 40), 'hex'), sha256('T11'));
INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at) VALUES
 (pg_temp.id('63ba01'), pg_temp.id('63a001'), pg_temp.id('63aa01'), pg_temp.id('63bf01'), sha256('canari-jeton-t1'),
  now() + interval '1 day'),
 (pg_temp.id('63ba03'), pg_temp.id('63a001'), pg_temp.id('63aa03'), pg_temp.id('63bf03'), sha256('canari-jeton-t3'),
  now() + interval '1 day'),
 (pg_temp.id('63ba11'), pg_temp.id('63a002'), pg_temp.id('63aa11'), pg_temp.id('63bf11'), sha256('canari-jeton-t11'),
  now() + interval '1 day');
-- Hostile : une ligne du prestataire A sur un terminal du prestataire B, exposée.
INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at, edge_exposed)
VALUES (pg_temp.id('63ba12'), pg_temp.id('63a001'), pg_temp.id('63aa11'), pg_temp.id('63bf12'), sha256('canari-jeton-croise'),
        now() + interval '1 day', true);
CREATE FUNCTION pg_temp.tf(p_op text, p_gw text, p_dev text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT d -> 'token_family' FROM jsonb_array_elements(pg_temp.page(p_op, p_gw, 0, 0, 200) -> 'reference' -> 'devices') d
   WHERE d ->> 'device_id' = pg_temp.id(p_dev)::text
$f$;
SELECT is((SELECT data_type FROM information_schema.columns WHERE table_name = 'device_refresh_token'
            AND column_name = 'edge_exposed'), 'boolean', 'device_refresh_token.edge_exposed : booléen');
SELECT is((SELECT is_nullable || ' ' || column_default FROM information_schema.columns
            WHERE table_name = 'device_refresh_token' AND column_name = 'edge_exposed'), 'NO false',
  'edge_exposed : NOT NULL DEFAULT false');
SELECT is(pg_temp.tf('63a001', '63e001', '63aa01'), 'null'::jsonb, 'famille non exposée : token_family null');
SELECT pg_temp.ctx('63a001');
CREATE TEMP TABLE seq0 AS SELECT max(change_seq) AS s FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d001');
UPDATE device_refresh_token SET edge_exposed = true WHERE id = pg_temp.id('63ba01');
SELECT cmp_ok((SELECT count(*)::int FROM edge_reference_change WHERE ledger_id = pg_temp.ledger_of('63d001')
                AND change_seq > (SELECT s FROM seq0) AND entity_kind = 'DEVICE' AND entity_id = pg_temp.id('63aa01')), '>=', 1,
  'exposition posée : une ligne DEVICE au journal (la passerelle relit le terminal)');
SELECT is(pg_temp.tf('63a001', '63e001', '63aa01'),
  jsonb_build_object('fid', pg_temp.id('63bf01'), 'status', 'ACTIVE',
                     'refresh_token_sha256_current', encode(sha256('canari-jeton-t1'), 'hex')),
  'famille exposée, passerelle PRIMARY : {fid, status ACTIVE, empreinte SHA-256}');
SELECT ok((SELECT position('canari-jeton-t1' IN lower(pg_temp.page('63a001', '63e001', 0, 0, 200)::text)) = 0),
  'jamais le jeton : seulement son empreinte');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.tf('63a001', '63e001', '63aa01')) k),
  ARRAY['fid', 'refresh_token_sha256_current', 'status'], 'token_family : trois clés exactement, rien d''autre');
-- STANDBY : jamais (G3 a été promue plus haut : on la rétrograde).
UPDATE edge_gateway SET role = 'STANDBY', role_changed_at = now() WHERE id = pg_temp.id('63e003');
UPDATE device_refresh_token SET edge_exposed = true WHERE id = pg_temp.id('63ba03');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.page('63a001', '63e003', 0, 0, 200) -> 'reference' -> 'devices') d
            WHERE d ->> 'device_id' = pg_temp.id('63aa03')::text), 1, 'le terminal est servi à la STANDBY');
SELECT is(pg_temp.tf('63a001', '63e003', '63aa03'), 'null'::jsonb, 'STANDBY : empreinte jamais servie, même exposée');
-- Autre prestataire : ni la ligne croisée (prestataire A sur terminal de B) ni les familles de B ne passent.
SELECT pg_temp.ctx('63a002');
UPDATE device_refresh_token SET edge_exposed = true WHERE id = pg_temp.id('63ba11');
SELECT is(pg_temp.tf('63a002', '63e011', '63aa11'),
  jsonb_build_object('fid', pg_temp.id('63bf11'), 'status', 'ACTIVE',
                     'refresh_token_sha256_current', encode(sha256('canari-jeton-t11'), 'hex')),
  'prestataire B : sa propre famille exposée est servie à sa PRIMARY');
SELECT ok((SELECT position(encode(sha256('canari-jeton-croise'), 'hex') IN pg_temp.page('63a002', '63e011', 0, 0, 200)::text) = 0),
  'ligne exposée d''un autre prestataire sur un terminal de B : jamais servie');
SELECT ok((SELECT position(encode(sha256('canari-jeton-t11'), 'hex') IN pg_temp.page('63a001', '63e001', 0, 0, 200)::text) = 0),
  'les familles du prestataire B ne sortent pas vers une passerelle du prestataire A');
-- Famille révoquée ou consommée : statut REVOKED servi (la passerelle refuse).
SELECT pg_temp.ctx('63a001');
UPDATE device_refresh_token SET revoked_at = now(), revoked_reason = 'DEVICE_REVOKED' WHERE id = pg_temp.id('63ba01');
SELECT is(pg_temp.tf('63a001', '63e001', '63aa01') ->> 'status', 'REVOKED', 'jeton révoqué au central : status REVOKED');
-- Passerelle révoquée : plus rien (edge_bind_gateway refuse déjà).
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('63e001');
SELECT throws_ok($$SELECT pg_temp.tf('63a001', '63e001', '63aa01')$$, NULL, NULL, 'passerelle révoquée : page refusée, aucune empreinte');

SELECT * FROM finish();
ROLLBACK;
