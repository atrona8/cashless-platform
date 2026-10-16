-- Migration 0011 : rôle humain PERSONALIZER et actions à deux des clés de bracelet (SPECIFICATION §3.2, §7.3 à §7.5 ;
-- mission bracelets-nfc, data-model « Migration 0011 », décision du porteur n° 3 du 13/10/2026).
-- PERSONALIZER : la personne qui tient un poste de personnalisation. Portée prestataire seulement ; ce rôle ne donne
-- que l'enregistrement d'un bracelet personnalisé et l'association de son code (contrôlé par l'API). Moindre
-- privilège : un jeton d'administrateur n'a pas à se trouver sur un poste d'atelier.
-- Actions à deux ajoutées : création d'une clé, rotation de sa clé de données, retrait d'une clé dédiée. La sortie de
-- liste noire utilise l'action REINSTATE_MEDIA, déjà prévue par le schéma de référence.

-- 1. Rôle PERSONALIZER ------------------------------------------------------------------------------------------------
ALTER TABLE role_assignment DROP CONSTRAINT role_assignment_role;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_role CHECK (role IN (
  'PLATFORM_ADMIN','OPERATOR_ADMIN','ORGANIZER_ADMIN','SUPERVISOR','CASHIER','MERCHANT_ADMIN','VENDOR','CUSTOMER','PERSONALIZER'));
ALTER TABLE role_assignment DROP CONSTRAINT role_assignment_role_scope;
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_role_scope CHECK (
     (role = 'PLATFORM_ADMIN' AND scope_type = 'PLATFORM')
  OR (role = 'OPERATOR_ADMIN' AND scope_type = 'OPERATOR')
  OR (role = 'ORGANIZER_ADMIN' AND scope_type = 'ORGANIZER')
  OR (role IN ('SUPERVISOR','CASHIER') AND scope_type IN ('ORGANIZER','EVENT'))
  OR (role IN ('MERCHANT_ADMIN','VENDOR') AND scope_type = 'MERCHANT')
  OR (role IN ('CUSTOMER','PERSONALIZER') AND scope_type = 'OPERATOR'));

-- 2. Actions à deux -----------------------------------------------------------------------------------------------------
ALTER TABLE approval_request DROP CONSTRAINT approval_request_action_check;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_action_check CHECK (action IN (
  'LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP','FORCE_CENTRAL_AUTHORITY','REINSTATE_MEDIA','PAYOUT',
  'DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION','EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK',
  'EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE','EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE',
  'CONTRACT_VERSION','PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE',
  'TAG_KEY_CREATE','TAG_DEK_ROTATE','TAG_KEY_RETIRE'));
-- La contrainte approval_request_platform_scope (migration 0009) reste telle quelle : seules les deux actions de
-- plateforme n'ont pas de prestataire ; les trois actions de clé en ont donc toujours un.
