package sn.cashless.nfcbench

// ⚠ NON TESTÉ SUR APPAREIL — écrit sans SDK Android / Flutter ni téléphone à disposition.
// Seule la logique de sn.cashless.nfcbench.core est couverte par des tests (JVM).

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import sn.cashless.nfcbench.core.EncryptedBlobProvider
import sn.cashless.nfcbench.core.HeaderRead
import sn.cashless.nfcbench.core.PersonalizeRequest
import sn.cashless.nfcbench.core.Personalizer
import sn.cashless.nfcbench.core.PwdPack
import sn.cashless.nfcbench.core.PwdPackProvider
import sn.cashless.nfcbench.core.TapBenchmark
import sn.cashless.nfcbench.core.TapConfig
import sn.cashless.nfcbench.core.TestKdfProvider
import sn.cashless.nfcbench.core.TestTableProvider
import sn.cashless.nfcbench.core.hex
import sn.cashless.nfcbench.core.toHex
import java.util.UUID

/**
 * Canal plate-forme du banc.
 *
 * MethodChannel « cashless/nfc_bench » :
 *   isAvailable            → {available, enabled}
 *   deviceInfo             → {manufacturer, model, device, sdk, release}
 *   start(args)            → démarre le reader mode (mode bench | personalize | unprotect)
 *   stop                   → arrête le reader mode
 *   resetSession           → remet à zéro numéros de tap / gestes / compteurs vus
 *   seedCounter{uid,value} → pré-charge un compteur « déjà vu » (test de clone)
 * EventChannel « cashless/nfc_bench/events » : une Map par tag présenté (type = tap | personalize
 * | unprotect | error).
 *
 * Arguments de start (tous optionnels) :
 *   mode: "bench" | "personalize" | "unprotect"
 *   presenceCheckDelayMs: Int (EXTRA_READER_PRESENCE_CHECK_DELAY ; défaut plate-forme si absent)
 *   transceiveTimeoutMs: Int
 *   readSignature, measureDwell, incrementCounter: Bool ; headerRead: "FAST_READ_4" | "READ_4"
 *   provider: { type: "kdf_test" | "table" | "blob", masterKeyHex, operatorUuid,
 *               table: {uidHex: "pwdHex(8)packHex(4)"},
 *               dekHex, blobs: {uidHex: {mediaId, keyIndex, blobHex}} }
 *   personalize: { major, minor, keyIndex, flags, corruptCrc, protect, currentPwdHex }
 *   unprotectPwdHex: String (mode unprotect, provider ignoré si fourni)
 */
class NfcBenchChannel(private val activity: Activity, messenger: BinaryMessenger) :
    MethodChannel.MethodCallHandler, EventChannel.StreamHandler, NfcAdapter.ReaderCallback {

    companion object {
        const val METHODS = "cashless/nfc_bench"
        const val EVENTS = "cashless/nfc_bench/events"

        /** Clé maître DE TEST (octets 0..31) et opérateur de test — cf. vecteurs_test_bracelet.py. */
        private val TEST_MASTER_KEY = ByteArray(32) { it.toByte() }
        private val TEST_OPERATOR: UUID = UUID.fromString("00000000-0000-0000-0000-000000000002")
    }

    private val main = Handler(Looper.getMainLooper())
    private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
    private var sink: EventChannel.EventSink? = null

    private var running = false
    private var mode = "bench"
    private var presenceDelayMs: Int? = null
    private var timeoutMs: Int? = null
    private var bench: TapBenchmark? = null
    private var personalizer: Personalizer? = null
    private var personalizeReq = PersonalizeRequest()
    private var unprotectPwd: ByteArray? = null

    init {
        MethodChannel(messenger, METHODS).setMethodCallHandler(this)
        EventChannel(messenger, EVENTS).setStreamHandler(this)
    }

    // ------------------------------------------------------------------ MethodChannel

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "isAvailable" -> result.success(mapOf("available" to (adapter != null), "enabled" to (adapter?.isEnabled == true)))
                "deviceInfo" -> result.success(
                    mapOf(
                        "manufacturer" to Build.MANUFACTURER, "model" to Build.MODEL, "device" to Build.DEVICE,
                        "sdk" to Build.VERSION.SDK_INT, "release" to Build.VERSION.RELEASE,
                    ),
                )
                "start" -> {
                    configure(call.arguments as? Map<*, *> ?: emptyMap<String, Any>())
                    running = true
                    enableReaderMode()
                    result.success(true)
                }
                "stop" -> {
                    running = false
                    adapter?.disableReaderMode(activity)
                    result.success(true)
                }
                "resetSession" -> {
                    bench?.resetSession(); result.success(true)
                }
                "seedCounter" -> {
                    val uid = call.argument<String>("uid")!!.lowercase()
                    bench?.counters?.seed(uid, call.argument<Int>("value")!!)
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        } catch (e: Exception) {
            result.error("NFC_BENCH", e.message, e.toString())
        }
    }

    private fun configure(a: Map<*, *>) {
        mode = a["mode"] as? String ?: "bench"
        presenceDelayMs = (a["presenceCheckDelayMs"] as? Number)?.toInt()
        timeoutMs = (a["transceiveTimeoutMs"] as? Number)?.toInt()
        val provider = buildProvider(a["provider"] as? Map<*, *>)
        val cfg = TapConfig(
            readSignature = a["readSignature"] as? Boolean ?: false,
            headerRead = HeaderRead.valueOf(a["headerRead"] as? String ?: "FAST_READ_4"),
            incrementCounter = a["incrementCounter"] as? Boolean ?: true,
            measureDwell = a["measureDwell"] as? Boolean ?: false,
        )
        // On conserve le registre de compteurs entre deux start() de la même session.
        bench = bench?.let { old -> TapBenchmark(provider, cfg, counters = old.counters) } ?: TapBenchmark(provider, cfg)
        personalizer = Personalizer(provider)
        (a["personalize"] as? Map<*, *>)?.let { p ->
            personalizeReq = PersonalizeRequest(
                major = (p["major"] as? Number)?.toInt() ?: 1,
                minor = (p["minor"] as? Number)?.toInt() ?: 0,
                keyIndex = (p["keyIndex"] as? Number)?.toInt() ?: 1,
                flags = (p["flags"] as? Number)?.toInt() ?: 0,
                corruptCrc = p["corruptCrc"] as? Boolean ?: false,
                protect = p["protect"] as? Boolean ?: true,
                currentPwd = (p["currentPwdHex"] as? String)?.takeIf { it.isNotBlank() }?.let(::hex),
            )
        }
        unprotectPwd = (a["unprotectPwdHex"] as? String)?.takeIf { it.isNotBlank() }?.let(::hex)
    }

    private fun buildProvider(p: Map<*, *>?): PwdPackProvider {
        val type = p?.get("type") as? String ?: "kdf_test"
        val op = (p?.get("operatorUuid") as? String)?.let(UUID::fromString) ?: TEST_OPERATOR
        return when (type) {
            "kdf_test" -> TestKdfProvider((p?.get("masterKeyHex") as? String)?.let(::hex) ?: TEST_MASTER_KEY, op)
            "table" -> TestTableProvider(
                (p?.get("table") as? Map<*, *> ?: emptyMap<String, String>()).entries.associate { (k, v) ->
                    val b = hex(v as String)
                    (k as String).lowercase() to PwdPack(b.copyOfRange(0, 4), b.copyOfRange(4, 6))
                },
            )
            "blob" -> EncryptedBlobProvider(
                hex(p!!["dekHex"] as String), op,
                (p["blobs"] as? Map<*, *> ?: emptyMap<String, Any>()).entries.associate { (k, v) ->
                    val e = v as Map<*, *>
                    (k as String).lowercase() to EncryptedBlobProvider.Entry(
                        UUID.fromString(e["mediaId"] as String), (e["keyIndex"] as Number).toInt(), hex(e["blobHex"] as String),
                    )
                },
            )
            else -> throw IllegalArgumentException("provider inconnu : $type")
        }
    }

    // ------------------------------------------------------------------ reader mode

    /** À appeler depuis onResume (le reader mode exige une activité au premier plan). */
    fun onResume() {
        if (running) enableReaderMode()
    }

    /** À appeler depuis onPause. */
    fun onPause() {
        adapter?.disableReaderMode(activity)
    }

    private fun enableReaderMode() {
        val a = adapter ?: throw IllegalStateException("NFC absent sur ce téléphone")
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        val extras = Bundle()
        presenceDelayMs?.let { extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, it) }
        a.enableReaderMode(activity, this, flags, extras)
    }

    /**
     * Appelé sur un thread binder (PAS le thread UI) : on y fait tout le travail NFC de façon
     * synchrone ; le prochain tag n'est pas délivré avant le retour de cette méthode.
     */
    override fun onTagDiscovered(tag: Tag) {
        val t0 = System.nanoTime()
        val wallMs = System.currentTimeMillis()
        val uptimeMs = SystemClock.elapsedRealtime()
        val event: Map<String, Any?> = try {
            val tr = NfcATransceiver(tag, timeoutMs)
            val common = mapOf(
                "wall_ms" to wallMs, "elapsed_ms" to uptimeMs,
                "atqa" to runCatching { tr.atqa.toHex() }.getOrNull(),
                "sak" to runCatching { tr.sak }.getOrNull(),
                "techs" to tag.techList.joinToString("|") { it.substringAfterLast('.') },
                "presence_delay_ms" to presenceDelayMs, "transceive_timeout_ms" to timeoutMs,
            )
            when (mode) {
                "personalize" -> mapOf("type" to "personalize") + common +
                    personalizer!!.personalize(tag.id, tr, personalizeReq).toMap()
                "unprotect" -> {
                    val pwd = unprotectPwd ?: throw IllegalStateException("unprotectPwdHex requis")
                    mapOf("type" to "unprotect") + common + personalizer!!.unprotect(tag.id, tr, pwd).toMap()
                }
                else -> mapOf("type" to "tap") + common + bench!!.run(tag.id, tr, t0).toMap()
            }
        } catch (e: Exception) {
            mapOf("type" to "error", "uid" to tag.id?.toHex(), "wall_ms" to wallMs, "error" to e.toString())
        }
        main.post { sink?.success(event) }
    }

    // ------------------------------------------------------------------ EventChannel

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }
}
