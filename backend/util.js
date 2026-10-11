// Validacoes compartilhadas.
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[len])) return false;
  }
  return true;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// Valor monetario positivo com 2 casas; retorna null se invalido.
function money(value, max = 100000) {
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

// Envolve handlers async para que erros virem resposta JSON.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { onlyDigits, isValidCpf, isValidEmail, money, asyncRoute };
