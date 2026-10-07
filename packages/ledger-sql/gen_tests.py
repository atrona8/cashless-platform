# Génère tests_grand_livre_cashless.sql (pgTAP) : chaque cas est une assertion qui échoue seule.
SN = "00000000-0000-0000-0000-000000000002"
CI = "00000000-0000-0000-0000-000000000009"
ORG = "00000000-0000-0000-0000-000000000003"
ORG2 = "00000000-0000-0000-0000-000000000005"
L = "10000000-0000-0000-0000-000000000001"
EV = "60000000-0000-0000-0000-000000000001"
A_WAVE, W1P, FOOD, ORGCOM = ("20000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002",
                             "20000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000004")
steps = []
def run(sql): steps.append(("run", sql))
def lives(sql, d): steps.append(("lives", sql, d))
def throws(sql, pat, d): steps.append(("throws", sql, pat, d))
def is_(q, exp, d): steps.append(("is", q, exp, d))
def ok(q, d): steps.append(("ok", q, d))
def throws_code(sql, code, d): steps.append(("throws_code", sql, code, d))
def section(t): steps.append(("section", t))

def lines(*pairs):
    return "'[" + ",".join('{"account_id":"%s","amount":%d}' % p for p in pairs) + "]'"
def post(typ, key, src, *pairs, occurred="now()", extra=""):
    return f"SELECT post_transaction('{L}','{typ}','{key}',{occurred},'{src}',{lines(*pairs)}{extra})"
def tap(tok, uid, counter, occurred="now()", device="NULL", mode="ONLINE", op=SN):
    return f"(SELECT result FROM register_tap('{op}', sha256('{tok}'::bytea), '{uid}', {counter}, {occurred}, {device}, '{mode}'))"

# ---------------------------------------------------------------- fixtures
run(f"SET app.operator_id = '{SN}'")
run(f"""INSERT INTO party (id, kind, legal_name) VALUES ('00000000-0000-0000-0000-000000000001','PLATFORM','Plateforme');
INSERT INTO party (id, kind, legal_name, country_code) VALUES ('{SN}','OPERATOR','Prestataire SN','SN'), ('{CI}','OPERATOR','Prestataire CI','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('{ORG}','ORGANIZER','{SN}','Organisateur','SN'), ('00000000-0000-0000-0000-000000000004','MERCHANT','{SN}','Food truck','SN'),
 ('{ORG2}','ORGANIZER','{SN}','Autre organisateur','SN');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('{L}','{SN}','EVENT', gen_random_uuid(),'XOF','{ORG}','{ORG}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('{A_WAVE}','{SN}','{L}','A-PSP-WAVE','ASSET','PSP',NULL,'D',false),
 ('{W1P}','{SN}','{L}','L-WAL-W01-P','CLAIM','WALLET_PAID',NULL,'C',false),
 ('{FOOD}','{SN}','{L}','L-MCH-FOOD','CLAIM','MERCHANT','00000000-0000-0000-0000-000000000004','C',true),
 ('{ORGCOM}','{SN}','{L}','L-ORG-COM','CLAIM','ORG_COM','{ORG}','C',false);
UPDATE account SET hot = true WHERE code IN ('L-ORG-COM','A-PSP-WAVE');""")

# ---------------------------------------------------------------- grand livre
section("Grand livre : écritures")
lives(post("TOPUP", "wave:abc", "PSP_WEBHOOK", (A_WAVE, 20000), (W1P, -20000)), "recharge de 20 000")
is_(f"({post('TOPUP','wave:abc','PSP_WEBHOOK',(A_WAVE,20000),(W1P,-20000))})",
    "(SELECT id FROM journal_transaction WHERE idempotency_key = 'wave:abc')", "rejeu identique : renvoie la même transaction")
is_("(SELECT count(*) FROM journal_transaction)::int", "1", "rejeu identique : aucun doublon")
throws(post("TOPUP", "wave:abc", "PSP_WEBHOOK", (A_WAVE, 99999), (W1P, -99999)), "%déjà utilisée avec un contenu différent%",
       "rejeu avec un autre montant refusé")
lives(post("PURCHASE", "dev1:1", "ONLINE", (W1P, 6000), (FOOD, -6000), (FOOD, 720), (ORGCOM, -720)), "vente + commission (4 lignes)")
lives(post("ADJUSTMENT", "adj:1", "BACKOFFICE", (W1P, 15000), (W1P, -2000), (FOOD, -13000),
           extra=", NULL, NULL, '90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002'"),
      "état intermédiaire négatif mais solde final valide : accepté")
throws(post("ADJUSTMENT", "adj:2", "BACKOFFICE", (FOOD, 100), (ORGCOM, -100),
            extra=", NULL, NULL, '90000000-0000-0000-0000-000000000001', NULL"), "%journal_transaction_check%",
       "saisie manuelle sans seconde validation refusée")
throws(post("PURCHASE", "dev1:2", "ONLINE", (W1P, 50000), (FOOD, -50000)), "Solde interdit%", "découvert refusé")
throws(post("PURCHASE", "dev1:3", "ONLINE", (W1P, 1000), (FOOD, -900)), "Lignes invalides%", "lignes déséquilibrées refusées")
throws(post("PAYMENT", "dev1:4", "ONLINE", (W1P, 100), (FOOD, -100)), "%journal_transaction_type_check%", "type de transaction inconnu refusé")
run(f"""INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000005','{SN}','{L}','L-ORG-CREANCES','CLAIM','ORG_RECEIVABLE','{ORG}','D',true)""")
lives(post("MERCHANT_DEBT_TRANSFER", "debt:1", "BATCH", ("20000000-0000-0000-0000-000000000005", 100), (FOOD, -100)),
      "dette d'un commerçant transférée à l'organisateur")
lives(post("MERCHANT_DEBT_TRANSFER", "debt:2", "BATCH", (FOOD, 100), ("20000000-0000-0000-0000-000000000005", -100)),
      "contre-écriture de test")
is_(f"(SELECT count(*) FROM merchant_participation WHERE pitch_fee_mode <> 'DEDUCT_OR_DEBT')::int", "0", "mode de droit de place par défaut : déduction, reste dû")
throws(post("REVERSAL", "dev1:5", "ONLINE", (FOOD, 100), (W1P, -100)), "%journal_transaction_check%", "contre-passation sans transaction d'origine refusée")
throws(post("ADJUSTMENT", "adj:3", "BATCH", (FOOD, 100), (ORGCOM, -100)), "%journal_transaction_check%", "écriture corrective hors back-office refusée")
throws_code(post("PURCHASE", "code:1", "ONLINE", (W1P, 99999999), (FOOD, -99999999)), "CL007", "solde insuffisant : SQLSTATE CL007")
throws_code(post("TOPUP", "wave:abc", "PSP_WEBHOOK", (A_WAVE, 1), (W1P, -1)), "CL002", "clé réutilisée : SQLSTATE CL002")
throws_code(post("PURCHASE", "code:2", "ONLINE", (W1P, 10), (FOOD, -9)), "CL001", "lignes invalides : SQLSTATE CL001")
lives(post("PITCH_FEE", "meta:1", "BATCH", (FOOD, 100), (ORGCOM, -100),
           extra=""", NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"device_occurred_at":"2026-12-11T19:10:00Z"}'::jsonb"""),
      "écriture avec métadonnées")
is_("(SELECT metadata->>'device_occurred_at' FROM journal_transaction WHERE idempotency_key = 'meta:1')", "'2026-12-11T19:10:00Z'",
    "métadonnées conservées (heure d'origine du terminal)")
throws("UPDATE posting SET amount = 1 WHERE id = (SELECT min(id) FROM posting)", "%ajout seul%", "modification d'une ligne refusée")
throws(f"INSERT INTO journal_transaction (operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source) VALUES ('{SN}','{L}','PURCHASE','direct:1','h',now(),'BATCH');"
       f"INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) SELECT '{SN}','{L}', id, 1, '{FOOD}', 5 FROM journal_transaction WHERE idempotency_key='direct:1';"
       "SET CONSTRAINTS ALL IMMEDIATE", "%déséquilibrée%", "filet de sécurité : écriture directe déséquilibrée refusée au commit")
run(f"UPDATE ledger SET status = 'CLOSING' WHERE id = '{L}'")
throws_code(post("PURCHASE", "dev1:4", "ONLINE", (W1P, 100), (FOOD, -100)), "CL004", "clôture : vente en ligne refusée (CL004)")
lives(post("PURCHASE", "dev2:17", "OFFLINE_SYNC", (W1P, 100), (FOOD, -100), occurred="now() - interval '1 hour'"),
      "clôture : synchro hors ligne acceptée")
run(f"UPDATE ledger SET status = 'OPEN', locked_until = now() - interval '10 minutes' WHERE id = '{L}'")
throws_code(post("PITCH_FEE", "late:1", "BATCH", (FOOD, 100), (ORGCOM, -100), occurred="now() - interval '1 day'"), "CL005",
       "écriture dans une période close refusée (CL005)")
run(f"UPDATE ledger SET locked_until = NULL, status = 'LOCKED' WHERE id = '{L}'")
throws_code(post("PITCH_FEE", "lock:1", "BATCH", (FOOD, 100), (ORGCOM, -100)), "CL003", "grand livre verrouillé : écriture refusée (CL003)")
run(f"UPDATE ledger SET status = 'OPEN' WHERE id = '{L}'")
throws(post("PITCH_FEE", "x:1", "BATCH", ("20000000-0000-0000-0000-00000000dead", 100), (ORGCOM, -100)), "Compte inconnu%",
       "compte inconnu refusé")
throws("UPDATE account SET hot = true WHERE code = 'L-WAL-W01-P'", "%account_check%", "un portefeuille ne peut pas être hot")
is_(f"(SELECT hot FROM account WHERE id = '{FOOD}')", "true", "compte commerçant chaud par défaut")
is_("(SELECT count(*) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.hot)::int", "0",
    "comptes hot : pas de solde en cache")
is_("(SELECT count(*) FROM hot_account_side_check)::int", "0", "comptes hot : du bon côté")
is_(f"(SELECT must_be_zero FROM ledger_invariant WHERE ledger_id = '{L}')::bigint", "0", "invariant : argent = droits")
is_("(SELECT count(*) FROM balance_drift)::int", "0", "solde en cache = recalcul")

# ---------------------------------------------------------------- cloisonnement
section("Cloisonnement entre prestataires")
run("DROP ROLE IF EXISTS app_test; CREATE ROLE app_test; GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_test;"
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_test")
run("INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings) VALUES (NULL,'PLATFORM', gen_random_uuid(), 1, now(), '{}')")
run(f"SET ROLE app_test; SET app.operator_id = '{CI}'")
is_("(SELECT count(*) FROM posting)::int", "0", "autre prestataire : aucune ligne visible")
is_("(SELECT count(*) FROM trial_balance)::int", "0", "autre prestataire : vue de balance vide (security_invoker)")
is_(f"(SELECT count(*) FROM party WHERE id = '{ORG}')::int", "0", "autre prestataire : organisateur invisible")
is_(f"(SELECT count(*) FROM party WHERE kind = 'PLATFORM')::int", "1", "plateforme visible de tous")
is_("(SELECT count(*) FROM config_version WHERE scope_type = 'PLATFORM')::int", "1", "configuration de niveau plateforme lisible par un prestataire")
run("RESET ROLE; GRANT INSERT ON config_version TO app_test; SET ROLE app_test")
throws("INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings) VALUES (NULL,'PLATFORM', gen_random_uuid(), 2, now(), '{}')",
       "%row-level security%", "un prestataire ne peut pas écrire une configuration de niveau plateforme")
throws(post("ADJUSTMENT", "xt:1", "BATCH", (FOOD, 100), (ORGCOM, -100)), "Objet introuvable", "autre prestataire : écriture refusée")
run(f"SET app.operator_id = '{SN}'")
is_("(SELECT count(*) FROM posting)::int > 0", "true", "bon prestataire : ses lignes sont visibles")
throws(f"INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) SELECT operator_id, ledger_id, transaction_id, 99, account_id, 1 FROM posting LIMIT 1",
       "%permission denied%", "rôle applicatif : insertion directe interdite")
run(f"RESET ROLE; SET app.operator_id = '{SN}'")

# ---------------------------------------------------------------- NFC
section("Bracelets NFC : passages et clones")
run(f"""INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000001','{SN}','{L}');
UPDATE account SET wallet_id = '30000000-0000-0000-0000-000000000001' WHERE code = 'L-WAL-W01-P';
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
 ('40000000-0000-0000-0000-000000000001','{SN}','NFC_TAG', sha256('\\x3f9a1c7e5b2d48e0a6c4f1d29b7e0c53'::bytea), '\\x04a1b2c3d4e5f6','30000000-0000-0000-0000-000000000001','ACTIVE'),
 ('40000000-0000-0000-0000-000000000002','{SN}','NFC_TAG', sha256('\\x00'::bytea), '\\x04000000000002','30000000-0000-0000-0000-000000000001','ACTIVE')""")
T1 = "\\x3f9a1c7e5b2d48e0a6c4f1d29b7e0c53"
is_(f"{tap(T1, chr(92)+'x04a1b2c3d4e5f6', 41, occurred=chr(110)+'ow() - interval '+chr(39)+'1 hour'+chr(39))}", "'OK'", "passage n° 41 accepté")
is_(f"{tap(T1, chr(92)+'x04a1b2c3d4e5f6', 40, occurred='now() - interval '+chr(39)+'2 hours'+chr(39), mode='OFFLINE')}", "'OK'",
    "passage hors ligne n° 40 arrivé en retard : accepté")
is_(f"{tap(T1, chr(92)+'x04a1b2c3d4e5f6', 41, mode='OFFLINE')}", "'CLONE_SUSPECTED'", "même compteur vu deux fois : clone")
is_("(SELECT status FROM media WHERE id = '40000000-0000-0000-0000-000000000001')", "'BLACKLISTED'", "clone : bracelet en liste noire")
is_(f"{tap(T1, chr(92)+'x04999999999999', 60)}", "'UID_MISMATCH'", "UID différent : refusé")
throws(f"SELECT {tap(T1, chr(92)+'x04a1b2c3d4e5f6', 99, op=CI)}", "Objet introuvable", "passage déclaré pour un autre prestataire : refusé")
is_(f"(SELECT spendable FROM offline_snapshot_rows WHERE token_hash = sha256('{T1}'::bytea))", "900", "snapshot : solde disponible")
run(f"SELECT {tap(chr(92)+'x00', chr(92)+'x04000000000002', 90, occurred='now() - interval '+chr(39)+'3 hours'+chr(39))}")
run(f"SELECT {tap(chr(92)+'x00', chr(92)+'x04000000000002', 12, mode='OFFLINE')}")
is_("(SELECT count(*) FROM counter_time_inversion WHERE media_id = '40000000-0000-0000-0000-000000000002')::int", "1",
    "compteur plus petit plus tard : inversion détectée")

# ---------------------------------------------------------------- événements, hors ligne, passerelle
section("Politique hors ligne, passerelle, terminaux, contrats")
run(f"""INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 ('50000000-0000-0000-0000-000000000001','SN',1,'2026-01-01','ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('{EV}','{SN}','{ORG}','Festival Sons 2026','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','OPERATOR');
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('70000000-0000-0000-0000-000000000001','{SN}','POS','{EV}','TPE-BAR-01'),
 ('70000000-0000-0000-0000-000000000002','{SN}','POS','{EV}','TPE-FOOD-01')""")
is_("(SELECT offline_enabled FROM effective_offline_policy('70000000-0000-0000-0000-000000000001'))", "false",
    "sans règle : hors ligne désactivé")
run(f"""INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale, max_per_media_per_device, max_total_per_device, max_snapshot_age) VALUES
 ('{SN}','ORGANIZER','{ORG}', true, 5000, 10000, 300000, '10 minutes'),
 ('{SN}','EVENT','{EV}', NULL, 3000, NULL, NULL, NULL),
 ('{SN}','DEVICE','70000000-0000-0000-0000-000000000002', false, NULL, NULL, NULL, NULL),
 ('{SN}','OPERATOR_CEILING','{SN}', NULL, NULL, 8000, NULL, NULL)""")
is_("(SELECT row(offline_enabled, max_per_sale, max_per_media_per_device, capped)::text FROM effective_offline_policy('70000000-0000-0000-0000-000000000001'))",
    "'(t,3000,8000,t)'", "cascade : activé, 3 000 par vente, 8 000 par bracelet (plafond prestataire)")
is_("(SELECT offline_enabled FROM effective_offline_policy('70000000-0000-0000-0000-000000000002'))", "false", "règle terminal : désactivé")
is_(f"set_debit_authority('{L}', 'EDGE', 'e0000000-0000-0000-0000-000000000001')", "1", "bascule vers la passerelle : époque 1")
throws(f"SELECT set_debit_authority('{L}', 'EDGE', NULL)", "Autorité invalide%", "bascule EDGE sans passerelle refusée")
throws(post("PURCHASE", "central:1", "ONLINE", (W1P, 100), (FOOD, -100)), "%passerelle locale%", "passerelle isolée : débit central refusé")
lives(post("TOPUP", "wave:web-99", "PSP_WEBHOOK", (A_WAVE, 5000), (W1P, -5000)), "passerelle isolée : crédit central accepté")
lives(post("PURCHASE", "edge:GW1:0001", "EDGE_SYNC", (W1P, 100), (FOOD, -100), occurred="now() - interval '5 minutes'"),
      "passerelle : synchro de ses ventes acceptée")
is_(f"set_debit_authority('{L}', 'CENTRAL')", "2", "retour au central : époque 2")
throws(f"INSERT INTO device (operator_id, kind, os, nfc_enabled, event_id, serial) VALUES ('{SN}','POS','IOS', true,'{EV}','IPAD-01')",
       "%device_check%", "terminal iOS avec NFC refusé")
lives(f"INSERT INTO device (operator_id, kind, app_mode, os, nfc_enabled, event_id, serial) VALUES ('{SN}','POS','KEYPAD_TPE','IOS', false,'{EV}','IPAD-02')",
      "terminal iOS en QR accepté")
throws(f"INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id) VALUES ('{SN}','{ORG}','Sans choix','EUR','Europe/Paris','50000000-0000-0000-0000-000000000001')",
       "%funds_holder%", "événement sans détenteur des fonds refusé")
throws(f"INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer) VALUES ('{SN}','OPERATOR_ORGANIZER','{ORG}', now(), 'ORGANIZER')",
       "%contract_check%", "contrat prestataire–organisateur incomplet refusé")

# ---------------------------------------------------------------- clés
section("Clés et mots de passe stockés")
run(f"""INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('{SN}', 1, 'arn:aws:kms:eu-west-3:111122223333:key/hmac-test');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 ('80000000-0000-0000-0000-000000000001','{SN}',1,1,'arn:aws:kms:eu-west-3:111122223333:key/wrap-test','\\xdeadbeef')""")
throws(f"INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES ('{SN}',1,2,'k','\\x00')",
       "%tag_data_key_one_active%", "une seule clé de données active par index")
throws("UPDATE media SET personalized_at = now() WHERE id = '40000000-0000-0000-0000-000000000002'", "%media_check%",
       "bracelet personnalisé sans mot de passe chiffré refusé")
throws("UPDATE media SET pwd_pack_enc = decode(repeat('00',33),'hex'), pwd_pack_dek_id = '80000000-0000-0000-0000-000000000001' WHERE id = '40000000-0000-0000-0000-000000000002'",
       "%pwd_pack_enc_check%", "mot de passe chiffré de mauvaise longueur refusé")
lives("UPDATE media SET pwd_pack_enc = '\\x000102030405060708090a0bf282e1ec76777dd9d1a82c60ad37fdcb0c2afc4a80b2', pwd_pack_dek_id = '80000000-0000-0000-0000-000000000001', personalized_at = now() WHERE id = '40000000-0000-0000-0000-000000000002'",
      "vecteur de test chiffré (34 octets) accepté")

# ---------------------------------------------------------------- lots
section("Lots de bracelets : validité par événement, préchargement, clé dédiée")
run(f"""INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('60000000-0000-0000-0000-000000000002','{SN}','{ORG}','Festival Sons 2027','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','OPERATOR'),
 ('60000000-0000-0000-0000-000000000003','{SN}','{ORG2}','Concert autre organisateur','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','OPERATOR');
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('70000000-0000-0000-0000-000000000010','{SN}','POS','60000000-0000-0000-0000-000000000002','TPE-2027-01'),
 ('70000000-0000-0000-0000-000000000011','{SN}','POS','60000000-0000-0000-0000-000000000003','TPE-AUTRE-01');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status) VALUES
 ('90000000-0000-0000-0000-000000000001','{SN}','{ORG}','{EV}','PUBLIC',1000,1,'ACTIVE'),
 ('90000000-0000-0000-0000-000000000002','{SN}','{ORG}', NULL,'PUBLIC',500,1,'ACTIVE'),
 ('90000000-0000-0000-0000-000000000003','{SN}','{ORG}','{EV}','PUBLIC',100,1,'DELIVERED');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, wallet_id, status) VALUES
 ('40000000-0000-0000-0000-000000000011','{SN}','NFC_TAG', sha256('\\x11'::bytea), '\\x04000000000011','90000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ACTIVE'),
 ('40000000-0000-0000-0000-000000000012','{SN}','NFC_TAG', sha256('\\x12'::bytea), '\\x04000000000012','90000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','ACTIVE'),
 ('40000000-0000-0000-0000-000000000013','{SN}','NFC_TAG', sha256('\\x13'::bytea), '\\x04000000000013','90000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','ACTIVE')""")
D1, D10, D11 = "'70000000-0000-0000-0000-000000000001'", "'70000000-0000-0000-0000-000000000010'", "'70000000-0000-0000-0000-000000000011'"
is_(tap("\\x11", "\\x04000000000011", 1, device=D1), "'OK'", "lot 2026 au festival 2026 : accepté")
is_(tap("\\x11", "\\x04000000000011", 2, device=D10), "'WRONG_EVENT'", "lot 2026 au festival 2027 : refusé")
is_(tap("\\x12", "\\x04000000000012", 1, device=D10), "'OK'", "lot réutilisable, même organisateur : accepté")
is_(tap("\\x11", "\\x04000000000011", 1, device=D1), "'OK'", "renvoi réseau de la même lecture (même terminal, dans le délai) : même résultat")
is_("(SELECT count(*) FROM anomaly WHERE media_id = '40000000-0000-0000-0000-000000000011')::int", "0", "renvoi réseau : aucune anomalie")
run("UPDATE event SET tap_replay_window_seconds = 0 WHERE id = '60000000-0000-0000-0000-000000000001'")
is_(tap("\\x11", "\\x04000000000011", 1, device=D1), "'OK'", "même lecture jamais utilisée pour une écriture : réutilisée hors délai (revue 2)")
run("UPDATE media_tap SET transaction_id = gen_random_uuid() WHERE media_id = '40000000-0000-0000-0000-000000000011' AND counter = 1")
is_(tap("\\x11", "\\x04000000000011", 1, device=D1), "'CLONE_SUSPECTED'", "délai de renvoi à 0 : même compteur = copie suspectée")
run("UPDATE event SET tap_replay_window_seconds = 120 WHERE id = '60000000-0000-0000-0000-000000000001'; SELECT reinstate_media('40000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'test du délai de renvoi')")
is_("(SELECT cash_refund_single_max FROM event WHERE id = '60000000-0000-0000-0000-000000000001')::bigint", "50000", "remboursement espèces : une personne jusqu'à 50 000 par défaut")
throws("UPDATE event SET cash_refund_single_max = -1 WHERE id = '60000000-0000-0000-0000-000000000001'", "%cash_refund_single_max%", "plafond de remboursement espèces négatif refusé")
throws("UPDATE event SET tap_replay_window_seconds = 3600 WHERE id = '60000000-0000-0000-0000-000000000001'", "%tap_replay_window_seconds%", "délai de renvoi borné à 10 minutes")
run("UPDATE media_tap SET received_at = received_at - interval '1 hour' WHERE media_id = '40000000-0000-0000-0000-000000000012' AND counter = 1")
OT = "(SELECT id FROM media_tap WHERE media_id = '40000000-0000-0000-0000-000000000012' AND counter = 1)"
is_(f"(SELECT result FROM register_tap('{SN}', sha256('\\x12'::bytea), '\\x04000000000012', 1, now(), {D10}, 'OFFLINE', NULL, {OT}))", "'OK'",
    "lot hors ligne citant la lecture enregistrée en ligne, hors délai : réutilisée, pas de copie")
is_(f"(SELECT result FROM register_tap('{SN}', sha256('\\x12'::bytea), '\\x04000000000012', 1, now(), {D1}, 'OFFLINE', NULL, {OT}))", "'CLONE_SUSPECTED'",
    "lecture citée depuis un autre terminal : copie suspectée")
is_(tap("\\x12", "\\x04000000000012", 2, device=D11), "'WRONG_EVENT'", "lot réutilisable, autre organisateur : refusé")
is_(tap("\\x13", "\\x04000000000013", 1, device=D1), "'BATCH_INACTIVE'", "lot livré non activé : refusé")
run("UPDATE media SET originality_sig_sha256 = sha256('\\x5151'::bytea) WHERE id = '40000000-0000-0000-0000-000000000011'")
is_(f"(SELECT result FROM register_tap('{SN}', sha256('\\x11'::bytea), '\\x04000000000011', 3, now(), {D1}, 'ONLINE', NULL, NULL, '\\x5151'))", "'OK'",
    "signature d'originalité identique à celle de la personnalisation : acceptée")
is_(f"(SELECT result FROM register_tap('{SN}', sha256('\\x11'::bytea), '\\x04000000000011', 4, now(), {D1}, 'ONLINE', NULL, NULL, '\\x9999'))", "'SIGNATURE_MISMATCH'",
    "autre signature d'originalité : autre puce, refusée et mise en liste noire")
is_("(SELECT count(*) FROM anomaly WHERE media_id = '40000000-0000-0000-0000-000000000011' AND kind = 'SIGNATURE_MISMATCH')::int", "1", "anomalie SIGNATURE_MISMATCH ouverte")
run("SELECT reinstate_media('40000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'test de signature')")
throws(f"INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES ('{SN}','{ORG}','{EV}','TICKET',10,1)",
       "%media_batch_kind_check%", "lot de bracelets-billets refusé (bracelets exclusivement cashless)")
run(f"""INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 ('30000000-0000-0000-0000-000000000021','{SN}','{L}'), ('30000000-0000-0000-0000-000000000022','{SN}','{L}');
INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, wallet_id, normal_side, allow_negative) VALUES
 ('{SN}','{L}','L-WAL-S21-X','CLAIM','WALLET_PROMO',NULL,'30000000-0000-0000-0000-000000000021','C',false),
 ('{SN}','{L}','L-WAL-S22-X','CLAIM','WALLET_PROMO',NULL,'30000000-0000-0000-0000-000000000022','C',false),
 ('{SN}','{L}','L-ORG-PROMO','CLAIM','ORG_PROMO','{ORG}',NULL,'D',true);
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, preload_promo_amount) VALUES
 ('90000000-0000-0000-0000-000000000010','{SN}','{ORG}','{EV}','STAFF',2,1,'ACTIVE',6000);
INSERT INTO media (operator_id, kind, token_hash, nfc_uid, batch_id, wallet_id, status) VALUES
 ('{SN}','NFC_TAG', sha256('\\x21'::bytea), '\\x04000000000021','90000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000021','ACTIVE'),
 ('{SN}','NFC_TAG', sha256('\\x22'::bytea), '\\x04000000000022','90000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000022','ACTIVE')""")
lives("SELECT preload_batch('90000000-0000-0000-0000-000000000010')", "préchargement du lot staff")
lives("SELECT preload_batch('90000000-0000-0000-0000-000000000010')", "préchargement relancé")
is_("(SELECT total_debit FROM trial_balance WHERE code = 'L-ORG-PROMO')::bigint", "12000", "préchargement : 2 × 6 000, sans doublon")
run(f"""INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000023','{SN}','{L}');
INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('{SN}','{L}','L-WAL-S23-X','CLAIM','WALLET_PROMO','30000000-0000-0000-0000-000000000023','C',false);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000023','{SN}','NFC_TAG', sha256('\\x23'::bytea), '\\x04000000000023','90000000-0000-0000-0000-000000000010')""")
lives("SELECT activate_media('40000000-0000-0000-0000-000000000023','30000000-0000-0000-0000-000000000023')", "activation tardive d'un bracelet staff")
is_("(SELECT total_debit FROM trial_balance WHERE code = 'L-ORG-PROMO')::bigint", "18000", "activation tardive : préchargement posé à l'activation")
is_("wallet_spendable('30000000-0000-0000-0000-000000000023')", "6000", "bracelet activé tard : crédits offerts disponibles")
run(f"""INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000024','{SN}','NFC_TAG', sha256('\\x24'::bytea), '\\x04000000000024','90000000-0000-0000-0000-000000000010');
UPDATE media SET status = 'SUSPENDED' WHERE id = '40000000-0000-0000-0000-000000000023'""")
lives("SELECT replace_media('40000000-0000-0000-0000-000000000023','40000000-0000-0000-0000-000000000024')", "remplacement d'un bracelet staff préchargé")
is_("(SELECT total_debit FROM trial_balance WHERE code = 'L-ORG-PROMO')::bigint", "18000", "remplacement : aucun nouveau préchargement, aucune écriture")
is_("wallet_spendable('30000000-0000-0000-0000-000000000023')", "6000", "remplacement : le portefeuille garde ses crédits")
run(f"""INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000014','{SN}','NFC_TAG', sha256('\\x14'::bytea), '\\x04000000000014','90000000-0000-0000-0000-000000000002')""")
throws_code("SELECT activate_media('40000000-0000-0000-0000-000000000014','30000000-0000-0000-0000-000000000021')", "CL001",
            "lot réutilisable : activation sans événement refusée")
lives(f"SELECT activate_media('40000000-0000-0000-0000-000000000014','30000000-0000-0000-0000-000000000021','DESK','{EV}')",
      "lot réutilisable : activation avec l'événement")
run(f"INSERT INTO tag_key (operator_id, key_index, kms_key_ref, scope, dedicated_event_id) VALUES ('{SN}', 40000, 'k-evt', 'DEDICATED','{EV}')")
throws(f"INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES ('{SN}','{ORG}','{EV}','PUBLIC',10,40000)",
       "Lot partagé%", "lot partagé sur une clé dédiée refusé")
throws(f"INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode) VALUES ('{SN}','{ORG}','60000000-0000-0000-0000-000000000002','PUBLIC',10,40000,'DEDICATED')",
       "Lot à clé dédiée%", "clé dédiée utilisée pour un autre événement refusée")
throws(f"INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode, reuse_policy) VALUES ('{SN}','{ORG}','{EV}','PUBLIC',10,40000,'DEDICATED','POOL')",
       "%media_batch_check%", "lot à clé dédiée en POOL refusé")
run(f"""INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode, status) VALUES
 ('90000000-0000-0000-0000-000000000040','{SN}','{ORG}','{EV}','PUBLIC',20000,40000,'DEDICATED','ACTIVE')""")
throws(f"INSERT INTO media (operator_id, kind, token_hash, nfc_uid, batch_id, key_index) VALUES ('{SN}','NFC_TAG', sha256('\\x40'::bytea), '\\x04000000000040','90000000-0000-0000-0000-000000000040', 1)",
       "%index de clé de son lot%", "bracelet avec un autre index que son lot refusé")
run(f"""INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id, status) VALUES
 ('40000000-0000-0000-0000-000000000040','{SN}','NFC_TAG', sha256('\\x40'::bytea), '\\x04000000000040','90000000-0000-0000-0000-000000000040', 40000,'30000000-0000-0000-0000-000000000001','ACTIVE')""")
is_(tap("\\x40", "\\x04000000000040", 1, device=D1), "'OK'", "bracelet à clé dédiée pendant l'événement : accepté")
throws(f"SELECT retire_dedicated_key('{SN}', 40000)", "Tous les lots%", "retrait de clé avant clôture du lot refusé")
run("UPDATE media_batch SET status = 'CLOSED' WHERE id = '90000000-0000-0000-0000-000000000040'")
run(f"""INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 ('a1000000-0000-0000-0000-000000040000','{SN}',40000,1,'k-wrap-evt','\\x01');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id) VALUES
 ('40000000-0000-0000-0000-000000000041','{SN}','NFC_TAG', sha256('\\x41'::bytea), '\\x04000000000041','90000000-0000-0000-0000-000000000040', 40000,
  '30000000-0000-0000-0000-000000000001', 'ACTIVE', now(), decode(repeat('ab', 34), 'hex'), 'a1000000-0000-0000-0000-000000040000');
UPDATE media SET status = 'REPLACED' WHERE id = '40000000-0000-0000-0000-000000000041'""")
is_(f"retire_dedicated_key('{SN}', 40000)", "1", "retrait de la clé dédiée : 1 bracelet retiré")
is_("(SELECT pwd_pack_enc IS NULL AND status = 'RETIRED' FROM media WHERE id = '40000000-0000-0000-0000-000000000040')", "true",
    "retrait : secret effacé, bracelet retiré")
is_(tap("\\x40", "\\x04000000000040", 2, device=D1), "'RETIRED'", "après retrait : refusé")
is_("(SELECT pwd_pack_enc IS NULL AND status = 'REPLACED' FROM media WHERE id = '40000000-0000-0000-0000-000000000041')", "true",
    "retrait : secret effacé aussi sur un bracelet remplacé")
throws(f"SELECT retire_dedicated_key('{SN}', 1)", "Seule une clé dédiée%", "retrait d'une clé partagée refusé")

# ---------------------------------------------------------------- cycle de vie
section("Cycle de vie des bracelets")
run(f"""INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, reuse_policy) VALUES
 ('90000000-0000-0000-0000-000000000050','{SN}','{ORG}', NULL,'PUBLIC',4,1,'ACTIVE','POOL'),
 ('90000000-0000-0000-0000-000000000051','{SN}','{ORG}','{EV}','PUBLIC',2,1,'ACTIVE','SINGLE_USE');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000050','{SN}','{L}'), ('30000000-0000-0000-0000-000000000051','{SN}','{L}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000050','{SN}','{L}','L-WAL-P50-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000050','C',false);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000050','{SN}','NFC_TAG', sha256('\\x50'::bytea), '\\x04000000000050','90000000-0000-0000-0000-000000000050'),
 ('40000000-0000-0000-0000-000000000051','{SN}','NFC_TAG', sha256('\\x51'::bytea), '\\x04000000000051','90000000-0000-0000-0000-000000000051'),
 ('40000000-0000-0000-0000-000000000052','{SN}','NFC_TAG', sha256('\\x52'::bytea), '\\x04000000000052','90000000-0000-0000-0000-000000000050')""")
is_("(SELECT status FROM media WHERE id = '40000000-0000-0000-0000-000000000050')", "'PERSONALIZED'", "un bracelet naît en stock")
throws("UPDATE media SET status = 'RELEASED' WHERE id = '40000000-0000-0000-0000-000000000050'", "Passage interdit%", "en stock -> rendu : interdit")
is_(tap("\\x50", "\\x04000000000050", 1, device=D1), "'NOT_ACTIVATED'", "en stock : refusé en caisse")
lives("SELECT activate_media('40000000-0000-0000-0000-000000000050','30000000-0000-0000-0000-000000000050','DESK','60000000-0000-0000-0000-000000000001')", "activation au guichet")
lives(post("TOPUP", "wave:pool-1", "PSP_WEBHOOK", (A_WAVE, 3000), ("20000000-0000-0000-0000-000000000050", -3000)), "recharge du bracelet POOL")
throws("SELECT release_media('40000000-0000-0000-0000-000000000050')", "Restitution refusée : solde%", "restitution avec solde refusée")
lives(post("WALLET_REFUND", "refund:pool-1", "ONLINE", ("20000000-0000-0000-0000-000000000050", 3000), (A_WAVE, -3000)), "remboursement du solde")
lives("SELECT release_media('40000000-0000-0000-0000-000000000050')", "restitution une fois soldé")
lives("SELECT reassign_pool_media('40000000-0000-0000-0000-000000000050', sha256('\\x50b1'::bytea))", "réattribution POOL avec nouvelle identité")
lives("SELECT activate_media('40000000-0000-0000-0000-000000000050','30000000-0000-0000-0000-000000000051','DESK','60000000-0000-0000-0000-000000000001')", "activation pour le nouveau détenteur")
is_(tap("\\x50", "\\x04000000000050", 5, device=D1), "'CLONE_SUSPECTED'", "ancienne identité : copie détectée")
is_(tap("\\x50b1", "\\x04000000000050", 6, device=D1), "'OK'", "nouvelle identité : acceptée")
run(f"INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES ('40000000-0000-0000-0000-000000000053','{SN}','NFC_TAG', sha256('\\x53'::bytea), '\\x04000000000053','90000000-0000-0000-0000-000000000050');"
    f"INSERT INTO media_identity_history (operator_id, token_hash, media_id) VALUES ('{SN}', sha256('\\x53a0'::bytea), '40000000-0000-0000-0000-000000000053')")
is_(tap("\\x53a0", "\\x04000000000053", 1, device=D1), "'CLONE_SUSPECTED'", "ancienne identité d'un bracelet sans portefeuille : copie détectée sans erreur")
is_("(SELECT count(*) FROM media_assignment WHERE media_id = '40000000-0000-0000-0000-000000000050')::int", "2", "deux rattachements successifs")
run("SELECT activate_media('40000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000050','DESK','60000000-0000-0000-0000-000000000001'); SELECT release_media('40000000-0000-0000-0000-000000000051')")
throws("SELECT reassign_pool_media('40000000-0000-0000-0000-000000000051', sha256('\\x51b1'::bytea))", "Réattribution interdite%",
       "réattribution d'un bracelet SINGLE_USE refusée")
run("UPDATE media SET status = 'SUSPENDED' WHERE id = '40000000-0000-0000-0000-000000000050'")
is_(tap("\\x50b1", "\\x04000000000050", 7, device=D1), "'BLOCKED'", "bracelet déclaré perdu : bloqué")
lives("SELECT replace_media('40000000-0000-0000-0000-000000000050','40000000-0000-0000-0000-000000000052')", "remplacement")
is_("(SELECT wallet_id FROM media WHERE id = '40000000-0000-0000-0000-000000000052')", "'30000000-0000-0000-0000-000000000051'::uuid",
    "le nouveau bracelet reprend le même portefeuille")
throws("UPDATE media SET status = 'ACTIVE' WHERE id = '40000000-0000-0000-0000-000000000050'", "Passage interdit%", "bracelet remplacé : définitif")
run("UPDATE media SET status = 'BLACKLISTED' WHERE id = '40000000-0000-0000-0000-000000000052'")
throws("SELECT reinstate_media('40000000-0000-0000-0000-000000000052','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','x')",
       "%seconde personne%", "sortie de liste noire par une seule personne refusée")
lives("SELECT reinstate_media('40000000-0000-0000-0000-000000000052','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','enquête close')",
      "sortie de liste noire validée par une seconde personne")
is_("(SELECT approved_by IS NOT NULL FROM media_status_history WHERE media_id = '40000000-0000-0000-0000-000000000052' ORDER BY id DESC LIMIT 1)",
    "true", "historique : validateur enregistré")
is_("close_batch('90000000-0000-0000-0000-000000000051')", "1", "clôture d'un lot SINGLE_USE")
is_("(SELECT missing_from_registry FROM batch_inventory WHERE batch_id = '90000000-0000-0000-0000-000000000050')::int", "1",
    "inventaire : bracelets manquants au registre")

section("Options d'événement : activation et bracelet retrouvé")
run(f"""UPDATE event SET activation_modes = '{{SELF_APP,FIRST_TOPUP}}', lost_media_policy = 'END_OF_LIFE' WHERE id = '{EV}';
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status) VALUES
 ('90000000-0000-0000-0000-000000000060','{SN}','{ORG}','{EV}','PUBLIC',3,1,'ACTIVE');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000060','{SN}','NFC_TAG', sha256('\\x60'::bytea), '\\x04000000000060','90000000-0000-0000-0000-000000000060'),
 ('40000000-0000-0000-0000-000000000061','{SN}','NFC_TAG', sha256('\\x61'::bytea), '\\x04000000000061','90000000-0000-0000-0000-000000000060')""")
throws("SELECT activate_media('40000000-0000-0000-0000-000000000060','30000000-0000-0000-0000-000000000050','DESK')", "Mode d'activation%",
       "activation par un mode non autorisé refusée")
lives("SELECT activate_media('40000000-0000-0000-0000-000000000060','30000000-0000-0000-0000-000000000050','SELF_APP')", "activation dans l'app")
lives("SELECT activate_media('40000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000050','FIRST_TOPUP')", "activation à la première recharge")
throws(f"UPDATE event SET activation_modes = '{{DESK,BIOMETRIE}}' WHERE id = '{EV}'", "%activation_modes_check%", "mode d'activation inconnu refusé")
run("UPDATE media SET status = 'SUSPENDED' WHERE id IN ('40000000-0000-0000-0000-000000000060','40000000-0000-0000-0000-000000000061')")
throws("UPDATE media SET status = 'ACTIVE' WHERE id = '40000000-0000-0000-0000-000000000060'", "Politique de l'événement%",
       "mode fin de vie : remise en service directe refusée")
is_("recover_media('40000000-0000-0000-0000-000000000060')", "'RETIRED'", "mode fin de vie : bracelet retrouvé retiré")
run(f"UPDATE event SET lost_media_policy = 'REACTIVATE' WHERE id = '{EV}'")
is_("recover_media('40000000-0000-0000-0000-000000000061')", "'ACTIVE'", "mode remise en service : bracelet réactivé")

section("Cycle de vie des lots")
run(f"INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES ('90000000-0000-0000-0000-000000000070','{SN}','{ORG}','{EV}','PUBLIC',100,1)")
throws("UPDATE media_batch SET status = 'ACTIVE' WHERE id = '90000000-0000-0000-0000-000000000070'", "Passage de lot interdit%",
       "lot commandé -> actif directement : interdit")
lives("""UPDATE media_batch SET status = 'PERSONALIZED' WHERE id = '90000000-0000-0000-0000-000000000070';
UPDATE media_batch SET status = 'DELIVERED' WHERE id = '90000000-0000-0000-0000-000000000070';
UPDATE media_batch SET status = 'ACTIVE' WHERE id = '90000000-0000-0000-0000-000000000070';
UPDATE media_batch SET status = 'SUSPENDED' WHERE id = '90000000-0000-0000-0000-000000000070';
UPDATE media_batch SET status = 'ACTIVE' WHERE id = '90000000-0000-0000-0000-000000000070';
UPDATE media_batch SET status = 'CLOSED' WHERE id = '90000000-0000-0000-0000-000000000070'""", "parcours complet d'un lot")
is_("(SELECT count(*) FROM media_batch_status_history WHERE batch_id = '90000000-0000-0000-0000-000000000070')::int", "7", "historique du lot complet")
throws("UPDATE media_batch SET status = 'ACTIVE' WHERE id = '90000000-0000-0000-0000-000000000070'", "Passage de lot interdit%", "lot clos : définitif")

section("Caution (modes C et D)")
throws(f"INSERT INTO media_batch (operator_id, organizer_id, kind, quantity, key_index, deposit_amount) VALUES ('{SN}','{ORG}','PUBLIC',5,1,1000)",
       "%media_batch_check%", "caution sans mode refusée")
run(f"""INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000080','{SN}','{L}','L-ORG-CAUTION','CLAIM','ORG_DEPOSIT','{ORG}','C',false),
 ('20000000-0000-0000-0000-000000000081','{SN}','{L}','L-ORG-CAUTION-ACQ','CLAIM','ORG_DEPOSIT_FORFEIT','{ORG}','C',false),
 ('20000000-0000-0000-0000-000000000082','{SN}','{L}','A-CAISSE-C9','ASSET','CASH_DESK',NULL,'D',false);
INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000080','{SN}','{L}'), ('30000000-0000-0000-0000-000000000081','{SN}','{L}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000083','{SN}','{L}','L-WAL-C80-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000080','C',false),
 ('20000000-0000-0000-0000-000000000084','{SN}','{L}','L-WAL-C81-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000081','C',false);
UPDATE event SET activation_modes = '{{DESK,SELF_APP,FIRST_TOPUP}}' WHERE id = '{EV}';
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, reuse_policy, deposit_amount, deposit_mode) VALUES
 ('90000000-0000-0000-0000-000000000080','{SN}','{ORG}','{EV}','PUBLIC',10,1,'ACTIVE','POOL',1000,'FROM_BALANCE'),
 ('90000000-0000-0000-0000-000000000081','{SN}','{ORG}','{EV}','PUBLIC',10,1,'ACTIVE','POOL',1000,'SEPARATE');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000080','{SN}','NFC_TAG', sha256('\\x80'::bytea), '\\x04000000000080','90000000-0000-0000-0000-000000000080'),
 ('40000000-0000-0000-0000-000000000081','{SN}','NFC_TAG', sha256('\\x81'::bytea), '\\x04000000000081','90000000-0000-0000-0000-000000000081');
SELECT activate_media('40000000-0000-0000-0000-000000000080','30000000-0000-0000-0000-000000000080','DESK')""")
is_("take_deposit('40000000-0000-0000-0000-000000000080')", "'DUE'", "mode C, solde vide : caution due")
run(post("TOPUP", "wave:dep-1", "PSP_WEBHOOK", (A_WAVE, 5000), ("20000000-0000-0000-0000-000000000083", -5000)))
is_("take_deposit('40000000-0000-0000-0000-000000000080')", "'HELD'", "mode C, après recharge : caution prélevée")
is_("wallet_spendable('30000000-0000-0000-0000-000000000080')", "4000", "mode C : solde diminué de la caution")
throws("SELECT release_media('40000000-0000-0000-0000-000000000080')", "%caution%", "restitution avec caution détenue refusée")
run("SELECT refund_deposit('40000000-0000-0000-0000-000000000080')")
is_("wallet_spendable('30000000-0000-0000-0000-000000000080')", "5000", "mode C : caution recréditée au retour")
run("SELECT activate_media('40000000-0000-0000-0000-000000000081','30000000-0000-0000-0000-000000000081','DESK')")
is_("take_deposit('40000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000082')", "'HELD'", "mode D : caution payée à la caisse")
is_("wallet_spendable('30000000-0000-0000-0000-000000000081')", "0", "mode D : solde intact")
run("SELECT close_batch('90000000-0000-0000-0000-000000000081')")
is_("(SELECT deposit_status FROM media WHERE id = '40000000-0000-0000-0000-000000000081')", "'FORFEITED'", "lot clos sans retour : caution acquise")
is_("(SELECT total_credit FROM trial_balance WHERE code = 'L-ORG-CAUTION-ACQ')::bigint", "1000", "caution acquise en produit")
run(f"""INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000082','{SN}','{L}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000085','{SN}','{L}','L-WAL-C82-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000082','C',false),
 ('20000000-0000-0000-0000-000000000086','{SN}','{L}','L-WAL-C82-X','CLAIM','WALLET_PROMO','30000000-0000-0000-0000-000000000082','C',false);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000082','{SN}','NFC_TAG', sha256('\\x82'::bytea), '\\x04000000000082','90000000-0000-0000-0000-000000000080');
SELECT activate_media('40000000-0000-0000-0000-000000000082','30000000-0000-0000-0000-000000000082','DESK');
SELECT post_transaction('{L}','PROMO_CREDIT','promo:c82',now(),'BATCH', jsonb_build_array(
  jsonb_build_object('account_id','20000000-0000-0000-0000-000000000086','amount',-3000),
  jsonb_build_object('account_id',(SELECT id FROM account WHERE code = 'L-ORG-PROMO' AND ledger_id = '{L}'),'amount',3000)))""")
is_("take_deposit('40000000-0000-0000-0000-000000000082')", "'DUE'", "mode C, seulement des crédits offerts : caution due (pas de débit)")

# ---------------------------------------------------------------- plafonds et multi-devises
section("Plafonds réglementaires")
LIM = "10000000-0000-0000-0000-000000000002"
run(f"""INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, unidentified_max_balance, unidentified_monthly_limit, max_wallet_balance, identified_monthly_limit)
 VALUES ('50000000-0000-0000-0000-000000000009','SN',9,'2026-01-01','ORGANIZER', 150000, 200000, 2000000, 10000000);
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('60000000-0000-0000-0000-000000000009','{SN}','{ORG}','Événement plafonné','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000009','OPERATOR');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('{LIM}','{SN}','EVENT','60000000-0000-0000-0000-000000000009','XOF','{ORG}','{SN}');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000000c1','CUSTOMER','{SN}','Festivalier identifié','SN');
INSERT INTO wallet (id, operator_id, ledger_id, customer_id) VALUES
 ('30000000-0000-0000-0000-000000000091','{SN}','{LIM}',NULL), ('30000000-0000-0000-0000-000000000092','{SN}','{LIM}','00000000-0000-0000-0000-0000000000c1');
INSERT INTO kyc_verification (id, operator_id, customer_id, wallet_id, agent_id, id_type, id_country, id_last4, id_expires_on) VALUES
 ('c0000000-0000-0000-0000-000000000001','{SN}','00000000-0000-0000-0000-0000000000c1','30000000-0000-0000-0000-000000000092',
  '90000000-0000-0000-0000-000000000001','NATIONAL_ID','SN','4821', current_date + 365);
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000090','{SN}','{LIM}','A-PSP-WAVE','ASSET','PSP',NULL,'D',false),
 ('20000000-0000-0000-0000-000000000091','{SN}','{LIM}','L-WAL-N-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000091','C',false),
 ('20000000-0000-0000-0000-000000000092','{SN}','{LIM}','L-WAL-V-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000092','C',false),
 ('20000000-0000-0000-0000-000000000093','{SN}','{LIM}','L-MCH-X','CLAIM','MERCHANT',NULL,'C',true)""")
def postl(typ, key, *pairs):
    return f"SELECT post_transaction('{LIM}','{typ}','{key}',now(),'ONLINE',{lines(*pairs)})"
A9, N, V, M9 = ("20000000-0000-0000-0000-000000000090", "20000000-0000-0000-0000-000000000091",
                "20000000-0000-0000-0000-000000000092", "20000000-0000-0000-0000-000000000093")
lives(postl("TOPUP", "lim:1", (A9, 140000), (N, -140000)), "non identifié : recharge sous les plafonds")
throws_code(postl("TOPUP", "lim:2", (A9, 20000), (N, -20000)), "CL008", "non identifié : plafond de solde (150 000) refusé (CL008)")
lives(postl("PURCHASE", "lim:3", (N, 100000), (M9, -100000)), "non identifié : dépense")
throws_code(postl("TOPUP", "lim:4", (A9, 70000), (N, -70000)), "CL009", "non identifié : total mensuel (200 000) dépassé refusé (CL009)")
lives(postl("TOPUP", "lim:5", (A9, 300000), (V, -300000)), "identifié : recharge au-delà des plafonds non identifiés acceptée")
lives(postl("TOPUP", "lim:6", (A9, 60000), (N, -60000)), "non identifié : recharge jusqu'au total mensuel")
lives(f"SELECT post_transaction('{LIM}','REVERSAL','lim:7',now(),'ONLINE',{lines((M9, 100000), (N, -100000))}, NULL,"
      f" (SELECT id FROM journal_transaction WHERE idempotency_key = 'lim:3'))",
      "annulation qui porte le solde au-delà du plafond : acceptée (restitution, pas un apport)")
CD, DUE = "20000000-0000-0000-0000-000000000094", "20000000-0000-0000-0000-000000000095"
run(f"""INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side, allow_negative) VALUES
 ('{CD}','{SN}','{LIM}','A-CAISSE-1','ASSET','CASH_DESK','D',false),
 ('{DUE}','{SN}','{LIM}','L-ESP-A-RENDRE','CLAIM','CUSTOMER_CASH_DUE','C',false)""")
W91 = "30000000-0000-0000-0000-000000000091"
run(f"""CREATE TEMP TABLE hr AS SELECT wallet_topup_headroom('{W91}', now()) AS h,
  (SELECT -sum(amount) FROM posting WHERE account_id = '{N}') AS bal,
  (SELECT -sum(p.amount) FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
    WHERE p.account_id = '{N}' AND p.amount < 0 AND t.type IN ('TOPUP','TOPUP_CASH')) AS mtot""")
is_("(SELECT h FROM hr)", "(SELECT least(greatest(150000 - bal, 0), greatest(200000 - mtot, 0)) FROM hr)",
    "marge de recharge : minimum du plafond de solde et du plafond mensuel restants")
lives(f"""DO $D$ DECLARE h bigint := (SELECT h FROM hr); l jsonb; BEGIN
  l := jsonb_build_array(jsonb_build_object('account_id','{CD}','amount',100000),
                         jsonb_build_object('account_id','{DUE}','amount',-(100000 - h)));
  IF h > 0 THEN l := l || jsonb_build_array(jsonb_build_object('account_id','{N}','amount',-h)); END IF;
  PERFORM post_transaction('{LIM}','TOPUP_CASH','cashover:1',now(),'OFFLINE_SYNC', l);
END $D$""", "recharge espèces au-delà du plafond : portefeuille crédité de la marge, le reste dû au client")
is_(f"(SELECT -sum(amount) FROM posting WHERE account_id = '{DUE}')", "(SELECT 100000 - h FROM hr)", "espèces dues au client = recharge moins la marge")
is_(f"wallet_topup_headroom('{W91}', now())", "0", "après la recharge découpée : plus aucune marge")
C1 = "00000000-0000-0000-0000-0000000000c1"
is_(f"wallet_kyc_level('30000000-0000-0000-0000-000000000091')", "'NONE'", "portefeuille anonyme : non identifié")
is_(f"wallet_kyc_level('30000000-0000-0000-0000-000000000092')", "'VERIFIED'", "identification valide du client : portefeuille identifié")
is_(f"wallet_kyc_level('30000000-0000-0000-0000-000000000092', current_date + 400)", "'NONE'", "pièce expirée : le niveau retombe sans tâche planifiée")
throws("UPDATE kyc_verification SET id_last4 = '9999' WHERE id = 'c0000000-0000-0000-0000-000000000001'", "%ajout seul%", "identification non modifiable")
throws(f"INSERT INTO kyc_verification (operator_id, customer_id, agent_id, id_type, id_country, id_last4, id_expires_on) VALUES ('{SN}','{C1}','90000000-0000-0000-0000-000000000001','PASSPORT','SN','A1234567', current_date + 30)",
       "%id_last4%", "numéro complet de la pièce refusé (4 derniers caractères seulement)")
throws("UPDATE kyc_verification SET status = 'REVOKED' WHERE id = 'c0000000-0000-0000-0000-000000000001'", "%kyc_verification_check%", "révocation sans auteur ni motif refusée")
lives(f"UPDATE kyc_verification SET status = 'REVOKED', revoked_at = now(), revoked_by = '90000000-0000-0000-0000-000000000002', revoked_reason = 'pièce falsifiée' WHERE id = 'c0000000-0000-0000-0000-000000000001'",
      "révocation avec auteur et motif")
throws_code(postl("TOPUP", "lim:8", (A9, 1000000), (V, -1000000)), "CL008", "identification révoquée : plafonds non identifiés appliqués à la recharge suivante")

section("Multi-devises : un portefeuille par devise sur un même bracelet")
EUR = "10000000-0000-0000-0000-000000000003"
run(f"""INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('{EUR}','{SN}','ORGANIZER','{ORG}','EUR','{ORG}','{ORG}');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000099','{SN}','{EUR}'),
 ('30000000-0000-0000-0000-000000000098','{SN}','{L}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000099','{SN}','{EUR}','L-WAL-E-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000099','C',false),
 ('20000000-0000-0000-0000-000000000098','{SN}','{EUR}','A-PSP-CARTE','ASSET','PSP',NULL,'D',false)""")
lives("SELECT attach_wallet('40000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000099')", "ajout d'un portefeuille EUR au bracelet")
throws("SELECT attach_wallet('40000000-0000-0000-0000-000000000061','30000000-0000-0000-0000-000000000098')", "%media_assignment_one_open%",
       "second portefeuille dans la même devise refusé")
is_("media_wallet('40000000-0000-0000-0000-000000000061','EUR')", "'30000000-0000-0000-0000-000000000099'::uuid", "portefeuille EUR retrouvé par devise")
is_("media_wallet('40000000-0000-0000-0000-000000000061','XOF')", "'30000000-0000-0000-0000-000000000050'::uuid", "portefeuille XOF retrouvé par devise")
run(f"SELECT post_transaction('{EUR}','TOPUP','eur:1',now(),'PSP_WEBHOOK',{lines(('20000000-0000-0000-0000-000000000098', 2000), ('20000000-0000-0000-0000-000000000099', -2000))})")
throws("SELECT release_media('40000000-0000-0000-0000-000000000061')", "Restitution refusée : solde%", "restitution refusée si le portefeuille EUR n'est pas soldé")


# ---------------------------------------------------------------- compléments critiques (section 18 du schéma)
D1, D2 = "70000000-0000-0000-0000-000000000001", "70000000-0000-0000-0000-000000000002"
U1, U2 = "90000000-0000-0000-0000-000000000001", "90000000-0000-0000-0000-000000000002"
def H(n): return f"sha256('op{n}'::bytea)"
def chain(prev, ns):
    e = prev
    for n in ns: e = f"chain_step({e}, {H(n)})"
    return e
G0 = f"device_chain_genesis('{D1}')"
def rec(seq, outcome="ACCEPTED", channel="ONLINE", content=None, extra=""):
    return f"record_device_seq('{D1}', {seq}, {content or H(seq)}, '{outcome}', '{channel}'{extra})"
def batch(bid, seq_from, prev, ns, last=None):
    arr = "ARRAY[" + ",".join(H(n) for n in ns) + "]"
    return f"open_offline_batch('{bid}', '{D1}', '{L}', {seq_from}, {prev}, {arr}, {last or chain(prev, ns)}, '\\x01')"
def B(n): return "b0000000-0000-0000-0000-%012d" % n
def dev(col): return f"(SELECT {col} FROM device WHERE id = '{D1}')"

section("Numérotation des terminaux : registre des numéros (S6)")
is_(f"(SELECT contiguous_acked_seq FROM {rec(1)})", "1", "numéro 1 enregistré : plage continue jusqu'à 1")
is_(f"(SELECT replayed FROM {rec(1)})", "true", "même numéro, même contenu : résultat mémorisé renvoyé")
throws_code(f"SELECT * FROM {rec(1, content=H(99))}", "CL002", "même numéro, autre contenu : CL002")
is_(f"(SELECT contiguous_acked_seq FROM {rec(3, 'VOID')})", "1", "numéro 3 reçu avant le 2 : la plage continue ne bouge pas")
is_(f"(SELECT array_agg(s)::text FROM device_missing_seqs('{D1}') s)", "'{2}'", "numéro manquant signalé : 2")
is_(f"(SELECT contiguous_acked_seq FROM {rec(2, 'REJECTED', extra=', NULL, ' + chr(39) + 'INSUFFICIENT_FUNDS' + chr(39))})", "3",
    "le 2 arrive (refus métier) : plage continue jusqu'à 3")
is_(dev("last_seq"), "3", "device.last_seq = plus grand numéro reçu")
throws(f"SELECT * FROM {rec(4, 'REJECTED')}", "%device_seq_registry_check%", "rejet sans raison refusé")
throws_code(f"SELECT * FROM {rec(4, 'WAIVED', 'WAIVER', content='NULL')}", "CL001", "levée d'un trou hors waive_seq_gap refusée")
throws(f"UPDATE device_seq_registry SET outcome = 'ACCEPTED' WHERE device_id = '{D1}' AND seq = 2", "%ajout seul%", "registre en ajout seul")

section("Lots hors ligne et chaînage (S7)")
is_(f"(SELECT chain_status FROM {batch(B(1), 1, G0, [1,2,3])})", "'VERIFIED'", "premier lot chaîné depuis l'origine du terminal : vérifié")
is_(dev("last_chain_seq"), "3", "curseur de chaîne du central : 3")
throws_code(f"SELECT {batch(B(2), 4, chain(G0,[1,2,3]), [4,5])}", "CL010", "second lot pendant qu'un lot est en cours : CL010")
is_(f"(SELECT status FROM complete_offline_batch('{B(1)}', '[]'))", "'COMPLETED'", "lot clos : chaque numéro a un résultat final")
is_(f"(SELECT status FROM {batch(B(1), 1, G0, [1,2,3])})", "'COMPLETED'", "renvoi du même lot : état mémorisé")
throws_code(f"SELECT {batch(B(1), 1, G0, [1,2,9])}", "CL002", "même batch_id, autre contenu : CL002")
is_(f"(SELECT reject_reason FROM {batch(B(2), 4, 'sha256(' + chr(39) + 'faux' + chr(39) + '::bytea)', [4,5])})", "'CHAIN_BROKEN'",
    "lot qui ne suit pas la chaîne connue : rejeté CHAIN_BROKEN")
is_(f"(SELECT count(*) FROM anomaly WHERE device_id = '{D1}' AND kind = 'CHAIN_BROKEN')::int", "1", "rupture de chaîne : anomalie ouverte")
is_(f"(SELECT row(chain_status, missing_seqs)::text FROM {batch(B(3), 6, chain(G0,[1,2,3,4,5]), [6,7])})", "'(PENDING,\"{4,5}\")'",
    "lot après un trou : traité, vérification de chaîne en attente, numéros 4 et 5 signalés")
is_(f"(SELECT count(*) FROM anomaly WHERE device_id = '{D1}' AND kind = 'SEQ_GAP' AND status = 'OPEN')::int", "2", "une anomalie SEQ_GAP par numéro manquant")
run(f"SELECT * FROM {rec(6, channel='BATCH', extra=', NULL, NULL, ' + chr(39) + B(3) + chr(39))}; SELECT * FROM {rec(7, channel='BATCH', extra=', NULL, NULL, ' + chr(39) + B(3) + chr(39))}")
throws_code(f"SELECT complete_offline_batch('{B(4)}', '[]')", "P0002", "clôture d'un lot inconnu : introuvable")
lives(f"SELECT complete_offline_batch('{B(3)}', '[]')", "lot 6..7 clos")
lives(f"SELECT {batch(B(4), 4, chain(G0,[1,2,3]), [4,5])}", "les numéros manquants arrivent (lot 4..5)")
is_(f"(SELECT chain_status FROM offline_batch WHERE id = '{B(3)}')", "'VERIFIED'", "le lot en attente est vérifié à l'arrivée du lot manquant")
is_(dev("last_chain_seq"), "7", "curseur de chaîne rattrapé jusqu'à 7")
run(f"SELECT * FROM {rec(4, channel='BATCH')}; SELECT * FROM {rec(5, channel='BATCH')}; SELECT complete_offline_batch('{B(4)}', '[]')")
is_(dev("contiguous_acked_seq"), "7", "plage continue jusqu'à 7")
is_(f"(SELECT count(*) FROM anomaly WHERE device_id = '{D1}' AND kind = 'SEQ_GAP' AND status = 'OPEN')::int", "0", "numéros renvoyés : anomalies SEQ_GAP closes")
lives(f"SELECT {batch(B(5), 9, chain(G0,[1,2,3,4,5,6,7,8]), [9])}; SELECT * FROM {rec(9, channel='BATCH')}", "numéro 8 perdu : lot 9 traité")
throws(f"SELECT waive_seq_gap('{D1}', 8, '{U1}', '{U1}', 'journal détruit')", "%device_seq_registry_check%", "levée d'un trou par une seule personne refusée")
throws_code(f"SELECT waive_seq_gap('{D1}', 2, '{U1}', '{U2}', 'x')", "CL012", "levée d'un numéro qui n'est pas un trou : CL012")
is_(f"waive_seq_gap('{D1}', 8, '{U1}', '{U2}', 'terminal détruit')", "9", "trou levé à deux : plage continue jusqu'à 9")
is_(f"(SELECT status FROM anomaly WHERE device_id = '{D1}' AND seq = 8 AND kind = 'SEQ_GAP')", "'RESOLVED'", "anomalie du numéro levé close")
is_(f"(SELECT chain_status FROM offline_batch WHERE id = '{B(5)}')", "'UNVERIFIABLE'", "chaîne après un numéro levé : invérifiable (signalé)")
throws_code("SELECT open_offline_batch('b0000000-0000-0000-0000-000000000099', '" + D1 + "', '" + L + "', 10, " + G0 +
            ", ARRAY(SELECT sha256(i::text::bytea) FROM generate_series(1, 501) i), " + G0 + ", '\\x01')", "CL011", "lot de 501 opérations : CL011")
run(f"SET ROLE app_test; SET app.operator_id = '{CI}'")
throws(f"SELECT * FROM {rec(50)}", "Objet introuvable", "autre prestataire : registre du terminal inaccessible")
is_("(SELECT count(*) FROM device_seq_registry)::int", "0", "autre prestataire : registre invisible")
run(f"RESET ROLE; SET app.operator_id = '{SN}'")

section("Snapshots signés, historique des politiques, configurations servies (S8, S9, S10, S11)")
run("""INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status) VALUES
 ('central-2025-01', NULL, 'CENTRAL', 'ECDSA_P256_SHA256', '\\x04', 'arn:aws:kms:eu-west-3:111122223333:key/old', 'RETIRED'),
 ('central-2026-01', NULL, 'CENTRAL', 'ECDSA_P256_SHA256', '\\x04', 'arn:aws:kms:eu-west-3:111122223333:key/snap', 'ACTIVE')""")
throws("INSERT INTO snapshot_signing_key (key_id, owner, algorithm, public_key, kms_key_ref) VALUES ('central-bis','CENTRAL','Ed25519','\\x00','arn:x')",
       "%snapshot_signing_key_one_active%", "une seule clé centrale active par signataire")
def snap(version, kind="FULL", base="NULL", epoch=f"(SELECT authority_epoch FROM ledger WHERE id = '{L}')", key="central-2026-01", hdr_version=None):
    return (f"INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, base_version, generated_at, valid_until, entries, "
            f"content_sha256, authority_epoch, key_id, header, signature) SELECT '{SN}', '{L}', '{EV}', '{kind}', {version}, {base}, "
            f"'2026-12-11T10:00:00Z', '2026-12-11T10:15:00Z', 2, sha256('c{version}'::bytea), e, '{key}', "
            f"jsonb_build_object('format','CASHLESS-SNAPSHOT/v1','kind','{kind}','operator_id','{SN}','ledger_id','{L}','event_id','{EV}',"
            f"'currency','XOF','version',{hdr_version or version},'base_version',{base},'generated_at','2026-12-11T10:00:00Z',"
            f"'valid_until','2026-12-11T10:15:00Z','entries',2,'content_sha256',encode(sha256('c{version}'::bytea),'hex'),"
            f"'authority_epoch',e,'key_id','{key}'), '\\x01' FROM (SELECT {epoch} AS e) x")
lives(snap(1), "snapshot complet v1 signé par la clé active")
throws(snap(1), "%non croissante%", "version non croissante refusée")
lives(snap(2, "DELTA", "1"), "delta v2 sur la v1")
throws(snap(3, "DELTA", "99"), "%version de base%", "delta sur une version inconnue refusé")
throws_code(snap(3, epoch=f"(SELECT authority_epoch + 1 FROM ledger WHERE id = '{L}')"), "CL015", "époque d'autorité périmée : CL015")
throws(snap(3, hdr_version=4), "%en-tête signé%", "en-tête signé différent des colonnes refusé")
throws(snap(3, key="central-2025-01"), "%non utilisable%", "clé retirée refusée")
throws(f"UPDATE offline_snapshot SET entries = 3 WHERE ledger_id = '{L}'", "%ajout seul%", "snapshot en ajout seul")
is_("(SELECT string_agg(currency, ',' ORDER BY currency) FROM offline_snapshot_rows WHERE media_id = '40000000-0000-0000-0000-000000000061')",
    "'EUR,XOF'", "bracelet à deux portefeuilles : une ligne par devise (rattachements)")
is_("(SELECT wallet_status FROM offline_snapshot_rows WHERE media_id = '40000000-0000-0000-0000-000000000061' AND currency = 'EUR')", "'ACTIVE'",
    "statut du portefeuille dans le snapshot")
is_("(SELECT last_counter FROM offline_snapshot_rows WHERE media_id = '40000000-0000-0000-0000-000000000001')",
    "(SELECT max(counter) FROM media_tap WHERE media_id = '40000000-0000-0000-0000-000000000001')", "dernier compteur vu dans le snapshot")
is_(f"(SELECT count(*) FROM offline_policy_history)::int", "(SELECT count(*) FROM offline_policy)::int", "chaque politique a sa version 1 dans l'historique")
C1 = f"(SELECT id FROM record_config_served('{D1}'))"
run(f"CREATE TEMP TABLE cfg AS SELECT 1 AS n, {C1} AS id")
is_(C1, "(SELECT id FROM cfg WHERE n = 1)", "configuration inchangée : même config_id")
run(f"UPDATE offline_policy SET max_per_sale = 1000 WHERE scope_type = 'EVENT' AND scope_id = '{EV}'")
is_(f"(SELECT version FROM offline_policy WHERE scope_type = 'EVENT' AND scope_id = '{EV}')", "2", "modification de politique : version 2")
is_(f"(SELECT h.max_per_sale FROM offline_policy_history h JOIN offline_policy p ON p.id = h.policy_id WHERE p.scope_type = 'EVENT' AND h.version = 1)",
    "3000", "l'ancienne version reste dans l'historique")
run(f"INSERT INTO cfg SELECT 2, {C1}")
is_("(SELECT count(DISTINCT id) FROM cfg)::int", "2", "politique changée : nouvelle configuration servie")
is_(f"policy_in_force('{D1}', (SELECT id FROM cfg WHERE n = 1))->>'max_per_sale'", "'3000'", "plafond en vigueur dans la configuration détenue (avant la baisse)")
is_(f"policy_in_force('{D1}', (SELECT id FROM cfg WHERE n = 2))->>'max_per_sale'", "'1000'", "plafond en vigueur après la baisse")
is_(f"(SELECT terminal_settings->>'online_total_timeout_ms' FROM record_config_served('{D1}'))", "'3000'", "réglages du terminal servis dans la configuration (défaut 3 s)")
run(f"UPDATE event SET online_total_timeout_ms = 5000 WHERE id = '{EV}'; INSERT INTO cfg SELECT 3, {C1}")
is_("(SELECT count(DISTINCT id) FROM cfg)::int", "3", "réglage du terminal modifié : nouvelle configuration servie")
throws(f"UPDATE event SET online_total_timeout_ms = 10000 WHERE id = '{EV}'", "%online_total_timeout_ms%", "délai total hors bornes (2 à 6 s) refusé")
throws(f"UPDATE event SET online_connect_timeout_ms = 5000, online_total_timeout_ms = 4000 WHERE id = '{EV}'", "%event_check%", "délai de connexion supérieur au délai total refusé")
throws(f"UPDATE event SET local_retention_days = 3 WHERE id = '{EV}'", "%local_retention_days%", "conservation locale inférieure à 7 jours refusée")
throws(f"SELECT policy_in_force('{D2}', (SELECT id FROM cfg WHERE n = 1))", "Configuration inconnue%", "configuration d'un autre terminal refusée")
throws("UPDATE offline_policy_history SET max_per_sale = 1", "%ajout seul%", "historique des politiques en ajout seul")
run(f"INSERT INTO device (id, operator_id, kind, serial) VALUES ('70000000-0000-0000-0000-000000000009','{SN}','POS','TPE-SANS-EVT')")
is_("(SELECT count(*) || ':' || bool_or(offline_enabled) FROM effective_offline_policy('70000000-0000-0000-0000-000000000009'))", "'1:false'",
    "terminal sans événement : une politique, hors ligne interdit (S11)")
run(f"UPDATE device SET personal_phone = true, app_mode = 'KEYPAD_TPE' WHERE id = '{D1}'")
is_(f"(SELECT offline_enabled FROM effective_offline_policy('{D1}'))", "false", "téléphone personnel : hors ligne interdit quelle que soit la politique")
run(f"UPDATE device SET personal_phone = false, app_mode = 'CATALOG_POS' WHERE id = '{D1}'")

section("Bascule vers la passerelle et registre de la passerelle (S12, S13)")
LE = "10000000-0000-0000-0000-00000000000e"
G1, G2, G3 = ("e1000000-0000-0000-0000-000000000001", "e1000000-0000-0000-0000-000000000002", "e1000000-0000-0000-0000-000000000003")
AE, WE, ME = "2e000000-0000-0000-0000-000000000001", "2e000000-0000-0000-0000-000000000002", "2e000000-0000-0000-0000-000000000003"
run(f"""INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES ('{LE}','{SN}','EVENT','{EV}','XOF','{ORG}','{ORG}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('{AE}','{SN}','{LE}','A-PSP-WAVE','ASSET','PSP',NULL,'D',false), ('{WE}','{SN}','{LE}','L-WAL-E1-P','CLAIM','WALLET_PAID',NULL,'C',false),
 ('{ME}','{SN}','{LE}','L-MCH-E1','CLAIM','MERCHANT','00000000-0000-0000-0000-000000000004','C',true);
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES ('{G1}','{SN}','{EV}','GW-1','PRIMARY'), ('{G2}','{SN}','{EV}','GW-2','STANDBY'),
 ('{G3}','{SN}','{EV}','GW-3','PRIMARY');
SELECT post_transaction('{LE}','TOPUP','e:topup:1',now(),'PSP_WEBHOOK','[{{"account_id":"{AE}","amount":5000}},{{"account_id":"{WE}","amount":-5000}}]')""")
def pe(key): return f"SELECT post_transaction('{LE}','PURCHASE','{key}',now(),'ONLINE','[{{\"account_id\":\"{WE}\",\"amount\":100}},{{\"account_id\":\"{ME}\",\"amount\":-100}}]')"
def hid(direction, status): return f"(SELECT id FROM debit_authority_handover WHERE ledger_id = '{LE}' AND direction = '{direction}' AND status = '{status}')"
throws_code(f"SELECT grant_edge_authority('{LE}', '{G2}', '{U1}')", "CL013", "passerelle STANDBY : bascule refusée (CL013)")
is_(f"(SELECT row(status, epoch, watermark_posting_id = (SELECT max(id) FROM posting WHERE ledger_id = '{LE}'))::text FROM grant_edge_authority('{LE}', '{G1}', '{U1}'))",
    "'(GRANTED,1,t)'", "bascule accordée : époque 1, filigrane = dernière écriture du grand livre")
throws_code(f"SELECT grant_edge_authority('{LE}', '{G3}', '{U1}')", "CL013", "seconde bascule pendant la première : CL013")
throws_code(pe("e:c:1"), "CL006", "dès l'accord, débit central refusé (CL006)")
throws_code(f"SELECT ack_edge_handover({hid('TO_EDGE','GRANTED')}, 9, 999999)", "CL015", "accusé avec une autre époque : CL015")
throws_code(f"SELECT ack_edge_handover({hid('TO_EDGE','GRANTED')}, 1, 0)", "CL014", "accusé avant d'avoir répliqué jusqu'au filigrane : CL014")
is_(f"(SELECT status FROM ack_edge_handover({hid('TO_EDGE','GRANTED')}, 1, (SELECT max(id) FROM posting)))", "'ACTIVE'", "accusé valide : passerelle active")
def res(seq, n, key=None, outcome="ACCEPTED"):
    return f"record_edge_seq('{G1}', {seq}, '{key or 'TPE-BAR-01:%04d' % (100 + seq)}', {H(n)}, '{outcome}')"
EG = f"edge_chain_genesis('{G1}')"
throws_code(f"SELECT * FROM {res(2, 102)}", "CL016", "edge_seq hors ordre : CL016")
is_(f"(SELECT chain_hash FROM {res(1, 101)})", chain(EG, [101]), "edge_seq 1 : chaîne calculée par le central")
is_(f"(SELECT replayed FROM {res(1, 101)})", "true", "edge_seq 1 renvoyé à l'identique : résultat mémorisé")
throws_code(f"SELECT * FROM {res(1, 999)}", "CL002", "edge_seq 1 avec un autre contenu : CL002")
throws(f"SELECT * FROM {res(2, 102, key='TPE-BAR-01:0101')}", "%edge_sync_registry_gateway_id_origin_key_key%", "même clé d'origine décidée deux fois : refusée")
run(f"SELECT * FROM {res(2, 102)}")
throws_code(f"SELECT complete_edge_release({hid('TO_EDGE','ACTIVE')}, 1, 2, {chain(EG,[101,102])})", "CL013", "retour sans demande : CL013")
run(f"SELECT request_edge_release('{LE}', '{U1}')")
throws_code(f"SELECT complete_edge_release({hid('TO_CENTRAL','RELEASE_REQUESTED')}, 1, 3, {chain(EG,[101,102,103])})", "CL014",
            "retour avec des edge_seq manquants : CL014")
throws_code(f"SELECT complete_edge_release({hid('TO_CENTRAL','RELEASE_REQUESTED')}, 1, 2, {chain(EG,[101,999])})", "CL017",
            "retour avec une chaîne différente : CL017")
is_(f"(SELECT row(status, epoch)::text FROM complete_edge_release({hid('TO_CENTRAL','RELEASE_REQUESTED')}, 1, 2, {chain(EG,[101,102])}))",
    "'(COMPLETED,2)'", "retour vérifié : central, époque 2")
is_(f"(SELECT status FROM debit_authority_handover WHERE ledger_id = '{LE}' AND direction = 'TO_EDGE')", "'COMPLETED'", "bascule vers la passerelle close")
lives(pe("e:c:2"), "débit central de nouveau accepté")
throws(f"UPDATE debit_authority_handover SET status = 'ACTIVE' WHERE ledger_id = '{LE}' AND direction = 'TO_EDGE'", "%interdit%",
       "retour en arrière d'une bascule refusé")
run(f"SELECT grant_edge_authority('{LE}', '{G1}', '{U1}'); SELECT ack_edge_handover({hid('TO_EDGE','GRANTED')}, 3, (SELECT max(id) FROM posting))")
throws(f"SELECT force_central_authority('{LE}', '{U1}', '{U1}', 'passerelle détruite')", "%deux personnes%",
       "reprise forcée par une seule personne refusée")
run(f"SELECT request_edge_release('{LE}', '{U1}')")
throws(f"SELECT force_central_authority('{LE}', '{U2}', '{U2}', 'passerelle détruite')", "%deux personnes%",
       "reprise forcée après une demande de retour : l'auteur ne peut pas se valider lui-même")
is_(f"(SELECT row(status, epoch)::text FROM force_central_authority('{LE}', '{U1}', '{U2}', 'passerelle détruite, constat sur site'))",
    "'(FORCED,4)'", "reprise forcée à deux : central, époque 4")
is_(f"(SELECT status FROM edge_gateway WHERE id = '{G1}')", "'REVOKED'", "reprise forcée : passerelle révoquée")
throws_code(f"SELECT grant_edge_authority('{LE}', '{G1}', '{U1}')", "CL013", "passerelle révoquée : plus de bascule possible")
run(f"SELECT grant_edge_authority('{LE}', '{G3}', '{U1}')")
is_(f"(SELECT status FROM fail_edge_grant({hid('TO_EDGE','GRANTED')}, '{U1}', 'aucun accusé'))", "'FAILED'", "bascule jamais accusée : abandonnée")
is_(f"(SELECT debit_authority || ':' || authority_epoch FROM ledger WHERE id = '{LE}')", "'CENTRAL:6'", "abandon : retour au central, époque 6")
run(f"SET ROLE app_test; SET app.operator_id = '{CI}'")
throws(f"SELECT grant_edge_authority('{LE}', '{G3}', '{U1}')", "Objet introuvable", "autre prestataire : bascule refusée")
is_("(SELECT count(*) FROM debit_authority_handover)::int", "0", "autre prestataire : bascules invisibles")
run(f"RESET ROLE; SET app.operator_id = '{SN}'")

section("Fonctions internes, terminaux, anomalies")
run("DROP ROLE IF EXISTS app_probe; CREATE ROLE app_probe")
is_("has_function_privilege('app_probe', 'set_debit_authority(uuid,text,uuid)', 'EXECUTE')", "false", "bascule directe interdite au rôle applicatif")
is_("has_function_privilege('app_probe', 'tenant_of_media(uuid)', 'EXECUTE')", "false", "fonctions tenant_of_* non exposées")
is_("has_function_privilege('app_probe', 'grant_edge_authority(uuid,uuid,uuid)', 'EXECUTE')", "true", "fonctions de bascule exposées")
throws(f"INSERT INTO device (operator_id, app_mode, event_id, serial) VALUES ('{SN}','PAIRED_TPE','{EV}','TPE-PAIRED-01')", "%device_app_mode_check%",
       "TPE associé (V2) refusé en V1")
throws(f"INSERT INTO device (operator_id, event_id, serial) VALUES ('{SN}','{EV}','TPE-BAR-01')", "%device_serial_active%",
       "serial déjà utilisé par un terminal actif refusé")
run(f"UPDATE device SET status = 'REVOKED' WHERE id = '70000000-0000-0000-0000-000000000002'")
lives(f"INSERT INTO device (operator_id, event_id, serial) VALUES ('{SN}','{EV}','TPE-FOOD-01')", "ré-enrôlement : serial d'un terminal révoqué réutilisable")
throws(f"INSERT INTO anomaly (operator_id, kind, amount) VALUES ('{SN}', 'AUTRE', 0)", "%anomaly_kind_check%", "type d'anomalie hors liste refusé")
throws(f"INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by, approved_by) VALUES ('{SN}','{L}','{ORG}',100,'WAVE','INITIATED','{U1}','{U1}')",
       "%payout_check%", "versement initié et validé par la même personne refusé")
throws(post("ANOMALY_RESOLUTION", "ano:1", "BATCH", (FOOD, 100), (ORGCOM, -100)), "%journal_transaction_check%", "résolution d'anomalie hors back-office refusée")
throws(post("ADJUSTMENT", "adj:9", "BACKOFFICE", (FOOD, 100), (ORGCOM, -100), extra=f", NULL, NULL, NULL, '{U2}'"), "%journal_transaction_check%",
       "écriture back-office sans auteur refusée")

section("Statut de l'événement et du grand livre (ADR-51)")
E9, L9 = "60000000-0000-0000-0000-0000000000e9", "10000000-0000-0000-0000-0000000000e9"
E8, L8 = "60000000-0000-0000-0000-0000000000e8", "10000000-0000-0000-0000-0000000000e8"
def acc(led, pfx):
    return f"""INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('{pfx}01','{SN}','{led}','A-PSP-WAVE','ASSET','PSP',NULL,'D',false),
 ('{pfx}02','{SN}','{led}','L-WAL-Z-P','CLAIM','WALLET_PAID',NULL,'C',false),
 ('{pfx}03','{SN}','{led}','L-MCH-FOOD','CLAIM','MERCHANT','00000000-0000-0000-0000-000000000004','C',true),
 ('{pfx}04','{SN}','{led}','S-ATTENTE','SUSPENSE','SUSPENSE',NULL,'D',true),
 ('{pfx}05','{SN}','{led}','L-VERS-ENCOURS','CLAIM','PAYOUT_PENDING',NULL,'C',false),
 ('{pfx}06','{SN}','{led}','L-ORG-CASSE','CLAIM','ORG_CASSE','{ORG}','C',false),
 ('{pfx}07','{SN}','{led}','L-OPE-CASSE','CLAIM','OPE_CASSE','{SN}','C',false)"""
P9, P8 = "29000000-0000-0000-0000-0000000000", "28000000-0000-0000-0000-0000000000"
run(f"""INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 ('50000000-0000-0000-0000-000000000099','SN',99,'2026-01-01','NONE');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('{E9}','{SN}','{ORG}','Clôture complète','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','ORGANIZER'),
 ('{E8}','{SN}','{ORG}','Clôture avec soldes restants','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000099','ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('{L9}','{SN}','EVENT','{E9}','XOF','{ORG}','{ORG}'), ('{L8}','{SN}','EVENT','{E8}','XOF','{ORG}','{ORG}');
{acc(L9, P9)}; {acc(L8, P8)}""")
def pz(led, pfx, typ, key, a, b, amt, src="BATCH", extra=""):
    return (f"SELECT post_transaction('{led}','{typ}','{key}',clock_timestamp(),'{src}',"
            f"'[{{\"account_id\":\"{pfx}{a}\",\"amount\":{amt}}},{{\"account_id\":\"{pfx}{b}\",\"amount\":{-amt}}}]'{extra})")
BO = f", NULL, NULL, '{U1}', '{U2}'"
def st(ev, s_): return f"SELECT set_event_status('{ev}', '{s_}', '{U1}')"
throws_code(f"UPDATE event SET status = 'LIVE' WHERE id = '{E9}'", "CL018", "statut d'événement modifié hors de set_event_status : refusé")
throws_code(st(E9, "CLOSING"), "CL018", "passage DRAFT -> CLOSING non prévu")
lives(st(E9, "LIVE"), "ouverture de l'événement")
run(pz(L9, P9, "TOPUP", "z:1", "01", "02", 1000, "PSP_WEBHOOK") + "; " + pz(L9, P9, "PURCHASE", "z:2", "02", "03", 400, "ONLINE")
    + "; " + pz(L9, P9, "PURCHASE", "z:3", "04", "03", 100, "OFFLINE_SYNC"))
lives(st(E9, "CLOSING"), "fin des ventes")
is_(f"(SELECT status FROM ledger WHERE id = '{L9}')", "'CLOSING'", "le grand livre suit : CLOSING")
throws_code(pz(L9, P9, "PURCHASE", "z:4", "02", "03", 10, "ONLINE"), "CL004", "clôture : vente en ligne refusée par la base")
lives(st(E9, "RECONCILING"), "rapprochement")
throws_code(st(E9, "SETTLING"), "CL019", "compte d'attente non soldé : règlement refusé")
run(pz(L9, P9, "ADJUSTMENT", "z:5", "03", "04", 100, "BACKOFFICE", BO))
lives(st(E9, "SETTLING"), "compte d'attente soldé : règlement")
throws_code(st(E9, "REFUND_WINDOW"), "CL019", "commerçant non versé : fenêtre de remboursement refusée")
run(pz(L9, P9, "PAYOUT_INITIATED", "z:6", "03", "05", 400, "BACKOFFICE", BO))
throws_code(st(E9, "REFUND_WINDOW"), "CL019", "versement initié non confirmé : refusé")
run(pz(L9, P9, "PAYOUT_CONFIRMED", "z:7", "05", "01", 400, "BACKOFFICE", BO))
lives(st(E9, "REFUND_WINDOW"), "versements faits : fenêtre de remboursement")
throws_code(st(E9, "CLOSED"), "CL019", "casse vers l'organisateur : soldes festivaliers non nuls, clôture refusée")
def p3(led, pfx, typ, key, lines_, src="BACKOFFICE", extra=BO):
    js = ",".join('{"account_id":"%s%s","amount":%d}' % (pfx, a, m) for a, m in lines_)
    return f"SELECT post_transaction('{led}','{typ}','{key}',clock_timestamp(),'{src}','[{js}]'{extra})"
# Casse à la date limite : 600 restants, 80 % organisateur, 20 % prestataire ; puis versement des parts de casse
run(p3(L9, P9, "BREAKAGE", "z:8", [("02", 600), ("06", -480), ("07", -120)], src="BATCH", extra="")
    + "; " + pz(L9, P9, "PAYOUT_INITIATED", "z:8a", "06", "05", 480, "BACKOFFICE", BO) + "; " + pz(L9, P9, "PAYOUT_CONFIRMED", "z:8b", "05", "01", 480, "BACKOFFICE", BO)
    + "; " + pz(L9, P9, "PAYOUT_INITIATED", "z:8c", "07", "05", 120, "BACKOFFICE", BO) + "; " + pz(L9, P9, "PAYOUT_CONFIRMED", "z:8d", "05", "01", 120, "BACKOFFICE", BO))
lives(st(E9, "CLOSED"), "casse partagée et versée : tout est soldé, clôture")
is_(f"(SELECT status || ':' || (SELECT count(*) FROM ledger_seal WHERE ledger_id = '{L9}') FROM ledger WHERE id = '{L9}')", "'LOCKED:1'",
    "clôture sans solde restant : grand livre verrouillé et scellement final")
is_(f"(SELECT count(*) FROM event_status_history WHERE event_id = '{E9}')::int", "6", "historique des six passages")
run(st(E8, "LIVE") + "; " + pz(L8, P8, "TOPUP", "y:1", "01", "02", 500, "PSP_WEBHOOK") + "; " + st(E8, "CLOSING") + "; "
    + st(E8, "RECONCILING") + "; " + st(E8, "SETTLING") + "; " + st(E8, "REFUND_WINDOW"))
lives(st(E8, "CLOSED"), "casse NONE : clôture avec soldes festivaliers restants")
is_(f"(SELECT status FROM ledger WHERE id = '{L8}') || ':' || (SELECT remaining FROM event_status_history WHERE event_id = '{E8}' AND to_status = 'CLOSED')",
    "'CLOSING:500'", "soldes restants : grand livre non verrouillé, relevé de 500")
throws_code(f"SELECT lock_settled_ledger('{L8}')", "CL019", "verrouillage refusé tant que des soldes restent dus")
run(pz(L8, P8, "WALLET_REFUND", "y:2", "02", "01", 500, "BACKOFFICE", BO))
lives(f"SELECT lock_settled_ledger('{L8}')", "soldes remboursés : verrouillage")
is_(f"(SELECT status FROM ledger WHERE id = '{L8}')", "'LOCKED'", "grand livre verrouillé après le dernier remboursement")
# Casse réversible (ADR-67) : réclamations tardives sur un grand livre verrouillé
is_(f"(SELECT late_claims_until > now() + interval '4 years' FROM ledger WHERE id = '{L9}')", "true", "verrouillage : réclamations tardives ouvertes 5 ans")
throws_code(pz(L9, P9, "TOPUP", "z:late:0", "01", "02", 100, "PSP_WEBHOOK"), "CL003", "grand livre verrouillé : recharge refusée")
throws(p3(L9, P9, "BREAKAGE_REVERSAL", "z:late:1", [("06", 240), ("07", 60), ("02", -300)], src="BATCH", extra=""), "%journal_transaction_check%", "annulation de casse hors back-office refusée")
throws_code(p3(L9, P9, "BREAKAGE_REVERSAL", "z:late:2", [("06", 300), ("02", -300)]), "CL024", "annulation de casse : répartition différente de la casse d'origine refusée")
throws_code(p3(L9, P9, "BREAKAGE_REVERSAL", "z:late:3", [("06", 240), ("07", 60), ("01", -300)]), "CL024", "annulation de casse vers un compte d'argent refusée")
lives(p3(L9, P9, "BREAKAGE_REVERSAL", "z:late:4", [("06", 240), ("07", 60), ("02", -300)]), "réclamation tardive : casse annulée au prorata (80/20)")
throws_code(p3(L9, P9, "BREAKAGE_REVERSAL", "z:late:5", [("06", 320), ("07", 80), ("02", -400)]), "CL024", "total annulé supérieur à la casse prise (700 > 600) : refusé")
throws_code(p3(L9, P9, "ADJUSTMENT", "z:late:6", [("01", 240), ("02", -240)]), "CL024", "grand livre verrouillé : ajustement vers un portefeuille refusé")
lives(p3(L9, P9, "ADJUSTMENT", "z:late:7", [("01", 240), ("06", -240)]), "l'organisateur rapporte sa part (240)")
throws_code(p3(L9, P9, "ADJUSTMENT", "z:late:8", [("01", 100), ("06", -100)]), "CL024", "apport supérieur à ce qui a été annulé sur ce compte : refusé")
lives(p3(L9, P9, "ADJUSTMENT", "z:late:7b", [("01", 60), ("07", -60)]), "le prestataire rapporte sa part (60)")
lives(p3(L9, P9, "WALLET_REFUND", "z:late:9", [("02", 300), ("01", -300)]), "remboursement tardif du festivalier")
is_(f"(SELECT count(*) FROM party_position WHERE ledger_id = '{L9}' AND net_claim <> 0)::int", "0", "après la réclamation tardive : chaque partie soldée")
throws_code(post("BREAKAGE_REVERSAL", "rv2:brk", "BACKOFFICE", (FOOD, 100), (W1P, -100), extra=", NULL, NULL, '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'"),
            "CL024", "annulation de casse sans casse antérieure (pendant l'événement) : refusée")
# Contestation carte après le verrouillage (ADR-77) : payée par la partie du contrat (organisateur par défaut)
run(f"""INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES
 ('{P9}08','{SN}','{L9}','L-ORG-PERTES','CLAIM','ORG_PERTES','{ORG}','D',true)""")
throws_code(p3(L9, P9, "CHARGEBACK", "z:cb:1", [("08", 500), ("06", -500)]), "CL024", "contestation tardive : crédit autre qu'un compte PSP refusé")
run(f"UPDATE account SET hot = true WHERE id = '{P9}01'")   # compte PSP chaud, comme en production (pas de contrôle de sens)
lives(p3(L9, P9, "CHARGEBACK", "z:cb:2", [("08", 500), ("01", -500)]), "contestation tardive : perte de l'organisateur, PSP crédité")
throws_code(p3(L9, P9, "ADJUSTMENT", "z:cb:3", [("01", 600), ("08", -600)]), "CL024", "apport du payeur supérieur à la contestation : refusé")
lives(p3(L9, P9, "ADJUSTMENT", "z:cb:4", [("01", 500), ("08", -500)]), "l'organisateur rapporte le montant contesté")
is_(f"(SELECT count(*) FROM party_position WHERE ledger_id = '{L9}' AND net_claim <> 0)::int", "0", "après la contestation tardive : chaque partie soldée")
is_("(SELECT column_default FROM information_schema.columns WHERE table_name = 'contract' AND column_name = 'chargeback_bearer')", "$$'ORGANIZER'::text$$", "contestations : organisateur par défaut (contrat)")
run(f"UPDATE ledger SET late_claims_until = now() - interval '1 day' WHERE id = '{L9}'")
throws_code(pz(L9, P9, "WALLET_REFUND", "z:late:10", "02", "01", 1, "BACKOFFICE", BO), "CL003", "délai de réclamation dépassé : refusé")
is_(f"(SELECT operator_fee_basis FROM contract LIMIT 1) IS NULL OR (SELECT bool_and(operator_fee_basis = 'GROSS') FROM contract)", "true", "assiette des frais du prestataire : brute par défaut")
throws(f"INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps, operator_fee_basis) VALUES ('{SN}','OPERATOR_ORGANIZER','{ORG}', now(), 'ORGANIZER','ORGANIZER',8000,'NET')",
       "%contract_operator_fee_basis_check%", "assiette inconnue refusée")
lives(f"INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps, operator_fee_basis) VALUES ('{SN}','OPERATOR_ORGANIZER','{ORG}', now(), 'ORGANIZER','ORGANIZER',8000,'NET_OF_REFUNDS')",
      "contrat avec assiette nette des remboursements")
run(f"SET ROLE app_test; SET app.operator_id = '{CI}'")
throws(st(E8, "LIVE"), "Objet introuvable", "autre prestataire : changement de statut refusé")
run(f"RESET ROLE; SET app.operator_id = '{SN}'")

section("Revue de cohérence n° 2 : corrections")
# --- clôture et verrouillage (DB-B1, DB-I5, DB-I14, DB-I15)
throws_code(f"SELECT lock_settled_ledger('{L}')", "CL019", "verrouillage d'un grand livre ouvert refusé")
run(f"CREATE TEMP TABLE lc AS SELECT late_claims_until FROM ledger WHERE id = '{L9}'")
lives(f"SELECT lock_settled_ledger('{L9}')", "verrouillage relancé sur un grand livre déjà verrouillé : sans effet")
is_(f"(SELECT late_claims_until FROM ledger WHERE id = '{L9}')", "(SELECT late_claims_until FROM lc)", "verrouillage relancé : délai de réclamation inchangé")
E7, L7 = "60000000-0000-0000-0000-0000000000e7", "10000000-0000-0000-0000-0000000000e7"
run(f"""INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('{E7}','{SN}','{ORG}','Clôture sous passerelle','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES ('{L7}','{SN}','EVENT','{E7}','XOF','{ORG}','{ORG}');
SELECT set_debit_authority('{L7}', 'EDGE', 'e0000000-0000-0000-0000-000000000001');
{st(E7, "LIVE")}; {st(E7, "CLOSING")}""")
throws_code(st(E7, "RECONCILING"), "CL019", "rapprochement refusé tant qu'une passerelle détient l'autorité de débit")
run(f"SELECT set_debit_authority('{L7}', 'CENTRAL')")
lives(st(E7, "RECONCILING"), "autorité rendue au central : rapprochement")
run(f"GRANT UPDATE ON event TO app_test; SET ROLE app_test; SET app.operator_id = '{SN}'; SELECT set_config('app.event_status_change', 'on', false)")
throws_code(f"UPDATE event SET status = 'CLOSED' WHERE id = '{E7}'", "CL018", "marqueur posé par l'application : changement de statut quand même refusé")
run("RESET ROLE; SELECT set_config('app.event_status_change', '', false); REVOKE UPDATE ON event FROM app_test")
# --- date limite de synchronisation (ADR-73, Q2)
E6 = "60000000-0000-0000-0000-0000000000e6"
run(f"""INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('{E6}','{SN}','{ORG}','Remontée des terminaux','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','ORGANIZER');
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('70000000-0000-0000-0000-0000000000e6','{SN}','POS','{E6}','TPE-E6-01'),
 ('70000000-0000-0000-0000-0000000000e7','{SN}','POS','{E6}','TPE-E6-PERSO');
UPDATE device SET personal_phone = true WHERE id = '70000000-0000-0000-0000-0000000000e7';
{st(E6, "LIVE")}; {st(E6, "CLOSING")}; {st(E6, "RECONCILING")}""")
is_(f"(SELECT event_sync_deadline('{E6}') - (SELECT changed_at FROM event_status_history WHERE event_id = '{E6}' AND to_status = 'CLOSING')) = interval '72 hours'",
    "true", "date limite par défaut : 72 h après la fin (ici le passage en CLOSING)")
is_(f"(SELECT string_agg(serial || ':' || coalesce(reason, 'OK'), ',') FROM event_device_sync_status('{E6}'))", "'TPE-E6-01:NOT_SEEN_SINCE_CLOSING'",
    "état de remontée : terminal muet depuis la clôture ; téléphone personnel exclu")
throws_code(st(E6, "SETTLING"), "CL019", "avant la date limite, un terminal pas à jour : règlement refusé")
run("UPDATE device SET last_seen_at = clock_timestamp() WHERE id = '70000000-0000-0000-0000-0000000000e6'")
lives(st(E6, "SETTLING"), "tous les terminaux à jour : règlement avant la date limite")
throws("UPDATE event SET sync_deadline_hours = 0 WHERE id = '" + E6 + "'", "%sync_deadline_hours%", "date limite d'au moins 1 heure")
E5 = "60000000-0000-0000-0000-0000000000e5"
run(f"""INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, ends_at, sync_deadline_hours) VALUES
 ('{E5}','{SN}','{ORG}','Date limite dépassée','XOF','Africa/Dakar','50000000-0000-0000-0000-000000000001','ORGANIZER', now() - interval '4 days', 72);
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ('70000000-0000-0000-0000-0000000000e5','{SN}','POS','{E5}','TPE-E5-PERDU');
{st(E5, "LIVE")}; {st(E5, "CLOSING")}; {st(E5, "RECONCILING")}""")
lives(st(E5, "SETTLING"), "date limite dépassée : règlement permis malgré un terminal perdu (la suite = synchronisations tardives)")

# --- demandes d'approbation du back-office (ADR-74, Q3)
run(f"""INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by) VALUES
 ('ad000000-0000-0000-0000-000000000001','{SN}','WAIVE_SEQ_GAP','70000000-0000-0000-0000-000000000001','{{"seq": 7}}','{U1}'),
 ('ad000000-0000-0000-0000-000000000002','{SN}','ADJUSTMENT','{L}','{{"amount": 100}}','{U1}')""")
throws_code(f"SELECT decide_approval_request('ad000000-0000-0000-0000-000000000001', '{U1}', true)", "CL023", "l'auteur de la demande ne peut pas l'approuver")
is_(f"(SELECT status || ':' || (decided_by = '{U2}') FROM decide_approval_request('ad000000-0000-0000-0000-000000000001', '{U2}', true))", "'APPROVED:true'",
    "approbation par une seconde personne")
throws_code(f"SELECT decide_approval_request('ad000000-0000-0000-0000-000000000001', '{U2}', true)", "CL023", "demande déjà décidée : refus")
throws_code("UPDATE approval_request SET payload = '{\"seq\": 8}' WHERE id = 'ad000000-0000-0000-0000-000000000001'", "CL023", "contenu d'une demande figé")
lives("UPDATE approval_request SET status = 'EXECUTED' WHERE id = 'ad000000-0000-0000-0000-000000000001'", "demande approuvée exécutée")
throws_code("UPDATE approval_request SET decided_by = gen_random_uuid() WHERE id = 'ad000000-0000-0000-0000-000000000001'",
            "CL023", "valideur d'une demande exécutée non modifiable")
run(f"""INSERT INTO approval_request (id, operator_id, action, payload, requested_by, requested_at, expires_at) VALUES
 ('ad000000-0000-0000-0000-000000000003','{SN}','ADJUSTMENT','{{}}','{U1}', now() - interval '2 days', now() - interval '1 day')""")
is_(f"(SELECT decide_approval_request('ad000000-0000-0000-0000-000000000003', '{U2}', true)) IS NULL", "true", "demande expirée : pas d'approbation")
is_("(SELECT status FROM approval_request WHERE id = 'ad000000-0000-0000-0000-000000000003')", "'EXPIRED'", "demande expirée marquée")

# --- remboursement vers un autre numéro (ADR-76, Q5)
is_(f"(SELECT refund_new_number_max || ':' || refund_new_number_hold_hours FROM event WHERE id = '{EV}')", "'50000:48'",
    "autre numéro : plafond 50 000 et attente de 48 h par défaut")
throws(f"UPDATE event SET refund_new_number_hold_hours = 500 WHERE id = '{EV}'", "%refund_new_number_hold_hours%", "attente bornée à 7 jours")

# --- caution qui suit le bracelet de remplacement (DB-B2, M5)
run(f"""INSERT INTO wallet (id, operator_id, ledger_id) VALUES ('30000000-0000-0000-0000-000000000087','{SN}','{L}');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES
 ('20000000-0000-0000-0000-000000000087','{SN}','{L}','L-WAL-C87-P','CLAIM','WALLET_PAID','30000000-0000-0000-0000-000000000087','C',false);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id) VALUES
 ('40000000-0000-0000-0000-000000000087','{SN}','NFC_TAG', sha256('\\x87'::bytea), '\\x04000000000087','90000000-0000-0000-0000-000000000080'),
 ('40000000-0000-0000-0000-000000000088','{SN}','NFC_TAG', sha256('\\x88'::bytea), '\\x04000000000088','90000000-0000-0000-0000-000000000080');
SELECT activate_media('40000000-0000-0000-0000-000000000087','30000000-0000-0000-0000-000000000087','DESK');
{post("TOPUP", "wave:rv2-87", "PSP_WEBHOOK", (A_WAVE, 3000), ("20000000-0000-0000-0000-000000000087", -3000))};
SELECT take_deposit('40000000-0000-0000-0000-000000000087')""")
throws_code("SELECT replace_media('40000000-0000-0000-0000-000000000087','40000000-0000-0000-0000-000000000080')", "CL020",
            "remplacement par un bracelet déjà en service refusé")
lives("SELECT replace_media('40000000-0000-0000-0000-000000000087','40000000-0000-0000-0000-000000000088')", "remplacement d'un bracelet avec caution détenue")
is_("(SELECT deposit_status || ':' || deposit_held FROM media WHERE id = '40000000-0000-0000-0000-000000000088')", "'HELD:1000'", "la caution passe au nouveau bracelet")
lives("SELECT refund_deposit('40000000-0000-0000-0000-000000000088')", "caution rendue sur le nouveau bracelet")
is_("wallet_spendable('30000000-0000-0000-0000-000000000087')", "3000", "caution recréditée au portefeuille")
throws_code("SELECT replace_media('40000000-0000-0000-0000-000000000087','40000000-0000-0000-0000-000000000052')", "CL020", "bracelet déjà remplacé : nouveau remplacement refusé")
# --- numéros de séquence bornés (DB-B3)
DV = "'70000000-0000-0000-0000-000000000001'"
throws_code(f"SELECT * FROM record_device_seq({DV}, (SELECT contiguous_acked_seq + max_seq_jump() + 1 FROM device WHERE id = {DV}), sha256('rv2'::bytea), 'ACCEPTED', 'ONLINE')",
            "CL021", "numéro trop loin devant : refusé (CL021), aucune anomalie de masse")
throws_code(f"SELECT open_offline_batch('b0000000-0000-0000-0000-0000000000f1', {DV}, '{L}', 1000000000, sha256('p'::bytea), ARRAY[sha256('o'::bytea)], sha256('l'::bytea), '\\x00')",
            "CL021", "lot hors plage : refusé avant toute anomalie")
is_(f"(SELECT count(*) FROM anomaly WHERE device_id = {DV} AND kind = 'SEQ_GAP' AND seq > 100000)::int", "0", "aucune anomalie SEQ_GAP créée")
# --- passage consommé une seule fois (DB-I3)
run(f"""CREATE TEMP TABLE tp AS SELECT * FROM register_tap('{SN}', sha256('\\x12'::bytea), '\\x04000000000012', 50, now(), '70000000-0000-0000-0000-000000000010', 'ONLINE');
CREATE TEMP TABLE tx2 AS SELECT id FROM journal_transaction WHERE ledger_id = '{L}' AND source = 'ONLINE' AND media_id IS NULL ORDER BY recorded_at, id LIMIT 2""")
is_("(SELECT result IS NOT NULL AND tap_id IS NOT NULL FROM tp)", "true", "register_tap renvoie le résultat et l'identifiant du passage")
lives("SELECT consume_tap((SELECT tap_id FROM tp), (SELECT min(id::text)::uuid FROM tx2))", "passage consommé par une écriture")
lives("SELECT consume_tap((SELECT tap_id FROM tp), (SELECT min(id::text)::uuid FROM tx2))", "même écriture : sans effet (rejeu)")
throws_code("SELECT consume_tap((SELECT tap_id FROM tp), (SELECT max(id::text)::uuid FROM tx2))", "CL022", "seconde écriture sur le même passage refusée")
run(f"""CREATE TEMP TABLE tp2 AS SELECT * FROM register_tap('{SN}', sha256('\\x12'::bytea), '\\x04000000000012', 51, now(), '70000000-0000-0000-0000-000000000010', 'ONLINE');
UPDATE media_tap SET received_at = now() - interval '1 hour' WHERE id = (SELECT tap_id FROM tp2)""")
throws_code("SELECT consume_tap((SELECT tap_id FROM tp2), (SELECT max(id::text)::uuid FROM tx2))", "CL022", "passage en ligne trop ancien : refusé")
is_(f"(SELECT result FROM register_tap('{SN}', sha256('\\x11'::bytea), '\\x04000000000011', 90, now(), '70000000-0000-0000-0000-000000000001', 'ONLINE'))",
    "'SIGNATURE_MISSING'", "puce avec signature enregistrée, signature absente en ligne : relire (sans liste noire)")
is_("(SELECT status FROM media WHERE id = '40000000-0000-0000-0000-000000000011')", "'ACTIVE'", "signature absente : pas de liste noire")
# --- espèces dues rendues au guichet (API-B2, DB-I11)
MD = "40000000-0000-0000-0000-000000000011"
run(f"""INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ('{SN}','{LIM}','CASH_TOPUP_OVER_LIMIT','{MD}', (SELECT -sum(amount) FROM posting WHERE account_id = '{DUE}'))""")
throws_code(f"SELECT release_media('{MD}')", "CL020", "restitution refusée tant que des espèces sont dues au détenteur")
throws_code(f"SELECT refund_cash_due('{MD}', '{A9}', 'cashdue:1', '{U1}')", "CL001", "rendu des espèces sur un compte qui n'est pas une caisse refusé")
throws_code(f"SELECT refund_cash_due('{MD}', '{CD}', 'cashdue:1', '{U1}')", "23514", "au-delà du plafond : seconde personne obligatoire (FORBIDDEN)")
lives(f"SELECT refund_cash_due('{MD}', '{CD}', 'cashdue:1', '{U1}', '{U2}')", "espèces dues rendues à deux personnes")
is_(f"(SELECT coalesce(sum(amount), 0) FROM posting WHERE account_id = '{DUE}')::bigint", "0", "L-ESP-A-RENDRE soldé")
is_(f"(SELECT count(*) FROM anomaly WHERE media_id = '{MD}' AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN')::int", "0", "anomalie close")
throws_code(f"SELECT refund_cash_due('{MD}', '{CD}', 'cashdue:2', '{U1}', '{U2}')", "CL020", "plus rien à rendre : refusé")
throws(f"INSERT INTO anomaly (operator_id, ledger_id, kind, amount) VALUES ('{SN}','{LIM}','CASH_TOPUP_OVER_LIMIT', 100)", "%anomaly_check%",
       "espèces dues sans bracelet refusées")
run(f"INSERT INTO anomaly (id, operator_id, ledger_id, kind, media_id, amount) VALUES ('ab000000-0000-0000-0000-000000000001','{SN}','{LIM}','CASH_TOPUP_OVER_LIMIT','{MD}', 100)")
throws_code("UPDATE anomaly SET status = 'RESOLVED' WHERE id = 'ab000000-0000-0000-0000-000000000001'", "CL020", "espèces dues closes à la main : refusé")
# --- lot abandonné, levée pendant un lot, borne (M8, DB-I12)
DV2 = "70000000-0000-0000-0000-0000000000f2"
G = f"device_chain_genesis('{DV2}')"
run(f"""INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ('{DV2}','{SN}','POS','{EV}','TPE-REV2');
SELECT open_offline_batch('b0000000-0000-0000-0000-0000000000a1', '{DV2}', '{L}', 1, {G}, ARRAY[sha256('a'::bytea)], chain_step({G}, sha256('a'::bytea)), '\\x00');
SELECT * FROM record_device_seq('{DV2}', 3, sha256('c'::bytea), 'REJECTED', 'ONLINE', NULL, 'TEST')""")
throws_code(f"SELECT waive_seq_gap('{DV2}', 1, '{U1}', '{U2}', 'perdu')", "CL010", "levée d'un numéro couvert par un lot en cours : refusée")
throws_code(f"SELECT open_offline_batch('b0000000-0000-0000-0000-0000000000a2', '{DV2}', '{L}', 2, chain_step({G}, sha256('a'::bytea)), ARRAY[sha256('b'::bytea)], chain_step(chain_step({G}, sha256('a'::bytea)), sha256('b'::bytea)), '\\x00')",
            "CL010", "second lot pendant le premier : refusé")
run("UPDATE offline_batch SET received_at = now() - interval '20 minutes' WHERE id = 'b0000000-0000-0000-0000-0000000000a1'")
lives(f"SELECT open_offline_batch('b0000000-0000-0000-0000-0000000000a2', '{DV2}', '{L}', 2, chain_step({G}, sha256('a'::bytea)), ARRAY[sha256('b'::bytea)], chain_step(chain_step({G}, sha256('a'::bytea)), sha256('b'::bytea)), '\\x00')",
      "lot en cours depuis plus de 15 min : abandonné, le suivant s'ouvre")
is_("(SELECT status || ':' || reject_reason FROM offline_batch WHERE id = 'b0000000-0000-0000-0000-0000000000a1')", "'REJECTED:ABANDONED'", "lot abandonné marqué")
# --- terminal d'un autre prestataire, signature absente hors ligne (M2, DB-I1)
run(f"INSERT INTO device (id, operator_id, kind, serial) VALUES ('70000000-0000-0000-0000-0000000000c9','{CI}','POS','TPE-CI-REV2')")
throws(f"SELECT * FROM register_tap('{SN}', sha256('\\x11'::bytea), '\\x04000000000011', 92, now(), '70000000-0000-0000-0000-0000000000c9', 'ONLINE')",
       "Objet introuvable", "terminal d'un autre prestataire : refusé")
run(f"SELECT * FROM register_tap('{SN}', sha256('\\x11'::bytea), '\\x04000000000011', 93, now(), '70000000-0000-0000-0000-000000000001', 'OFFLINE')")
is_("(SELECT count(*) FROM anomaly WHERE media_id = '40000000-0000-0000-0000-000000000011' AND kind = 'SIGNATURE_MISMATCH')::int", "2",
    "hors ligne, signature absente : opération gardée, anomalie ouverte")
# --- comptes chauds et froids (DB-I8, DB-I9)
is_(f"(SELECT allow_negative FROM account WHERE id = '{M9}')", "true", "compte commerçant chaud : côté opposé permis")
run(f"UPDATE account SET hot = false WHERE id = '{M9}'")
is_(f"(SELECT balance FROM account_balance WHERE account_id = '{M9}')", f"(SELECT sum(amount) FROM posting WHERE account_id = '{M9}')", "passage en froid : solde en cache recalculé")
run(f"UPDATE account SET hot = true WHERE id = '{M9}'")
is_(f"(SELECT count(*) FROM account_balance WHERE account_id = '{M9}')::int", "0", "retour en chaud : cache supprimé")
is_("(SELECT count(*) FROM balance_drift)::int", "0", "aucun écart de cache")
# --- identification à une date passée (M1)
run(f"""INSERT INTO kyc_verification (operator_id, customer_id, agent_id, id_type, id_country, id_last4, id_expires_on, status, verified_at, revoked_at, revoked_by, revoked_reason)
 VALUES ('{SN}','00000000-0000-0000-0000-0000000000c1','{U1}','PASSPORT','SN','1234', current_date + 300, 'REVOKED', now() - interval '10 days', now() - interval '2 days', '{U2}', 'test')""")
is_("wallet_kyc_level('30000000-0000-0000-0000-000000000092', current_date - 5)", "'VERIFIED'", "niveau à une date passée : identification alors valide")
is_("wallet_kyc_level('30000000-0000-0000-0000-000000000092', current_date - 20)", "'NONE'", "avant la vérification : non identifié")
is_(f"(SELECT unsealed_postings > 0 FROM ledgers_to_seal WHERE ledger_id = '{L9}')", "true", "réclamations tardives d'un grand livre verrouillé : à sceller")
is_("(SELECT count(*) FROM pg_proc WHERE proname IN ('forfeit_batch_deposits','refund_cash_due','consume_tap','ledger_unsettled','max_seq_jump'))::int", "5",
    "fonctions ajoutées par la revue 2 présentes")

section("Scellement du journal (S25)")
is_(f"(SELECT postings FROM seal_ledger('{L}', interval '0'))", f"(SELECT count(*) FROM posting WHERE ledger_id = '{L}')::int",
    "premier scellement : toutes les lignes du grand livre")
is_(f"(SELECT prev_seal_hash FROM ledger_seal WHERE ledger_id = '{L}' AND seal_no = 1)", f"ledger_seal_genesis('{L}')", "premier scellement chaîné sur l'origine")
is_(f"(SELECT seal_no FROM seal_ledger('{L}', interval '0')) IS NULL", "true", "rien de nouveau : pas de scellement")
run(post("PITCH_FEE", "seal:1", "BATCH", (FOOD, 50), (ORGCOM, -50)))
is_(f"(SELECT seal_no FROM seal_ledger('{L}')) IS NULL", "true", "délai par défaut (5 min) : une écriture récente n'est pas encore scellée")
is_(f"(SELECT row(seal_no, postings)::text FROM seal_ledger('{L}', interval '0'))", "'(2,2)'", "second scellement : les 2 nouvelles lignes seulement")
is_(f"(SELECT prev_seal_hash FROM ledger_seal WHERE ledger_id = '{L}' AND seal_no = 2)",
    f"(SELECT seal_hash FROM ledger_seal WHERE ledger_id = '{L}' AND seal_no = 1)", "scellements chaînés")
is_(f"(SELECT bool_and(ok) FROM verify_ledger_seals('{L}'))", "true", "vérification : aucun écart")
throws(f"UPDATE ledger_seal SET postings = 1 WHERE ledger_id = '{L}' AND seal_no = 1", "%ajout seul%", "scellement non modifiable")
lives(f"UPDATE ledger_seal SET external_ref = 's3://seals/{L}/1' WHERE ledger_id = '{L}' AND seal_no = 1", "référence de la copie externe renseignée")
throws(f"UPDATE ledger_seal SET external_ref = 's3://autre' WHERE ledger_id = '{L}' AND seal_no = 1", "%ajout seul%", "référence externe renseignée une seule fois")
run(f"SET ROLE app_test; SET app.operator_id = '{CI}'")
throws(f"SELECT seal_ledger('{L}', interval '0')", "Objet introuvable", "autre prestataire : scellement refusé")
run(f"RESET ROLE; SET app.operator_id = '{SN}'")
run(f"SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE posting DISABLE TRIGGER posting_immutable; UPDATE posting SET amount = amount + 1 WHERE id = (SELECT min(id) FROM posting WHERE ledger_id = '{L}')")
is_(f"(SELECT string_agg(seal_no || ':' || ok, ',' ORDER BY seal_no) FROM verify_ledger_seals('{L}'))", "'1:false,2:true'",
    "altération d'un montant scellé : détectée dans le bon scellement")
run(f"DELETE FROM posting WHERE id = (SELECT max(id) FROM posting WHERE ledger_id = '{L}'); ALTER TABLE posting ENABLE TRIGGER posting_immutable")
is_(f"(SELECT string_agg(seal_no || ':' || ok, ',' ORDER BY seal_no) FROM verify_ledger_seals('{L}'))", "'1:false,2:false'",
    "suppression d'une ligne scellée : détectée")
run(f"SELECT seal_ledger('{LIM}', interval '0'); SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE journal_transaction DISABLE TRIGGER USER; "
    f"UPDATE journal_transaction SET created_by = gen_random_uuid() WHERE id = (SELECT min(id::text)::uuid FROM journal_transaction WHERE ledger_id = '{LIM}'); "
    "ALTER TABLE journal_transaction ENABLE TRIGGER USER")
is_(f"(SELECT bool_and(ok) FROM verify_ledger_seals('{LIM}'))", "false", "auteur d'une écriture scellée modifié : détecté (revue 2)")

# ---------------------------------------------------------------- génération
n = sum(1 for s in steps if s[0] in ("lives", "throws", "throws_code", "is", "ok"))
def q(x): return "$Q$" + x + "$Q$"
out = ["-- Tests du grand livre cashless — pgTAP. Lancer : pg_prove -d <base> tests_grand_livre_cashless.sql",
       "-- (généré par gen_tests.py). Chaque cas est une assertion ; tout écart fait échouer la suite.",
       "\\set ON_ERROR_STOP 1", "\\set QUIET 1", "BEGIN;", "CREATE EXTENSION IF NOT EXISTS pgtap;", f"SELECT plan({n});"]
for s in steps:
    k = s[0]
    if k == "section": out.append(f"\n-- ===== {s[1]}")
    elif k == "run": out.append(s[1].rstrip(";") + ";")
    elif k == "lives": out.append(f"SELECT lives_ok({q(s[1])}, {q(s[2])});")
    elif k == "throws": out.append(f"SELECT throws_like({q(s[1])}, {q(s[2])}, {q(s[3])});")
    elif k == "throws_code": out.append(f"SELECT throws_ok({q(s[1])}, '{s[2]}', NULL, {q(s[3])});")
    elif k == "is": out.append(f"SELECT is(({s[1]})::text, ({s[2]})::text,{q(s[3])});")
    elif k == "ok": out.append(f"SELECT ok(({s[1]}), {q(s[2])});")
out += ["SELECT * FROM finish();", "ROLLBACK;"]
open("tests_grand_livre_cashless.sql", "w").write("\n".join(out) + "\n")
print("assertions:", n)
