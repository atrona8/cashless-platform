# WP13 — nouveau cycle court (décision 15 du porteur, 17/11/2026)

WP13 a été approuvé ; ce cycle applique la décision 15 et corrige deux tests relevés en relecture.
Lire les décisions 15 à 17 de `docs/passation-9b/contexte-9b.md`. La décision 17 (bornes UTC de
l'export) revient à WP14 : ne pas y toucher ici.

1. **Ventes internes (décision 15, SPECIFICATION §12.3)** : le relevé de l'organisateur (JSON et CSV)
   gagne la catégorie « Ventes internes » : comptes des participations `INTERNAL` de ses commerçants
   pour l'événement. Les autres catégories restent égales aux `L-ORG-*`. Le recoupement avec le
   scénario (`scenario_reference.json`) et `closing_step.summary` est mis à jour en conséquence ;
   un organisateur ne voit jamais les ventes d'un commerçant `EXTERNAL` ni d'un autre organisateur
   (test). Revérifier NFR-004 (p95 du relevé organisateur) après l'ajout.
2. **Test tautologique « débit = crédit » de l'export** : le remplacer par un test qui prouve
   l'équilibre réel (somme des montants par transaction et par sens sur les deux côtés mappés, ou
   égalité au grand livre), et qui échoue si une écriture est omise.
3. **Test `=HYPERLINK` du relevé de partie** : le libellé commence par la catégorie, donc le test ne
   prouve rien. Injecter la charge dans un champ qui arrive en tête de cellule (nom de commerçant,
   compte légal) et vérifier la neutralisation.
