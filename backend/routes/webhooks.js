// Notificacoes do Mercado Pago. Os dados sao sempre reconsultados na API antes de confirmar.
const express = require('express');
const gateway = require('../gateway');
const payments = require('../payments');

const router = express.Router();

router.post('/webhooks/mercadopago', async (req, res) => {
  const type = req.query.type || req.query.topic || req.body?.type;
  const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id;
  if (type !== 'payment' || !dataId || gateway.mode !== 'mercadopago') return res.sendStatus(200);

  const valid = gateway.verifyWebhookSignature({
    signature: req.get('x-signature'),
    requestId: req.get('x-request-id'),
    dataId: String(dataId),
  });
  if (!valid) return res.sendStatus(401);

  try {
    await payments.handleWebhook(String(dataId));
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] erro ao processar pagamento', dataId, err.message);
    // 500 faz o Mercado Pago tentar de novo mais tarde.
    res.sendStatus(500);
  }
});

module.exports = router;
