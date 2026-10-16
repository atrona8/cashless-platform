// Code de rattachement : alphabet, tirage, normalisation de la saisie (SPECIFICATION §7.8).
import 'package:cashless_tag_format/cashless_tag_format.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  final c = vectors['claim_code'] as Map<String, dynamic>;
  final refusals =
      (vectors['refusals'] as Map<String, dynamic>)['claim_code']
          as List<dynamic>;

  test('alphabet de 32 caractères sans 0, 1, I ni O', () {
    expect(claimCodeAlphabet, c['alphabet']);
    expect(claimCodeAlphabet.split('').toSet().length, 32);
    expect(RegExp('[01IO]').hasMatch(claimCodeAlphabet), isFalse);
  });

  for (final sample
      in (c['inputs'] as List<dynamic>).cast<Map<String, dynamic>>()) {
    test('normalise « ${sample['input']} »', () {
      expect(
        normalizeClaimCode(sample['input'] as String),
        sample['normalized'],
      );
      expect(formatClaimCode(sample['input'] as String), sample['formatted']);
    });
  }

  for (final input in refusals.cast<String>()) {
    test('refuse « $input »', () {
      expect(codeOf(() => normalizeClaimCode(input)), 'BAD_CLAIM_CODE');
    });
  }

  test(
    'le tirage ne dépend que des 5 bits de poids faible de chaque octet',
    () {
      expect(generateClaimCode(List.filled(10, 0)), '2222222222');
      expect(generateClaimCode(List.filled(10, 0xff)), 'ZZZZZZZZZZ');
      expect(generateClaimCode(List.filled(10, 0x20)), '2222222222');
      expect(codeOf(() => generateClaimCode(List.filled(9, 0))), 'BAD_LENGTH');
    },
  );

  test('URL du QR imprimé', () {
    expect(
      claimCodeUrl('pay.example', 'k7qm-4xh9rt'),
      'https://pay.example/c/K7QM4XH9RT',
    );
  });
}
