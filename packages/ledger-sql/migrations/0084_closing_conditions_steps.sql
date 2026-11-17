-- Étapes de clôture et conditions de passage de statut (mission 9b, lot WP02 ; FR-002, FR-008, C-004 ; research
-- R-01, R-02, R-05). Numéro 0084. Aucun droit accordé (lot WP06, post-roles.sql section 12), aucune route.
--
-- Objet : table `closing_step` (ajout seul), `record_closing_step`, fonction de lecture `closing_new_conditions`
-- (les quatre conditions nouvelles, UNE seule définition), et redéfinition ENSEMBLE de `event_transition_conditions`
-- (0008) et de `set_event_status` (schéma de référence, jamais modifié : on la redéfinit ici). Corps d'origine conservés
-- ligne à ligne ; seuls changent : `search_path = public, pg_temp` (tests_definer_search_path l'exige ; les originaux
-- avaient `public`) et l'appel aux conditions nouvelles.
--
-- Conditions ajoutées (source = 'DATABASE', à la suite des existantes) :
--   NO_OPEN_CASH_SESSION      vers RECONCILING : aucune cash_session OPEN ou CLOSING de l'événement      (CL019)
--   PSP_RECONCILED            vers SETTLING : tous les comptes A-PSP-* des grands livres de l'événement
--                             sont rapprochés (account_reconciliation, 0083) ; devient calculée         (CL019)
--   CLOSING_STEPS_DONE        vers REFUND_WINDOW : étapes 1 à 3 DONE ou NOT_APPLICABLE ; vers CLOSED : 1 à 7 (CL019)
--   REFUND_DEADLINE_REACHED   vers CLOSED : refund_deadline <= clock_timestamp() ; échéance nulle = NON remplie,
--                             detail explicite (choix signalé : la 9a lisait une échéance effective fin + 30 j)
-- Renforcements (à consigner) : conditions nouvelles ; passage vers CLOSED refusé avant l'échéance.
-- Ordre des verrous inchangé (celui du corps d'origine de set_event_status) : événement FOR NO KEY UPDATE, verrous
-- consultatifs d'autorité par grand livre (ordre des identifiants), puis grands livres FOR NO KEY UPDATE. Les
-- conditions nouvelles sont de la LECTURE SEULE, évaluées après les verrous d'autorité (écritures en vol terminées),
-- sans verrou ajouté.
-- record_closing_step : verrou consultatif pg_advisory_xact_lock(hashtextextended('closing-step:' || event || ':' ||
-- step, 0)) (MÊME clé que le verrou de l'API, WP07), après lecture de l'événement FOR KEY SHARE (compatible avec le
-- NO KEY UPDATE de set_event_status : pas d'interblocage avec une écriture qui tient le verrou d'autorité). L'argument
-- `p_actor` est AJOUTÉ à la signature de data-model.md (done_by est NOT NULL, rien d'autre ne le fournit).
-- Fonctions à faire relire : set_event_status, event_transition_conditions, closing_new_conditions,
-- record_closing_step.

-- 1. closing_step ---------------------------------------------------------------------------------------------------
CREATE TABLE closing_step (
  operator_id     uuid NOT NULL REFERENCES party(id),
  event_id        uuid NOT NULL REFERENCES event(id),
  step            text NOT NULL CHECK (step IN ('PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE',
                    'OPERATOR_FEE_REGULARIZATION', 'BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY')),
  status          text NOT NULL CHECK (status IN ('DONE', 'NOT_APPLICABLE')),
  done_by         uuid NOT NULL,
  done_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_ids uuid[] NOT NULL DEFAULT '{}',
  summary         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(summary) = 'object'),
  PRIMARY KEY (event_id, step),
  CONSTRAINT closing_step_na_no_tx CHECK (status <> 'NOT_APPLICABLE' OR cardinality(transaction_ids) = 0)
);
ALTER TABLE closing_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_step FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON closing_step
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
CREATE TRIGGER closing_step_immutable BEFORE UPDATE OR DELETE ON closing_step
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Garde d'insertion : l'événement appartient au prestataire de la ligne, et chaque transaction listée appartient au
-- grand livre de l'événement (renforcement : pas seulement au prestataire).
CREATE FUNCTION closing_step_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant_of_event(NEW.event_id) IS DISTINCT FROM NEW.operator_id
     OR EXISTS (SELECT 1 FROM unnest(NEW.transaction_ids) u(id)
                 WHERE NOT EXISTS (SELECT 1 FROM journal_transaction t
                                    WHERE t.id = u.id AND t.operator_id = NEW.operator_id
                                      AND EXISTS (SELECT 1 FROM ledger l WHERE l.id = t.ledger_id
                                                   AND l.scope_type = 'EVENT' AND l.scope_id = NEW.event_id))) THEN
    RAISE EXCEPTION 'Étape de clôture : événement ou transaction d''un autre prestataire ou hors du grand livre de l''événement'
      USING ERRCODE = 'CL047';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION closing_step_scope_guard() FROM PUBLIC;
CREATE TRIGGER closing_step_scope_guard BEFORE INSERT ON closing_step
  FOR EACH ROW EXECUTE FUNCTION closing_step_scope_guard();

-- 2. record_closing_step --------------------------------------------------------------------------------------------
-- Ordre de référence (R-02) : 1 à 3 en SETTLING, 4 à 7 en REFUND_WINDOW. Déjà enregistrée : rend la ligne existante
-- sans rien écrire (rejeu, même si la phase a changé depuis). Phase ou ordre non respectés : CL019.
CREATE FUNCTION record_closing_step(p_event uuid, p_step text, p_status text, p_tx uuid[], p_summary jsonb,
                                    p_actor uuid)
RETURNS closing_step
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  steps constant text[] := ARRAY['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE', 'OPERATOR_FEE_REGULARIZATION',
                                 'BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY'];
  pos int := array_position(steps, p_step);
  ev event%ROWTYPE; r closing_step%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  IF pos IS NULL OR p_status IS NULL OR p_status NOT IN ('DONE', 'NOT_APPLICABLE') OR p_actor IS NULL
     OR (p_summary IS NOT NULL AND jsonb_typeof(p_summary) <> 'object') THEN
    RAISE EXCEPTION 'Étape de clôture : étape, statut, auteur ou résumé invalide' USING ERRCODE = 'CL047';
  END IF;
  SELECT * INTO ev FROM event WHERE id = p_event FOR KEY SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('closing-step:' || p_event || ':' || p_step, 0));
  SELECT * INTO r FROM closing_step WHERE event_id = p_event AND step = p_step;
  IF FOUND THEN RETURN r; END IF;
  IF (pos <= 3 AND ev.status <> 'SETTLING') OR (pos > 3 AND ev.status <> 'REFUND_WINDOW') THEN
    RAISE EXCEPTION 'Étape % : hors de sa phase (événement en %)', p_step, ev.status USING ERRCODE = 'CL019';
  END IF;
  IF pos > 1 AND NOT EXISTS (SELECT 1 FROM closing_step c WHERE c.event_id = p_event AND c.step = steps[pos - 1]) THEN
    RAISE EXCEPTION 'Étape % : l''étape précédente (%) n''est ni faite ni sans objet', p_step, steps[pos - 1]
      USING ERRCODE = 'CL019';
  END IF;
  INSERT INTO closing_step (operator_id, event_id, step, status, done_by, transaction_ids, summary)
  VALUES (ev.operator_id, p_event, p_step, p_status, p_actor, coalesce(p_tx, '{}'), coalesce(p_summary, '{}'))
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION record_closing_step(uuid, text, text, uuid[], jsonb, uuid) FROM PUBLIC;

-- 3. Conditions nouvelles (lecture seule, une seule définition pour les deux copies) -------------------------------------
CREATE FUNCTION closing_new_conditions(p_event uuid, p_to event_status)
RETURNS TABLE (code text, met boolean, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  steps constant text[] := ARRAY['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE', 'OPERATOR_FEE_REGULARIZATION',
                                 'BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY'];
  n bigint; missing text; dl timestamptz;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  IF p_to = 'RECONCILING' THEN
    SELECT count(*) INTO n FROM cash_session s WHERE s.event_id = p_event AND s.status IN ('OPEN', 'CLOSING');
    code := 'NO_OPEN_CASH_SESSION';
    met := n = 0;
    detail := CASE WHEN met THEN 'Aucune session de caisse ouverte'
                   ELSE format('%s session(s) de caisse ouverte(s) ou en cours de fermeture', n) END;
    RETURN NEXT;
  END IF;
  IF p_to = 'SETTLING' THEN
    SELECT count(*) INTO n
      FROM ledger l CROSS JOIN LATERAL account_reconciliation(l.id) r
     WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event AND r.code LIKE 'A-PSP-%' AND NOT r.reconciled;
    code := 'PSP_RECONCILED';
    met := n = 0;
    detail := CASE WHEN met THEN 'Comptes PSP rapprochés'
                   ELSE format('%s compte(s) PSP non rapproché(s) avec le relevé', n) END;
    RETURN NEXT;
  END IF;
  IF p_to IN ('REFUND_WINDOW', 'CLOSED') THEN
    SELECT string_agg(s, ', ' ORDER BY array_position(steps, s)) INTO missing
      FROM unnest(CASE WHEN p_to = 'CLOSED' THEN steps ELSE steps[1:3] END) s
     WHERE NOT EXISTS (SELECT 1 FROM closing_step c
                        WHERE c.event_id = p_event AND c.step = s AND c.status IN ('DONE', 'NOT_APPLICABLE'));
    code := 'CLOSING_STEPS_DONE';
    met := missing IS NULL;
    detail := CASE WHEN met THEN 'Étapes de clôture faites ou sans objet'
                   ELSE format('Étapes de clôture à faire : %s', missing) END;
    RETURN NEXT;
  END IF;
  IF p_to = 'CLOSED' THEN
    SELECT e.refund_deadline INTO dl FROM event e WHERE e.id = p_event;
    code := 'REFUND_DEADLINE_REACHED';
    met := dl IS NOT NULL AND dl <= clock_timestamp();
    detail := CASE WHEN dl IS NULL THEN 'Échéance de remboursement non définie'
                   WHEN met THEN 'Échéance de remboursement atteinte'
                   ELSE format('Échéance de remboursement non atteinte (%s)', dl) END;
    RETURN NEXT;
  END IF;
END $$;
REVOKE ALL ON FUNCTION closing_new_conditions(uuid, event_status) FROM PUBLIC;

-- 4. event_transition_conditions (copie en lecture) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION event_transition_conditions(p_event uuid, p_to event_status)
RETURNS TABLE (code text, met boolean, detail text, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE ev event%ROWTYPE; deadline timestamptz; n bigint; v bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  SELECT * INTO ev FROM event WHERE id = p_event;
  source := 'DATABASE';

  code := 'TRANSITION_ALLOWED';
  met := EXISTS (SELECT 1 FROM event_status_transition WHERE from_status = ev.status AND to_status = p_to);
  detail := format('Passage %s -> %s %s', ev.status, p_to, CASE WHEN met THEN 'prévu' ELSE 'non prévu' END);
  RETURN NEXT;

  IF p_to = 'SETTLING' THEN
    deadline := event_sync_deadline(p_event);
    SELECT count(*) INTO n FROM event_device_sync_status(p_event) x WHERE NOT x.caught_up;
    code := 'DEVICES_CAUGHT_UP';
    met := n = 0 OR clock_timestamp() >= coalesce(deadline, 'infinity');
    detail := CASE WHEN n = 0 THEN 'Tous les terminaux sont à jour'
                   WHEN met THEN format('%s terminal(aux) en retard, date limite de synchronisation dépassée', n)
                   ELSE format('%s terminal(aux) pas encore à jour avant la date limite de synchronisation', n) END;
    RETURN NEXT;
  END IF;

  IF p_to IN ('RECONCILING','SETTLING','REFUND_WINDOW','CLOSED') THEN
    SELECT count(*) INTO n FROM ledger l
     WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event AND l.debit_authority <> 'CENTRAL';
    code := 'DEBIT_AUTHORITY_CENTRAL';
    met := n = 0;
    detail := CASE WHEN met THEN 'Autorité de débit au central'
                   ELSE 'Autorité de débit encore détenue par une passerelle' END;
    RETURN NEXT;
  END IF;

  IF p_to IN ('SETTLING','REFUND_WINDOW','CLOSED') THEN
    SELECT count(*) FILTER (WHERE b.bal <> 0), coalesce(sum(b.bal), 0) INTO n, v
      FROM (SELECT ledger_purpose_balance(l.id, ARRAY['SUSPENSE']) AS bal
              FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event) b;
    code := 'SUSPENSE_ZERO';
    met := n = 0;
    detail := CASE WHEN met THEN 'Compte d''attente soldé' ELSE format('Compte d''attente non soldé (%s)', v) END;
    RETURN NEXT;
  END IF;

  IF p_to IN ('REFUND_WINDOW','CLOSED') THEN
    SELECT count(*) INTO n
      FROM party_position pp JOIN party p ON p.id = pp.owner_party_id
      JOIN ledger l ON l.id = pp.ledger_id
     WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event
       AND p.kind IN ('MERCHANT','OPERATOR','PLATFORM') AND pp.net_claim <> 0;
    code := 'PARTY_POSITIONS_ZERO';
    met := n = 0;
    detail := CASE WHEN met THEN 'Commerçants, prestataire et plateforme soldés'
                   ELSE format('%s commerçant(s), prestataire ou plateforme avec un droit net non nul', n) END;
    RETURN NEXT;

    SELECT count(*) FILTER (WHERE b.bal <> 0), coalesce(sum(-b.bal), 0) INTO n, v
      FROM (SELECT ledger_purpose_balance(l.id, ARRAY['PAYOUT_PENDING']) AS bal
              FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event) b;
    code := 'PAYOUT_PENDING_ZERO';
    met := n = 0;
    detail := CASE WHEN met THEN 'Aucun versement en cours'
                   ELSE format('Versements initiés non confirmés (%s)', v) END;
    RETURN NEXT;
  END IF;

  IF p_to = 'CLOSED' THEN
    -- Soldes restants autorisés : le compte légal, et les soldes des festivaliers si la casse est NONE.
    SELECT coalesce(sum(ledger_unsettled(l.id,
             CASE WHEN (ledger_jurisdiction(l.id)).breakage_destination = 'NONE'
                  THEN ARRAY['LEGAL_BREAKAGE','WALLET_PAID','CUSTOMER_CASH_DUE'] ELSE ARRAY['LEGAL_BREAKAGE'] END)), 0)
      INTO n FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event;
    code := 'POSITIONS_SETTLED';
    met := n = 0;
    detail := CASE WHEN met THEN 'Toutes les positions sont soldées'
                   ELSE format('%s position(s) non soldée(s) hors soldes restants autorisés', n) END;
    RETURN NEXT;
  END IF;

  -- Conditions ajoutées par 0084 (une seule définition : closing_new_conditions).
  RETURN QUERY SELECT c.code, c.met, c.detail, 'DATABASE'::text FROM closing_new_conditions(p_event, p_to) c;
END $$;
REVOKE ALL ON FUNCTION event_transition_conditions(uuid, event_status) FROM PUBLIC;

-- 5. set_event_status ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_event_status(p_event uuid, p_status event_status, p_actor uuid) RETURNS event_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev event%ROWTYPE; l ledger%ROWTYPE; lg uuid; dest text; v bigint; rem bigint := 0; total_rem bigint := 0;
        keep text[]; to_lock uuid[] := '{}'; cnd record;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Auteur obligatoire' USING ERRCODE = 'CL001'; END IF;
  -- NO KEY UPDATE : compatible avec le KEY SHARE que prennent les écritures (clé étrangère event_id)
  SELECT * INTO ev FROM event WHERE id = p_event FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM event_status_transition WHERE from_status = ev.status AND to_status = p_status) THEN
    RAISE EXCEPTION 'Passage % -> % non prévu', ev.status, p_status USING ERRCODE = 'CL018';
  END IF;
  -- Date limite de synchronisation (ADR-73) : avant elle, tous les terminaux doivent avoir tout remonté
  IF p_status = 'SETTLING' AND clock_timestamp() < coalesce(event_sync_deadline(p_event), 'infinity') THEN
    SELECT count(*) INTO v FROM event_device_sync_status(p_event) x WHERE NOT x.caught_up;
    IF v > 0 THEN
      RAISE EXCEPTION '% terminal(aux) pas encore à jour avant la date limite de synchronisation (%)', v,
        event_sync_deadline(p_event) USING ERRCODE = 'CL019';
    END IF;
  END IF;
  -- Ordre de verrouillage unique : verrous d'autorité exclusifs (les écritures en vol se terminent), puis les lignes.
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || id, 0))
     FROM (SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event ORDER BY id) x;
  -- Conditions ajoutées par 0084 : lecture seule, après les verrous d'autorité (les écritures en vol sont terminées),
  -- mêmes calculs que la copie en lecture (event_transition_conditions) via closing_new_conditions.
  FOR cnd IN SELECT * FROM closing_new_conditions(p_event, p_status) c WHERE NOT c.met LOOP
    RAISE EXCEPTION '%', cnd.detail USING ERRCODE = 'CL019';
  END LOOP;
  FOR l IN SELECT * FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event ORDER BY id FOR NO KEY UPDATE LOOP
    lg := l.id; rem := 0;
    -- À partir du rapprochement, plus aucune passerelle ne doit détenir l'autorité de débit (DB-I14)
    IF p_status IN ('RECONCILING','SETTLING','REFUND_WINDOW','CLOSED') AND l.debit_authority <> 'CENTRAL' THEN
      RAISE EXCEPTION 'Autorité de débit encore détenue par une passerelle : la rendre au central d''abord' USING ERRCODE = 'CL019';
    END IF;
    IF p_status IN ('SETTLING','REFUND_WINDOW','CLOSED') THEN
      v := ledger_purpose_balance(lg, ARRAY['SUSPENSE']);
      IF v <> 0 THEN RAISE EXCEPTION 'Compte d''attente non soldé (%)', v USING ERRCODE = 'CL019'; END IF;
    END IF;
    IF p_status IN ('REFUND_WINDOW','CLOSED') THEN
      SELECT count(*) INTO v FROM party_position pp JOIN party p ON p.id = pp.owner_party_id
       WHERE pp.ledger_id = lg AND p.kind IN ('MERCHANT','OPERATOR','PLATFORM') AND pp.net_claim <> 0;
      IF v > 0 THEN
        RAISE EXCEPTION '% commerçant(s), prestataire ou plateforme avec un droit net non nul', v USING ERRCODE = 'CL019';
      END IF;
      v := ledger_purpose_balance(lg, ARRAY['PAYOUT_PENDING']);
      IF v <> 0 THEN RAISE EXCEPTION 'Versements initiés non confirmés (%)', -v USING ERRCODE = 'CL019'; END IF;
    END IF;
    IF p_status = 'CLOSED' THEN
      dest := (ledger_jurisdiction(lg)).breakage_destination;
      -- seuls peuvent rester dus : le compte légal, et les soldes des festivaliers si la casse est NONE.
      -- Toutes les autres positions doivent être soldées, par partie (droit net) ou par compte sans titulaire.
      keep := CASE WHEN dest = 'NONE' THEN ARRAY['LEGAL_BREAKAGE','WALLET_PAID','CUSTOMER_CASH_DUE'] ELSE ARRAY['LEGAL_BREAKAGE'] END;
      v := ledger_unsettled(lg, keep);
      IF v > 0 THEN
        RAISE EXCEPTION '% position(s) non soldée(s) hors soldes restants autorisés', v USING ERRCODE = 'CL019';
      END IF;
      rem := -ledger_purpose_balance(lg, keep);
      total_rem := total_rem + rem;
      IF ledger_unsettled(lg) = 0 THEN
        to_lock := to_lock || lg;
      ELSE                                   -- soldes restants : seuls remboursements et versement au compte légal
        UPDATE ledger SET status = 'CLOSING', locked_until = clock_timestamp() WHERE id = lg;
      END IF;
    ELSIF p_status IN ('CLOSING','RECONCILING','SETTLING','REFUND_WINDOW') THEN
      UPDATE ledger SET status = 'CLOSING' WHERE id = lg;
    END IF;
  END LOOP;
  PERFORM set_config('app.event_status_change', 'on', true);
  UPDATE event SET status = p_status WHERE id = p_event;
  PERFORM set_config('app.event_status_change', '', true);
  FOREACH lg IN ARRAY to_lock LOOP
    UPDATE ledger SET status = 'CLOSING' WHERE id = lg AND status <> 'CLOSING';
    PERFORM lock_settled_ledger(lg);
  END LOOP;
  INSERT INTO event_status_history (operator_id, event_id, from_status, to_status, actor_id, remaining)
  VALUES (ev.operator_id, p_event, ev.status, p_status, p_actor, CASE WHEN p_status = 'CLOSED' THEN total_rem END);
  RETURN p_status;
END $$;
REVOKE ALL ON FUNCTION set_event_status(uuid, event_status, uuid) FROM PUBLIC;
