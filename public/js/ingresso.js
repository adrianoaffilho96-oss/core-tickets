const params = new URLSearchParams(location.search);
const ticketId = params.get('id');
const $ = (id) => document.getElementById(id);
let pollTimer = null,
  countdownTimer = null;

maskCpf($('lookupCpf'));
maskCpf($('novoCpf'));

// ---------- Busca por CPF + e-mail ----------
$('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMsg($('lookupMsg'));
  $('lookupResults').innerHTML = '';
  try {
    const r = await apiRequest('/meus-ingressos', {
      method: 'POST',
      body: JSON.stringify({ cpf: $('lookupCpf').value, email: $('lookupEmail').value }),
    });
    $('lookupResults').innerHTML = r.tickets
      .map(
        (t) =>
          `<a class="list-item" href="ingresso.html?id=${encodeURIComponent(t.id)}"><span><strong>${esc(t.label)}</strong><small>${formatDateTime(t.createdAt)}</small></span><span class="badge ${esc(t.status)}">${statusLabel(t.status)}</span></a>`,
      )
      .join('');
  } catch (err) {
    showMsg($('lookupMsg'), 'error', err.message);
  }
});

// ---------- Pagina do ingresso ----------
function renderPayment(d) {
  const box = $('paymentBox');
  const p = d.payment;
  clearInterval(countdownTimer);
  if (!p || d.ticket.status !== 'aguardando_pagamento') {
    if (d.ticket.status === 'expirado') {
      box.innerHTML = `<div class="panel center"><h3>O prazo de pagamento terminou</h3><p class="muted">O ingresso voltou para venda. Faça um novo pedido.</p><a class="primary-button inline" href="/#ingressos">Comprar novamente</a></div>`;
    } else if (d.ticket.status === 'cancelado') {
      box.innerHTML = `<div class="panel center"><h3>Ingresso cancelado</h3><p class="muted">O pagamento foi estornado.</p></div>`;
    } else box.innerHTML = '';
    return;
  }
  const simulate =
    d.paymentMode === 'simulado'
      ? `<button class="secondary-button" id="simulateBtn" type="button">Simular pagamento aprovado (modo de teste)</button>`
      : '';
  if (p.method === 'pix') {
    box.innerHTML = `<div class="panel center pay-panel">
      <p class="eyebrow">Pague com Pix</p>
      <h2>${formatCurrency(p.amount)}</h2>
      ${p.pixQr ? `<img class="qr" src="${p.pixQr}" alt="QR code Pix" />` : ''}
      <p class="muted small">Abra o app do seu banco, escolha Pix e leia o QR code ou use o código abaixo.</p>
      <div class="copy-row"><input readonly id="pixCode" value="${esc(p.pixCopiaCola || '')}" /><button class="secondary-button" id="copyBtn" type="button">Copiar</button></div>
      <p class="small">Expira em <strong id="countdown"></strong> · Aguardando confirmação <span class="dots"></span></p>
      ${simulate}
    </div>`;
    $('copyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('pixCode').value);
      } catch {
        $('pixCode').select();
        document.execCommand('copy');
      }
      $('copyBtn').textContent = 'Copiado!';
    };
  } else {
    box.innerHTML = `<div class="panel center pay-panel">
      <p class="eyebrow">Pague com cartão</p>
      <h2>${formatCurrency(p.amount)}</h2>
      <p class="muted">Você será levado ao ambiente seguro do Mercado Pago para inserir os dados do cartão.</p>
      ${d.paymentMode === 'simulado' ? '' : `<a class="primary-button inline" href="${esc(p.checkoutUrl)}">Pagar com cartão <span>→</span></a>`}
      <p class="small">Link válido por <strong id="countdown"></strong> · Esta página atualiza sozinha após o pagamento.</p>
      ${simulate}
    </div>`;
  }
  if (simulate) {
    $('simulateBtn').onclick = async () => {
      await apiRequest(`/tickets/${encodeURIComponent(ticketId)}/simular-pagamento`, { method: 'POST' });
      load();
    };
  }
  const tick = () => {
    const ms = new Date(p.expiresAt) - Date.now();
    const el = $('countdown');
    if (!el) return;
    if (ms <= 0) {
      el.textContent = '00:00';
      clearInterval(countdownTimer);
      return;
    }
    el.textContent = `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function renderWallet(w) {
  $('walletQr').src = w.qr;
  $('walletCode').textContent = w.code;
  $('walletBalance').textContent = formatCurrency(w.balance);
  try {
    const r = await apiRequest(`/wallets/${encodeURIComponent(w.code)}`);
    $('walletTx').innerHTML = r.transactions.length
      ? r.transactions
          .map(
            (t) =>
              `<div class="list-item"><span><strong>${esc(t.description || t.type)}</strong><small>${formatDateTime(t.created_at)}</small></span><b class="${t.type === 'recarga' ? 'pos' : 'neg'}">${t.type === 'recarga' ? '+' : '−'} ${formatCurrency(t.amount)}</b></div>`,
          )
          .join('')
      : '<p class="muted small">Nenhuma movimentação ainda.</p>';
  } catch {}
}

let lastStatus = null;
async function load() {
  try {
    const d = await apiRequest(`/tickets/${encodeURIComponent(ticketId)}`);
    $('ticketView').hidden = false;
    $('tLabel').textContent = d.ticket.label;
    $('tBuyer').textContent = `${d.ticket.buyerName} · ${formatCurrency(d.ticket.price)}`;
    $('tStatus').textContent = statusLabel(d.ticket.status);
    $('tStatus').className = `badge ${d.ticket.status}`;
    if (d.ticket.status !== lastStatus) renderPayment(d);
    lastStatus = d.ticket.status;

    const paid = d.ticket.status === 'pago';
    $('paidBox').hidden = !paid;
    if (paid) {
      $('entryQr').src = d.entryQr;
      $('checkinInfo').textContent = d.ticket.checkedInAt ? `Entrada registrada em ${formatDateTime(d.ticket.checkedInAt)}` : '';
      $('transferBox').hidden = !!d.ticket.checkedInAt;
      if (d.wallet) renderWallet(d.wallet);
    }
    clearTimeout(pollTimer);
    if (d.ticket.status === 'aguardando_pagamento') pollTimer = setTimeout(load, 4000);
  } catch (err) {
    showMsg($('pageMsg'), 'error', err.status === 404 ? 'Ingresso não encontrado.' : 'Não foi possível carregar o ingresso. Tentando de novo...');
    if (err.status !== 404) pollTimer = setTimeout(load, 8000);
  }
}

$('transferForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!confirm('Confirmar a transferência? O novo titular passa a ser o dono do ingresso.')) return;
  try {
    await apiRequest(`/tickets/${encodeURIComponent(ticketId)}/transferir`, {
      method: 'POST',
      body: JSON.stringify({ novoNome: $('novoNome').value, novoCpf: $('novoCpf').value, novoEmail: $('novoEmail').value }),
    });
    showMsg($('transferMsg'), 'success', 'Ingresso transferido. Envie o link desta página para o novo titular.');
    e.target.reset();
    lastStatus = null;
    load();
  } catch (err) {
    showMsg($('transferMsg'), 'error', err.message);
  }
});

if (ticketId) load();
else $('lookup').hidden = false;
