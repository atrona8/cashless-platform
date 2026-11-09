# Relecture WP07 (0062) - constats, cycle 1 - verdict : planned

**B1 (bloquant, plafond reglementaire contournable) : `occurred_at` n'est pas borne.**
`edge_counter_op` ecrit `v_occ` tel que la passerelle l'envoie dans `journal_transaction.occurred_at` et le passe a
`wallet_topup_headroom(wal.id, v_occ)`, dont le plafond MENSUEL et le niveau KYC dependent de la date. Contrairement a
0061 (`v_eff` borne a [debut du cycle - 15 min ; maintenant + 15 min]), rien ne borne la date ici.
Preuve rejouee (jurisdiction unidentified_monthly_limit = 5000, portefeuille 30) : recharges de 5000 datees maintenant
(5000 credites), maintenant (0 credite, 5000 dus), 2024-03-10 (5000 credites), 2024-04-10 (5000 credites) : 15 000
credites au portefeuille pour un plafond mensuel de 5000 ; solde paye -15000. Dates 1999, 2020, 2099 acceptees et ecrites
au journal (caution et recharge). Une passerelle compromise, ou un terminal au temps faux, depasse le plafond sans
anomalie.
Correction : borner la date (meme formule que 0061, `v_eff`) pour la marge de recharge ET pour `occurred_at` de l'ecriture
(ou, a defaut, rejeter MALFORMED_OPERATION / ORIGIN_OCCURRED_AT hors bornes) ; calculer la marge avec une date non
anterieure au debut du cycle - 15 min. Test : recharge datee 2020 et 2099 ne contourne pas le plafond mensuel (profil avec
`unidentified_monthly_limit`) ; test qui echoue sans la borne.

**M1 (mineur) : aucun test de l'autorite.** Rien ne prouve que `lg.debit_authority <> 'EDGE'` (CL013), l'absence de handover
actif (CL013) ou le handover TO_CENTRAL RELEASING (accepte) sont tenus. Ajouter trois assertions.

**M2 (mineur) : cle d'origine deja au registre sous un autre numero : 23505 apres ecriture** (limite connue de 0061, reprise
ici). La passerelle reste bloquee sur ce numero (CL016 ensuite). Documente ; a traiter par WP13/WP14 (ne pas relancer en boucle).

**M3 (mineur) : doublon route en ligne (`api_idempotency`) sans filtre sur `scope`.** Une cle `<serie>:<seq>` terminee en 2xx
sur une autre route donne un faux VOID / DUPLICATE_ORIGIN_KEY. Filtrer sur les scopes d'activation / caution. En outre
`LIKE 'deposit:<media>:%'` peut rendre l'ecriture d'une caution plus ancienne du meme bracelet (rattachement seulement).

**M4 (note) : recharge sans plafond de montant unitaire** (l'excedent regle est borne par la marge, mais un `amount` de 9e11
est ecrit comme espece encaissee et dues). Pas de regle de la fiche ; signaler au porteur si un plafond d'operation est voulu.
