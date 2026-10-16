/// Refus de la bibliothèque de format : un code stable, identique en TypeScript et en Dart.
class TagFormatException implements Exception {
  TagFormatException(this.code, this.message);

  /// `BAD_LENGTH`, `UNKNOWN_MAJOR`, `BAD_CRC`, `BAD_KEY_INDEX`, `BAD_IDENTITY`, `BAD_UUID`, `BAD_UID`, `BAD_KEY`,
  /// `AUTH_FAILED`, `BAD_CLAIM_CODE`.
  final String code;
  final String message;

  @override
  String toString() => 'TagFormatException($code): $message';
}

void requireLength(List<int> bytes, int length, String code, String what) {
  if (bytes.length != length) {
    throw TagFormatException(
      code,
      '$what : $length octets attendus, ${bytes.length} reçus',
    );
  }
}
