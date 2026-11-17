-- Base des versements (mission versements-rapprochements-cloture, lot WP03 ; FR-009, FR-010, FR-012, NFR-001).
-- Objet : colonnes de destination, de résultat et de lot sur `payout`, CHECK, garde d'insertion, déclencheurs de
-- transition et de DELETE ; `create_payout_batch` (borne du droit net, CL055, écriture PAYOUT_INITIATED) ;
-- `settle_payout` (écriture PAYOUT_CONFIRMED ou PAYOUT_FAILED, une seule fois par ligne).
-- AUCUN droit accordé ici : post-roles.sql, section 12 (lot WP06). Aucune route.
--
-- Décisions et écarts signalés (voir le compte rendu du lot) :
--   * origin_account_id : compte débité à l'initiation, absent de data-model.md. Sans lui, settle_payout ne peut pas
--     recréditer sans ambiguïté en cas d'échec (deux lignes de même montant sur un même bénéficiaire).
--   * CASH refusé par create_payout_batch (CL047) : aucun compte d'argent de sortie ne lui correspond. Le CHECK
--     d'origine de payout.method garde CASH (le test existant de payout_check reste vert).
--   * Bénéficiaire LEGAL (L-LEGAL-CASSE, sans titulaire) : payout.beneficiary_id est NOT NULL ; la ligne porte la
--     partie du prestataire (operator_id du grand livre), la borne se lit sur le solde créditeur du compte légal.
--     Conséquence : un lot ne peut pas contenir à la fois OPERATOR et LEGAL (même beneficiary_id).
--   * Borne : le droit net lu (party_position) est DÉJÀ diminué des versements INITIATED non réglés, car
--     PAYOUT_INITIATED débite le compte de droits du bénéficiaire (L-*-VERS ou L-MCH-*) et PAYOUT_FAILED le
--     recrédite. Soustraire en plus la somme des lignes INITIATED compterait deux fois : la borne est donc
--     « montant <= droit net courant, relu sous verrou ».
--   * Écritures de résultat : BACKOFFICE exige deux personnes distinctes (CHECK de journal_transaction) alors que
--     le règlement est une action seule : created_by = acteur, approved_by = valideur du lot, ou l'initiateur du lot
--     si l'acteur est le valideur.
--   * Verrous : autorité du grand livre (partagé), verrou du lot, comptes de droits du bénéficiaire par identifiant
--     croissant (FOR NO KEY UPDATE : sérialise les créateurs de lots sans bloquer les clés étrangères des ventes),
--     puis ligne payout. Aucun verrou d'autorité exclusif.
--   * L'IBAN est une donnée personnelle : jamais dans un message d'erreur ni un RAISE.
-- Parité : la logique de comptes de create_payout_batch et settle_payout duplique celle des constructeurs
-- TypeScript buildPayoutInitiated / buildPayoutConfirmed / buildPayoutFailed (apps/api/src/ledger/builders/closing).
-- Fonctions à faire relire : create_payout_batch, settle_payout, payout_transition_guard, payout_scope_guard.

-- 1. Colonnes ---------------------------------------------------------------------------------------------------------
ALTER TABLE payout
  ADD COLUMN approval_request_id uuid REFERENCES approval_request(id),
  ADD COLUMN origin_account_id   uuid REFERENCES account(id),
  ADD COLUMN msisdn              text,
  ADD COLUMN iban                text,
  ADD COLUMN failure_reason      text,
  ADD COLUMN confirmed_by        uuid,
  ADD COLUMN confirmed_at        timestamptz;

-- Les CHECK sont NOT VALID : ils valent pour toute écriture à venir sans réexaminer d'éventuelles lignes
-- antérieures (aucune route n'en écrivait avant cette mission).
ALTER TABLE payout
  ADD CONSTRAINT payout_destination_bank CHECK (method <> 'BANK_TRANSFER'
    OR (length(btrim(coalesce(iban, ''))) > 0 AND msisdn IS NULL)) NOT VALID,
  ADD CONSTRAINT payout_destination_mobile CHECK (method NOT IN ('WAVE', 'ORANGE_MONEY')
    OR (length(btrim(coalesce(msisdn, ''))) > 0 AND iban IS NULL)) NOT VALID,
  ADD CONSTRAINT payout_failure_reason_iff_failed CHECK ((status = 'FAILED') =
    (length(btrim(coalesce(failure_reason, ''))) > 0)) NOT VALID,
  ADD CONSTRAINT payout_confirmed_pair CHECK ((status = 'INITIATED') =
    (confirmed_by IS NULL AND confirmed_at IS NULL)) NOT VALID,
  ADD CONSTRAINT payout_confirmed_ref CHECK (status <> 'CONFIRMED'
    OR length(btrim(coalesce(external_ref, ''))) > 0) NOT VALID;
-- Ligne liée à ses transactions : initiated_tx_id toujours, settled_tx_id dès que le statut n'est plus INITIATED ;
-- les clés composites exigent que la transaction soit du même grand livre. Nommés après payout_check (ordre
-- alphabétique des CHECK) pour que le test existant de payout_check reste vert.
ALTER TABLE payout
  ADD CONSTRAINT payout_tx_required CHECK (initiated_tx_id IS NOT NULL
    AND (status = 'INITIATED' OR settled_tx_id IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT payout_initiated_tx_same_ledger FOREIGN KEY (ledger_id, initiated_tx_id)
    REFERENCES journal_transaction (ledger_id, id) NOT VALID,
  ADD CONSTRAINT payout_settled_tx_same_ledger FOREIGN KEY (ledger_id, settled_tx_id)
    REFERENCES journal_transaction (ledger_id, id) NOT VALID;
CREATE UNIQUE INDEX payout_batch_beneficiary ON payout (approval_request_id, beneficiary_id);
CREATE INDEX payout_ledger_status_idx ON payout (ledger_id, status);

-- 2. Garde d'insertion : la RLS ne contrôle que operator_id ---------------------------------------------------------
CREATE FUNCTION payout_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant_of_ledger(NEW.ledger_id) IS DISTINCT FROM NEW.operator_id
     OR NOT EXISTS (SELECT 1 FROM party p WHERE p.id = NEW.beneficiary_id
                       AND (p.operator_id = NEW.operator_id OR p.id = NEW.operator_id OR p.kind = 'PLATFORM'))
     OR (NEW.origin_account_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM account a WHERE a.id = NEW.origin_account_id AND a.ledger_id = NEW.ledger_id))
     OR (NEW.approval_request_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM approval_request r WHERE r.id = NEW.approval_request_id AND r.operator_id = NEW.operator_id))
  THEN
    RAISE EXCEPTION 'Versement : grand livre, bénéficiaire, compte ou lot d''un autre prestataire'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payout_scope_guard() FROM PUBLIC;
CREATE TRIGGER payout_scope_guard BEFORE INSERT ON payout
  FOR EACH ROW EXECUTE FUNCTION payout_scope_guard();

-- 3. Transition unique et immuabilité --------------------------------------------------------------------------------
-- INITIATED -> CONFIRMED ou FAILED, une fois. Seules les colonnes de résultat changent.
CREATE FUNCTION payout_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'INITIATED' THEN
    RAISE EXCEPTION 'Versement déjà réglé (%) : aucune modification', OLD.status USING ERRCODE = 'CL029';
  END IF;
  IF (OLD.id, OLD.operator_id, OLD.ledger_id, OLD.beneficiary_id, OLD.amount, OLD.method, OLD.initiated_at,
      OLD.initiated_by, OLD.approved_by, OLD.initiated_tx_id, OLD.approval_request_id, OLD.origin_account_id,
      OLD.msisdn, OLD.iban)
     IS DISTINCT FROM
     (NEW.id, NEW.operator_id, NEW.ledger_id, NEW.beneficiary_id, NEW.amount, NEW.method, NEW.initiated_at,
      NEW.initiated_by, NEW.approved_by, NEW.initiated_tx_id, NEW.approval_request_id, NEW.origin_account_id,
      NEW.msisdn, NEW.iban) THEN
    RAISE EXCEPTION 'Versement : seules les colonnes de résultat sont modifiables' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.status NOT IN ('CONFIRMED', 'FAILED') THEN
    RAISE EXCEPTION 'Versement : transition % -> % interdite', OLD.status, NEW.status USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payout_transition_guard() FROM PUBLIC;
CREATE TRIGGER payout_transition_guard BEFORE UPDATE ON payout
  FOR EACH ROW EXECUTE FUNCTION payout_transition_guard();

CREATE FUNCTION payout_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Versement : suppression interdite' USING ERRCODE = 'CL029';
END $$;
REVOKE ALL ON FUNCTION payout_no_delete() FROM PUBLIC;
CREATE TRIGGER payout_no_delete BEFORE DELETE ON payout
  FOR EACH ROW EXECUTE FUNCTION payout_no_delete();

-- 4. create_payout_batch -----------------------------------------------------------------------------------------------
-- p_lines : [{"beneficiary": {"participation_id": uuid} | "ORGANIZER" | "OPERATOR" | "PLATFORM" | "LEGAL",
--             "beneficiary_id": uuid, "amount": bigint, "method": text, "msisdn": text | "iban": text}, ...]
-- Rend {transaction_id, payout_ids[]} (ordre des lignes demandées). Rejeu du même lot : même résultat, rien écrit.
-- Erreurs : CL001 contenu invalide, CL002 lot rejoué avec un autre contenu, CL047 moyen CASH, CL055 au-delà du droit.
CREATE FUNCTION create_payout_batch(p_ledger uuid, p_approval_request uuid, p_lines jsonb, p_actor uuid,
                                    p_approver uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lg ledger%ROWTYPE;
  ar approval_request%ROWTYPE;
  r record;
  v_n int;
  v_key text := 'payout-batch:' || p_approval_request;
  v_b jsonb; v_code text; v_ben uuid; v_amount bigint; v_method text; v_msisdn text; v_iban text;
  v_acc uuid; v_owner uuid; v_is_legal boolean; v_money text;
  a_acc uuid[] := '{}'; a_ben uuid[] := '{}'; a_amt bigint[] := '{}'; a_meth text[] := '{}';
  a_msisdn text[] := '{}'; a_iban text[] := '{}'; a_legal boolean[] := '{}';
  v_pending uuid; v_total bigint := 0; v_net bigint; v_tx uuid; v_ids jsonb := '[]'; v_pid uuid;
  v_event uuid; v_lines jsonb; i int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  IF p_actor IS NULL OR p_approver IS NULL OR p_actor = p_approver THEN
    RAISE EXCEPTION 'Lot de versements : auteur et valideur requis et distincts' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO ar FROM approval_request WHERE id = p_approval_request AND operator_id = lg.operator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Lot de versements vide' USING ERRCODE = 'CL001';
  END IF;

  -- 1. Validation et résolution des comptes (lecture seule, avant tout verrou)
  FOR r IN SELECT e, o FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, o) ORDER BY o LOOP
    IF jsonb_typeof(r.e) <> 'object' THEN
      RAISE EXCEPTION 'Ligne % : objet attendu', r.o USING ERRCODE = 'CL001';
    END IF;
    v_b := r.e -> 'beneficiary';
    v_ben := nullif(r.e ->> 'beneficiary_id', '')::uuid;
    IF v_ben IS NULL THEN
      RAISE EXCEPTION 'Ligne % : bénéficiaire requis', r.o USING ERRCODE = 'CL001';
    END IF;
    IF jsonb_typeof(r.e -> 'amount') IS DISTINCT FROM 'number' OR (r.e ->> 'amount') !~ '^[0-9]{1,18}$'
       OR (r.e ->> 'amount')::bigint <= 0 THEN
      RAISE EXCEPTION 'Ligne % : montant entier strictement positif requis', r.o USING ERRCODE = 'CL001';
    END IF;
    v_amount := (r.e ->> 'amount')::bigint;
    IF v_ben = ANY (a_ben) THEN
      RAISE EXCEPTION 'Ligne % : un seul versement par bénéficiaire dans un lot', r.o USING ERRCODE = 'CL001';
    END IF;
    v_is_legal := false;
    IF jsonb_typeof(v_b) = 'object' THEN
      v_code := 'L-MCH-' || coalesce(v_b ->> 'participation_id', '');
    ELSIF jsonb_typeof(v_b) = 'string' THEN
      v_code := CASE v_b #>> '{}' WHEN 'ORGANIZER' THEN 'L-ORG-VERS' WHEN 'OPERATOR' THEN 'L-OPE-VERS'
                                  WHEN 'PLATFORM' THEN 'L-PLT-VERS' WHEN 'LEGAL' THEN 'L-LEGAL-CASSE' END;
      v_is_legal := (v_b #>> '{}') = 'LEGAL';
    END IF;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'Ligne % : bénéficiaire inconnu', r.o USING ERRCODE = 'CL001';
    END IF;
    SELECT a.id, a.owner_party_id INTO v_acc, v_owner FROM account a
     WHERE a.ledger_id = p_ledger AND a.code = v_code AND a.is_active AND a.family = 'CLAIM';
    IF v_acc IS NULL THEN
      RAISE EXCEPTION 'Ligne % : le bénéficiaire n''a pas de compte de droits dans ce grand livre', r.o
        USING ERRCODE = 'CL001';
    END IF;
    IF v_is_legal THEN
      IF v_ben <> lg.operator_id THEN
        RAISE EXCEPTION 'Ligne % : le compte légal se rattache au prestataire', r.o USING ERRCODE = 'CL001';
      END IF;
    ELSIF v_owner IS DISTINCT FROM v_ben THEN
      RAISE EXCEPTION 'Ligne % : le compte ne correspond pas au bénéficiaire', r.o USING ERRCODE = 'CL001';
    END IF;
    v_method := r.e ->> 'method';
    IF v_method = 'CASH' THEN
      RAISE EXCEPTION 'Ligne % : le moyen CASH n''est pas admis pour un versement', r.o USING ERRCODE = 'CL047';
    END IF;
    v_msisdn := nullif(btrim(coalesce(r.e ->> 'msisdn', '')), '');
    v_iban := nullif(btrim(coalesce(r.e ->> 'iban', '')), '');
    v_money := CASE v_method WHEN 'BANK_TRANSFER' THEN 'A-BANQUE' WHEN 'WAVE' THEN 'A-PSP-WAVE'
                             WHEN 'ORANGE_MONEY' THEN 'A-PSP-OM' END;
    IF v_money IS NULL THEN
      RAISE EXCEPTION 'Ligne % : moyen de versement inconnu', r.o USING ERRCODE = 'CL001';
    END IF;
    IF (v_method = 'BANK_TRANSFER' AND (v_iban IS NULL OR v_msisdn IS NOT NULL))
       OR (v_method <> 'BANK_TRANSFER' AND (v_msisdn IS NULL OR v_iban IS NOT NULL)) THEN
      RAISE EXCEPTION 'Ligne % : destination absente ou incohérente avec le moyen', r.o USING ERRCODE = 'CL001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM account a WHERE a.ledger_id = p_ledger AND a.code = v_money AND a.is_active) THEN
      RAISE EXCEPTION 'Ligne % : compte d''argent du moyen absent du grand livre', r.o USING ERRCODE = 'CL001';
    END IF;
    a_acc := array_append(a_acc, v_acc);       a_ben := array_append(a_ben, v_ben);
    a_amt := array_append(a_amt, v_amount);    a_meth := array_append(a_meth, v_method);
    a_msisdn := array_append(a_msisdn, v_msisdn); a_iban := array_append(a_iban, v_iban);
    a_legal := array_append(a_legal, v_is_legal);
    v_total := v_total + v_amount;
  END LOOP;
  v_n := cardinality(a_acc);
  SELECT id INTO v_pending FROM account
   WHERE ledger_id = p_ledger AND code = 'L-VERS-ENCOURS' AND is_active;
  IF v_pending IS NULL THEN
    RAISE EXCEPTION 'Compte des versements en cours absent du grand livre' USING ERRCODE = 'CL001';
  END IF;

  -- 2. Verrous, dans l'ordre de interfaces.md : autorité (partagé), lot, comptes de droits par identifiant
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || p_ledger, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- Rejeu (NFR-001) : le lot existe déjà ; même contenu : même résultat sans écriture, sinon CL002.
  IF EXISTS (SELECT 1 FROM payout WHERE approval_request_id = p_approval_request) THEN
    IF (SELECT count(*) FROM payout WHERE approval_request_id = p_approval_request) <> v_n
       OR EXISTS (
         SELECT 1 FROM unnest(a_ben, a_amt, a_meth, a_acc) AS u(b, a, m, c)
          WHERE NOT EXISTS (SELECT 1 FROM payout x
                             WHERE x.approval_request_id = p_approval_request AND x.beneficiary_id = u.b
                               AND x.amount = u.a AND x.method = u.m AND x.origin_account_id = u.c)) THEN
      RAISE EXCEPTION 'Lot % déjà écrit avec un contenu différent', p_approval_request USING ERRCODE = 'CL002';
    END IF;
    RETURN (SELECT jsonb_build_object('transaction_id', min(x.initiated_tx_id::text)::uuid,
                                      'payout_ids', jsonb_agg(x.id ORDER BY u.o))
              FROM unnest(a_ben) WITH ORDINALITY AS u(b, o)
              JOIN payout x ON x.approval_request_id = p_approval_request AND x.beneficiary_id = u.b);
  END IF;

  -- Demande d'approbation (renforcement du porteur, 17/11/2026) : action PAYOUT, acceptée (APPROVED : statut porté
  -- par la demande pendant l'exécution de l'action, avant EXECUTED), auteur = demandeur, valideur = décideur.
  IF ar.action <> 'PAYOUT' THEN
    RAISE EXCEPTION 'Demande d''approbation : action % au lieu de PAYOUT', ar.action USING ERRCODE = 'CL001';
  END IF;
  IF ar.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Demande d''approbation non acceptée (statut %)', ar.status USING ERRCODE = 'CL029';
  END IF;
  IF ar.requested_by IS DISTINCT FROM p_actor OR ar.decided_by IS DISTINCT FROM p_approver THEN
    RAISE EXCEPTION 'Demande d''approbation : auteur ou valideur différent de ceux de la demande'
      USING ERRCODE = 'CL001';
  END IF;

  PERFORM 1 FROM account a
   WHERE a.ledger_id = p_ledger AND a.family = 'CLAIM'
     AND (a.id = ANY (a_acc) OR a.owner_party_id = ANY (a_ben))
   ORDER BY a.id FOR NO KEY UPDATE;

  -- 3. Borne : droit net relu (après les verrous : nouvelle lecture), déjà net des versements INITIATED
  FOR i IN 1 .. v_n LOOP
    IF a_legal[i] THEN
      SELECT -coalesce(sum(p.amount), 0) INTO v_net FROM posting p WHERE p.account_id = a_acc[i];
    ELSE
      SELECT -coalesce(sum(p.amount), 0) INTO v_net FROM posting p JOIN account a ON a.id = p.account_id
       WHERE a.ledger_id = p_ledger AND a.family = 'CLAIM' AND a.owner_party_id = a_ben[i];
    END IF;
    IF a_amt[i] > v_net THEN
      RAISE EXCEPTION 'Versement de % refusé : droit net disponible de %', a_amt[i], v_net USING ERRCODE = 'CL055';
    END IF;
  END LOOP;

  -- 4. Écriture : un débit par bénéficiaire, un crédit du total sur L-VERS-ENCOURS (buildPayoutInitiated)
  SELECT jsonb_agg(jsonb_build_object('account_id', u.c, 'amount', u.a, 'memo', 'Versement initié') ORDER BY u.o)
         || jsonb_build_array(jsonb_build_object('account_id', v_pending, 'amount', -v_total,
                                                 'memo', 'Versements en cours'))
    INTO v_lines FROM unnest(a_acc, a_amt) WITH ORDINALITY AS u(c, a, o);
  v_event := CASE WHEN lg.scope_type = 'EVENT' THEN lg.scope_id END;
  v_tx := post_transaction(p_ledger, 'PAYOUT_INITIATED', v_key, clock_timestamp(), 'BACKOFFICE', v_lines, v_event,
                           NULL, p_actor, p_approver, NULL, NULL, NULL,
                           jsonb_build_object('approval_request_id', p_approval_request));
  FOR i IN 1 .. v_n LOOP
    INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by, approved_by,
                        initiated_tx_id, approval_request_id, origin_account_id, msisdn, iban)
    VALUES (lg.operator_id, p_ledger, a_ben[i], a_amt[i], a_meth[i], 'INITIATED', p_actor, p_approver,
            v_tx, p_approval_request, a_acc[i], a_msisdn[i], a_iban[i])
    RETURNING id INTO v_pid;
    v_ids := v_ids || to_jsonb(v_pid);
  END LOOP;
  RETURN jsonb_build_object('transaction_id', v_tx, 'payout_ids', v_ids);
END $$;
REVOKE ALL ON FUNCTION create_payout_batch(uuid, uuid, jsonb, uuid, uuid) FROM PUBLIC;

-- 5. settle_payout -----------------------------------------------------------------------------------------------------
-- Une ligne ne change de statut qu'une fois. Rejeu (même résultat, même référence ou motif) : rend la ligne.
-- Autre résultat sur une ligne réglée : CL029. Référence ou motif vide : CL001.
CREATE FUNCTION settle_payout(p_payout uuid, p_outcome text, p_ref text, p_reason text, p_actor uuid)
RETURNS payout LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  po payout%ROWTYPE;
  lg ledger%ROWTYPE;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_pending uuid; v_credit uuid; v_money text; v_tx uuid; v_approver uuid; v_event uuid;
BEGIN
  SELECT * INTO po FROM payout WHERE id = p_payout;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(po.operator_id);
  IF p_outcome IS NULL OR p_outcome NOT IN ('CONFIRMED', 'FAILED') OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Règlement : résultat et acteur requis (CONFIRMED ou FAILED)' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'CONFIRMED' AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Règlement confirmé : référence externe requise' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'FAILED' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Règlement échoué : motif requis' USING ERRCODE = 'CL001';
  END IF;

  -- Verrous : autorité (partagé), compte recrédité, puis ligne payout
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || po.ledger_id, 0));
  IF p_outcome = 'FAILED' AND po.origin_account_id IS NOT NULL THEN
    PERFORM 1 FROM account WHERE id = po.origin_account_id FOR NO KEY UPDATE;
  END IF;
  SELECT * INTO po FROM payout WHERE id = p_payout FOR UPDATE;

  IF po.status <> 'INITIATED' THEN
    IF po.status = p_outcome AND (
         (p_outcome = 'CONFIRMED' AND po.external_ref IS NOT DISTINCT FROM v_ref)
         OR (p_outcome = 'FAILED' AND po.failure_reason IS NOT DISTINCT FROM v_reason)) THEN
      RETURN po;                                   -- rejeu identique
    END IF;
    RAISE EXCEPTION 'Versement déjà réglé (%) : un autre résultat est refusé', po.status USING ERRCODE = 'CL029';
  END IF;

  SELECT * INTO lg FROM ledger WHERE id = po.ledger_id;
  SELECT id INTO v_pending FROM account
   WHERE ledger_id = po.ledger_id AND code = 'L-VERS-ENCOURS' AND is_active;
  IF v_pending IS NULL THEN
    RAISE EXCEPTION 'Compte des versements en cours absent du grand livre' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'CONFIRMED' THEN
    v_money := CASE po.method WHEN 'BANK_TRANSFER' THEN 'A-BANQUE' WHEN 'WAVE' THEN 'A-PSP-WAVE'
                              WHEN 'ORANGE_MONEY' THEN 'A-PSP-OM' END;
    SELECT id INTO v_credit FROM account
     WHERE ledger_id = po.ledger_id AND code = v_money AND is_active;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'Compte d''argent du moyen absent du grand livre' USING ERRCODE = 'CL001';
    END IF;
  ELSE
    v_credit := po.origin_account_id;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'Versement sans compte d''origine : recrédit impossible' USING ERRCODE = 'CL001';
    END IF;
  END IF;

  -- Deux personnes distinctes exigées par journal_transaction (BACKOFFICE) : acteur + valideur du lot
  v_approver := CASE WHEN p_actor = po.approved_by THEN po.initiated_by ELSE po.approved_by END;
  v_event := CASE WHEN lg.scope_type = 'EVENT' THEN lg.scope_id END;
  v_tx := post_transaction(po.ledger_id, CASE p_outcome WHEN 'CONFIRMED' THEN 'PAYOUT_CONFIRMED' ELSE 'PAYOUT_FAILED' END,
                           'payout:' || po.id || ':settle', clock_timestamp(), 'BACKOFFICE',
                           jsonb_build_array(
                             jsonb_build_object('account_id', v_pending, 'amount', po.amount,
                               'memo', CASE p_outcome WHEN 'CONFIRMED' THEN 'Versement confirmé'
                                                      ELSE 'Versement échoué' END),
                             jsonb_build_object('account_id', v_credit, 'amount', -po.amount,
                               'memo', CASE p_outcome WHEN 'CONFIRMED' THEN 'Versement confirmé'
                                                      ELSE 'Échec : montant recrédité au bénéficiaire' END)),
                           v_event, NULL, p_actor, v_approver, NULL, NULL, NULL,
                           jsonb_build_object('payout_id', po.id));
  UPDATE payout SET status = p_outcome, external_ref = v_ref,
                    failure_reason = CASE p_outcome WHEN 'FAILED' THEN v_reason END,
                    settled_at = clock_timestamp(), settled_tx_id = v_tx,
                    confirmed_by = p_actor, confirmed_at = clock_timestamp()
   WHERE id = po.id
  RETURNING * INTO po;
  RETURN po;
END $$;
REVOKE ALL ON FUNCTION settle_payout(uuid, text, text, text, uuid) FROM PUBLIC;
