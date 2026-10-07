// Banc de mesure NFC — écran unique.
//
// ⚠ NON TESTÉ SUR APPAREIL — écrit sans SDK Flutter à disposition. À compiler et relire
// (`flutter analyze`) avant la première campagne.

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'nfc_bench.dart';

void main() => runApp(const BenchApp());

/// Conditions du protocole terrain (PROTOCOLE_TERRAIN.md §4).
const kConditions = <String>[
  'C0-table', 'C1-poignet', 'C2-rapide', 'C3-distance-orientation', 'C4-coque',
  'C5-batterie-basse', 'C6-chaleur', 'C7-sueur', 'C8-foule', 'C9-deux-bracelets',
  'C10-lots-speciaux', 'C11-presence-check',
];

class BenchApp extends StatelessWidget {
  const BenchApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Banc NFC cashless',
        theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
        home: const BenchPage(),
      );
}

class BenchPage extends StatefulWidget {
  const BenchPage({super.key});

  @override
  State<BenchPage> createState() => _BenchPageState();
}

class _BenchPageState extends State<BenchPage> {
  final _nfc = NfcBench();
  final _phone = TextEditingController();
  final _lot = TextEditingController(text: 'V1'); // préfixe V = valides, X = hors format, K = clones
  final _note = TextEditingController();
  final _presence = TextEditingController(); // vide = défaut plate-forme
  final _pwd = TextEditingController(); // PWD actuel / PWD pour « unprotect »

  final List<Map<String, Object?>> _rows = [];
  StreamSubscription<Map<String, Object?>>? _sub;
  Map<String, Object?> _device = const {};
  String _condition = kConditions[1];
  BenchMode _mode = BenchMode.bench;
  bool _running = false;
  bool _readSig = false;
  bool _dwell = false;
  bool _corruptCrc = false;
  bool _protect = true;
  int _ok = 0;
  int _ko = 0;
  Map<String, Object?>? _last;
  late String _sessionId;

  @override
  void initState() {
    super.initState();
    _sessionId = DateTime.now().toUtc().toIso8601String().replaceAll(RegExp('[-:.]'), '');
    _init();
  }

  Future<void> _init() async {
    try {
      final avail = await _nfc.isAvailable();
      final dev = await _nfc.deviceInfo();
      setState(() {
        _device = dev;
        if (_phone.text.isEmpty) _phone.text = '${dev['manufacturer']} ${dev['model']}';
      });
      if (avail['available'] != true || avail['enabled'] != true) {
        _snack('NFC absent ou désactivé sur ce téléphone');
      }
    } on PlatformException catch (e) {
      _snack('Canal NFC indisponible : ${e.message}');
    }
    _sub = _nfc.events.listen(_onEvent);
  }

  void _onEvent(Map<String, Object?> e) {
    final row = <String, Object?>{
      'session_id': _sessionId,
      'phone_label': _phone.text,
      'manufacturer': _device['manufacturer'],
      'model': _device['model'],
      'sdk': _device['sdk'],
      'condition': _condition,
      'lot': _lot.text,
      'note': _note.text,
      ...e,
    };
    final good = e['outcome'] == 'OK' || e['ok'] == true;
    good ? HapticFeedback.lightImpact() : HapticFeedback.vibrate();
    setState(() {
      _rows.add(row);
      _last = row;
      good ? _ok++ : _ko++;
    });
  }

  Future<void> _toggle() async {
    if (_running) {
      await _nfc.stop();
      setState(() => _running = false);
      return;
    }
    if (_mode != BenchMode.bench && !await _confirmWrite()) return;
    final cfg = BenchConfig(
      mode: _mode,
      presenceCheckDelayMs: int.tryParse(_presence.text),
      readSignature: _readSig,
      measureDwell: _dwell,
      personalize: PersonalizeParams(
        corruptCrc: _corruptCrc,
        protect: _protect,
        currentPwdHex: _pwd.text.trim().isEmpty ? null : _pwd.text.trim(),
      ),
      unprotectPwdHex: _pwd.text.trim().isEmpty ? null : _pwd.text.trim(),
    );
    try {
      await _nfc.start(cfg);
      setState(() => _running = true);
    } on PlatformException catch (e) {
      _snack('Démarrage impossible : ${e.message}');
    }
  }

  Future<bool> _confirmWrite() async {
    final r = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('⚠ Écriture sur les bracelets'),
        content: const Text(
          'Ce mode ÉCRIT dans chaque bracelet présenté (pages 4–10, PWD, PACK, ACCESS, AUTH0).\n\n'
          'Un PWD perdu ou une écriture interrompue au mauvais moment peut rendre le bracelet '
          'DÉFINITIVEMENT inutilisable pour le banc. Exportez le CSV (UID, PWD, PACK) après chaque '
          'lot et tenez le bracelet immobile jusqu\'au retour haptique.\n\n'
          'N\'utilisez QUE des bracelets de test.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Je comprends')),
        ],
      ),
    );
    return r ?? false;
  }

  Future<void> _export() async {
    if (_rows.isEmpty) {
      _snack('Aucune mesure');
      return;
    }
    final dir = await getApplicationDocumentsDirectory();
    final safe = _phone.text.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_');
    final f = File('${dir.path}/nfc_bench_${safe}_$_sessionId.csv');
    await f.writeAsString(toCsv(_rows));
    await Share.shareXFiles([XFile(f.path, mimeType: 'text/csv')], subject: f.uri.pathSegments.last);
  }

  Future<void> _reset() async {
    await _nfc.resetSession();
    setState(() {
      _rows.clear();
      _ok = 0;
      _ko = 0;
      _last = null;
    });
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  void dispose() {
    _sub?.cancel();
    _nfc.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = _last;
    return Scaffold(
      appBar: AppBar(title: const Text('Banc NFC — non validé sur appareil')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Téléphone / modèle (ex. P2-Galaxy-A15)')),
          DropdownButtonFormField<String>(
            value: _condition,
            decoration: const InputDecoration(labelText: 'Condition'),
            items: [for (final c in kConditions) DropdownMenuItem(value: c, child: Text(c))],
            onChanged: (v) => setState(() => _condition = v!),
          ),
          TextField(controller: _lot, decoration: const InputDecoration(labelText: 'Lot (V… valides, X… hors format, K… clones)')),
          TextField(controller: _note, decoration: const InputDecoration(labelText: 'Note (T°, batterie %, coque…)')),
          TextField(
            controller: _presence,
            enabled: !_running,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Presence-check delay (ms, vide = défaut)'),
          ),
          const SizedBox(height: 8),
          SegmentedButton<BenchMode>(
            segments: const [
              ButtonSegment(value: BenchMode.bench, label: Text('Mesure')),
              ButtonSegment(value: BenchMode.personalize, label: Text('Personnaliser')),
              ButtonSegment(value: BenchMode.unprotect, label: Text('Déprotéger')),
            ],
            selected: {_mode},
            onSelectionChanged: _running ? null : (s) => setState(() => _mode = s.first),
          ),
          if (_mode == BenchMode.bench) ...[
            SwitchListTile(title: const Text('READ_SIG (étape 8)'), value: _readSig, onChanged: _running ? null : (v) => setState(() => _readSig = v)),
            SwitchListTile(title: const Text('Mesurer le temps jusqu\'au retrait'), value: _dwell, onChanged: _running ? null : (v) => setState(() => _dwell = v)),
          ],
          if (_mode == BenchMode.personalize) ...[
            SwitchListTile(title: const Text('Protéger (AUTH0=5, PROT=1)'), value: _protect, onChanged: _running ? null : (v) => setState(() => _protect = v)),
            SwitchListTile(title: const Text('CRC volontairement faux (lot hors format)'), value: _corruptCrc, onChanged: _running ? null : (v) => setState(() => _corruptCrc = v)),
          ],
          if (_mode != BenchMode.bench)
            TextField(controller: _pwd, enabled: !_running, decoration: const InputDecoration(labelText: 'PWD actuel (hex, 8 car.) si déjà protégé')),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _toggle,
            icon: Icon(_running ? Icons.stop : Icons.nfc),
            label: Text(_running ? 'Arrêter' : 'Démarrer'),
          ),
          const SizedBox(height: 12),
          Text('Événements : ${_rows.length}   OK : $_ok   Échecs : $_ko', style: Theme.of(context).textTheme.titleMedium),
          if (last != null) _LastCard(last),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _export, icon: const Icon(Icons.ios_share), label: const Text('Exporter CSV'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: _running ? null : _reset, icon: const Icon(Icons.restart_alt), label: const Text('Nouvelle session'))),
          ]),
        ],
      ),
    );
  }
}

class _LastCard extends StatelessWidget {
  final Map<String, Object?> r;
  const _LastCard(this.r);

  String _ms(Object? v) => v is num ? v.toStringAsFixed(1) : '–';

  @override
  Widget build(BuildContext context) {
    const steps = ['connect', 'get_version', 'read_header', 'pwd_lookup', 'pwd_auth', 'read_body', 'check_crc', 'incr_cnt', 'read_cnt', 'read_sig', 'hash'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${r['type']} — ${r['outcome'] ?? (r['ok'] == true ? 'OK' : 'ÉCHEC')}   total ${_ms(r['total_ms'])} ms',
              style: Theme.of(context).textTheme.titleMedium),
          Text('UID ${r['uid']}  compteur ${r['counter'] ?? '–'}  tentative ${r['attempt'] ?? '–'}'),
          if (r['error'] != null) Text('Erreur : ${r['error']}', style: const TextStyle(color: Colors.red)),
          if (r['type'] == 'tap')
            Wrap(spacing: 12, children: [for (final s in steps) if (r['t_${s}_ms'] != null) Text('$s ${_ms(r['t_${s}_ms'])}')]),
          if (r['dwell_ms'] != null) Text('Présence après résultat : ${_ms(r['dwell_ms'])} ms'),
        ]),
      ),
    );
  }
}
