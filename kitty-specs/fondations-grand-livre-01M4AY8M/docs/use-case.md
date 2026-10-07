# Cas d'usage — mission fondations-grand-livre-01M4AY8M

> État : **plan finalisé** (2026-10-07), avant implémentation. À recaler après la review.

Mission de fondation : ses acteurs sont l'équipe de développement, la CI et les missions suivantes, qui
s'appuient sur le grand livre et sur les garanties transverses de l'API. Aucun acteur terrain ni du back-office
n'a encore de route à appeler (seule une route de santé est publiée).

## Cas d'usage propres à cette mission

```mermaid
flowchart LR
    Dev([Développeur])
    CI([CI])
    Mission([Missions suivantes])
    Exploit([Exploitant])

    UC1((Vérifier la base<br/>en local))
    UC2((Vérifier la base<br/>à chaque commit))
    UC3((Écrire au grand livre<br/>par le moteur))
    UC4((Rejouer le festival<br/>de référence))
    UC5((Hériter des garanties<br/>de l'API))
    UC6((Générer les types<br/>du contrat))
    UC7((Vérifier la santé<br/>de l'API))

    Dev --> UC1
    Dev --> UC6
    CI --> UC2
    CI --> UC4
    Mission --> UC3
    Mission --> UC5
    Exploit --> UC7
    UC4 -.include.-> UC3
```

| Cas d'usage | Ce qui le prouve |
|---|---|
| Vérifier la base en local | 400 + 64 assertions pgTAP vertes sur le cluster privé (port 5433), sans admin ni Docker |
| Vérifier la base à chaque commit | Job CI : migrations, `roles.sql`, pgTAP, générateurs à jour, tests TypeScript |
| Écrire au grand livre par le moteur | 26 constructeurs, 19 cas normatifs, refus selon le statut de l'événement |
| Rejouer le festival de référence | Soldes exacts après T23 et en fin de clôture ; second rejeu = 0 transaction |
| Hériter des garanties de l'API | Idempotence S21, problem+json, `X-Request-Id`, `Accept-Language`, cloisonnement par prestataire |
| Générer les types du contrat | `openapi-typescript` → `packages/contracts/generated/` ; contrôle CI |
| Vérifier la santé de l'API | `GET /v1/health` (seule route publiée) |

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaine **« Grand livre et moteur d'écritures »** (socle technique,
pas de cas d'usage terrain nouveau dans le diagramme global ; ligne ajoutée au tableau « Détail par mission »).

## Nécessaire pour cette mission ? Oui — la mission introduit des cas d'usage (pour l'équipe, la CI et les missions suivantes), même s'ils ne sont pas des cas d'usage terrain.
## Complet ? Partiel — reflète le plan ; à confronter à l'implémentation réelle à la review.
## Validé par : Porteur du projet (07/10/2026)
