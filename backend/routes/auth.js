const express = require('express');
const auth = require('../auth');

const router = express.Router();
const attempts = new Map();

router.post('/auth/login', (req, res) => {
  // Limite simples contra tentativa e erro: 10 tentativas a cada 15 minutos por IP.
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, since: now };
  if (now - entry.since > 15 * 60 * 1000) Object.assign(entry, { count: 0, since: now });
  if (entry.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });

  if (!auth.checkPassword(req.body?.password)) {
    entry.count += 1;
    attempts.set(key, entry);
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  attempts.delete(key);
  res.json(auth.issueToken());
});

module.exports = router;
