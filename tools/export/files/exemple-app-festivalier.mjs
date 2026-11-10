// Exemple de client « app festivalier » pour l'API Cashless : chaque écran de la spécification xaamga, écrit contre
// le contrat `openapi.yaml` ET contre ce que l'API partagée sert aujourd'hui. Node.js 18+ (fetch intégré), aucune
// dépendance. Données : DONNEES-DEMO.md.
//
//   node exemple-app-festivalier.mjs                       parcours sans effet durable (lectures, QR client)
//   CLAIM_CODE=SL6WM-28D6E node exemple-app-festivalier.mjs   rattache aussi ce bracelet libre à Fatou (consomme le code)
//   MERCHANT_QR='https://…/r/<id>#t=<jeton>' node …           consulte puis paie une demande QR d'un commerçant
//   API=http://localhost/v1 node …                          autre serveur
//
// AUTHENTIFICATION. Le contrat prévoit OTP → jeton (`/customer-auth/*`, `humanBearer`), mais ces routes ne sont pas
// encore servies. Sur l'API de développement, le festivalier est identifié par trois en-têtes de test (faux refusé en
// production). La classe `Session` cache cette différence : le jour où `/customer-auth/*` répond, passer
// `AUTH=bearer` sans toucher au reste du code.
/* global fetch */
import { randomUUID } from 'node:crypto';

const API = process.env.API ?? 'https://removable-thimble-uptight.ngrok-free.dev/v1';
const OPERATOR_A = 'ec04692a-229e-482b-8542-7492544766c8';
const DEMO = {
  awa: {
    customerId: 'c10e0ac3-f0ca-43fc-9b1a-8fcf53cd07ae',
    walletId: '44f1a187-a49c-4152-8f5d-8f4991cdb6c8',
  },
  fatou: { customerId: '96a58580-81a1-4d4d-b3ea-cfd78f010075' },
  ibrahima: {
    customerId: 'd22ffa2b-71ab-4b4b-929d-dbc8f80f1795',
    walletId: '3437eecc-da19-42a5-9abe-01fc864a9455',
  },
  anonymousCode: '82CFB-WJUG9',
};

// ----------------------------------------------------------------------------------------------------------------
// Transport : en-têtes communs, erreurs au format problem+json (RFC 9457), idempotence des POST.
// ----------------------------------------------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, problem) {
    super(`${status} ${problem?.code ?? ''} ${problem?.detail ?? ''}`.trim());
    this.status = status;
    this.code = problem?.code; // code stable à tester (jamais le texte, qui suit Accept-Language)
    this.problem = problem;
  }
}

/**
 * Routes déclarées au contrat mais pas encore servies (mission de l'app festivalier). Le serveur répond alors le même
 * `404 NOT_FOUND` qu'un objet inconnu : impossible de les distinguer à la réponse, d'où cette liste.
 */
export const NOT_SERVED_YET = [
  'POST /customer-auth/otp',
  'POST /customer-auth/token',
  'POST /customer-auth/refresh',
  'POST /me/media/{id}/report-lost',
  'POST /me/refund-requests',
  'GET /me/refund-requests',
  'POST /refund-requests/{id}/holder-decision',
];

async function call(method, path, { body, headers = {}, idempotencyKey } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'ngrok-skip-browser-warning': '1', // page d'interstitiel ngrok (offre gratuite)
      'X-Request-Id': randomUUID(),
      'Accept-Language': 'fr',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      // Une clé PAR OPÉRATION métier : la garder pour un nouvel essai réseau (rejeu = même réponse), jamais réutilisée
      // pour une autre opération.
      ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey ?? randomUUID() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ----------------------------------------------------------------------------------------------------------------
// 1. Session du festivalier
// ----------------------------------------------------------------------------------------------------------------

export class Session {
  /** Développement : identité par en-têtes de test (DONNEES-DEMO.md §1). */
  static testHeaders(customerId, operatorId = OPERATOR_A, deviceRef = 'exemple-node') {
    const s = new Session();
    s.authHeaders = async () => ({
      'X-Test-Customer-Id': customerId,
      'X-Test-Operator-Id': operatorId,
      'X-Test-Customer-Device': deviceRef,
    });
    return s;
  }

  /**
   * Cible du contrat (pas encore servie : 404) : OTP par SMS, jeton court, rafraîchissement. `askCode` demande le code
   * reçu à l'utilisateur.
   */
  static async otp(phone, operatorCode, askCode) {
    const { otp_request_id } = await call('POST', '/customer-auth/otp', {
      body: { phone, operator_code: operatorCode, channel: 'SMS' },
    });
    let tokens = await call('POST', '/customer-auth/token', {
      body: { otp_request_id, code: await askCode() },
    });
    let expiresAt = Date.now() + tokens.expires_in * 1000;
    const s = new Session();
    s.authHeaders = async () => {
      if (Date.now() > expiresAt - 30_000) {
        tokens = await call('POST', '/customer-auth/refresh', {
          body: { refresh_token: tokens.refresh_token },
        });
        expiresAt = Date.now() + tokens.expires_in * 1000;
      }
      return { Authorization: `Bearer ${tokens.access_token}` };
    };
    return s;
  }

  async get(path, extra = {}) {
    return call('GET', path, { headers: { ...(await this.authHeaders()), ...extra } });
  }
  async post(path, body, options = {}) {
    return call('POST', path, {
      ...options,
      body,
      headers: { ...(await this.authHeaders()), ...options.headers },
    });
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Écrans de l'app (une fonction par endpoint de la spécification xaamga)
// ----------------------------------------------------------------------------------------------------------------

export const app = {
  // 2. Profil et portefeuilles : servis (phone vide, refund.eligible faux jusqu'aux missions 10a et 9).
  profile: (s) => s.get('/me'),
  wallets: (s) => s.get('/me/wallets'),
  transactions: (s, walletId, cursor) =>
    s.get(
      `/me/wallets/${walletId}/transactions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  // 3. Solde sans compte : servi. Réponse réduite : { currency, spendable, media_status, recent[{occurred_at,type,amount}] }.
  anonymousBalance: (claimCode) =>
    call('POST', '/public/balance-lookups', { body: { claim_code: claimCode } }),

  // 4. Bracelets
  myMedia: (s) => s.get('/me/media'),
  /** Servi. 201 → bracelet actif ; 202 → bracelet déjà crédité : `confirmation_code` à montrer au guichet (24 h). */
  claimMedia: (s, claimCode) => s.post('/me/media', { claim_code: claimCode }),
  reportLost: (s, mediaId) => s.post(`/me/media/${mediaId}/report-lost`, {}), // pas encore servi

  // 5. Recharge en ligne : servie, mais `provider` ∈ WAVE | ORANGE_MONEY | CARD (PayDunya ou Stripe derrière CARD).
  startTopup: (s, walletId, amount, provider, msisdn) =>
    s.post('/topups/psp', {
      wallet_id: walletId,
      amount,
      currency: 'XOF',
      provider,
      payer_msisdn: msisdn,
      // `https:` (lien universel de l'app) ou `cashless:` seulement : un schéma propre (`xaamga://`) est refusé (422).
      return_url: 'https://xaamga.example/cashless/topup/callback',
    }),
  topupStatus: (s, topupId) => s.get(`/topups/psp/${topupId}`), // PENDING | SUCCEEDED | FAILED | EXPIRED | CANCELLED
  cancelTopup: (s, topupId) => s.post(`/topups/psp/${topupId}/cancel`, {}),

  // 6. QR. Direction 1 : le festivalier montre SON QR (servi) ; `qr_payload` = "CSHL1:<jeton>", valable 60 s.
  customerQr: (s, walletId) => s.post('/me/customer-qr-tokens', { wallet_id: walletId }),

  /**
   * Direction 2 : QR du commerçant scanné = `https://<domaine>/r/<payment_request_id>#t=<jeton>`. Le jeton voyage dans
   * l'en-tête `X-Payment-Request-Token` pour la lecture, dans le corps pour le paiement (jamais dans l'URL appelée).
   */
  parseMerchantQr(qr) {
    const m = /\/r\/([0-9a-f-]{36})#t=(.+)$/i.exec(qr);
    if (!m) throw new Error('QR commerçant non reconnu');
    return { paymentRequestId: m[1], token: m[2] };
  },
  merchantRequest: (s, { paymentRequestId, token }) =>
    s.get(`/payment-requests/${paymentRequestId}`, { 'X-Payment-Request-Token': token }),
  payMerchantRequest: (s, { paymentRequestId, token }, walletId, idempotencyKey) =>
    s.post(
      `/payment-requests/${paymentRequestId}/pay`,
      { token, wallet_id: walletId },
      { idempotencyKey },
    ),

  // 7. Remboursements : au contrat, PAS ENCORE SERVIS.
  requestRefund: (s, walletId, msisdn) =>
    s.post('/me/refund-requests', { wallet_id: walletId, destination: { method: 'WAVE', msisdn } }),
  myRefunds: (s) => s.get('/me/refund-requests'),
};

// ----------------------------------------------------------------------------------------------------------------
// Parcours de démonstration
// ----------------------------------------------------------------------------------------------------------------

/** `pending` : route de NOT_SERVED_YET, un 404 est attendu tant qu'elle n'est pas livrée. */
async function step(title, fn, { pending = false } = {}) {
  try {
    const out = await fn();
    console.log(`✔ ${title}\n  ${JSON.stringify(out)}`);
    return out;
  } catch (e) {
    const why = pending && e.status === 404 ? 'pas encore servi par ce serveur (404)' : e.message;
    console.log(`${pending ? '…' : '✘'} ${title}\n  ${why}`);
    return null;
  }
}
const pending = { pending: true };

async function main() {
  const awa = Session.testHeaders(DEMO.awa.customerId);
  const fatou = Session.testHeaders(DEMO.fatou.customerId);
  const ibrahima = Session.testHeaders(DEMO.ibrahima.customerId);

  console.log(`API : ${API}\n`);
  await step(
    '1. Connexion OTP (contrat)',
    () =>
      call('POST', '/customer-auth/otp', {
        body: { phone: '+221770000001', operator_code: 'demo' },
      }),
    pending,
  );
  await step('2. Profil', () => app.profile(awa));
  await step('2. Portefeuilles', () => app.wallets(awa));
  await step('2. Historique', () => app.transactions(awa, DEMO.awa.walletId));
  await step('3. Solde d’un bracelet anonyme', () => app.anonymousBalance(DEMO.anonymousCode));
  await step('4. Mes bracelets', () => app.myMedia(awa));
  if (process.env.CLAIM_CODE)
    await step(`4. Rattacher ${process.env.CLAIM_CODE} (Fatou)`, () =>
      app.claimMedia(fatou, process.env.CLAIM_CODE),
    );
  await step('5. Recharge Wave', () =>
    app.startTopup(awa, DEMO.awa.walletId, 5000, 'WAVE', '+221770000001'),
  );
  const qr = await step('6. QR client (Awa)', () => app.customerQr(awa, DEMO.awa.walletId));
  if (qr) console.log(`  → afficher « ${qr.qr_payload} » en QR jusqu’à ${qr.expires_at}`);
  await step('6. QR client, portefeuille bloqué (Ibrahima) : refus attendu', () =>
    app.customerQr(ibrahima, DEMO.ibrahima.walletId),
  );
  if (process.env.MERCHANT_QR) {
    const scanned = app.parseMerchantQr(process.env.MERCHANT_QR);
    const request = await step('6. Demande du commerçant', () => app.merchantRequest(awa, scanned));
    if (request?.status === 'PENDING')
      await step('6. Payer', () =>
        app.payMerchantRequest(awa, scanned, DEMO.awa.walletId, randomUUID()),
      );
  }
  await step(
    '7. Demande de remboursement',
    () => app.requestRefund(awa, DEMO.awa.walletId, '+221770000001'),
    pending,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
