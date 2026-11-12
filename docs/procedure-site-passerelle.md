# Procédure de site de la passerelle locale

Cette procédure s'adresse à la personne qui installe et exploite le mini-PC sur le site, sans connaissance
technique particulière. Chaque étape se vérifie. En cas de doute, ne rien forcer et appeler l'exploitation.

## Limites à connaître avant de commencer

- **Un mini-PC volé avant la purge garde ses secrets.** La révocation à distance ne joint pas une machine
  débranchée. Seuls le chiffrement du disque et la purge protègent les données (OP-N106, ADR-161).
- **La passerelle n'est pas utilisable en production avant la mission 12b** : le stockage matériel des clés est
  simulé jusqu'alors, et le démarrage en production refuse un faux.
- Après la purge, les blocs libérés du disque et le journal de PostgreSQL ne sont pas effacés octet par octet :
  seul le disque chiffré les protège.

## 1. Préparer le matériel

1. Disque chiffré sur le mini-PC (chiffrement du disque entier, clé saisie au démarrage par un responsable). Le
   dossier des données de PostgreSQL et le volume de la passerelle (`GATEWAY_STATE_DIR`, qui contient le marqueur de
   purge) sont sur ce disque.
2. Onduleur branché ; le mini-PC s'arrête proprement si le courant manque.
3. Wi-Fi dédié aux terminaux, sans autre usage. Le port d'administration de la passerelle n'est jamais publié sur
   ce Wi-Fi.
4. Source de temps locale (NTP) joignable. Un écart d'horloge de plus de quelques minutes bloque la passerelle.
5. Certificat et clé TLS du port d'administration (`admin-tls.crt`, `admin-tls.key`, valables pour `127.0.0.1`
   et `localhost`) déposés dans le dossier des fichiers de site, distincts de ceux des terminaux. Sans eux la
   passerelle refuse de démarrer en production (pas de repli en clair). Aucune clé n'est dans l'image.
6. Dossier de secrets hors dépôt (`GATEWAY_SECRETS_DIR`), accessible à la seule personne d'exploitation.

## 2. Inscription (une personne)

1. Une seule personne lance la demande d'inscription (`request --serial ... --role PRIMARY|STANDBY`).
2. Le central envoie une alerte immédiate à l'exploitation à chaque inscription.
3. **Aucun mot de passe de bracelet n'est envoyé pendant 30 minutes** après l'inscription. Ce délai laisse le
   temps de repérer une inscription non voulue et de la révoquer.
4. Une passerelle de secours (`STANDBY`) ne reçoit rien tant qu'elle n'est pas promue.

## 3. Enrôlement

1. Déposer le fichier d'enrôlement dans le dossier des fichiers de site, puis lancer `enroll <fichier>` ; le
   fichier est supprimé après usage.
2. Le fichier contient les clés publiques des deux responsables du site (clés des ordres à deux personnes).
   **Deux titulaires nominatifs distincts** sont exigés, chacun garde sa clé privée : jamais deux clés chez la
   même personne, jamais sur le mini-PC. Cette règle n'est pas vérifiable par la machine : l'exploitation la
   contrôle (limite résiduelle consignée).

## 4. Démarrage et vérifications

1. `docker compose -f apps/gateway/docker-compose.site.yml --env-file site.env up -d`.
2. Les deux services doivent être « healthy » (`docker compose ps`).
3. La passerelle affiche `GATEWAY listening` ; un terminal d'essai obtient sa configuration.
4. Si le démarrage est refusé, lire la raison affichée (aucun secret n'y figure) et corriger ; ne jamais
   contourner un refus.

## 5. Bascule et rendu côté administration

La bascule de l'autorité (une seule passerelle débite) se déclenche depuis l'administration du central. Attendre
que la file locale soit vidée et acquittée ; la passerelle rend alors l'autorité. Une passerelle de secours
promue passe par le même rendu complet et ne débite qu'après un accord complet du central.

## 6. Perte de la passerelle

1. Prévenir l'exploitation immédiatement.
2. Reprise forcée à deux personnes côté central, puis révocation de la passerelle.
3. La levée locale d'un état `STALE` est un ordre signé par les deux responsables (`LOCAL_UNSTALE`), possible
   seulement lien coupé ; le central en garde la trace au retour du lien.

## 7. Purge

- **Automatique** : à la clôture de l'événement, si la file est vide et entièrement acquittée. Sinon la passerelle
  affiche « purge en attente » et ne détruit rien.
- **Manuelle, à deux personnes** : ordre `PURGE` signé par les deux responsables, valable 10 minutes, envoyé en
  HTTPS sur l'écouteur d'administration (boucle locale du conteneur, `docker compose exec gateway ...`). Refusé si
  la file n'est pas acquittée ; rien n'est détruit dans ce cas.
- **Versement au central avant destruction** : l'ordre est inscrit, puis la passerelle attend (30 s) que le central
  l'ait accusé ; l'état « purge en suspens » est consigné (`PURGE`, étape `AWAITING_CENTRAL`). Accusé reçu : la
  purge a lieu. Sans accusé (lien coupé, ou aucune opération à envoyer pour porter l'ordre : un lot en exige au
  moins une), la purge locale est forcée et consignée `CENTRAL_UNCONFIRMED` ; la ligne d'ordre reste dans l'audit
  local et partira avec le premier lot suivant.
- Effet : clés de bracelet et de jetons détruites, colis et empreintes effacés, tables vidées. Une purge
  interrompue est terminée au démarrage suivant avant tout service.
- Après la purge, la passerelle ne répond plus (503) et refuse de redémarrer sur ces données.
- L'ordre de purge manuelle est consigné localement avec les noms des deux responsables.
- Limites consignées (décision 49, OP-N118, ADR-186) : journal de transactions et blocs libres non effacés ; tables
  d'ajout seul non vidées ; purge hors transaction de la file.

## 8. Retour du matériel

1. Vérifier que la purge est terminée (marqueur `DONE`, passerelle muette).
2. Arrêter les services, puis effacer le disque ou détruire sa clé de chiffrement.
3. Restituer le mini-PC à l'exploitation avec la liste de ce qui a été fait.
