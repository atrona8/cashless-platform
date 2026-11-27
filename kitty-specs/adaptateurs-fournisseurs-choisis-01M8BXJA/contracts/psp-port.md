# Contrat — port `PspAdapter` révisé (IC-01)

```ts
export type PspVerification =
  | { ok: true; kind: 'NOTIFICATION'; notification: NormalizedNotification; signedAt: Date;
      secretUsed: 'current' | 'previous'; confirmationRequired: boolean }
  | { ok: true; kind: 'SIGNAL'; notificationId: string;
      reference: { merchantReference: string | null; providerPaymentRef: string };
      secretUsed: 'current' }
  | { ok: false; reason: PspRejectionReason };

export interface VerifyNotificationInput {
  rawBody: Buffer;
  contentType: 'json' | 'form';          // nouveau : PayDunya seul accepte 'form'
  headers: Record<string, string | string[] | undefined>;
  secrets: PspSecrets;
  now: Date;
}
```

Règles (s'ajoutent aux règles 1 à 9 du port actuel) :

1. Ordre inchangé : preuve d'origine avant toute lecture du corps ; pour PayDunya, la seule lecture avant la preuve est
   l'extraction du champ `data[hash]` du formulaire (aucun autre champ lu avant la comparaison).
2. `NOTIFICATION` : horodatage signé obligatoire, tolérance par fournisseur (300 s), rejouée par `webhook-verifier.ts`.
3. `SIGNAL` : aucun montant, aucune devise, aucune carte ; ne produit jamais d'écriture ; déclenche une relecture.
4. `confirmationRequired: true` : la notification est conservée sans effet ; le crédit vient de `getStatus`.
5. `getStatus` rend le paiement complet (montant, devise, carte normalisée) ; c'est la seule source d'un crédit après
   un signal ou une notification à relire.
6. Le faux garde son schéma actuel (`t.corps`, deux secrets) et rend toujours `NOTIFICATION`,
   `confirmationRequired: false`, pour ne pas casser les tests existants ; un second faux « signal » sert aux tests du
   chemin de relecture.
7. `readStatement` peut rendre `{ supported: false }` (PayDunya) : le rapprochement de ce fournisseur reste manuel.
