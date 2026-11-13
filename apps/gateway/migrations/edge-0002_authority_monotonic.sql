-- edge-0002 (WP17) : l'autorité ne recule pas en UPDATE direct, et l'époque confirmée par le
-- central est distinguée de l'époque seulement plausible.
--
-- 1. `edge_authority.epoch` ne diminue jamais. `highest_epoch_seen` ne diminue que dans la levée
--    locale de STALE à deux personnes (STALE -> ACTIVE avec highest_epoch_seen = epoch), seul cas
--    de data-model.md B.8 qui la « ramène à epoch ». Un UPDATE direct qui fait reculer l'une ou
--    l'autre (rendre un débit possible après un STALE) est refusé par la base.
-- 2. `central_confirmed_epoch` : plus haute époque vue au long-polling du central (source
--    fiable). La levée locale est refusée quand elle dépasse l'époque détenue. Ne diminue jamais.
-- 3. Index unique partiel : un nonce d'ordre local à deux personnes ne sert qu'une fois
--    (§ 12.13), même sous concurrence.
--
-- Rien de ce qui précède n'élargit un droit : tout est un contrôle de plus.
ALTER TABLE edge_authority ADD COLUMN central_confirmed_epoch bigint
  CHECK (central_confirmed_epoch IS NULL OR central_confirmed_epoch >= 0);

CREATE OR REPLACE FUNCTION edge_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('STANDBY', 'ARMED') THEN
      RAISE EXCEPTION 'edge_authority : état initial % interdit (STANDBY ou ARMED)', NEW.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE interdit sur edge_authority' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT EXISTS (SELECT 1 FROM edge_authority_transition t
                    WHERE t.from_state = OLD.state AND t.to_state = NEW.state) THEN
      RAISE EXCEPTION 'edge_authority : transition % -> % absente de la table', OLD.state, NEW.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- Invariant B.7-4 : RELEASING ne retourne à ACTIVE que sur échec du handover signalé pour la
    -- même époque.
    IF OLD.state = 'RELEASING' AND NEW.state = 'ACTIVE'
       AND NEW.handover_failed_epoch IS DISTINCT FROM NEW.epoch THEN
      RAISE EXCEPTION 'edge_authority : RELEASING -> ACTIVE exige handover_failed_epoch = epoch'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.epoch < OLD.epoch THEN
    RAISE EXCEPTION 'edge_authority : l''époque détenue ne recule jamais (% -> %)',
      OLD.epoch, NEW.epoch USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.highest_epoch_seen < OLD.highest_epoch_seen
     AND NOT (OLD.state = 'STALE' AND NEW.state = 'ACTIVE'
              AND NEW.highest_epoch_seen = NEW.epoch) THEN
    RAISE EXCEPTION 'edge_authority : highest_epoch_seen ne recule que par levée locale (% -> %)',
      OLD.highest_epoch_seen, NEW.highest_epoch_seen USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.central_confirmed_epoch IS NOT NULL
     AND NEW.central_confirmed_epoch IS DISTINCT FROM OLD.central_confirmed_epoch
     AND (NEW.central_confirmed_epoch IS NULL
          OR NEW.central_confirmed_epoch < OLD.central_confirmed_epoch) THEN
    RAISE EXCEPTION 'edge_authority : central_confirmed_epoch ne recule jamais'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX edge_audit_site_order_nonce ON edge_audit ((detail ->> 'nonce'))
  WHERE kind = 'SITE_ORDER_ACCEPTED';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
