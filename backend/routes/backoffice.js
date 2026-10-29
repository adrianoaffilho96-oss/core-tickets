// Painel administrativo (rotas montadas em /api/equipe, exigem login).
const express = require('express');
const db = require('../db');
const payments = require('../payments');
const { money, onlyDigits, isValidCpf, isValidEmail, asyncRoute } = require('../util');

const router = express.Router();
const value = (sql) => db.prepare(sql).get().v;

router.get('/backoffice/summary', (req, res) => {
  res.json({
    totalVendido: value("SELECT COALESCE(SUM(price),0) v FROM tickets WHERE status='pago'"),
    ingressosPagos: value("SELECT COUNT(*) v FROM tickets WHERE status='pago'"),
    totalPendentePagamento: value("SELECT COALESCE(SUM(price),0) v FROM tickets WHERE status='aguardando_pagamento'"),
    ingressosPendentes: value("SELECT COUNT(*) v FROM tickets WHERE status='aguardando_pagamento'"),
    checkins: value('SELECT COUNT(*) v FROM tickets WHERE checked_in_at IS NOT NULL'),
    saldoEmCarteiras: value('SELECT COALESCE(SUM(balance),0) v FROM wallets'),
    totalRecarregado: value("SELECT COALESCE(SUM(amount),0) v FROM wallet_transactions WHERE type='recarga'"),
    totalConsumido: value("SELECT COALESCE(SUM(amount),0) v FROM wallet_transactions WHERE type='consumo'"),
  });
});

router.get('/backoffice/tickets', (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const where = [];
  const params = [];
  if (q) {
    where.push('(t.buyer_name LIKE ? OR t.buyer_cpf LIKE ? OR t.buyer_email LIKE ? OR t.id LIKE ?)');
    params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, `${q}%`);
  }
  if (status) {
    where.push('t.status=?');
    params.push(status);
  }
  const rows = db
    .prepare(
      `SELECT t.*, p.method payment_method, p.status payment_status, p.provider
       FROM tickets t LEFT JOIN payments p ON p.ticket_id=t.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.created_at DESC LIMIT 500`,
    )
    .all(...params);
  res.json(rows);
});

router.get('/backoffice/lots', (req, res) => {
  res.json(db.prepare('SELECT * FROM ticket_lots ORDER BY category,price').all());
});

router.patch('/backoffice/lots/:id', (req, res) => {
  const lot = db.prepare('SELECT * FROM ticket_lots WHERE id=?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lote nao encontrado.' });
  const { price, quantityTotal, active } = req.body || {};
  // Cortesia e sempre gratuita.
  const newPrice = price === undefined || lot.category === 'cortesia' ? lot.price : money(price);
  const newTotal = quantityTotal === undefined ? lot.quantity_total : Number(quantityTotal);
  if (newPrice === null) return res.status(400).json({ error: 'Preco invalido.' });
  if (!Number.isInteger(newTotal) || newTotal < lot.quantity_sold) {
    return res.status(400).json({ error: `Quantidade deve ser inteira e no minimo ${lot.quantity_sold} (ja vendidos).` });
  }
  const newActive = active === undefined ? lot.active : active ? 1 : 0;
  db.prepare('UPDATE ticket_lots SET price=?, quantity_total=?, active=? WHERE id=?').run(newPrice, newTotal, newActive, lot.id);
  res.json(db.prepare('SELECT * FROM ticket_lots WHERE id=?').get(lot.id));
});

router.post(
  '/backoffice/cortesias',
  asyncRoute(async (req, res) => {
    const { buyerName, buyerEmail, buyerCpf } = req.body || {};
    const lot = db.prepare("SELECT * FROM ticket_lots WHERE category='cortesia' AND active=1 ORDER BY rowid LIMIT 1").get();
    if (!lot) return res.status(409).json({ error: 'Cortesias desativadas. Ative em Lotes e produtos.' });
    const name = String(buyerName || '').trim();
    if (name.length < 3 || name.length > 120) return res.status(400).json({ error: 'Informe o nome completo do convidado.' });
    if (!isValidEmail(buyerEmail)) return res.status(400).json({ error: 'Informe um e-mail valido.' });
    if (!isValidCpf(buyerCpf)) return res.status(400).json({ error: 'CPF invalido.' });
    const result = await payments.issueCourtesy({
      lot,
      buyer: { name, email: String(buyerEmail).trim().toLowerCase(), cpf: onlyDigits(buyerCpf) },
    });
    res.status(201).json(result);
  }),
);

router.get('/backoffice/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY category,name').all());
});

router.patch('/backoffice/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produto nao encontrado.' });
  const { price, stock, active } = req.body || {};
  const newPrice = price === undefined ? p.price : money(price, 10000);
  const newStock = stock === undefined ? p.stock : Number(stock);
  if (newPrice === null) return res.status(400).json({ error: 'Preco invalido.' });
  if (!Number.isInteger(newStock) || newStock < 0) return res.status(400).json({ error: 'Estoque invalido.' });
  const newActive = active === undefined ? p.active : active ? 1 : 0;
  db.prepare('UPDATE products SET price=?, stock=?, active=? WHERE id=?').run(newPrice, newStock, newActive, p.id);
  res.json(db.prepare('SELECT * FROM products WHERE id=?').get(p.id));
});

module.exports = router;
