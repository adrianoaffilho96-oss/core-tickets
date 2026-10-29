// Rotas publicas: compra de ingresso, acompanhamento do pagamento e carteira.
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const gateway = require('../gateway');
const payments = require('../payments');
const { onlyDigits, isValidCpf, isValidEmail, asyncRoute } = require('../util');

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({ paymentMode: gateway.mode, expirationMinutes: payments.EXPIRATION_MINUTES });
});

// Lotes publicos em ordem de virada: so o primeiro com estoque fica a venda;
// os anteriores aparecem esgotados e os seguintes "em breve".
function publicLots() {
  const lots = db
    .prepare(
      "SELECT id,category,label,price,capacity,sector_label,quantity_total,quantity_sold FROM ticket_lots WHERE active=1 AND category<>'cortesia' ORDER BY price,rowid",
    )
    .all();
  const current = lots.find((l) => l.quantity_sold < l.quantity_total);
  return lots.map((l) => ({
    ...l,
    status: l === current ? 'disponivel' : l.quantity_sold >= l.quantity_total ? 'esgotado' : 'em_breve',
  }));
}

router.get('/ticket-types', (req, res) => {
  res.json(publicLots());
});

router.post(
  '/tickets',
  asyncRoute(async (req, res) => {
    const { lotId, buyerName, buyerEmail, buyerCpf, method } = req.body || {};
    // Cortesia so pode ser emitida pela equipe.
    const lot = db.prepare("SELECT * FROM ticket_lots WHERE id=? AND active=1 AND category<>'cortesia'").get(lotId);
    if (!lot) return res.status(400).json({ error: 'Ingresso/lote invalido.' });
    if (lot.quantity_sold >= lot.quantity_total) return res.status(409).json({ error: 'Esse lote esta esgotado.' });
    if (publicLots().find((l) => l.id === lot.id)?.status !== 'disponivel') {
      return res.status(409).json({ error: 'Esse lote ainda nao esta a venda.' });
    }
    const name = String(buyerName || '').trim();
    if (name.length < 3 || name.length > 120) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (!isValidEmail(buyerEmail)) return res.status(400).json({ error: 'Informe um e-mail valido.' });
    if (!isValidCpf(buyerCpf)) return res.status(400).json({ error: 'CPF invalido.' });
    if (!['pix', 'cartao'].includes(method)) return res.status(400).json({ error: 'Forma de pagamento invalida.' });

    const result = await payments.createTicketPurchase({
      lot,
      buyer: { name, email: String(buyerEmail).trim().toLowerCase(), cpf: onlyDigits(buyerCpf) },
      method,
    });
    res.status(201).json(result);
  }),
);

// Pagina do ingresso: status do pagamento, Pix, QR de entrada e carteira.
router.get(
  '/tickets/:id',
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    let payment = db.prepare('SELECT * FROM payments WHERE ticket_id=? ORDER BY created_at DESC').get(id);
    if (payment && payment.status === 'pendente') {
      await payments.syncPayment(payment.id);
      payment = db.prepare('SELECT * FROM payments WHERE id=?').get(payment.id);
    }
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
    if (!ticket) return res.status(404).json({ error: 'Ingresso nao encontrado.' });

    const out = {
      ticket: {
        id: ticket.id,
        label: ticket.type_label,
        price: ticket.price,
        buyerName: ticket.buyer_name,
        status: ticket.status,
        createdAt: ticket.created_at,
        checkedInAt: ticket.checked_in_at,
      },
      payment: null,
      wallet: null,
      entryQr: null,
      paymentMode: gateway.mode,
    };

    if (payment) {
      out.payment = {
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        expiresAt: payment.expires_at,
        confirmedAt: payment.confirmed_at,
      };
      if (payment.status === 'pendente') {
        out.payment.checkoutUrl = payment.checkout_url;
        if (payment.pix_copia_cola) {
          out.payment.pixCopiaCola = payment.pix_copia_cola;
          out.payment.pixQr = await QRCode.toDataURL(payment.pix_copia_cola, { margin: 1, width: 320 });
        }
      }
    }

    if (ticket.status === 'pago') {
      out.entryQr = await QRCode.toDataURL(`CX-${ticket.id}`, { margin: 1, width: 320 });
      const wallet = db.prepare('SELECT * FROM wallets WHERE ticket_id=?').get(ticket.id);
      if (wallet) {
        out.wallet = { code: wallet.code, balance: wallet.balance, status: wallet.status, qr: wallet.qr_data_url };
      }
    }
    res.json(out);
  }),
);

// Disponivel apenas no modo simulado (sem Mercado Pago configurado).
router.post(
  '/tickets/:id/simular-pagamento',
  asyncRoute(async (req, res) => {
    if (gateway.mode !== 'simulado') return res.status(403).json({ error: 'Simulacao desativada com o gateway real.' });
    const payment = db.prepare("SELECT * FROM payments WHERE ticket_id=? AND status='pendente'").get(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Nenhum pagamento pendente para esse ingresso.' });
    await payments.confirmPayment(payment.id, null);
    res.json({ ok: true });
  }),
);

router.post('/tickets/:id/transferir', (req, res) => {
  const { novoNome, novoEmail, novoCpf } = req.body || {};
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ingresso nao encontrado.' });
  if (t.status !== 'pago') return res.status(409).json({ error: 'So e possivel transferir ingressos pagos.' });
  if (t.checked_in_at) return res.status(409).json({ error: 'Esse ingresso ja foi usado na entrada.' });
  const name = String(novoNome || '').trim();
  if (name.length < 3) return res.status(400).json({ error: 'Informe o nome completo do novo titular.' });
  if (!isValidCpf(novoCpf)) return res.status(400).json({ error: 'CPF do novo titular invalido.' });
  if (novoEmail && !isValidEmail(novoEmail)) return res.status(400).json({ error: 'E-mail do novo titular invalido.' });
  db.prepare('UPDATE tickets SET buyer_name=?, buyer_email=?, buyer_cpf=? WHERE id=?').run(
    name,
    novoEmail ? String(novoEmail).trim().toLowerCase() : null,
    onlyDigits(novoCpf),
    t.id,
  );
  res.json({ ok: true });
});

// "Ja tenho ingresso": exige CPF e e-mail da compra para listar os ingressos.
router.post('/meus-ingressos', (req, res) => {
  const { cpf, email } = req.body || {};
  if (!isValidCpf(cpf) || !isValidEmail(email)) return res.status(400).json({ error: 'Informe o CPF e o e-mail usados na compra.' });
  const rows = db
    .prepare(
      "SELECT id,type_label label,status,created_at createdAt FROM tickets WHERE buyer_cpf=? AND lower(buyer_email)=? AND status IN ('pago','aguardando_pagamento') ORDER BY created_at DESC",
    )
    .all(onlyDigits(cpf), String(email).trim().toLowerCase());
  if (!rows.length) return res.status(404).json({ error: 'Nenhum ingresso encontrado com esses dados.' });
  res.json({ tickets: rows });
});

router.get('/wallets/:code', (req, res) => {
  const w = db.prepare('SELECT id,code,balance,status,created_at FROM wallets WHERE code=?').get(String(req.params.code).toUpperCase());
  if (!w) return res.status(404).json({ error: 'Carteira nao encontrada.' });
  const transactions = db
    .prepare('SELECT type,amount,description,created_at FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC')
    .all(w.id);
  delete w.id;
  res.json({ wallet: w, transactions });
});

module.exports = router;
