// Utilitarios compartilhados pelas paginas.
const STAFF_TOKEN_KEY = 'corex_staff_token';

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = options.staff ? localStorage.getItem(STAFF_TOKEN_KEY) : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Erro na requisicao.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

// Escapa texto antes de inserir com innerHTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function maskCpf(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  });
}

function showMsg(el, type, text) {
  el.innerHTML = text ? `<div class="msg ${type}">${esc(text)}</div>` : '';
}

const STATUS_LABELS = {
  aguardando_pagamento: 'Aguardando pagamento',
  pago: 'Pago',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  estornado: 'Estornado',
  falhou: 'Falhou',
  em_preparo: 'Em preparo',
  pronto: 'Pronto',
  retirado: 'Retirado',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;
