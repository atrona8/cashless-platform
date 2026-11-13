---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-06T11:03:22Z'
reviewer_agent: claude
wp_id: WP06
---

# Retour de relecture WP06 (cycle 1) : rejet

pgTAP reel (cashless_wp06r) : tests_edge_post_transaction 157/157 OK ; voisines OK (edge_sync 86, edge_handover 123,
edge_gateway 79, cash_sessions 174, execute_grants 79, definer_search_path 14, offline_exposure_bounded 12, offline_anomalies 121).
Mais deux defauts bloquants de securite que la suite ne voit pas.

## B1 (bloquant) Plafond horaire contournable par heures d'origine decroissantes
0061, calcul de `v_used` : la fenetre est `(v_eff - 3600, v_eff]`, donc une vente ecrite plus tard avec une heure d'origine
PLUS ANCIENNE ne voit pas les ventes deja ecrites a des heures plus recentes. Une passerelle hostile envoie ses ventes avec
occurred_at decroissant (now - 0.3 s x i, tout dans la fenetre du cycle) : chaque vente voit used = 0.
Preuve : copie du test de la passerelle hostile avec `occurred_at = clock_timestamp() - (i*0.3) secondes` : perte mesuree
4 000 000 XOF pour P_max 1 500 000 (test 148 en echec), aucune alerte EDGE_REPLAY_CEILING (test 152 en echec).
Le test existant ne le voit pas : ses heures croissantes sont ecretees aux bornes du cycle, donc cumulatives.
Correction attendue : somme symetrique (toute vente du terminal dont ceiling_epoch est dans (eff-3600, eff+3600)), ou cumul
par seau horaire de l'heure reelle d'ecriture (clock_timestamp) plutot que de l'heure declaree. Ajouter au test le cas
decroissant ET le cas melange (A tard, B tot, puis C entre les deux), perte <= P_max.

## B2 (bloquant) cashless_app peut reecrire les plafonds (RLS contournable par le drapeau local)
`edge_platform_setting` reçoit par les droits par defaut `cashless_app=arw` (relacl verifie). La politique d'ecriture ne teste
que `current_setting('app.edge_setting_write')`, qu'un appelant pose lui-meme. Preuve en base :
`set local role cashless_app; set local app.edge_setting_write='on'; update edge_platform_setting set value=999999999
where key='replay_max_per_sale';` reussit. Cela contredit interfaces.md 12.4 (un processus compromis ne doit pas changer les
plafonds) et la regle 1 (droit plus large).
Correction attendue : `REVOKE ALL ON edge_platform_setting FROM PUBLIC, cashless_app` (et tout autre role) apres creation,
verifier relacl = proprietaire seul ; ne plus compter sur le drapeau seul ; test qui, sous chaque role de
l'application (cashless_app, cashless_edge, cashless_edgeadmin), echoue sur UPDATE/INSERT meme avec le drapeau pose.

## Mineurs (a consigner)
M1. REVERSAL accepte toute vente PURCHASE du portefeuille dans le grand livre (y compris ecrite par le central avant la remise,
    autre commercant, sans limite d'age), sur simple tap valide du bracelet. A borner (source EDGE_SYNC et cycle courant) ou consigner.
M2. Les montants de p_fee_lines ne sont pas recalcules : une ligne peut deplacer jusqu'a tout le montant du commercant vers un compte de
    frais du grand livre (seuls compte, signe et fee_rule_id/beneficiary sont verifies). Contrat a imposer a WP13 : lignes issues du moteur central.
M3. `edge_amount` (plafond horaire) compte le montant demande, non le montant ecrit : sur-comptage prudent, a documenter.
M4. Ordre des verrous (evenement, autorite, lignes) : juge correct et coherent avec 0058-0060 ; aucun cycle trouve par lecture.
    Le media est verrouille FOR UPDATE avant les soldes : verifier l'ordre avec les chemins en ligne (consume_tap) en WP13.
