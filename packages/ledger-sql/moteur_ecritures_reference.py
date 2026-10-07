"""Implémentation de référence des calculs du moteur d'écritures (arrondis, frais, taxes, partages).
Normative pour les calculs : l'implémentation NestJS DOIT donner exactement les mêmes résultats sur la table de cas
ci-dessous (à reprendre telle quelle en tests unitaires). Entiers uniquement : aucun flottant.
Lancer : python3 moteur_ecritures_reference.py
"""

def div_round(num: int, den: int) -> int:
    """num/den arrondi au plus proche, demi vers l'extérieur (0,5 -> 1 ; -0,5 -> -1). den > 0."""
    assert den > 0
    q, r = divmod(abs(num), den)
    if 2 * r >= den:
        q += 1
    return q if num >= 0 else -q

def fee(base: int, rate_bps: int = 0, fixed: int = 0, min_amount=None, max_amount=None) -> int:
    """Frais = arrondi(base x taux) + fixe, puis bornés. Le résultat est TTC si la règle est tax_inclusive."""
    f = div_round(base * rate_bps, 10_000) + fixed
    if min_amount is not None: f = max(f, min_amount)
    if max_amount is not None: f = min(f, max_amount)
    return f

def split_tax(ttc: int, tax_bps: int) -> tuple[int, int]:
    """Extrait la taxe d'un montant TTC : taxe arrondie, HT par différence (HT + taxe = TTC exactement).
    Règle d'agrégation : dans UNE transaction, on additionne les frais TTC de même bénéficiaire et de même taux,
    puis on extrait la taxe UNE fois sur cette somme (voir CASES 2 et 18)."""
    tax = div_round(ttc * tax_bps, 10_000 + tax_bps)
    return ttc - tax, tax

def split_share(total: int, first_bps: int) -> tuple[int, int]:
    """Partage d'un total (ex. casse organisateur / prestataire) : 1re part arrondie, la 2e reçoit le reste."""
    a = div_round(total * first_bps, 10_000)
    return a, total - a

def purchase_lines(amount, promo_balance, paid_balance, commission_bps, tax_bps, promo_first=True):
    """Lignes d'une vente en ligne : consommation des crédits offerts d'abord (paramétrable), puis commission TTC -> HT + taxe.
    Renvoie une liste (compte, montant signé). Lève une erreur si le solde ne suffit pas (en ligne)."""
    if promo_balance + paid_balance < amount:
        raise ValueError("INSUFFICIENT_FUNDS")
    from_promo = min(amount, promo_balance) if promo_first else max(0, amount - paid_balance)
    from_paid = amount - from_promo
    lines = []
    if from_promo: lines.append(("L-WAL-X", from_promo))
    if from_paid: lines.append(("L-WAL-P", from_paid))
    lines.append(("L-MCH", -amount))
    com = fee(amount, commission_bps)
    if com:
        ht, tax = split_tax(com, tax_bps)
        lines += [("L-MCH", com), ("L-ORG-COM", -ht)]
        if tax: lines.append(("L-ORG-TVA", -tax))
    assert sum(a for _, a in lines) == 0
    return lines

def offline_sync_lines(amount, paid_balance, commission_bps, tax_bps, promo_balance=0, promo_first=True):
    """Vente hors ligne synchronisée : le commerçant est garanti, la part couverte est répartie entre crédits
    offerts et payés selon spend_order, la part non couverte va au compte d'attente."""
    covered = min(amount, max(paid_balance, 0) + max(promo_balance, 0))
    from_promo = min(covered, promo_balance) if promo_first else max(0, covered - paid_balance)
    lines = [("L-WAL-X", from_promo), ("L-WAL-P", covered - from_promo)]
    if amount - covered: lines.append(("S-ATTENTE", amount - covered))
    lines.append(("L-MCH", -amount))
    com = fee(amount, commission_bps)
    ht, tax = split_tax(com, tax_bps)
    lines += [("L-MCH", com), ("L-ORG-COM", -ht), ("L-ORG-TVA", -tax)]
    assert sum(a for _, a in lines) == 0
    return [l for l in lines if l[1]]

# ---------------------------------------------------------------- table de cas (normative)
CASES = [
    # (n°, description, calcul, attendu)
    (1, "Commission 12 % sur vente de 6 000 XOF, TVA 18 %", lambda: split_tax(fee(6000, 1200), 1800), (610, 110)),
    (2, "Frais d'activation 5 x 1 000 XOF TTC, TVA 18 %", lambda: split_tax(5000, 1800), (4237, 763)),
    (3, "Frais PSP Wave 1 % sur 20 000 XOF", lambda: fee(20000, 100), 200),
    (4, "Frais PSP Orange Money 1,5 % sur 15 000 XOF", lambda: fee(15000, 150), 225),
    (5, "Demi exact : 10 % de 1 005 XOF = 100,5 -> 101", lambda: fee(1005, 1000), 101),
    (6, "Demi négatif : -100,5 -> -101 (symétrique)", lambda: div_round(-1005 * 1000, 10_000), -101),
    (7, "Commission 12 % sur 9,99 EUR (999 centimes), TVA 20 %", lambda: split_tax(fee(999, 1200), 2000), (100, 20)),
    (8, "Frais bornés : 3 % de 1 000 avec minimum 100", lambda: fee(1000, 300, min_amount=100), 100),
    (9, "Frais bornés : 3 % de 1 000 000 avec maximum 20 000", lambda: fee(1_000_000, 300, max_amount=20_000), 20_000),
    (10, "Taxe à 0 % : tout en HT", lambda: split_tax(720, 0), (720, 0)),
    (11, "Casse 20 000 XOF, organisateur 80 % (8 000 bps)", lambda: split_share(20_000, 8000), (16_000, 4_000)),
    (12, "Casse 999 XOF, organisateur 33,33 % : le reste au prestataire", lambda: split_share(999, 3333), (333, 666)),
    (13, "Vente 1 000 avec 400 offerts + 5 000 payés, offerts d'abord, sans commission (taux 0)",
         lambda: purchase_lines(1000, 400, 5000, 0, 1800), [("L-WAL-X", 400), ("L-WAL-P", 600), ("L-MCH", -1000)]),
    (14, "Vente hors ligne 9 000, solde 6 000, commission 12 %, TVA 18 %",
         lambda: offline_sync_lines(9000, 6000, 1200, 1800),
         [("L-WAL-P", 6000), ("S-ATTENTE", 3000), ("L-MCH", -9000), ("L-MCH", 1080), ("L-ORG-COM", -915), ("L-ORG-TVA", -165)]),
    (15, "Frais du prestataire 3 % sur recharges payées 100 000 (une seule fois, sur le total)", lambda: fee(100_000, 300), 3000),
    (16, "Redevance plateforme 20 % des frais HT du prestataire 5 085, TVA 18 %",
         lambda: split_tax(fee(5085, 2000), 1800), (862, 155)),
    (18, "Deux droits de place 15 000 + 10 000 TTC dans une transaction, TVA 18 % : taxe extraite une fois sur la somme",
         lambda: split_tax(15000 + 10000, 1800), (21186, 3814)),
    (19, "Vente hors ligne 9 000, 2 000 offerts + 5 000 payés, offerts d'abord, sans commission",
         lambda: offline_sync_lines(9000, 5000, 0, 1800, promo_balance=2000),
         [("L-WAL-X", 2000), ("L-WAL-P", 5000), ("S-ATTENTE", 2000), ("L-MCH", -9000)]),
]

def expect_error(fn, code):
    try: fn()
    except ValueError as e: return str(e) == code
    return False

if __name__ == "__main__":
    for n, desc, calc, exp in CASES:
        got = calc()
        assert got == exp, (n, desc, got, exp)
    assert expect_error(lambda: purchase_lines(7000, 400, 5000, 1200, 1800), "INSUFFICIENT_FUNDS")
    print(f"{len(CASES) + 1} cas OK")
