-- Relevés importés, rapprochement et état par compte (mission 9b, lot WP02 ; FR-001, FR-004, FR-013 à FR-015, C-004 ;
-- research R-08). Numéro 0083. Aucune route, aucun droit accordé : les droits de rôle sont posés par le lot WP06
-- (post-roles.sql, section 12). Les tests de ce lot s'exécutent en propriétaire.
--
-- Objet : table `statement_import` (ajout seul), colonnes et gardes de `external_statement_line`, index d'import,
-- trois fonctions SECURITY DEFINER (`import_statement_lines`, `match_statement_line`, `account_reconciliation`).
--
-- Décisions (WP09 les consomme) :
--   * SIGNE de `external_statement_line.amount` : positif = entrée sur le compte d'argent, négatif = sortie. Le sens
--     est fixé par le compte (côté débit d'un compte ASSET), pas par le fournisseur. `closing_balance` suit le même
--     signe : solde positif = argent détenu.
--   * SOLDE DU COMPTE à une date : somme signée des lignes de `posting` du compte dont la transaction a
--     `occurred_at` <= fin du jour de `statement_date` (minuit suivant, moins une microseconde, dans le fuseau de
--     l'événement du grand livre, UTC hors événement). Même valeur que `trial_balance_at(ledger, date)` pour le
--     `code` du compte ; calculée compte par compte (index posting(account_id, id)) pour ne pas balayer tout le
--     grand livre à chaque appel.
--   * COMPTE RAPPROCHÉ = aucune ligne non rapprochée ET `closing_balance` du dernier relevé = solde du grand livre à
--     sa date + somme des lignes rapprochées à une anomalie (FR-015). Un compte sans relevé, sans ligne et sans
--     aucun mouvement compte comme rapproché (sinon un événement sans PSP ne passerait jamais). Un compte avec
--     mouvements mais sans relevé n'est PAS rapproché.
--   * Rapprochement automatique par TABLE SOURCE (jamais en analysant idempotency_key) : psp_topup.provider_payment_ref
--     -> topup_tx_id ; psp_chargeback.provider_dispute_id -> chargeback_tx_id ; refund_request.external_reference ->
--     transaction_id ; payout.external_ref -> settled_tx_id. Conditions : même prestataire, même grand livre, la
--     transaction a une ligne `posting` sur le compte de la ligne. Une référence qui désigne plusieurs transactions
--     laisse la ligne non rapprochée. Le rapprochement porte sur toutes les lignes non rapprochées du compte, pas
--     seulement celles du fichier importé (un réimport d'un fichier qui en recoupe un autre rattrape les anciennes).
--   * UNICITÉ (renforcement, décision de l'orchestrateur, règle 1) : la contrainte d'origine UNIQUE (source,
--     external_ref), GLOBALE (sans prestataire ni compte), est RETIRÉE (external_statement_line_source_external_ref_key).
--     Elle permettait à un prestataire d'occuper à l'avance les références d'un autre (déni de service sur le
--     rapprochement) et de lui révéler leur existence par `existing`. Seul l'index unique (account_id, source,
--     external_ref) reste ; l'import utilise ON CONFLICT (account_id, source, external_ref). Aucun code ni aucune suite
--     ne lisait la contrainte par son nom. À consigner (ADR, POINTS_OUVERTS) et à reporter dans data-model.md (WP14).
--   * Les lignes d'un même fichier qui répètent un external_ref : une seule est créée (la première) ; la répétition
--     compte dans `existing`.
--   * Erreurs : CL047 (VALIDATION_FAILED) pour toute entrée invalide (devise, compte, montant, cible), CL043
--     (CONFLICT_STATE) pour une ligne déjà rapprochée. Un grand livre d'un autre prestataire : « Objet introuvable ».
--   * Verrous : import = verrou consultatif par (compte, empreinte du fichier) ; rapprochement manuel = ligne
--     `FOR UPDATE` en dernier (interfaces.md, « Ordre des verrous »).
--   * Décision 14 (17/11/2026, OP-N126) : le rapprochement manuel et l'automatique prennent d'abord, `FOR UPDATE` par
--     ordre d'identifiant, les `refund_request` du grand livre liées à la transaction ou à la référence de la ligne
--     (la demande passe en tête de l'ordre des verrous, comme dans la confirmation de WP11). Sous ce verrou, une
--     demande `FAILED` (déjà recréditée) fait refuser le manuel (CL043, CONFLICT_STATE : code existant, aucun code
--     nouveau) et laisse la ligne non rapprochée à l'automatique. Renforcement ; la règle de rapprochement ne change pas.
--
-- Index de recherche des références externes (noms figés) : psp_topup_provider_ref_idx, psp_chargeback_dispute_idx,
-- payout_external_ref_idx, refund_request_external_ref_idx, external_statement_line_unmatched_idx.
-- Fonctions à faire relire : external_statement_line_scope_guard, external_statement_line_update_guard,
-- import_statement_lines, match_statement_line, account_reconciliation.

-- 1. statement_import -----------------------------------------------------------------------------------------------
CREATE TABLE statement_import (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  ledger_id       uuid NOT NULL REFERENCES ledger(id),
  account_id      uuid NOT NULL REFERENCES account(id),
  source          text NOT NULL CHECK (length(btrim(source)) > 0),
  file_sha256     text NOT NULL CHECK (file_sha256 ~* '^[0-9a-f]{64}$'),
  statement_date  date NOT NULL,
  closing_balance bigint NOT NULL,
  currency        char(3) NOT NULL,
  -- Personne du back-office : comme approval_request, sans clé étrangère.
  imported_by     uuid NOT NULL,
  imported_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  lines_created   int NOT NULL CHECK (lines_created >= 0),
  lines_existing  int NOT NULL CHECK (lines_existing >= 0),
  lines_matched   int NOT NULL CHECK (lines_matched >= 0),
  CONSTRAINT statement_import_account_ledger FOREIGN KEY (ledger_id, account_id) REFERENCES account(ledger_id, id),
  CONSTRAINT statement_import_file_once UNIQUE (account_id, file_sha256),
  CONSTRAINT statement_import_id_account UNIQUE (id, account_id)
);
CREATE INDEX statement_import_account_date_idx ON statement_import (account_id, statement_date DESC, imported_at DESC);
ALTER TABLE statement_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_import FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement_import
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
CREATE TRIGGER statement_import_immutable BEFORE UPDATE OR DELETE ON statement_import
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Garde d'insertion : la RLS ne contrôle que operator_id ; sans cette garde, une session du prestataire A pourrait
-- désigner le grand livre ou le compte de B, ou un compte qui n'est pas de la famille ASSET.
CREATE FUNCTION statement_import_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant_of_ledger(NEW.ledger_id) IS DISTINCT FROM NEW.operator_id
     OR NOT EXISTS (SELECT 1 FROM account a WHERE a.id = NEW.account_id AND a.ledger_id = NEW.ledger_id
                       AND a.operator_id = NEW.operator_id AND a.family = 'ASSET') THEN
    RAISE EXCEPTION 'Relevé : grand livre ou compte d''un autre prestataire, ou compte hors famille ASSET'
      USING ERRCODE = 'CL047';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION statement_import_scope_guard() FROM PUBLIC;
CREATE TRIGGER statement_import_scope_guard BEFORE INSERT ON statement_import
  FOR EACH ROW EXECUTE FUNCTION statement_import_scope_guard();

-- 2. external_statement_line : colonnes, contraintes, gardes -----------------------------------------------------------
ALTER TABLE external_statement_line
  ADD COLUMN statement_import_id uuid,
  ADD COLUMN currency            char(3),
  ADD COLUMN matched_anomaly_id  uuid REFERENCES anomaly(id),
  ADD COLUMN matched_by          uuid,
  ADD COLUMN matched_at          timestamptz;
-- Rattachement au relevé : même compte que la ligne. Différé, car import_statement_lines compte ses lignes avant
-- d'écrire la ligne `statement_import` (table en ajout seul : aucun UPDATE des compteurs).
ALTER TABLE external_statement_line
  ADD CONSTRAINT external_statement_line_import FOREIGN KEY (statement_import_id, account_id)
    REFERENCES statement_import (id, account_id) DEFERRABLE INITIALLY DEFERRED;
-- Renforcement : plus d'unicité globale (source, external_ref), qui croisait les prestataires.
ALTER TABLE external_statement_line DROP CONSTRAINT external_statement_line_source_external_ref_key;
CREATE UNIQUE INDEX external_statement_line_account_ref ON external_statement_line (account_id, source, external_ref);
CREATE INDEX external_statement_line_unmatched_idx ON external_statement_line (account_id)
  WHERE matched_tx_id IS NULL AND matched_anomaly_id IS NULL;
CREATE INDEX external_statement_line_import_idx ON external_statement_line (statement_import_id);
-- Une cible au plus ; auteur et date si et seulement si rapprochée. NOT VALID : les lignes d'avant 0083 (aucune
-- n'est écrite par l'application) ne sont pas réécrites ; la contrainte vaut pour toute écriture nouvelle.
ALTER TABLE external_statement_line
  ADD CONSTRAINT external_statement_line_one_target CHECK (matched_tx_id IS NULL OR matched_anomaly_id IS NULL),
  ADD CONSTRAINT external_statement_line_match_audit CHECK (
    ((matched_tx_id IS NOT NULL OR matched_anomaly_id IS NOT NULL) = (matched_by IS NOT NULL))
    AND ((matched_by IS NULL) = (matched_at IS NULL))) NOT VALID,
  ADD CONSTRAINT external_statement_line_amount_nonzero CHECK (amount <> 0) NOT VALID,
  ADD CONSTRAINT external_statement_line_source_nonblank CHECK (length(btrim(source)) > 0) NOT VALID,
  ADD CONSTRAINT external_statement_line_ref_nonblank CHECK (length(btrim(external_ref)) > 0) NOT VALID;

-- Index de recherche des références externes (import : NFR-003).
CREATE INDEX IF NOT EXISTS psp_topup_provider_ref_idx ON psp_topup (provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS psp_chargeback_dispute_idx ON psp_chargeback (provider_dispute_id);
CREATE INDEX IF NOT EXISTS payout_external_ref_idx ON payout (external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_request_external_ref_idx ON refund_request (external_reference)
  WHERE external_reference IS NOT NULL;

-- Garde d'insertion d'une ligne : grand livre du prestataire de la ligne, compte de ce grand livre et de la famille
-- ASSET, relevé (s'il y en a un) du même prestataire. Une ligne neuve naît non rapprochée.
CREATE FUNCTION external_statement_line_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant_of_ledger(NEW.ledger_id) IS DISTINCT FROM NEW.operator_id
     OR NOT EXISTS (SELECT 1 FROM account a WHERE a.id = NEW.account_id AND a.ledger_id = NEW.ledger_id
                       AND a.operator_id = NEW.operator_id AND a.family = 'ASSET') THEN
    RAISE EXCEPTION 'Ligne de relevé : grand livre ou compte d''un autre prestataire, ou compte hors famille ASSET'
      USING ERRCODE = 'CL047';
  END IF;
  IF NEW.matched_tx_id IS NOT NULL OR NEW.matched_anomaly_id IS NOT NULL
     OR NEW.matched_by IS NOT NULL OR NEW.matched_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne de relevé : une ligne neuve naît non rapprochée' USING ERRCODE = 'CL047';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION external_statement_line_scope_guard() FROM PUBLIC;
CREATE TRIGGER external_statement_line_scope_guard BEFORE INSERT ON external_statement_line
  FOR EACH ROW EXECUTE FUNCTION external_statement_line_scope_guard();

-- Garde de mise à jour : seules les colonnes de rapprochement passent de NULL à une valeur, une seule fois ; la cible
-- est du même prestataire et du même grand livre, la transaction mouvemente le compte, l'anomalie est ouverte et d'un
-- type PSP. Toute autre colonne est immuable.
CREATE FUNCTION external_statement_line_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.operator_id, NEW.ledger_id, NEW.account_id, NEW.source, NEW.external_ref, NEW.value_date,
      NEW.amount, NEW.currency, NEW.statement_import_id)
     IS DISTINCT FROM
     (OLD.id, OLD.operator_id, OLD.ledger_id, OLD.account_id, OLD.source, OLD.external_ref, OLD.value_date,
      OLD.amount, OLD.currency, OLD.statement_import_id) THEN
    RAISE EXCEPTION 'Ligne de relevé : seules les colonnes de rapprochement changent' USING ERRCODE = 'CL047';
  END IF;
  IF OLD.matched_tx_id IS NOT NULL OR OLD.matched_anomaly_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne de relevé déjà rapprochée' USING ERRCODE = 'CL043';
  END IF;
  IF NEW.matched_tx_id IS NULL AND NEW.matched_anomaly_id IS NULL THEN
    RAISE EXCEPTION 'Ligne de relevé : aucune cible de rapprochement' USING ERRCODE = 'CL047';
  END IF;
  IF NEW.matched_tx_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM journal_transaction t
        WHERE t.id = NEW.matched_tx_id AND t.operator_id = NEW.operator_id AND t.ledger_id = NEW.ledger_id
          AND EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id AND p.account_id = NEW.account_id)) THEN
    RAISE EXCEPTION 'Rapprochement : transaction d''un autre prestataire ou grand livre, ou qui ne touche pas le compte'
      USING ERRCODE = 'CL047';
  END IF;
  IF NEW.matched_anomaly_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM anomaly n
        WHERE n.id = NEW.matched_anomaly_id AND n.operator_id = NEW.operator_id AND n.ledger_id = NEW.ledger_id
          AND n.status = 'OPEN' AND n.kind IN ('PSP_TOPUP_OVER_LIMIT', 'PSP_TOPUP_NOT_CREDITED', 'PSP_MISMATCH')) THEN
    RAISE EXCEPTION 'Rapprochement : anomalie d''un autre prestataire ou grand livre, résolue, ou de type non PSP'
      USING ERRCODE = 'CL047';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION external_statement_line_update_guard() FROM PUBLIC;
CREATE TRIGGER external_statement_line_update_guard BEFORE UPDATE ON external_statement_line
  FOR EACH ROW EXECUTE FUNCTION external_statement_line_update_guard();
CREATE TRIGGER external_statement_line_no_delete BEFORE DELETE ON external_statement_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 3. import_statement_lines ------------------------------------------------------------------------------------------
-- p_import : ledger_id, account_id, source, file_sha256, statement_date, closing_balance, currency, imported_by.
-- p_lines  : tableau de {external_ref, value_date, amount, currency}.
-- Rend {import_id, created, matched, existing}. Réimport du même fichier sur le même compte : l'import existant,
-- created = 0, aucune écriture.
CREATE FUNCTION import_statement_lines(p_import jsonb, p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ledger uuid; v_account uuid; v_source text; v_sha text; v_date date; v_closing bigint; v_cur text; v_by uuid;
  l ledger%ROWTYPE; v_existing statement_import%ROWTYPE; v_id uuid := gen_random_uuid();
  v_total int; v_bad int; v_created int; v_matched int;
BEGIN
  IF p_import IS NULL OR jsonb_typeof(p_import) <> 'object' OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Import : relevé ou lignes absents ou mal formés' USING ERRCODE = 'CL047';
  END IF;
  BEGIN
    v_ledger := (p_import->>'ledger_id')::uuid;
    v_account := (p_import->>'account_id')::uuid;
    v_source := p_import->>'source';
    v_sha := lower(p_import->>'file_sha256');
    v_date := (p_import->>'statement_date')::date;
    v_closing := (p_import->>'closing_balance')::bigint;
    v_cur := p_import->>'currency';
    v_by := (p_import->>'imported_by')::uuid;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format
            OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'Import : champ du relevé mal formé' USING ERRCODE = 'CL047';
  END;
  PERFORM assert_tenant(tenant_of_ledger(v_ledger));
  IF v_account IS NULL OR v_source IS NULL OR length(btrim(v_source)) = 0 OR v_sha IS NULL
     OR v_sha !~ '^[0-9a-f]{64}$' OR v_date IS NULL OR v_closing IS NULL OR v_cur IS NULL OR v_by IS NULL THEN
    RAISE EXCEPTION 'Import : champ du relevé manquant ou invalide' USING ERRCODE = 'CL047';
  END IF;
  SELECT * INTO l FROM ledger WHERE id = v_ledger;
  IF NOT EXISTS (SELECT 1 FROM account a WHERE a.id = v_account AND a.ledger_id = v_ledger AND a.family = 'ASSET') THEN
    RAISE EXCEPTION 'Import : compte absent du grand livre ou hors famille ASSET' USING ERRCODE = 'CL047';
  END IF;
  IF v_cur IS DISTINCT FROM l.currency THEN
    RAISE EXCEPTION 'Import : devise du relevé différente de celle du grand livre' USING ERRCODE = 'CL047';
  END IF;
  v_total := jsonb_array_length(p_lines);
  BEGIN
    SELECT count(*) INTO v_bad
      FROM jsonb_array_elements(p_lines) e(el)
     WHERE jsonb_typeof(e.el) <> 'object'
        OR coalesce(btrim(e.el->>'external_ref'), '') = ''
        OR (e.el->>'value_date')::date IS NULL
        OR coalesce((e.el->>'amount')::bigint, 0) = 0
        OR (e.el->>'currency') IS DISTINCT FROM l.currency;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format
            OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'Import : ligne mal formée' USING ERRCODE = 'CL047';
  END;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Import : % ligne(s) invalide(s) (référence vide, montant nul, date ou devise invalide)', v_bad
      USING ERRCODE = 'CL047';
  END IF;

  -- Même fichier, même compte, deux sessions : la seconde attend la première puis voit l'import existant.
  PERFORM pg_advisory_xact_lock(hashtextextended('statement-import:' || v_account || ':' || v_sha, 0));
  SELECT * INTO v_existing FROM statement_import WHERE account_id = v_account AND file_sha256 = v_sha;
  IF FOUND THEN
    RETURN jsonb_build_object('import_id', v_existing.id, 'created', 0, 'matched', 0,
                              'existing', v_existing.lines_created + v_existing.lines_existing);
  END IF;

  -- Lignes nouvelles (une instruction pour tout le fichier) ; les doublons du fichier et les lignes déjà connues
  -- sont ignorés par ON CONFLICT (account_id, source, external_ref) DO NOTHING.
  WITH src AS (
    SELECT DISTINCT ON (btrim(e.el->>'external_ref'))
           btrim(e.el->>'external_ref') AS external_ref, (e.el->>'value_date')::date AS value_date,
           (e.el->>'amount')::bigint AS amount, e.el->>'currency' AS currency
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY e(el, ord)
     ORDER BY btrim(e.el->>'external_ref'), e.ord),
  ins AS (
    INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount,
                                         currency, statement_import_id)
    SELECT l.operator_id, v_ledger, v_account, v_source, s.external_ref, s.value_date, s.amount, s.currency, v_id
      FROM src s
    ON CONFLICT (account_id, source, external_ref) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_created FROM ins;

  -- Décision 14 : verrou des demandes de remboursement liées (ordre des identifiants), avant toute ligne de relevé.
  -- Demandes dont la référence est celle d'une ligne non rapprochée du compte, ou encore en cours (PROCESSING : seule
  -- l'étape de confirmation de WP11 peut les faire passer à FAILED). Une demande FAILED ou PAID ne bouge plus.
  PERFORM 1 FROM refund_request rr
   WHERE rr.ledger_id = v_ledger
     AND ((rr.transaction_id IS NOT NULL AND rr.status = 'PROCESSING')
          OR rr.external_reference IN (SELECT e.external_ref FROM external_statement_line e
                                        WHERE e.account_id = v_account AND e.matched_tx_id IS NULL
                                          AND e.matched_anomaly_id IS NULL))
   ORDER BY rr.id FOR UPDATE;

  -- Rapprochement automatique par table source, sur toutes les lignes non rapprochées du compte.
  WITH todo AS MATERIALIZED (
    SELECT e.id, e.operator_id, e.ledger_id, e.account_id, e.external_ref, e.amount
      FROM external_statement_line e
     WHERE e.account_id = v_account AND e.matched_tx_id IS NULL AND e.matched_anomaly_id IS NULL),
  cand AS MATERIALIZED (
    SELECT t.id AS line_id, pt.topup_tx_id AS tx_id
      FROM todo t JOIN psp_topup pt ON pt.provider_payment_ref = t.external_ref
                                   AND pt.operator_id = t.operator_id AND pt.ledger_id = t.ledger_id
     WHERE pt.topup_tx_id IS NOT NULL
    UNION ALL
    SELECT t.id, pc.chargeback_tx_id
      FROM todo t JOIN psp_chargeback pc ON pc.provider_dispute_id = t.external_ref AND pc.operator_id = t.operator_id
                  JOIN psp_topup pt ON pt.psp_topup_id = pc.psp_topup_id AND pt.ledger_id = t.ledger_id
     WHERE pc.chargeback_tx_id IS NOT NULL
    UNION ALL
    SELECT t.id, rr.transaction_id
      FROM todo t JOIN refund_request rr ON rr.external_reference = t.external_ref
                                        AND rr.operator_id = t.operator_id AND rr.ledger_id = t.ledger_id
     WHERE rr.transaction_id IS NOT NULL
    UNION ALL
    SELECT t.id, po.settled_tx_id
      FROM todo t JOIN payout po ON po.external_ref = t.external_ref
                                AND po.operator_id = t.operator_id AND po.ledger_id = t.ledger_id
     WHERE po.settled_tx_id IS NOT NULL),
  valid AS MATERIALIZED (
    SELECT c.line_id, c.tx_id
      FROM cand c JOIN todo t ON t.id = c.line_id
                  JOIN journal_transaction jt ON jt.id = c.tx_id AND jt.operator_id = t.operator_id
                                              AND jt.ledger_id = t.ledger_id
       -- Signe de la ligne = signe du mouvement net de la transaction sur le compte (posting : + débit = entrée sur un
       -- compte ASSET), et montant égal au net ou à la somme des postings de ce signe (brut, frais postés sur le même
       -- compte). Signe contraire ou autre montant : la ligne reste non rapprochée (manuel ou anomalie).
     WHERE NOT EXISTS (SELECT 1 FROM refund_request rf   -- décision 14 : demande déjà recréditée (FAILED)
                        WHERE rf.ledger_id = t.ledger_id AND rf.status = 'FAILED'
                          AND (rf.transaction_id = c.tx_id OR rf.external_reference = t.external_ref))
       AND (SELECT sign(m.net) = sign(t.amount) AND t.amount IN (m.net, m.gross)
              FROM (SELECT sum(p.amount) AS net,
                           sum(p.amount) FILTER (WHERE sign(p.amount) = sign(t.amount)) AS gross
                      FROM posting p WHERE p.transaction_id = c.tx_id AND p.account_id = t.account_id) m)),
  uniq AS MATERIALIZED (
    -- MATERIALIZED : sans cela le planificateur peut réévaluer la recherche pour chaque ligne mise à jour.
    SELECT line_id, (array_agg(DISTINCT tx_id))[1] AS tx_id FROM valid GROUP BY line_id
    HAVING count(DISTINCT tx_id) = 1)
  UPDATE external_statement_line e
     SET matched_tx_id = u.tx_id, matched_by = v_by, matched_at = clock_timestamp()
    FROM uniq u WHERE e.id = u.line_id;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  INSERT INTO statement_import (id, operator_id, ledger_id, account_id, source, file_sha256, statement_date,
                                closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched)
  VALUES (v_id, l.operator_id, v_ledger, v_account, v_source, v_sha, v_date, v_closing, v_cur, v_by,
          v_created, v_total - v_created, v_matched);
  RETURN jsonb_build_object('import_id', v_id, 'created', v_created, 'matched', v_matched,
                            'existing', v_total - v_created);
END $$;
REVOKE ALL ON FUNCTION import_statement_lines(jsonb, jsonb) FROM PUBLIC;

-- 4. match_statement_line --------------------------------------------------------------------------------------------
-- Rapprochement manuel : exactement une cible (transaction ou anomalie PSP ouverte). Les contrôles de cible sont ceux
-- de la garde de mise à jour (une seule règle) ; la fonction les refait pour rendre un message clair avant l'écriture.
CREATE FUNCTION match_statement_line(p_line bigint, p_tx uuid, p_anomaly uuid, p_actor uuid)
RETURNS external_statement_line
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l external_statement_line%ROWTYPE;
BEGIN
  PERFORM assert_tenant((SELECT e.operator_id FROM external_statement_line e WHERE e.id = p_line));
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Rapprochement : auteur obligatoire' USING ERRCODE = 'CL047'; END IF;
  IF (p_tx IS NULL) = (p_anomaly IS NULL) THEN
    RAISE EXCEPTION 'Rapprochement : désigner exactement une transaction ou une anomalie' USING ERRCODE = 'CL047';
  END IF;
  -- Décision 14 : lecture sans verrou de la ligne (grand livre, référence), puis verrou des demandes de remboursement
  -- liées (même grand livre, transaction cible ou référence de la ligne), par ordre d'identifiant, AVANT la ligne.
  SELECT * INTO l FROM external_statement_line WHERE id = p_line;
  IF FOUND THEN
    PERFORM 1 FROM refund_request rr
     WHERE rr.ledger_id = l.ledger_id
       AND ((p_tx IS NOT NULL AND rr.transaction_id = p_tx) OR rr.external_reference = l.external_ref)
     ORDER BY rr.id FOR UPDATE;
  END IF;
  -- La ligne est verrouillée ensuite (ordre des verrous) : deux sessions sur la même ligne s'attendent.
  SELECT * INTO l FROM external_statement_line WHERE id = p_line FOR UPDATE;
  IF l.matched_tx_id IS NOT NULL OR l.matched_anomaly_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne de relevé déjà rapprochée' USING ERRCODE = 'CL043';
  END IF;
  -- Demande déjà recréditée (FAILED) sur cette transaction ou cette référence : le paiement n'a pas eu lieu.
  IF EXISTS (SELECT 1 FROM refund_request rr
              WHERE rr.ledger_id = l.ledger_id AND rr.status = 'FAILED'
                AND ((p_tx IS NOT NULL AND rr.transaction_id = p_tx) OR rr.external_reference = l.external_ref)) THEN
    RAISE EXCEPTION 'Rapprochement : une demande de remboursement liée est déjà recréditée (échec constaté)'
      USING ERRCODE = 'CL043';
  END IF;
  IF p_tx IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM journal_transaction t
        WHERE t.id = p_tx AND t.operator_id = l.operator_id AND t.ledger_id = l.ledger_id
          AND EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id AND p.account_id = l.account_id)) THEN
    RAISE EXCEPTION 'Rapprochement : transaction introuvable, d''un autre grand livre, ou qui ne touche pas le compte'
      USING ERRCODE = 'CL047';
  END IF;
  IF p_anomaly IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM anomaly n
        WHERE n.id = p_anomaly AND n.operator_id = l.operator_id AND n.ledger_id = l.ledger_id AND n.status = 'OPEN'
          AND n.kind IN ('PSP_TOPUP_OVER_LIMIT', 'PSP_TOPUP_NOT_CREDITED', 'PSP_MISMATCH')) THEN
    RAISE EXCEPTION 'Rapprochement : anomalie introuvable, résolue, d''un autre grand livre ou de type non PSP'
      USING ERRCODE = 'CL047';
  END IF;
  UPDATE external_statement_line
     SET matched_tx_id = p_tx, matched_anomaly_id = p_anomaly, matched_by = p_actor, matched_at = clock_timestamp()
   WHERE id = p_line
  RETURNING * INTO l;
  RETURN l;
END $$;
REVOKE ALL ON FUNCTION match_statement_line(bigint, uuid, uuid, uuid) FROM PUBLIC;

-- 5. account_reconciliation -----------------------------------------------------------------------------------------
-- Une ligne par compte ASSET d'argent du grand livre : A-PSP-*, A-BANQUE, et tout compte qui a reçu un relevé (les
-- caisses n'y figurent que si elles ont un relevé). Règle de « rapproché » : voir l'en-tête.
CREATE FUNCTION account_reconciliation(p_ledger uuid)
RETURNS TABLE (account_id uuid, code text, lines bigint, unmatched_lines bigint, statement_closing_balance bigint,
               statement_date date, ledger_balance bigint, explained_by_anomalies bigint, reconciled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_tz text;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT coalesce(ev.timezone, 'UTC') INTO v_tz
    FROM ledger lg LEFT JOIN event ev ON lg.scope_type = 'EVENT' AND ev.id = lg.scope_id WHERE lg.id = p_ledger;
  RETURN QUERY
  WITH accts AS (
    SELECT a.id, a.code FROM account a
     WHERE a.ledger_id = p_ledger AND a.family = 'ASSET'
       AND (a.code LIKE 'A-PSP-%' OR a.code = 'A-BANQUE'
            OR EXISTS (SELECT 1 FROM statement_import si WHERE si.account_id = a.id))),
  lastimp AS (
    SELECT DISTINCT ON (si.account_id) si.account_id, si.closing_balance, si.statement_date
      FROM statement_import si WHERE si.ledger_id = p_ledger
     ORDER BY si.account_id, si.statement_date DESC, si.imported_at DESC, si.id),
  cnt AS (
    SELECT e.account_id, count(*) AS n, count(*) FILTER (WHERE e.matched_tx_id IS NULL AND e.matched_anomaly_id IS NULL) AS un,
           coalesce(sum(e.amount) FILTER (WHERE e.matched_anomaly_id IS NOT NULL), 0)::bigint AS expl
      FROM external_statement_line e WHERE e.ledger_id = p_ledger GROUP BY e.account_id),
  bal AS (
    SELECT a.id AS account_id,
           (SELECT coalesce(sum(p.amount), 0)::bigint
              FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
             WHERE p.account_id = a.id
               AND (li.statement_date IS NULL
                    OR t.occurred_at <= ((li.statement_date + 1)::timestamp AT TIME ZONE v_tz)
                                        - interval '1 microsecond')) AS balance,
           EXISTS (SELECT 1 FROM posting p WHERE p.account_id = a.id) AS has_movement
      FROM accts a LEFT JOIN lastimp li ON li.account_id = a.id)
  SELECT a.id, a.code, coalesce(c.n, 0)::bigint, coalesce(c.un, 0)::bigint, li.closing_balance, li.statement_date,
         b.balance, coalesce(c.expl, 0)::bigint,
         coalesce(c.un, 0) = 0
           AND CASE WHEN li.account_id IS NULL THEN NOT b.has_movement
                    ELSE li.closing_balance = b.balance + coalesce(c.expl, 0) END
    FROM accts a
    LEFT JOIN lastimp li ON li.account_id = a.id
    LEFT JOIN cnt c ON c.account_id = a.id
    JOIN bal b ON b.account_id = a.id
   ORDER BY a.code;
END $$;
REVOKE ALL ON FUNCTION account_reconciliation(uuid) FROM PUBLIC;
