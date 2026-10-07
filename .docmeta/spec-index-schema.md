# Schéma de `docs/spec-index.json` et vue visuelle en quadrants

> Fichier de réglage : ajuste ici le schéma si le format doit évoluer.
> `spec-kitty-docs-maintain` lit ce fichier pour savoir quels champs extraire
> de `spec.md` à chaque mission ; ne modifie le schéma qu'en connaissance de
> cause, un changement ici doit être répercuté dans la page qui consomme le
> fichier (voir composant de départ en bas de ce document).

## Pourquoi ce fichier existe

`docs/02-use-case-diagram.md` documente les cas d'usage en diagramme UML
(acteurs et ellipses). `docs/spec-index.json` sert un besoin différent : une
vue visuelle en quadrants, un coup d'œil complet par mission, pensée pour
être cliquable plutôt que lue en Markdown. Les deux coexistent, aucun ne
remplace l'autre.

## Schéma

Un tableau d'objets, un par mission ayant un `spec.md` produit :

```json
[
  {
    "mission": "recherche-filtre-candidatures-01KYQ1HX",
    "titre_cas_usage": "Rechercher / filtrer les candidatures",
    "statut": "mergée",
    "user_stories": [
      {
        "titre": "Filtrer par statut",
        "detail": "En tant que candidat, je veux filtrer par statut afin de retrouver rapidement où j'en suis avec chaque entreprise."
      }
    ],
    "entites_cles": ["Candidature", "Statut", "Mot-clé"],
    "resultat_mesurable": "Résultat filtré affiché en moins de 100 ms, pour un utilisateur avec jusqu'à 500 candidatures",
    "hypotheses": ["Filtrage fait en mémoire côté client"],
    "contraintes": ["Aucun appel serveur déclenché à la frappe"],
    "cas_limites": ["Recherche sans résultat", "Filtre combiné à une relance active"],
    "fonctionnel": ["Filtrer par statut, mot-clé, plage de dates"],
    "non_fonctionnel": ["Accessible clavier", "Pas de scroll bloquant"],
    "source": "kitty-specs/recherche-filtre-candidatures-01KYQ1HX/spec.md"
  }
]
```

## Règles d'extraction pour `spec-kitty-docs-maintain`

- Source unique : `kitty-specs/<mission>/spec.md`, jamais réécrit à la main,
  toujours régénéré par extraction à chaque addendum post-plan et post-review.
- `user_stories[].titre` : forme courte (3-5 mots) dérivée de chaque user
  story de `spec.md`, pas la phrase complète (elle va dans `detail`).
- Un champ vide reste un tableau vide `[]` ou une chaîne vide `""`, jamais
  omis : la page qui consomme ce fichier doit pouvoir compter sur la
  présence de toutes les clés.
- `statut` reflète le statut réel de la mission (vérifié comme pour
  `docs/06-docs-status.md`), pas un statut recopié aveuglément.
- Mets à jour l'entrée correspondante (ou ajoute-la si absente) à chaque
  addendum post-plan et post-review défini dans
  `.docmeta/prompts/B-mise-a-jour-post-mission.md` — ne régénère jamais tout
  le fichier depuis zéro, pour ne pas perdre une mission déjà indexée si son
  `spec.md` a depuis été déplacé.

## Composant de départ pour la page (hors périmètre du skill)

Ce composant n'est pas géré par le skill lui-même (rappel de discipline :
seuls `docs/`, `kitty-specs/*/docs/` et `docs/06-docs-status.md` sont dans
son périmètre d'écriture). Il est fourni ici comme point de départ pour
l'ajout ponctuel à faire une fois dans `src/app/documentation/` (ou
l'équivalent du visualiseur existant du projet). Utilise `styled-jsx`
(natif Next.js) plutôt que des styles inline, pour de vraies media queries
et interactions au survol.

### Gabarit visuel exact, à respecter à la lettre

Une carte par mission, en grille 2×2 fixe sur écran large (empilée en une
colonne sous 760px, jamais 3 colonnes) :

| | Colonne gauche | Colonne droite |
|---|---|---|
| **Ligne haute** | User stories, sous forme de liste cliquable : cliquer une story affiche son détail complet | Entités clés + résultat mesurable |
| **Ligne basse** | Hypothèses + contraintes | Cas limites + exigences fonctionnelles/non fonctionnelles |

La carte occupe la largeur disponible de son conteneur (pas une largeur fixe
étroite) : sur un écran large elle doit remplir l'essentiel de la zone de
contenu, pas se réduire à une fraction de l'écran entourée de vide.

### Navigation entre missions : par boutons, jamais par défilement

Une seule carte affichée à la fois. On change de mission avec les boutons
`‹` / `›`, ou en cliquant directement un repère de position (façon réglette
graduée). Pas de liste qui défile verticalement ou horizontalement pour
atteindre les autres missions.

### Direction visuelle : plan technique / schéma d'ingénierie

Palette et signature délibérément choisies pour ce contenu (des
spécifications techniques), pas une palette neutre par défaut :

- Fond encre profonde (`#0E1B2B`), texte papier clair (`#EDEEF0`).
- Accent cyan bleu de méthode (`#5FD4E8`) pour la structure et les libellés.
- Accent ambre (`#F2A93B`) pour tout ce qui est cliquable/interactif.
- Police monospace (`IBM Plex Mono`, repli `ui-monospace`) pour les libellés
  et le statut, police sans-serif (`IBM Plex Sans`, repli `system-ui`) pour
  le texte courant.
- Signature : coins façon équerre de plan technique sur la carte, tampon de
  statut légèrement pivoté (façon tampon encreur), réglette de navigation
  graduée en bas plutôt que des boutons génériques.

```tsx
// src/app/documentation/SpecCard.tsx — carte individuelle
"use client";
import { useState } from "react";

type UserStory = { titre: string; detail: string };
export type SpecEntry = {
  mission: string;
  titre_cas_usage: string;
  statut: string;
  user_stories: UserStory[];
  entites_cles: string[];
  resultat_mesurable: string;
  hypotheses: string[];
  contraintes: string[];
  cas_limites: string[];
  fonctionnel: string[];
  non_fonctionnel: string[];
  source: string;
};

const STATUT_LABEL: Record<string, string> = {
  "mergée": "MERGED",
  "en cours": "IN PROGRESS",
  "planifiée": "PLANNED",
};

export function SpecCard({ entry }: { entry: SpecEntry }) {
  const [selected, setSelected] = useState<UserStory | null>(entry.user_stories[0] ?? null);

  return (
    <div className="spec-card">
      <div className="corner corner-tl" />
      <div className="corner corner-tr" />
      <div className="corner corner-bl" />
      <div className="corner corner-br" />

      <header>
        <span className="eyebrow">Cas d&apos;usage</span>
        <h2>{entry.titre_cas_usage}</h2>
        <span className="stamp">{STATUT_LABEL[entry.statut] ?? entry.statut.toUpperCase()}</span>
      </header>

      <div className="quadrants">
        {/* Position 1 = haut-gauche */}
        <section className="q q-stories">
          <h3>User stories</h3>
          <ul>
            {entry.user_stories.map((us) => (
              <li key={us.titre}>
                <button
                  className={selected?.titre === us.titre ? "story-btn active" : "story-btn"}
                  onClick={() => setSelected(us)}
                >
                  {us.titre}
                </button>
              </li>
            ))}
          </ul>
          {selected && <p className="detail">{selected.detail}</p>}
        </section>

        {/* Position 2 = haut-droite */}
        <section className="q">
          <h3>Entités clés &amp; résultat mesurable</h3>
          <p className="label">Entités</p>
          <p className="tags">
            {entry.entites_cles.map((e) => <span key={e} className="tag">{e}</span>)}
          </p>
          <p className="label">Résultat mesurable</p>
          <p>{entry.resultat_mesurable}</p>
        </section>

        {/* Position 3 = bas-gauche */}
        <section className="q">
          <h3>Hypothèses &amp; contraintes</h3>
          <p className="label">Hypothèses</p>
          <ul className="plain">{entry.hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>
          <p className="label">Contraintes</p>
          <ul className="plain">{entry.contraintes.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>

        {/* Position 4 = bas-droite */}
        <section className="q">
          <h3>Cas limites &amp; exigences</h3>
          <p className="label">Cas limites</p>
          <ul className="plain">{entry.cas_limites.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="label">Fonctionnel / non fonctionnel</p>
          <ul className="plain">
            {[...entry.fonctionnel, ...entry.non_fonctionnel].map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      </div>

      <footer>SOURCE&nbsp;/&nbsp;{entry.source}</footer>

      <style jsx>{`
        .spec-card {
          position: relative;
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          background: #0e1b2b;
          color: #edeef0;
          border: 1px solid #1f3347;
          border-radius: 4px;
          padding: 32px clamp(20px, 4vw, 48px);
          font-family: "IBM Plex Sans", system-ui, sans-serif;
        }
        .corner {
          position: absolute;
          width: 18px;
          height: 18px;
          border: 2px solid #5fd4e8;
          opacity: 0.8;
        }
        .corner-tl { top: 10px; left: 10px; border-right: none; border-bottom: none; }
        .corner-tr { top: 10px; right: 10px; border-left: none; border-bottom: none; }
        .corner-bl { bottom: 10px; left: 10px; border-right: none; border-top: none; }
        .corner-br { bottom: 10px; right: 10px; border-left: none; border-top: none; }

        header {
          display: flex;
          align-items: baseline;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 24px;
          border-bottom: 1px dashed #1f3347;
          padding-bottom: 16px;
        }
        .eyebrow {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          color: #5fd4e8;
          text-transform: uppercase;
        }
        h2 { margin: 0; font-size: clamp(18px, 2.4vw, 26px); flex: 1; }
        .stamp {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          color: #f2a93b;
          border: 1px solid #f2a93b;
          padding: 4px 10px;
          border-radius: 2px;
          transform: rotate(-3deg);
        }

        .quadrants {
          display: grid;
          grid-template-columns: 1fr 1fr;
          align-items: start;
          gap: 1px;
          background: #1f3347;
          border: 1px solid #1f3347;
        }
        .q { background: #0e1b2b; padding: 20px; }
        .q h3 {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #5fd4e8;
          margin: 0 0 12px;
        }
        .label {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 11px;
          color: #7f93a6;
          margin: 10px 0 2px;
        }
        ul { list-style: none; margin: 0; padding: 0; }
        ul.plain li {
          font-size: 13.5px;
          padding: 3px 0 3px 14px;
          position: relative;
          color: #d7dde2;
        }
        ul.plain li::before {
          content: "—";
          position: absolute;
          left: 0;
          color: #3f5468;
        }
        .story-btn {
          background: none;
          border: none;
          color: #d7dde2;
          font-size: 13.5px;
          text-align: left;
          width: 100%;
          padding: 6px 8px;
          margin: 2px 0;
          border-radius: 2px;
          cursor: pointer;
          border-left: 2px solid transparent;
        }
        .story-btn:hover { background: #142534; }
        .story-btn.active {
          border-left: 2px solid #f2a93b;
          color: #f2a93b;
          background: #16273a;
        }
        .detail {
          font-size: 13px;
          color: #9fb0bf;
          border-top: 1px dashed #1f3347;
          margin-top: 12px;
          padding-top: 10px;
        }
        .tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .tag {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 11px;
          border: 1px solid #3f5468;
          color: #9fb0bf;
          padding: 2px 8px;
          border-radius: 2px;
        }
        footer {
          margin-top: 20px;
          padding-top: 12px;
          border-top: 1px dashed #1f3347;
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 10.5px;
          letter-spacing: 0.06em;
          color: #3f5468;
        }

        @media (max-width: 760px) {
          .quadrants { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
```

```tsx
// src/app/documentation/SpecGallery.tsx — bascule entre missions par boutons
"use client";
import { useEffect, useState } from "react";
import { SpecCard, type SpecEntry } from "./SpecCard";

export function SpecGallery({ entries }: { entries: SpecEntry[] }) {
  const [index, setIndex] = useState(0);
  const total = entries.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  if (total === 0) {
    return <p className="empty">Aucune mission indexée pour le moment.</p>;
  }

  return (
    <div className="gallery">
      <SpecCard entry={entries[index]} />

      <div className="switcher">
        <button
          className="nav-btn"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          aria-label="Mission précédente"
        >
          ‹
        </button>

        <div className="ruler">
          {entries.map((e, i) => (
            <button
              key={e.mission}
              className={i === index ? "tick active" : "tick"}
              onClick={() => setIndex(i)}
              title={e.titre_cas_usage}
              aria-label={`Aller à ${e.titre_cas_usage}`}
            />
          ))}
        </div>

        <button
          className="nav-btn"
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
          disabled={index === total - 1}
          aria-label="Mission suivante"
        >
          ›
        </button>

        <span className="position">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
      </div>

      <style jsx>{`
        .gallery {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          width: 100%;
        }
        .switcher {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .nav-btn {
          width: 36px;
          height: 36px;
          border-radius: 2px;
          border: 1px solid #f2a93b;
          background: none;
          color: #f2a93b;
          font-size: 18px;
          cursor: pointer;
          line-height: 1;
        }
        .nav-btn:disabled {
          opacity: 0.3;
          cursor: default;
          border-color: #3f5468;
          color: #3f5468;
        }
        .nav-btn:not(:disabled):hover { background: #f2a93b; color: #0e1b2b; }
        .ruler {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 4px;
        }
        .tick {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 1px solid #3f5468;
          background: none;
          cursor: pointer;
          padding: 0;
        }
        .tick.active { background: #5fd4e8; border-color: #5fd4e8; }
        .position {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          font-size: 12px;
          color: #7f93a6;
          letter-spacing: 0.05em;
        }
        .empty {
          font-family: "IBM Plex Mono", ui-monospace, monospace;
          color: #7f93a6;
        }
      `}</style>
    </div>
  );
}

// Page parente : fetch/lecture de docs/spec-index.json, puis
// <SpecGallery entries={entries} />
```
