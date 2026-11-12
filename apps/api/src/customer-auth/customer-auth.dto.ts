// Corps des trois routes `/customer-auth/*` (contrat `requestCustomerOtp`, `exchangeCustomerOtp`, `refreshCustomerToken`).
import { ProblemException } from '../errors/problem';
import type { OtpChannel } from './otp-sender';

const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const PHONE = /^\+[1-9][0-9]{6,14}$/;
const CODE = /^[0-9]{6}$/;

function body(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON attendu.');
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  return raw as Record<string, unknown>;
}

function text(value: Record<string, unknown>, name: string, max: number): string {
  const field = value[name];
  if (typeof field !== 'string' || field.length === 0 || field.length > max)
    throw invalid(`${name} : texte de 1 à ${max} caractères attendu.`);
  return field;
}

export function parseOtpRequest(raw: unknown): {
  phone: string;
  operatorCode: string;
  channel: OtpChannel;
} {
  const value = body(raw, ['phone', 'operator_code', 'channel']);
  const phone = text(value, 'phone', 16);
  if (!PHONE.test(phone)) throw invalid('phone : numéro au format E.164 attendu.');
  const operatorCode = text(value, 'operator_code', 64);
  const channel = value.channel ?? 'AUTO';
  if (channel !== 'AUTO' && channel !== 'SMS' && channel !== 'WHATSAPP')
    throw invalid('channel : AUTO, SMS ou WHATSAPP attendu.');
  return { phone, operatorCode, channel };
}

export function parseOtpExchange(raw: unknown): { requestId: string; code: string } {
  const value = body(raw, ['otp_request_id', 'code']);
  const requestId = text(value, 'otp_request_id', 64);
  const code = text(value, 'code', 6);
  if (!CODE.test(code)) throw invalid('code : 6 chiffres attendus.');
  return { requestId, code };
}

export function parseRefresh(raw: unknown): { refreshToken: string } {
  const value = body(raw, ['refresh_token']);
  return { refreshToken: text(value, 'refresh_token', 2048) };
}
