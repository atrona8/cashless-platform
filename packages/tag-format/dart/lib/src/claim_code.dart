// Code de rattachement imprimé sur un bracelet (SPECIFICATION §7.8, ADR-36, ADR-56) : 10 caractères d'un alphabet de
// 32 sans ambiguïté (ni 0, 1, I, O), soit 50 bits, affichés en deux groupes (`K7QM-4XH9RT`).
import 'errors.dart';

const String claimCodeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const int claimCodeLength = 10;

/// Tire un code à partir de 10 octets aléatoires (`Random.secure()` en production). Chaque caractère prend les 5 bits
/// de poids faible d'un octet : 256 est un multiple de 32, le tirage est donc sans biais et sans rejet.
String generateClaimCode(List<int> randomBytes) {
  if (randomBytes.length != claimCodeLength) {
    throw TagFormatException(
      'BAD_LENGTH',
      'source d’aléa : 10 octets attendus',
    );
  }
  return String.fromCharCodes(
    randomBytes.map((byte) => claimCodeAlphabet.codeUnitAt(byte & 0x1F)),
  );
}

/// Saisie → 10 caractères : retire tirets et espaces, met en majuscules, refuse tout le reste.
String normalizeClaimCode(String input) {
  final code = input.replaceAll(RegExp(r'[\s-]'), '').toUpperCase();
  if (code.length != claimCodeLength) {
    throw TagFormatException(
      'BAD_CLAIM_CODE',
      'code de rattachement : 10 caractères attendus',
    );
  }
  for (final rune in code.runes) {
    if (!claimCodeAlphabet.contains(String.fromCharCode(rune))) {
      throw TagFormatException(
        'BAD_CLAIM_CODE',
        'code de rattachement : caractère non permis',
      );
    }
  }
  return code;
}

String formatClaimCode(String code) {
  final normalized = normalizeClaimCode(code);
  return '${normalized.substring(0, 4)}-${normalized.substring(4)}';
}

/// Contenu du QR imprimé : `https://<domaine>/c/<code>`.
String claimCodeUrl(String domain, String code) =>
    'https://$domain/c/${normalizeClaimCode(code)}';
