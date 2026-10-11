// Login da equipe: uma senha (ADMIN_PASSWORD) gera um token assinado com validade de 12h.
const crypto = require('crypto');

const SESSION_HOURS = 12;
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = crypto.randomBytes(6).toString('base64url');
  console.warn(`[auth] ADMIN_PASSWORD nao definida. Senha temporaria da equipe: ${password}`);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken() {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `equipe.${expires}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(expires).toISOString() };
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], sign(payload)) && Number(parts[1]) > Date.now();
}

function checkPassword(candidate) {
  return typeof candidate === 'string' && safeEqual(candidate, password);
}

function requireStaff(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Acesso restrito a equipe. Faca login.' });
  next();
}

module.exports = { issueToken, checkPassword, requireStaff, safeEqual };
