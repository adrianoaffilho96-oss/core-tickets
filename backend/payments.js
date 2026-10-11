// Ciclo de vida dos pagamentos: criar cobranca, confirmar, expirar e estornar.
const { randomUUID, randomBytes } = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');
const gateway = require('./gateway');

const EXPIRATION_MINUTES = Number(process.env.PAYMENT_EXPIRATION_MINUTES) || 30;

function now() {
  return new Date().toISOString();
}

function walletCode() {
  // Sem 0/O/1/I para evitar confusao na leitura no bar.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'W-' + Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

// Reserva o ingresso e gera a cobranca no gateway.
async function createTicketPurchase({ lot, buyer, method }) {
  const ticketId = randomUUID();
  const paymentId = randomUUID();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000);

  db.transaction(() => {
    const reserved = db
      .prepare('UPDATE ticket_lots SET quantity_sold=quantity_sold+1 WHERE id=? AND active=1 AND quantity_sold<quantity_total')
      .run(lot.id);
    if (!reserved.changes) {
      const err = new Error('Esse lote acabou de esgotar.');
      err.status = 409;
      throw err;
    }
    db.prepare('INSERT INTO tickets(id,type,type_label,price,buyer_name,buyer_email,buyer_cpf,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      ticketId,
      lot.id,
      lot.label,
      lot.price,
      buyer.name,
      buyer.email,
      buyer.cpf,
      'aguardando_pagamento',
      createdAt,
    );
    db.prepare('INSERT INTO payments(id,ticket_id,method,amount,status,provider,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(
      paymentId,
      ticketId,
      method,
      lot.price,
      'pendente',
      gateway.mode,
      createdAt,
      expiresAt.toISOString(),
    );
  })();

  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);

  try {
    if (method === 'pix') {
      const charge = await gateway.createPix({ payment, ticket, expiresAt });
      db.prepare('UPDATE payments SET gateway_ref=?, pix_copia_cola=? WHERE id=?').run(charge.gatewayRef, charge.pixCopiaCola, paymentId);
    } else {
      const charge = await gateway.createCardCheckout({ payment, ticket, expiresAt });
      db.prepare('UPDATE payments SET gateway_ref=?, checkout_url=? WHERE id=?').run(charge.gatewayRef, charge.checkoutUrl, paymentId);
    }
  } catch (err) {
    // Falhou no gateway: devolve o ingresso ao estoque.
    releaseReservation(paymentId, 'falhou');
    console.error('[pagamento] erro ao criar cobranca:', err.message, err.details || '');
    const out = new Error('Nao foi possivel gerar a cobranca agora. Tente novamente em instantes.');
    out.status = 502;
    throw out;
  }

  return { ticketId, paymentId };
}

function releaseReservation(paymentId, status) {
  db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p || p.status !== 'pendente') return;
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(p.ticket_id);
    db.prepare('UPDATE payments SET status=? WHERE id=?').run(status, p.id);
    if (t && t.status === 'aguardando_pagamento') {
      db.prepare("UPDATE tickets SET status='expirado' WHERE id=?").run(t.id);
      db.prepare('UPDATE ticket_lots SET quantity_sold=MAX(quantity_sold-1,0) WHERE id=?').run(t.type);
    }
  })();
}

// Confirma o pagamento, marca o ingresso como pago e cria a carteira cashless. Idempotente.
async function confirmPayment(paymentId, providerRef) {
  const code = walletCode();
  const qr = await QRCode.toDataURL(code, { margin: 1, width: 320 });
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p) return { ok: false, reason: 'not_found' };
    if (p.status === 'confirmado') return { ok: true, already: true };
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(p.ticket_id);
    // Pagamento aprovado depois de expirar: o cliente pagou, entao o ingresso volta a contar no lote.
    if (t.status === 'expirado') {
      db.prepare('UPDATE ticket_lots SET quantity_sold=quantity_sold+1 WHERE id=?').run(t.type);
    }
    db.prepare("UPDATE payments SET status='confirmado', confirmed_at=?, gateway_ref=COALESCE(?, gateway_ref) WHERE id=?").run(
      now(),
      providerRef || null,
      p.id,
    );
    db.prepare("UPDATE tickets SET status='pago' WHERE id=?").run(t.id);
    if (!db.prepare('SELECT 1 FROM wallets WHERE ticket_id=?').get(t.id)) {
      db.prepare('INSERT INTO wallets VALUES(?,?,?,?,?,?,?)').run(randomUUID(), t.id, code, 0, 'ativa', qr, now());
    }
    return { ok: true };
  })();
}

function refundPayment(paymentId) {
  db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p || p.status !== 'confirmado') return;
    db.prepare("UPDATE payments SET status='estornado' WHERE id=?").run(p.id);
    db.prepare("UPDATE tickets SET status='cancelado' WHERE id=?").run(p.ticket_id);
    db.prepare("UPDATE wallets SET status='bloqueada' WHERE ticket_id=?").run(p.ticket_id);
  })();
}

// Aplica no banco o estado de um pagamento vindo do Mercado Pago.
async function applyProviderPayment(payment, providerPayment) {
  if (!providerPayment) return;
  if (providerPayment.status === 'approved') {
    if (providerPayment.currency !== 'BRL' || providerPayment.amount + 0.001 < payment.amount) {
      console.error(`[pagamento] valor divergente em ${payment.id}: recebido ${providerPayment.amount} ${providerPayment.currency}`);
      return;
    }
    await confirmPayment(payment.id, providerPayment.providerId);
  } else if (['refunded', 'charged_back'].includes(providerPayment.status)) {
    refundPayment(payment.id);
  }
}

// Consulta o gateway quando o pagamento ainda esta pendente (cobre webhooks perdidos e testes locais).
async function syncPayment(paymentId) {
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!payment || payment.provider !== 'mercadopago' || !['pendente', 'expirado'].includes(payment.status)) return;
  try {
    await applyProviderPayment(payment, await gateway.findProviderPayment(payment.id));
  } catch (err) {
    console.error('[pagamento] erro ao consultar Mercado Pago:', err.message);
  }
}

async function handleWebhook(providerId) {
  const providerPayment = await gateway.getProviderPayment(providerId);
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(providerPayment.externalReference);
  if (!payment) return false;
  await applyProviderPayment(payment, providerPayment);
  return true;
}

// Libera ingressos de pagamentos que passaram do prazo.
async function expireOverdue() {
  const overdue = db.prepare("SELECT id FROM payments WHERE status='pendente' AND expires_at IS NOT NULL AND expires_at < ?").all(now());
  for (const { id } of overdue) {
    await syncPayment(id);
    releaseReservation(id, 'expirado');
  }
}

module.exports = {
  EXPIRATION_MINUTES,
  createTicketPurchase,
  confirmPayment,
  syncPayment,
  handleWebhook,
  expireOverdue,
};
