# Relecture WP10, cycle 1 : changements demandes

**Constat 1 (bloquant, test qui ne prouve pas ce qu'il dit).** Le plafond dur de 35 s
(`OTP_CODE_HARD_CAP_MS`, `arm(entry, OTP_CODE_HARD_CAP_MS, ...)` dans `send`) n'est prouve par aucun
test. Mutation relancee : retirer cette ligne de `otp-chain.ts` laisse `test/unit/customer-auth` a
18/18 verts. Le test « plafond dur » (otp-chain.spec.ts l. 219) passe parce que les delais d'envoi
(15 s + 20 s) epuisent la chaine a 35 s d'eux-memes. Correction : un scenario ou seul le plafond
efface le code, par exemple un `send` de WhatsApp lent (14 s, rend `accepted` sans accuse) puis un SMS
principal lent, de sorte que l'etape suivante tombe apres 35 s ; verifier `inFlightCount() === 0` et
`jest.getTimerCount() === 0` a 35 s, et que le code n'est plus joignable (aucun appel de
fournisseur ensuite). Consigner la mutation (retrait de l'armement du plafond) dans la note de lane.
DoD : « plafond dur et effacement prouves ».

**Constat 2 (mineur, a consigner ou documenter).** Quand le plafond tombe avant l'etape suivante
(delais lents), la chaine s'arrete sans que le repli parte et sans essai note en base : comportement
conforme a « 35 s au plus » mais a signaler dans la note de lane (reglage de delais au maximum +
fournisseur lent).

**Constat 3 (mineur).** Lignes de plus de 100 caracteres : otp-chain.ts (16), otp-providers.ts (5),
otp-sender.ts (8), otp-chain.spec.ts unitaire (6) et integration (7). A reformater (regle de la fiche).

**Non verifie par le relecteur.** La base Docker (5433) etait arretee (colima) : les tests d'integration
`test/integration/customer-auth/otp-chain.spec.ts` et `production-refusals.spec.ts` n'ont pas pu etre
relances. A relancer au cycle suivant.

Verifie OK : unitaires customer-auth + production-guard 47/47 ; eslint et tsc propres ; mutations (a)
confirmation sans effacement, (b) delais echanges, (d) borne retiree : echouent bien ; revue du code :
code jamais passe a l'enregistreur ni aux erreurs, trois fabriques/libelles exacts et gardes dans
`bootstrap.ts` et `COVERAGE`, `send` rend des le premier envoi.
