---
affected_files: []
cycle_number: 2
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T15:38:47Z'
reviewer_agent: claude
wp_id: WP03
---

# WP03 — cycle 2 : décisions du porteur du 26/11/2026 et réserves de la relecture du cycle 1

Pré-requis : la lane c doit fusionner la lane g (WP07 cycle 2 approuvé, méthode facultative
`resolvePaymentReference?(ref, secrets)` du port) : `bash <R>/docs/passation-12b-1/scripts/merge-deps.sh c g`.

1. **Litige Stripe rattaché par relecture (décision).** L'adaptateur Stripe rend `charge.dispute.created` en
   `NOTIFICATION` de kind `DISPUTE`, `confirmationRequired: true`, `reference.providerPaymentRef = <payment_intent>`.
   - La réception conserve le litige « à relire » (aucun effet sur le grand livre sur la seule notification).
   - Le confirmateur, si l'adaptateur expose `resolvePaymentReference`, résout la référence (session `cs_…` et
     `merchantReference`) puis passe le litige normalisé (référence marchande remplie) au répartiteur de litiges
     **existant** ; résolution `null` ou adaptateur sans la méthode : anomalie sans correspondance, comme aujourd'hui.
   - Tests (faux adaptateur du registre de test) : résolution trouvée → répartiteur appelé avec la référence ;
     `null` → anomalie sans correspondance ; aucune écriture avant relecture. Mutations notées.
2. **Relecture sur `close` (réserve).** La relecture asynchrone est déclenchée aussi sur l'événement `close` de la
   réponse (connexion coupée avant `finish`), une seule fois (pas de double relecture si `finish` puis `close`). Test.
3. **Borne par minute (réserve).** La borne par recharge/minute n'est posée qu'après une relecture aboutie
   (`APPLIED` ou `PENDING`), pas après `FAILED` (un échec réseau ne doit pas bloquer la relecture suivante). Test et
   mutation.

Fichier à faire relire par une personne : `psp-status-confirmer.ts` (à nommer dans la note de lane).
Relancer les gardes transverses : `test/unit/psp`, `test/integration/webhooks`, `test/integration/topups`,
`test/unit/architecture.spec.ts`, `test/unit/production-guard.spec.ts` (si présent).
