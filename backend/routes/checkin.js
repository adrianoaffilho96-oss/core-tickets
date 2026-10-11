// Check-in na entrada (rotas montadas em /api/equipe, exigem login).
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/checkin/buscar', (req, res) => {
  const { cpf, name, code } = req.query;
  let rows = [];
  if (code) {
    // Aceita o conteudo do QR (CX-<id>) ou o id puro.
    const id = String(code).trim().replace(/^CX-/i, '');
    rows = db.prepare('SELECT * FROM tickets WHERE id=?').all(id);
  } else if (cpf) {
    rows = db.prepare("SELECT * FROM tickets WHERE buyer_cpf=? AND status='pago'").all(String(cpf).replace(/\D/g, ''));
  } else if (name && String(name).trim().length >= 2) {
    rows = db.prepare("SELECT * FROM tickets WHERE buyer_name LIKE ? AND status='pago' LIMIT 50").all(`%${String(name).trim()}%`);
  }
  if (!rows.length) return res.status(404).json({ error: 'Nenhum ingresso encontrado.' });
  res.json({ tickets: rows });
});

router.post('/checkin/:ticketId/confirmar', (req, res) => {
  const result = db.transaction(() => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.ticketId);
    if (!t) return [404, { error: 'Ingresso nao encontrado.' }];
    if (t.status !== 'pago') return [409, { error: `Ingresso com status "${t.status}". Entrada nao permitida.` }];
    if (t.checked_in_at) return [409, { error: `Check-in ja realizado em ${new Date(t.checked_in_at).toLocaleString('pt-BR')}.` }];
    const now = new Date().toISOString();
    db.prepare('UPDATE tickets SET checked_in_at=? WHERE id=?').run(now, t.id);
    return [200, { ok: true, checkedInAt: now, buyerName: t.buyer_name, label: t.type_label }];
  })();
  res.status(result[0]).json(result[1]);
});

module.exports = router;
