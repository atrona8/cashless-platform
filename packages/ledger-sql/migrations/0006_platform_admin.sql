-- Migration 0006 : création d'un administrateur de la plateforme par l'API (POST /platform-admins ; mission
-- identite-roles-double-validation, WP06, research R-06). Une personne de la plateforme a operator_id NULL :
-- invisible et non insérable sous RLS pour le rôle applicatif. Cette fonction SECURITY DEFINER la crée, avec son
-- attribution et la ligne d'audit, dans la transaction de la requête.
-- L'autorisation ne repose que sur l'attribution PLATFORM_ADMIN active de p_actor, lue en base (jamais sur un
-- paramètre de rôle). Erreurs : CL001 (acteur non autorisé, traduit 403 par l'API) ; 23505 ((émetteur, sujet)
-- déjà connu, traduit 409 CONFLICT_STATE).
-- p_origin et p_request_id : contexte d'audit (FR-008), ajoutés à la signature de la fiche WP06.

CREATE FUNCTION create_platform_admin(p_actor uuid, p_issuer text, p_subject text, p_display_name text,
                                      p_email text, p_phone text, p_origin text DEFAULT NULL,
                                      p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_user%ROWTYPE; ra role_assignment%ROWTYPE; result jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
       SELECT 1 FROM role_assignment a JOIN app_user p ON p.id = a.user_id
        WHERE a.user_id = p_actor AND a.role = 'PLATFORM_ADMIN' AND a.revoked_at IS NULL AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Création d''un administrateur de la plateforme : réservée à un PLATFORM_ADMIN' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO app_user (operator_id, issuer, subject, email, phone, display_name, created_by)
  VALUES (NULL, p_issuer, p_subject, p_email, p_phone, p_display_name, p_actor)
  RETURNING * INTO u;
  INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
  VALUES (u.id, 'PLATFORM_ADMIN', 'PLATFORM', NULL, p_actor)
  RETURNING * INTO ra;
  result := jsonb_build_object(
    'user_id', u.id, 'operator_id', NULL, 'issuer', u.issuer, 'subject', u.subject, 'email', u.email,
    'phone', u.phone, 'display_name', u.display_name, 'status', u.status, 'created_at', u.created_at,
    'disabled_at', u.disabled_at,
    'role_assignments', jsonb_build_array(jsonb_build_object(
      'assignment_id', ra.id, 'role', ra.role, 'scope_type', ra.scope_type, 'scope_id', ra.scope_id,
      'granted_by', ra.granted_by, 'granted_at', ra.granted_at, 'revoked_at', ra.revoked_at)));
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin, request_id)
  VALUES (NULL, p_actor, 'PLATFORM_ADMIN', 'PLATFORM_ADMIN_CREATED', 'app_user', u.id::text, result, p_origin,
          p_request_id);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION create_platform_admin(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC;
-- EXECUTE accordé au rôle applicatif par post-roles.sql (le rôle n'existe qu'après roles.sql, rejoué après la série).
