-- Migration 0008 : grand livre d'un événement, compte d'une participation, conditions de passage de statut
-- (SPECIFICATION §5.2, §12.1 ; mission configuration-parties-evenements, data-model « Migration 0008 », research
-- R-04, R-08).
-- open_event_ledger et open_participation_account sont SECURITY INVOKER : elles s'exécutent sous la RLS de
-- l'appelant, dans la transaction de la route, et n'élargissent aucun droit (le rôle applicatif insère déjà
-- ledger et account). event_transition_conditions est SECURITY DEFINER (elle lit des fonctions internes) et
-- commence donc par assert_tenant.
-- Aucun nom de rôle ici : les droits sont posés par post-roles.sql.

-- 1. Grand livre et comptes fixes d'un événement -----------------------------------------------------------------
-- Plan de comptes : tableau de §5.2. Titulaires : H = détenteur des fonds, O = organisateur, P = prestataire,
-- T = plateforme, NULL = aucun. Les comptes par portefeuille, par caisse et par canal PSP sont créés par les
-- missions qui les introduisent. allow_negative de ORG_CASSE, OPE_CASSE et LEGAL_BREAKAGE est posé par le
-- déclencheur account_merchant_hot.
CREATE FUNCTION open_event_ledger(p_event uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ev event%ROWTYPE; holder uuid; issuer uuid; plt uuid; dest text; lg uuid;
BEGIN
  SELECT * INTO ev FROM event WHERE id = p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF EXISTS (SELECT 1 FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event) THEN
    RAISE EXCEPTION 'Événement : grand livre déjà ouvert' USING ERRCODE = 'CL001';
  END IF;
  holder := CASE ev.funds_holder WHEN 'ORGANIZER' THEN ev.organizer_id WHEN 'OPERATOR' THEN ev.operator_id
                                 ELSE ev.funds_holder_party_id END;
  issuer := CASE ev.issuer WHEN 'OPERATOR' THEN ev.operator_id ELSE ev.organizer_id END;
  -- La plateforme est une partie unique ; la plus ancienne fait foi si une base d'essai en contient plusieurs.
  SELECT id INTO plt FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1;
  IF plt IS NULL THEN
    RAISE EXCEPTION 'Événement : partie plateforme absente' USING ERRCODE = 'CL001';
  END IF;
  SELECT breakage_destination INTO dest FROM jurisdiction_profile WHERE id = ev.jurisdiction_id;

  INSERT INTO ledger (operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
  VALUES (ev.operator_id, 'EVENT', p_event, ev.currency, issuer, holder)
  RETURNING id INTO lg;

  INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative, hot)
  SELECT ev.operator_id, lg, a.code, a.family::account_family, a.purpose,
         CASE a.owner WHEN 'H' THEN holder WHEN 'O' THEN ev.organizer_id WHEN 'P' THEN ev.operator_id WHEN 'T' THEN plt END,
         a.side, a.neg, a.hot
    FROM (VALUES
      ('A-TRANSIT',         'ASSET',    'CASH_TRANSIT',        'H',  'D', false, false),
      ('A-BANQUE',          'ASSET',    'BANK',                'H',  'D', false, false),
      ('L-ORG-COM',         'CLAIM',    'ORG_COM',             'O',  'C', false, true),
      ('L-ORG-PLACE',       'CLAIM',    'ORG_PLACE',           'O',  'C', false, false),
      ('L-ORG-FFEST',       'CLAIM',    'ORG_FFEST',           'O',  'C', false, false),
      ('L-ORG-TVA',         'CLAIM',    'ORG_TAX',             'O',  'C', false, true),
      ('L-ORG-CASSE',       'CLAIM',    'ORG_CASSE',           'O',  'C', false, false),
      ('L-ORG-CAUTION',     'CLAIM',    'ORG_DEPOSIT',         'O',  'C', false, false),
      ('L-ORG-CAUTION-ACQ', 'CLAIM',    'ORG_DEPOSIT_FORFEIT', 'O',  'C', false, false),
      ('L-ORG-PROMO',       'CLAIM',    'ORG_PROMO',           'O',  'D', true,  false),
      ('L-ORG-FPSP',        'CLAIM',    'ORG_FPSP',            'O',  'D', true,  true),
      ('L-ORG-FPREST',      'CLAIM',    'ORG_FPREST',          'O',  'D', true,  false),
      ('L-ORG-PERTES',      'CLAIM',    'ORG_PERTES',          'O',  'D', true,  false),
      ('L-ORG-CREANCES',    'CLAIM',    'ORG_RECEIVABLE',      'O',  'D', true,  false),
      ('L-ORG-VERS',        'CLAIM',    'ORG_VERS',            'O',  'D', true,  false),
      ('L-OPE-FRAIS',       'CLAIM',    'OPE_FRAIS',           'P',  'C', false, false),
      ('L-OPE-TVA',         'CLAIM',    'OPE_TAX',             'P',  'C', false, false),
      ('L-OPE-CASSE',       'CLAIM',    'OPE_CASSE',           'P',  'C', false, false),
      ('L-OPE-FPSP',        'CLAIM',    'OPE_FPSP',            'P',  'D', true,  true),
      ('L-OPE-PERTES',      'CLAIM',    'OPE_PERTES',          'P',  'D', true,  false),
      ('L-OPE-REDEV',       'CLAIM',    'OPE_REDEV',           'P',  'D', true,  false),
      ('L-OPE-VERS',        'CLAIM',    'OPE_VERS',            'P',  'D', true,  false),
      ('L-PLT-REDEV',       'CLAIM',    'PLT_REDEV',           'T',  'C', false, false),
      ('L-PLT-TVA',         'CLAIM',    'PLT_TAX',             'T',  'C', false, false),
      ('L-PLT-VERS',        'CLAIM',    'PLT_VERS',            'T',  'D', true,  false),
      ('L-ESP-A-RENDRE',    'CLAIM',    'CUSTOMER_CASH_DUE',   NULL, 'C', false, false),
      ('L-VERS-ENCOURS',    'CLAIM',    'PAYOUT_PENDING',      NULL, 'C', false, false),
      ('S-ATTENTE',         'SUSPENSE', 'SUSPENSE',            NULL, 'D', true,  false),
      ('L-LEGAL-CASSE',     'CLAIM',    'LEGAL_BREAKAGE',      NULL, 'C', false, false)
    ) AS a(code, family, purpose, owner, side, neg, hot)
   WHERE a.code <> 'L-LEGAL-CASSE' OR dest = 'LEGAL_ACCOUNT';
  RETURN lg;
END $$;

-- 2. Compte d'une participation ----------------------------------------------------------------------------------
-- L-MCH-<participation> dans le grand livre de l'événement ; chaud et négatif permis posés par account_merchant_hot.
-- Idempotente : rend le compte existant.
CREATE FUNCTION open_participation_account(p_participation uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE mp merchant_participation%ROWTYPE; lg uuid; acc uuid;
BEGIN
  SELECT * INTO mp FROM merchant_participation WHERE id = p_participation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT l.id INTO lg FROM ledger l JOIN event e ON e.id = l.scope_id AND e.currency = l.currency
   WHERE l.scope_type = 'EVENT' AND l.scope_id = mp.event_id;
  IF lg IS NULL THEN
    RAISE EXCEPTION 'Participation : grand livre de l''événement non ouvert' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, participation_id, normal_side)
  VALUES (mp.operator_id, lg, 'L-MCH-' || mp.id, 'CLAIM', 'MERCHANT', mp.merchant_id, mp.id, 'C')
  ON CONFLICT (ledger_id, code) DO NOTHING
  RETURNING id INTO acc;
  IF acc IS NULL THEN
    SELECT id INTO acc FROM account WHERE ledger_id = lg AND code = 'L-MCH-' || mp.id;
  END IF;
  RETURN acc;
END $$;

-- 3. Conditions d'un passage de statut, en lecture ---------------------------------------------------------------
-- Mêmes calculs que set_event_status (schéma de référence), sans verrou ni écriture, toutes les conditions rendues
-- au lieu de s'arrêter à la première. Correspondance avec les blocs de set_event_status :
--   TRANSITION_ALLOWED       passage présent dans event_status_transition                       (CL018)
--   DEVICES_CAUGHT_UP        vers SETTLING : avant event_sync_deadline, aucun terminal en retard (ADR-73, CL019)
--   DEBIT_AUTHORITY_CENTRAL  vers RECONCILING et au-delà : debit_authority = CENTRAL            (DB-I14, CL019)
--   SUSPENSE_ZERO            vers SETTLING et au-delà : ledger_purpose_balance(SUSPENSE) = 0    (CL019)
--   PARTY_POSITIONS_ZERO     vers REFUND_WINDOW et CLOSED : droit net nul des commerçants, du prestataire et de la
--                            plateforme (party_position)                                        (CL019)
--   PAYOUT_PENDING_ZERO      vers REFUND_WINDOW et CLOSED : ledger_purpose_balance(PAYOUT_PENDING) = 0 (CL019)
--   POSITIONS_SETTLED        vers CLOSED : ledger_unsettled(grand livre, soldes restants autorisés) = 0 (CL019)
-- Les conditions de configuration et les conditions externes sont ajoutées par l'API (R-08).
CREATE FUNCTION event_transition_conditions(p_event uuid, p_to event_status)
RETURNS TABLE (code text, met boolean, detail text, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION event_transition_conditions(uuid, event_status) FROM PUBLIC;
