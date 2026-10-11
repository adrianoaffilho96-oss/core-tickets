// Gateway de pagamento.
// - Com MP_ACCESS_TOKEN: Mercado Pago real (Pix direto na pagina + cartao via Checkout Pro).
// - Sem token: modo simulado, para desenvolvimento e testes.
const crypto = require('crypto');

const MP_API = 'https://api.mercadopago.com';
const accessToken = process.env.MP_ACCESS_TOKEN || '';
const webhookSecret = process.env.MP_WEBHOOK_SECRET || '';
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const mode = accessToken ? 'mercadopago' : 'simulado';
const isHttps = publicUrl.startsWith('https://');

// O Mercado Pago exige data com fuso explicito (ex.: 2026-12-12T22:30:00.000-03:00).
function mpDate(date) {
  const local = new Date(date.getTime() - 3 * 3600 * 1000);
  return local.toISOString().replace('Z', '-03:00');
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') || parts[0] };
}

async function mpRequest(method, path, body, idempotencyKey) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.message || data.error || res.statusText;
    const err = new Error(`Mercado Pago recusou a requisicao: ${detail}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function notificationUrl() {
  return isHttps ? `${publicUrl}/api/webhooks/mercadopago` : undefined;
}

async function createPix({ payment, ticket, expiresAt }) {
  if (mode === 'simulado') {
    const ref = `sim_pix_${payment.id.slice(0, 8)}`;
    return {
      gatewayRef: ref,
      pixCopiaCola: `00020126580014BR.GOV.BCB.PIX0136SIMULADO-${ref}5204000053039865802BR5906CORE X6009SAO PAULO6304SIMU`,
    };
  }
  const mp = await mpRequest(
    'POST',
    '/v1/payments',
    {
      transaction_amount: Number(payment.amount.toFixed(2)),
      description: `Core X - ${ticket.type_label}`,
      payment_method_id: 'pix',
      external_reference: payment.id,
      notification_url: notificationUrl(),
      date_of_expiration: mpDate(expiresAt),
      payer: {
        email: ticket.buyer_email,
        ...splitName(ticket.buyer_name),
        identification: { type: 'CPF', number: ticket.buyer_cpf },
      },
    },
    payment.id,
  );
  const tx = mp.point_of_interaction?.transaction_data || {};
  return { gatewayRef: String(mp.id), pixCopiaCola: tx.qr_code, pixQrBase64: tx.qr_code_base64 };
}

async function createCardCheckout({ payment, ticket, expiresAt }) {
  const returnUrl = `${publicUrl || ''}/ingresso.html?id=${ticket.id}`;
  if (mode === 'simulado') {
    return { gatewayRef: `sim_card_${payment.id.slice(0, 8)}`, checkoutUrl: `/ingresso.html?id=${ticket.id}` };
  }
  const pref = await mpRequest(
    'POST',
    '/checkout/preferences',
    {
      items: [
        {
          id: ticket.type,
          title: `Core X - ${ticket.type_label}`,
          quantity: 1,
          unit_price: Number(payment.amount.toFixed(2)),
          currency_id: 'BRL',
        },
      ],
      payer: {
        name: ticket.buyer_name,
        email: ticket.buyer_email,
        identification: { type: 'CPF', number: ticket.buyer_cpf },
      },
      external_reference: payment.id,
      notification_url: notificationUrl(),
      back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
      auto_return: isHttps ? 'approved' : undefined,
      statement_descriptor: 'COREX',
      expires: true,
      expiration_date_from: mpDate(new Date()),
      expiration_date_to: mpDate(expiresAt),
      payment_methods: {
        // Boleto leva dias para compensar; o ingresso expira antes disso.
        excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
        installments: 12,
      },
    },
    payment.id,
  );
  const sandbox = accessToken.startsWith('TEST-');
  return { gatewayRef: pref.id, checkoutUrl: sandbox ? pref.sandbox_init_point : pref.init_point };
}

function normalize(mp) {
  return {
    providerId: String(mp.id),
    externalReference: mp.external_reference,
    status: mp.status,
    amount: Number(mp.transaction_amount),
    currency: mp.currency_id,
  };
}

// Procura no Mercado Pago o pagamento ligado ao nosso id (external_reference).
async function findProviderPayment(paymentId) {
  if (mode === 'simulado') return null;
  const data = await mpRequest(
    'GET',
    `/v1/payments/search?external_reference=${encodeURIComponent(paymentId)}&sort=date_created&criteria=desc`,
  );
  const results = (data.results || []).map(normalize);
  return (
    results.find((p) => p.status === 'approved') ||
    results.find((p) => ['refunded', 'charged_back'].includes(p.status)) ||
    results[0] ||
    null
  );
}

async function getProviderPayment(providerId) {
  return normalize(await mpRequest('GET', `/v1/payments/${encodeURIComponent(providerId)}`));
}

// Valida o cabecalho x-signature enviado pelo Mercado Pago nos webhooks.
function verifyWebhookSignature({ signature, requestId, dataId }) {
  if (!webhookSecret) return true;
  const parts = Object.fromEntries(
    String(signature || '')
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2),
  );
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

module.exports = {
  mode,
  createPix,
  createCardCheckout,
  findProviderPayment,
  getProviderPayment,
  verifyWebhookSignature,
};
