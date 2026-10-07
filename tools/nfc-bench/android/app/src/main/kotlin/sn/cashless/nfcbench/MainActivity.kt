package sn.cashless.nfcbench

// ⚠ NON TESTÉ SUR APPAREIL.
// Le « plugin » est intégré à l'application (pas de paquet Flutter séparé) : plus simple pour un
// banc ; il peut être extrait plus tard en plugin Flutter (FlutterPlugin + ActivityAware).

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var bench: NfcBenchChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        bench = NfcBenchChannel(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onResume() {
        super.onResume()
        bench?.onResume()
    }

    override fun onPause() {
        bench?.onPause()
        super.onPause()
    }
}
