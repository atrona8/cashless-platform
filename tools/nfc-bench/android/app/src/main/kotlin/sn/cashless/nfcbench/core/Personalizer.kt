package sn.cashless.nfcbench.core

import java.security.SecureRandom

/*
 * Personalizer : prépare des bracelets DE TEST pour le banc (pages 4–10, PWD, PACK, ACCESS, AUTH0).
 *
 * ⚠⚠⚠ AVERTISSEMENT ⚠⚠⚠
 * Une fois AUTH0 = 5 et PROT = 1 écrits, toute relecture/réécriture des pages ≥ 5 ET des pages de
 * configuration exige le PWD. Si le PWD écrit est perdu (UID/key_index/opérateur/clé de test
 * oubliés, table non sauvegardée, écriture interrompue au mauvais moment), le bracelet est
 * DÉFINITIVEMENT inutilisable pour le banc : il n'existe aucune commande de remise à zéro.
 * Le banc refuse donc : AUTH0 autre que 5 ou 0xFF, AUTHLIM ≠ 0 (blocage après N échecs), et
 * n'écrit JAMAIS CFGLCK (verrou définitif) ni les octets de verrouillage (page 2).
 *
 * Ordre d'écriture (une interruption ne doit jamais laisser une puce protégée par un PWD inconnu) :
 *   1. données 4–10  2. PWD (0x12)  3. PACK (0x13)  4. CFG1/ACCESS (0x11)  5. CFG0/AUTH0 (0x10) EN DERNIER
 * Tant que AUTH0 vaut 0xFF, PROT n'a aucun effet : une coupure avant l'étape 5 laisse la puce ouverte.
 */

class PersonalizeRequest(
    val major: Int = 1,
    val minor: Int = 0,
    val keyIndex: Int = 1,
    /** null = identité aléatoire (SecureRandom). */
    val identity: ByteArray? = null,
    val flags: Int = 0,
    /** Lot « hors format » : CRC volontairement faux. */
    val corruptCrc: Boolean = false,
    /** false = bracelet NON protégé (AUTH0 = 0xFF, PROT = 0) — lot « non personnalisé ». */
    val protect: Boolean = true,
    /** PWD actuel si le bracelet est déjà protégé (re-personnalisation). */
    val currentPwd: ByteArray? = null,
)

class PersonalizeResult(
    val ok: Boolean,
    val uid: ByteArray,
    val log: List<String>,
    val written: ByteArray? = null,
    val pwdPack: PwdPack? = null,
    val error: String? = null,
) {
    fun toMap(): Map<String, Any?> = linkedMapOf(
        "ok" to ok, "uid" to uid.toHex(), "log" to log, "pages_4_10" to written?.toHex(),
        "pwd" to pwdPack?.pwd?.toHex(), "pack" to pwdPack?.pack?.toHex(), "error" to error,
    )
}

class Personalizer(
    private val provider: PwdPackProvider,
    private val random: SecureRandom = SecureRandom(),
) {
    companion object {
        const val AUTH0_PROTECTED = 5
        const val AUTH0_OPEN = 0xFF

        /** Plan d'écritures ordonné (page, 4 octets) — miroir de ev1_format.personalization_writes. */
        fun plan(
            formatB: ByteArray, pwd: ByteArray, pack: ByteArray, cfg0: ByteArray, cfg1: ByteArray,
            auth0: Int = AUTH0_PROTECTED, prot: Boolean = true, authlim: Int = 0,
        ): List<Pair<Int, ByteArray>> {
            require(formatB.size == FormatB.LEN) { "format B : 28 octets" }
            require(auth0 == AUTH0_PROTECTED || auth0 == AUTH0_OPEN) { "banc : AUTH0 limité à 5 ou 0xFF" }
            require(authlim == 0) { "banc : AUTHLIM doit rester 0" }
            require(pwd.size == 4)
            val out = ArrayList<Pair<Int, ByteArray>>()
            for (i in 0 until 7) out += (Ev1.PAGE_HEADER + i) to formatB.copyOfRange(4 * i, 4 * i + 4)
            out += Ev1.PAGE_PWD to pwd.copyOf()
            out += Ev1.PAGE_PACK to Ev1.packPage(pack)
            out += Ev1.PAGE_CFG1 to Ev1.cfg1WithAccess(cfg1, prot, authlim)
            out += Ev1.PAGE_CFG0 to Ev1.cfg0WithAuth0(cfg0, auth0)
            return out
        }
    }

    private class Stop(msg: String) : Exception(msg)

    fun personalize(uid: ByteArray, t: Transceiver, req: PersonalizeRequest): PersonalizeResult {
        val log = ArrayList<String>()
        val r = Ev1Reader(t)
        return try {
            t.connect()
            val v = r.getVersion()
            log += "GET_VERSION ${v.toHex()}"
            if (!Ev1.isMf0ul11(v)) throw Stop("puce non MF0UL11 : refus")

            if (req.currentPwd != null) {
                val p = r.pwdAuth(req.currentPwd)
                log += "PWD_AUTH (PWD actuel) OK, PACK ${p.toHex()}"
            }
            val cfg = try {
                r.read(Ev1.PAGE_CFG0) // pages 0x10..0x13 (PWD et PACK relus à 0)
            } catch (e: Ev1Exception) {
                throw Stop("lecture configuration refusée (${e.message}) : bracelet déjà protégé ? fournir le PWD actuel")
            }
            val cfg0 = cfg.copyOfRange(0, 4)
            val cfg1 = cfg.copyOfRange(4, 8)
            log += "CFG0 ${cfg0.toHex()} CFG1 ${cfg1.toHex()}"
            if ((cfg1[0].toInt() and Ev1.ACCESS_CFGLCK) != 0) throw Stop("CFGLCK posé : configuration figée, refus")

            val identity = req.identity ?: ByteArray(16).also { random.nextBytes(it) }
            val data = FormatB.build(req.major, req.minor, req.keyIndex, identity, req.flags, corruptCrc = req.corruptCrc)
            val keys = provider.lookup(uid, Header(req.major, req.minor, req.keyIndex))
                ?: throw Stop("aucun PWD/PACK de test pour cet UID / key_index")

            val steps = plan(
                data, keys.pwd, keys.pack, cfg0, cfg1,
                auth0 = if (req.protect) AUTH0_PROTECTED else AUTH0_OPEN, prot = req.protect,
            )
            for ((page, bytes) in steps) {
                r.write(page, bytes)
                log += "WRITE 0x%02X ← %s".format(page, if (page == Ev1.PAGE_PWD) "********" else bytes.toHex())
            }

            // Vérifications. Sur un bracelet vierge (sans PWD actuel), l'écriture d'AUTH0 = 5 rend
            // IMMÉDIATEMENT les pages ≥ 5 illisibles sans authentification : il faut donc
            // s'authentifier avec le NOUVEAU PWD avant de relire (ce qui vérifie aussi PWD/PACK).
            if (req.protect) {
                val pack = r.pwdAuth(keys.pwd)
                if (!pack.contentEquals(keys.pack)) throw Stop("PACK relu ${pack.toHex()} ≠ ${keys.pack.toHex()}")
                log += "PWD_AUTH (nouveau PWD) OK"
            }
            val back = r.fastRead(Ev1.PAGE_HEADER, Ev1.PAGE_BODY_LAST)
            if (!back.contentEquals(data)) throw Stop("relecture 4–10 différente : ${back.toHex()}")
            log += "relecture 4–10 OK"
            PersonalizeResult(true, uid, log, data, keys)
        } catch (e: Stop) {
            PersonalizeResult(false, uid, log, error = e.message)
        } catch (e: Ev1Exception) {
            PersonalizeResult(false, uid, log, error = "${e.kind} ${e.message} — ÉTAT DE LA PUCE INCERTAIN, relire avant réutilisation")
        } catch (e: Exception) {
            PersonalizeResult(false, uid, log, error = e.toString())
        } finally {
            t.close()
        }
    }

    /**
     * Retire la protection (AUTH0 = 0xFF d'abord, puis PROT = 0) pour recycler un bracelet de test.
     * Le PWD reste écrit (il est sans effet tant que AUTH0 = 0xFF).
     */
    fun unprotect(uid: ByteArray, t: Transceiver, pwd: ByteArray): PersonalizeResult {
        val log = ArrayList<String>()
        val r = Ev1Reader(t)
        return try {
            t.connect()
            if (!Ev1.isMf0ul11(r.getVersion())) throw Stop("puce non MF0UL11")
            r.pwdAuth(pwd)
            log += "PWD_AUTH OK"
            val cfg = r.read(Ev1.PAGE_CFG0)
            r.write(Ev1.PAGE_CFG0, Ev1.cfg0WithAuth0(cfg.copyOfRange(0, 4), AUTH0_OPEN))
            log += "AUTH0 ← 0xFF"
            r.write(Ev1.PAGE_CFG1, Ev1.cfg1WithAccess(cfg.copyOfRange(4, 8), prot = false, authlim = 0))
            log += "PROT ← 0"
            PersonalizeResult(true, uid, log)
        } catch (e: Stop) {
            PersonalizeResult(false, uid, log, error = e.message)
        } catch (e: Exception) {
            PersonalizeResult(false, uid, log, error = e.message ?: e.toString())
        } finally {
            t.close()
        }
    }
}
