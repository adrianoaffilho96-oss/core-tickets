// Caixa: consulta e recarga das carteiras cashless (rotas montadas em /api/equipe, exigem login).
const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { money } = require('../util');

const router = express.Router();

function findWallet(code) {
  return db.prepare('SELECT * FROM wallets WHERE code=?').get(String(code || '').trim().toUpperCase());
}

router.get('/wallets/:code', (req, res) => {
  const w = findWallet(req.params.code);
  if (!w) return res.status(404).json({ error: 'Carteira nao encontrada.' });
  const ticket = db.prepare('SELECT buyer_name,type_label,status FROM tickets WHERE id=?').get(w.ticket_id);
  const transactions = db.prepare('SELECT * FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC').all(w.id);
  res.json({ wallet: w, ticket, transactions });
});

router.post('/wallets/:code/recarga', (req, res) => {
  const w = findWallet(req.params.code);
  const amount = money(req.body?.amount, 5000);
  if (!w) return res.status(404).json({ error: 'Carteira nao encontrada.' });
  if (w.status !== 'ativa') return res.status(409).json({ error: 'Carteira bloqueada.' });
  if (!amount) return res.status(400).json({ error: 'Valor invalido (maximo R$ 5.000 por recarga).' });
  const balance = db.transaction(() => {
    db.prepare('UPDATE wallets SET balance=balance+? WHERE id=?').run(amount, w.id);
    db.prepare('INSERT INTO wallet_transactions VALUES(?,?,?,?,?,?)').run(
      randomUUID(),
      w.id,
      'recarga',
      amount,
      String(req.body?.description || 'Recarga no caixa').slice(0, 120),
      new Date().toISOString(),
    );
    return db.prepare('SELECT balance FROM wallets WHERE id=?').get(w.id).balance;
  })();
  res.json({ ok: true, balance });
});

module.exports = router;
