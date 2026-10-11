const path = require('path');

// Carrega o .env da raiz do projeto, se existir (Node 20.12+).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {}

const express = require('express');
const { requireStaff } = require('./auth');
const gateway = require('./gateway');
const payments = require('./payments');

const app = express();
const PORT = process.env.PORT || 8000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, paymentMode: gateway.mode }));

// Rotas publicas
app.use('/api', require('./routes/tickets'));
app.use('/api', require('./routes/webhooks'));
app.use('/api', require('./routes/auth'));

// Rotas da equipe (exigem login)
app.use('/api/equipe', requireStaff, require('./routes/backoffice'));
app.use('/api/equipe', requireStaff, require('./routes/checkin'));
app.use('/api/equipe', requireStaff, require('./routes/pos'));
app.use('/api/equipe', requireStaff, require('./routes/bar'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));

// Enderecos antigos continuam funcionando.
app.get('/checkout.html', (req, res) => res.redirect(301, '/'));
app.get('/checkin.html', (req, res) => res.redirect(301, '/equipe.html#checkin'));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalido.' });
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno. Tente novamente.' });
});

// A cada minuto, devolve ao estoque os ingressos com pagamento vencido.
setInterval(() => payments.expireOverdue().catch((e) => console.error('[expiracao]', e)), 60 * 1000).unref();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Core X rodando em http://localhost:${PORT}`);
    console.log(`Pagamentos: ${gateway.mode === 'mercadopago' ? 'Mercado Pago (real)' : 'modo SIMULADO (defina MP_ACCESS_TOKEN para cobrar de verdade)'}`);
  });
}

module.exports = app;
