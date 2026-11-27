---
affected_files: []
cycle_number: 1
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-27T10:17:56Z'
reviewer_agent: claude
wp_id: WP13
---

# Relecture WP13 : a corriger (1 constat bloquant, 2 mineurs)

Verifie et conforme : complétude des consignes WP13 (OP-N199 a N211, ADR-237 a 240, D9, Android, Apple, RKP,
lookup, WP03, WP10, WP11), faits cites (grep : plus de 30 echantillons, tous presents), numerotation sans doublon,
libelles « 12b » precises sans perte, aucun secret, aucune migration, consignation.spec.ts 128/128, gardes transverses 556 verts,
4 mutations reelles.

## Bloquant : propositions presentees comme decisions du porteur
Le porteur n'a decide ni la mission 13 pour N205/N207/N208/N211, ni « bloque la production : Non » de N202/N203.
1. `PRD.md` §2.8 : « Heritages : mission 13 (OP-N205, OP-N207, OP-N208, OP-N211) » ; `PROMPTS-A-ENVOYER.md` :
   encadre « Herite de la 12b-1 (ADR-240) » dans la mission 13 (N205, N207, N208, N211), sans mot de proposition.
   Ecrire « proposition, en attente de decision du porteur » (PRD, PROMPTS, ADR-240 « Missions qui les levent »,
   POINTS_OUVERTS : colonnes N205 « mesure a la recette (mission 13) », N208 et N211 « Mission 13 »).
2. `docs/POINTS_OUVERTS.md` OP-N203 (et N202) : la colonne « Bloque la production : Non » doit etre marquee
   « proposition, a confirmer par le porteur » (le porteur a decide du report en mission 12, pas du caractere non bloquant).
   Idem dans ADR-239 / PRD / PROMPTS si repris. Ajouter aussi a `note-equipes.md` §3 point 5 la liste de ces
   decisions en attente (N203 non bloquant, mission 13 pour N205/N207/N208/N211).
   Le test consignation.spec.ts peut verifier la presence du mot « proposition » pres de ces OP.

## Mineurs
- OP-N209 / ADR-240 : la limite « preuve d'injection du test d'architecture sur `S3SealCopy` seul » (fiche WP10) n'est que
  dans preuves.md ; l'ajouter a N209.
- consignation.spec.ts : en-tete et quelques lignes de commentaire du fichier depassent 100 caracteres (lignes 1, 3, 7 existantes) ; sans effet.
