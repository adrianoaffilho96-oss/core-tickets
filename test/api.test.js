// Testes de ponta a ponta da API em modo simulado. Rode com: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-tickets-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.ADMIN_PASSWORD = 'senha-teste';
delete process.env.MP_ACCESS_TOKEN;

const app = require('../backend/server');
let server, base, token;

async function api(method, url, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await api('POST', '/auth/login', { password: 'senha-teste' })).body.token;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const buyer = { buyerName: 'Maria Teste', buyerEmail: 'maria@teste.com', buyerCpf: '529.982.247-25', method: 'pix' };

test('rejeita CPF invalido e e-mail ausente', async () => {
  const lot = (await api('GET', '/ticket-types')).body[0];
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: lot.id, buyerCpf: '123.456.789-00' })).status, 400);
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: lot.id, buyerEmail: '' })).status, 400);
});

test('rotas da equipe exigem login', async () => {
  assert.equal((await api('GET', '/equipe/backoffice/summary')).status, 401);
  assert.equal((await api('POST', '/auth/login', { password: 'errada' })).status, 401);
  assert.equal((await api('GET', '/equipe/backoffice/summary', null, true)).status, 200);
});

test('fluxo completo: compra, pagamento, recarga, bar e check-in', async () => {
  const lot = (await api('GET', '/ticket-types')).body.find((l) => l.label === '1º lote');
  const created = await api('POST', '/tickets', { ...buyer, lotId: lot.id });
  assert.equal(created.status, 201);
  const id = created.body.ticketId;

  let t = (await api('GET', `/tickets/${id}`)).body;
  assert.equal(t.ticket.status, 'aguardando_pagamento');
  assert.ok(t.payment.pixCopiaCola);
  assert.equal(t.wallet, null);

  assert.equal((await api('POST', `/tickets/${id}/simular-pagamento`)).status, 200);
  t = (await api('GET', `/tickets/${id}`)).body;
  assert.equal(t.ticket.status, 'pago');
  const code = t.wallet.code;

  assert.equal((await api('POST', `/equipe/wallets/${code}/recarga`, { amount: 30 }, true)).body.balance, 30);
  const products = (await api('GET', '/equipe/products', null, true)).body;
  const burger = products.find((p) => p.name === 'Hamburguer');
  const sale = await api('POST', '/equipe/bar/vendas', { walletCode: code, items: [{ productId: burger.id, quantity: 1 }] }, true);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.balance, 2);

  // Saldo insuficiente nao debita nem baixa estoque
  const fail = await api('POST', '/equipe/bar/vendas', { walletCode: code, items: [{ productId: burger.id, quantity: 1 }] }, true);
  assert.equal(fail.status, 409);
  const after = (await api('GET', '/equipe/products', null, true)).body.find((p) => p.id === burger.id);
  assert.equal(after.stock, burger.stock - 1);

  assert.equal((await api('POST', `/equipe/checkin/${id}/confirmar`, null, true)).status, 200);
  assert.equal((await api('POST', `/equipe/checkin/${id}/confirmar`, null, true)).status, 409);
  assert.equal((await api('POST', `/tickets/${id}/transferir`, { novoNome: 'Joao', novoCpf: '52998224725' })).status, 409);
});

test('pagamento vencido devolve o ingresso ao estoque', async () => {
  const db = require('../backend/db');
  const payments = require('../backend/payments');
  // Lote atual com so 1 vaga livre: ao reservar, ele esgota e o proximo abre (virada automatica)
  const lot = (await api('GET', '/ticket-types')).body.find((l) => l.status === 'disponivel');
  assert.equal(lot.label, '1º lote');
  assert.equal((await api('PATCH', `/equipe/backoffice/lots/${lot.id}`, { quantityTotal: lot.quantity_sold + 1 }, true)).status, 200);
  const created = await api('POST', '/tickets', { ...buyer, lotId: lot.id });
  assert.equal(created.status, 201);
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: lot.id })).status, 409);
  const lots = (await api('GET', '/ticket-types')).body;
  assert.deepEqual(lots.map((l) => l.status), ['esgotado', 'disponivel', 'em_breve']);
  // 3o lote nao pode ser comprado antes da hora
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: lots[2].id })).status, 409);

  db.prepare('UPDATE payments SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), created.body.paymentId);
  await payments.expireOverdue();
  assert.equal((await api('GET', `/tickets/${created.body.ticketId}`)).body.ticket.status, 'expirado');
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: lot.id })).status, 201);
});

test('vitrine mostra so os 3 lotes e cortesia e emitida apenas pela equipe', async () => {
  const lots = (await api('GET', '/ticket-types')).body;
  assert.deepEqual(lots.map((l) => l.label), ['1º lote', '2º lote', '3º lote']);
  const cortesia = (await api('GET', '/equipe/backoffice/lots', null, true)).body.find((l) => l.category === 'cortesia');
  assert.equal(cortesia.price, 0);
  // Compra publica da cortesia e recusada
  assert.equal((await api('POST', '/tickets', { ...buyer, lotId: cortesia.id })).status, 400);
  // Sem login nao emite
  assert.equal((await api('POST', '/equipe/backoffice/cortesias', buyer)).status, 401);

  const issued = await api('POST', '/equipe/backoffice/cortesias', buyer, true);
  assert.equal(issued.status, 201);
  const t = (await api('GET', `/tickets/${issued.body.ticketId}`)).body;
  assert.equal(t.ticket.status, 'pago');
  assert.equal(t.ticket.price, 0);
  assert.ok(t.wallet.code);
  assert.ok(t.entryQr);
  // Preco da cortesia nao muda
  await api('PATCH', `/equipe/backoffice/lots/${cortesia.id}`, { price: 50 }, true);
  assert.equal((await api('GET', '/equipe/backoffice/lots', null, true)).body.find((l) => l.id === cortesia.id).price, 0);
});

test('simulacao de pagamento nao existe para ingresso inexistente', async () => {
  assert.equal((await api('POST', '/tickets/nao-existe/simular-pagamento')).status, 404);
});
