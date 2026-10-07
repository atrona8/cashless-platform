// Wrapper Dart du canal plate-forme « cashless/nfc_bench ».
//
// ⚠ NON TESTÉ SUR APPAREIL — écrit sans SDK Flutter à disposition (ni analyse statique, ni
// exécution). Relire `flutter analyze` au premier build.

import 'dart:async';

import 'package:flutter/services.dart';

/// Mode de fonctionnement du lecteur.
enum BenchMode { bench, personalize, unprotect }

/// Paramètres de personnalisation (mode `personalize`).
class PersonalizeParams {
  final int major;
  final int minor;
  final int keyIndex;
  final int flags;
  final bool corruptCrc; // lot « hors format » : CRC volontairement faux
  final bool protect; // false = AUTH0 0xFF / PROT 0 (lot « non protégé »)
  final String? currentPwdHex; // si le bracelet est déjà protégé

  const PersonalizeParams({
    this.major = 1,
    this.minor = 0,
    this.keyIndex = 1,
    this.flags = 0,
    this.corruptCrc = false,
    this.protect = true,
    this.currentPwdHex,
  });

  Map<String, Object?> toMap() => {
        'major': major,
        'minor': minor,
        'keyIndex': keyIndex,
        'flags': flags,
        'corruptCrc': corruptCrc,
        'protect': protect,
        'currentPwdHex': currentPwdHex,
      };
}

class BenchConfig {
  final BenchMode mode;

  /// EXTRA_READER_PRESENCE_CHECK_DELAY (ms). null = valeur par défaut de la plate-forme.
  final int? presenceCheckDelayMs;

  /// NfcA.setTimeout (ms). null = valeur par défaut.
  final int? transceiveTimeoutMs;
  final bool readSignature;
  final bool measureDwell;
  final bool incrementCounter;

  /// "FAST_READ_4" (recommandé) ou "READ_4".
  final String headerRead;

  /// Source PWD/PACK : par défaut dérivation avec la clé maître DE TEST.
  /// Autres formes : {'type':'table','table':{uidHex: pwdHex+packHex}}
  ///                 {'type':'blob','dekHex':..,'blobs':{uidHex:{mediaId,keyIndex,blobHex}}}
  final Map<String, Object?> provider;
  final PersonalizeParams personalize;
  final String? unprotectPwdHex;

  const BenchConfig({
    this.mode = BenchMode.bench,
    this.presenceCheckDelayMs,
    this.transceiveTimeoutMs,
    this.readSignature = false,
    this.measureDwell = false,
    this.incrementCounter = true,
    this.headerRead = 'FAST_READ_4',
    this.provider = const {'type': 'kdf_test'},
    this.personalize = const PersonalizeParams(),
    this.unprotectPwdHex,
  });

  Map<String, Object?> toMap() => {
        'mode': mode.name,
        'presenceCheckDelayMs': presenceCheckDelayMs,
        'transceiveTimeoutMs': transceiveTimeoutMs,
        'readSignature': readSignature,
        'measureDwell': measureDwell,
        'incrementCounter': incrementCounter,
        'headerRead': headerRead,
        'provider': provider,
        'personalize': personalize.toMap(),
        'unprotectPwdHex': unprotectPwdHex,
      };
}

class NfcBench {
  static const MethodChannel _methods = MethodChannel('cashless/nfc_bench');
  static const EventChannel _events = EventChannel('cashless/nfc_bench/events');

  Stream<Map<String, Object?>>? _stream;

  /// Un événement par bracelet présenté : `type` = tap | personalize | unprotect | error.
  /// Clés d'un `tap` : voir TapResult.toMap() côté Kotlin (uid, outcome, t_*_ms, total_ms…).
  Stream<Map<String, Object?>> get events => _stream ??= _events
      .receiveBroadcastStream()
      .map((e) => Map<String, Object?>.from(e as Map));

  Future<Map<String, Object?>> isAvailable() async =>
      Map<String, Object?>.from(await _methods.invokeMethod('isAvailable') as Map);

  Future<Map<String, Object?>> deviceInfo() async =>
      Map<String, Object?>.from(await _methods.invokeMethod('deviceInfo') as Map);

  Future<void> start(BenchConfig config) => _methods.invokeMethod('start', config.toMap());

  Future<void> stop() => _methods.invokeMethod('stop');

  Future<void> resetSession() => _methods.invokeMethod('resetSession');

  /// Pré-charge un compteur « déjà vu » pour un UID (simulation de clone).
  Future<void> seedCounter(String uidHex, int value) =>
      _methods.invokeMethod('seedCounter', {'uid': uidHex, 'value': value});
}

/// Colonnes du CSV de mesures — format de référence décrit dans PROTOCOLE_TERRAIN.md.
const List<String> kCsvColumns = [
  // contexte de session (saisi dans l'écran)
  'session_id', 'phone_label', 'manufacturer', 'model', 'sdk', 'condition', 'lot', 'note',
  // événement
  'type', 'seq', 'wall_ms', 'uid', 'atqa', 'sak', 'techs', 'presence_delay_ms',
  'transceive_timeout_ms', 'outcome', 'failed_step', 'error_kind', 'nak_code',
  'tag_present_after_error', 'gesture_id', 'attempt', 'major', 'minor', 'key_index', 'counter',
  'token_hash',
  // chronométrages (ms)
  'total_ms', 't_connect_ms', 't_get_version_ms', 't_read_header_ms', 't_pwd_lookup_ms',
  't_pwd_auth_ms', 't_read_body_ms', 't_check_crc_ms', 't_incr_cnt_ms', 't_read_cnt_ms',
  't_read_sig_ms', 't_hash_ms', 'dwell_ms',
  // personnalisation
  'ok', 'pages_4_10', 'pwd', 'pack', 'version', 'error',
];

String _csvCell(Object? v) {
  if (v == null) return '';
  final s = v is double ? v.toStringAsFixed(3) : v.toString();
  if (s.contains(RegExp('[",\n\r]'))) return '"${s.replaceAll('"', '""')}"';
  return s;
}

String toCsv(List<Map<String, Object?>> rows) {
  final b = StringBuffer()..writeln(kCsvColumns.join(','));
  for (final r in rows) {
    b.writeln(kCsvColumns.map((c) => _csvCell(r[c])).join(','));
  }
  return b.toString();
}
