// Bar e cozinha: venda com debito na carteira e fila de pedidos (rotas montadas em /api/equipe, exigem login).
const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');

const router = express.Router();
const KITCHEN_STATUSES = ['em_preparo', 'pronto', 'retirado'];

router.get('/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,name').all());
});

router.post('/bar/vendas', (req, res) => {
  const { walletCode, items } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Adicione ao menos um item.' });

  try {
    const sale = db.transaction(() => {
      const w = db.prepare('SELECT * FROM wallets WHERE code=?').get(String(walletCode || '').trim().toUpperCase());
      if (!w) throw httpError(404, 'Comanda nao encontrada.');
      if (w.status !== 'ativa') throw httpError(409, 'Carteira bloqueada.');

      let total = 0;
      let needsKitchen = false;
      const lines = items.map((item) => {
        const qty = Number(item.quantity);
        const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.productId);
        if (!p) throw httpError(400, 'Produto invalido.');
        if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw httpError(400, `Quantidade invalida para ${p.name}.`);
        const ok = db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(qty, p.id, qty);
        if (!ok.changes) throw httpError(409, `Estoque insuficiente de ${p.name}.`);
        total += p.price * qty;
        if (p.category === 'alimentacao') needsKitchen = true;
        return { p, qty };
      });
      total = Math.round(total * 100) / 100;

      const debit = db.prepare('UPDATE wallets SET balance=balance-? WHERE id=? AND balance>=?').run(total, w.id, total);
      if (!debit.changes) throw httpError(409, `Saldo insuficiente. Saldo atual: R$ ${w.balance.toFixed(2)}.`);

      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO bar_sales VALUES(?,?,?,?,?,?)').run(id, w.id, total, 'codigo', needsKitchen ? 'em_preparo' : 'retirado', now);
      const addItem = db.prepare('INSERT INTO bar_sale_items VALUES(?,?,?,?,?,?)');
      lines.forEach(({ p, qty }) => addItem.run(randomUUID(), id, p.id, p.name, qty, p.price));
      const description = lines.map(({ p, qty }) => `${qty}x ${p.name}`).join(', ');
      db.prepare('INSERT INTO wallet_transactions VALUES(?,?,?,?,?,?)').run(randomUUID(), w.id, 'consumo', total, description.slice(0, 200), now);

      return { id, total, balance: db.prepare('SELECT balance FROM wallets WHERE id=?').get(w.id).balance, status: needsKitchen ? 'em_preparo' : 'retirado' };
    })();
    res.status(201).json(sale);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.get('/cozinha/pedidos', (req, res) => {
  const sales = db.prepare("SELECT s.*, w.code wallet_code FROM bar_sales s JOIN wallets w ON w.id=s.wallet_id WHERE s.status != 'retirado' ORDER BY s.created_at ASC").all();
  const items = db.prepare('SELECT * FROM bar_sale_items WHERE bar_sale_id=?');
  res.json(sales.map((s) => ({ ...s, items: items.all(s.id) })));
});

router.post('/cozinha/pedidos/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!KITCHEN_STATUSES.includes(status)) return res.status(400).json({ error: 'Status invalido.' });
  const r = db.prepare('UPDATE bar_sales SET status=? WHERE id=?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Pedido nao encontrado.' });
  res.json({ ok: true });
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = router;
