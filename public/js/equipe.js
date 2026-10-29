const $ = (id) => document.getElementById(id);
const staff = (path, options = {}) => apiRequest(path.startsWith('/') ? `/equipe${path}` : path, { ...options, staff: true });
let currentTab = null,
  kitchenTimer = null,
  products = [],
  cart = new Map();

// ---------- Login ----------
function showApp(loggedIn) {
  $('loginView').hidden = loggedIn;
  $('appView').hidden = !loggedIn;
  $('logoutBtn').hidden = !loggedIn;
  if (loggedIn) openTab(location.hash.slice(1) || 'painel');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    localStorage.setItem(STAFF_TOKEN_KEY, r.token);
    $('password').value = '';
    showMsg($('loginMsg'));
    showApp(true);
  } catch (err) {
    showMsg($('loginMsg'), 'error', err.message);
  }
});

$('logoutBtn').onclick = () => {
  localStorage.removeItem(STAFF_TOKEN_KEY);
  showApp(false);
};

// Sessao expirada em qualquer chamada volta para o login.
async function guard(fn, msgEl) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) {
      localStorage.removeItem(STAFF_TOKEN_KEY);
      showApp(false);
      showMsg($('loginMsg'), 'error', 'Sessão expirada. Entre novamente.');
    } else if (msgEl) showMsg(msgEl, 'error', err.message);
    else console.error(err);
  }
}

// ---------- Abas ----------
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));

function openTab(name) {
  if (!$(`tab-${name}`)) name = 'painel';
  currentTab = name;
  history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  clearInterval(kitchenTimer);
  ({ painel: loadPanel, checkin: () => $('checkinQuery').focus(), cortesias: () => $('courtesyName').focus(), caixa: () => $('walletQuery').focus(), bar: loadProducts, cozinha: startKitchen, config: loadConfig })[name]();
}

// ---------- Painel ----------
async function loadPanel() {
  await guard(async () => {
    const s = await staff('/backoffice/summary');
    $('stats').innerHTML = [
      ['Vendido', formatCurrency(s.totalVendido), `${s.ingressosPagos} ingressos pagos`],
      ['Aguardando pagamento', formatCurrency(s.totalPendentePagamento), `${s.ingressosPendentes} pedidos`],
      ['Check-ins', s.checkins, `de ${s.ingressosPagos} pagos`],
      ['Recargas', formatCurrency(s.totalRecarregado), `${formatCurrency(s.saldoEmCarteiras)} em carteiras`],
      ['Consumo no bar', formatCurrency(s.totalConsumido), ''],
    ]
      .map(([label, value, sub]) => `<div class="stat"><small>${label}</small><strong>${value}</strong><span>${sub}</span></div>`)
      .join('');
    await loadTickets();
  });
}

let searchTimer;
$('ticketSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTickets, 300);
});
$('ticketStatus').addEventListener('change', loadTickets);

async function loadTickets() {
  await guard(async () => {
    const q = new URLSearchParams({ q: $('ticketSearch').value, status: $('ticketStatus').value });
    const rows = await staff(`/backoffice/tickets?${q}`);
    $('ticketTable').innerHTML =
      `<thead><tr><th>Data</th><th>Comprador</th><th>CPF</th><th>Ingresso</th><th>Valor</th><th>Pagamento</th><th>Status</th><th>Entrada</th></tr></thead><tbody>` +
      (rows.length
        ? rows
            .map(
              (t) =>
                `<tr><td>${formatDateTime(t.created_at)}</td><td>${esc(t.buyer_name)}<br><small class="muted">${esc(t.buyer_email || '')}</small></td><td>${esc(t.buyer_cpf || '')}</td><td>${esc(t.type_label)}</td><td>${formatCurrency(t.price)}</td><td>${esc(t.payment_method || '')}${t.provider === 'simulado' ? ' <small class="muted">(teste)</small>' : ''}</td><td><span class="badge ${esc(t.status)}">${statusLabel(t.status)}</span></td><td>${t.checked_in_at ? formatDateTime(t.checked_in_at) : '—'}</td></tr>`,
            )
            .join('')
        : '<tr><td colspan="8" class="muted">Nenhum ingresso.</td></tr>') +
      '</tbody>';
  });
}

// ---------- Check-in ----------
$('checkinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  searchCheckin($('checkinQuery').value.trim());
});

async function searchCheckin(query) {
  showMsg($('checkinMsg'));
  $('checkinResults').innerHTML = '';
  const digits = query.replace(/\D/g, '');
  const param = /^CX-/i.test(query) || /^[0-9a-f-]{36}$/i.test(query) ? { code: query } : digits.length === 11 ? { cpf: digits } : { name: query };
  await guard(async () => {
    const r = await staff(`/checkin/buscar?${new URLSearchParams(param)}`);
    $('checkinResults').innerHTML = r.tickets
      .map((t) => {
        const can = t.status === 'pago' && !t.checked_in_at;
        const note = t.checked_in_at ? `Entrou em ${formatDateTime(t.checked_in_at)}` : t.status !== 'pago' ? statusLabel(t.status) : '';
        return `<div class="list-item ${can ? '' : 'disabled'}"><span><strong>${esc(t.buyer_name)}</strong><small>${esc(t.type_label)} · CPF ${esc(t.buyer_cpf)}</small></span>${can ? `<button class="primary-button inline" data-checkin="${esc(t.id)}">Confirmar entrada</button>` : `<span class="badge cancelado">${esc(note)}</span>`}</div>`;
      })
      .join('');
    $('checkinResults')
      .querySelectorAll('[data-checkin]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            guard(async () => {
              const r = await staff(`/checkin/${encodeURIComponent(b.dataset.checkin)}/confirmar`, { method: 'POST' });
              showMsg($('checkinMsg'), 'success', `Entrada liberada: ${r.buyerName} (${r.label})`);
              $('checkinResults').innerHTML = '';
              $('checkinQuery').value = '';
              $('checkinQuery').focus();
            }, $('checkinMsg'))),
      );
  }, $('checkinMsg'));
}

// ---------- Caixa ----------
$('walletForm').addEventListener('submit', (e) => {
  e.preventDefault();
  loadWallet($('walletQuery').value.trim());
});

async function loadWallet(code) {
  showMsg($('walletMsg'));
  await guard(async () => {
    const r = await staff(`/wallets/${encodeURIComponent(code)}`);
    const w = r.wallet;
    $('walletInfo').innerHTML = `
      <div class="row between wallet-summary">
        <div><strong>${esc(r.ticket?.buyer_name || '')}</strong><br><small class="muted">${esc(w.code)} · ${esc(r.ticket?.type_label || '')}</small></div>
        <div class="big">${formatCurrency(w.balance)}</div>
      </div>
      ${
        w.status === 'ativa'
          ? `<form id="rechargeForm" class="row">
        ${[20, 50, 100, 200].map((v) => `<button type="button" class="secondary-button" data-amount="${v}">${formatCurrency(v)}</button>`).join('')}
        <input id="rechargeAmount" type="number" min="1" max="5000" step="0.01" placeholder="Outro valor" />
        <select id="rechargeMethod"><option>Dinheiro</option><option>Pix</option><option>Cartão</option></select>
        <button class="primary-button inline" type="submit">Recarregar</button>
      </form>`
          : '<div class="msg error">Carteira bloqueada.</div>'
      }
      <div class="list">${r.transactions.map((t) => `<div class="list-item"><span><strong>${esc(t.description || t.type)}</strong><small>${formatDateTime(t.created_at)}</small></span><b class="${t.type === 'recarga' ? 'pos' : 'neg'}">${t.type === 'recarga' ? '+' : '−'} ${formatCurrency(t.amount)}</b></div>`).join('')}</div>`;
    const form = $('rechargeForm');
    if (!form) return;
    form.querySelectorAll('[data-amount]').forEach((b) => (b.onclick = () => ($('rechargeAmount').value = b.dataset.amount)));
    form.onsubmit = (e) => {
      e.preventDefault();
      const amount = Number($('rechargeAmount').value);
      if (!amount || !confirm(`Confirmar recarga de ${formatCurrency(amount)} em ${w.code}?`)) return;
      guard(async () => {
        const res = await staff(`/wallets/${encodeURIComponent(w.code)}/recarga`, {
          method: 'POST',
          body: JSON.stringify({ amount, description: `Recarga no caixa (${$('rechargeMethod').value})` }),
        });
        await loadWallet(w.code);
        showMsg($('walletMsg'), 'success', `Recarga feita. Novo saldo: ${formatCurrency(res.balance)}`);
      }, $('walletMsg'));
    };
  }, $('walletMsg'));
}

// ---------- Bar ----------
async function loadProducts() {
  await guard(async () => {
    products = await staff('/products');
    $('productGrid').innerHTML = products
      .map(
        (p) =>
          `<button class="product" data-product="${esc(p.id)}" ${p.stock <= 0 ? 'disabled' : ''}><strong>${esc(p.name)}</strong><span>${formatCurrency(p.price)}</span><small>${p.stock <= 0 ? 'Sem estoque' : `${p.stock} em estoque`}</small></button>`,
      )
      .join('');
    $('productGrid')
      .querySelectorAll('[data-product]')
      .forEach((b) => (b.onclick = () => addToCart(b.dataset.product, 1)));
    renderCart();
  });
}

function addToCart(id, delta) {
  const qty = (cart.get(id) || 0) + delta;
  if (qty <= 0) cart.delete(id);
  else cart.set(id, qty);
  renderCart();
}

function renderCart() {
  let total = 0;
  $('cart').innerHTML =
    [...cart]
      .map(([id, qty]) => {
        const p = products.find((x) => x.id === id);
        if (!p) return '';
        total += p.price * qty;
        return `<div class="list-item"><span><strong>${esc(p.name)}</strong><small>${formatCurrency(p.price)} cada</small></span><span class="qty"><button class="secondary-button" data-dec="${esc(id)}">−</button><b>${qty}</b><button class="secondary-button" data-inc="${esc(id)}">+</button></span></div>`;
      })
      .join('') || '<p class="muted small">Toque nos produtos para adicionar.</p>';
  $('cartTotal').textContent = formatCurrency(total);
  $('cart').querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => addToCart(b.dataset.dec, -1)));
  $('cart').querySelectorAll('[data-inc]').forEach((b) => (b.onclick = () => addToCart(b.dataset.inc, 1)));
}

$('saleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!cart.size) return showMsg($('saleMsg'), 'error', 'Adicione produtos ao pedido.');
  guard(async () => {
    const r = await staff('/bar/vendas', {
      method: 'POST',
      body: JSON.stringify({ walletCode: $('saleWallet').value.trim(), items: [...cart].map(([productId, quantity]) => ({ productId, quantity })) }),
    });
    showMsg($('saleMsg'), 'success', `Cobrado ${formatCurrency(r.total)}. Saldo restante: ${formatCurrency(r.balance)}.${r.status === 'em_preparo' ? ' Pedido enviado para a cozinha.' : ''}`);
    cart.clear();
    $('saleWallet').value = '';
    loadProducts();
  }, $('saleMsg'));
});

// ---------- Cozinha ----------
function startKitchen() {
  loadKitchen();
  kitchenTimer = setInterval(loadKitchen, 10000);
}

async function loadKitchen() {
  await guard(async () => {
    const orders = await staff('/cozinha/pedidos');
    $('kitchen').innerHTML = orders.length
      ? orders
          .map(
            (o) => `<div class="panel order ${esc(o.status)}">
          <div class="row between"><strong>${esc(o.wallet_code)}</strong><span class="badge ${esc(o.status)}">${statusLabel(o.status)}</span></div>
          <small class="muted">${formatDateTime(o.created_at)}</small>
          <ul>${o.items.map((i) => `<li>${i.quantity}x ${esc(i.product_name)}</li>`).join('')}</ul>
          ${o.status === 'em_preparo' ? `<button class="primary-button" data-order="${esc(o.id)}" data-next="pronto">Marcar como pronto</button>` : `<button class="secondary-button" data-order="${esc(o.id)}" data-next="retirado">Entregue ao cliente</button>`}
        </div>`,
          )
          .join('')
      : '<p class="muted">Nenhum pedido em andamento.</p>';
    $('kitchen')
      .querySelectorAll('[data-order]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            guard(async () => {
              await staff(`/cozinha/pedidos/${encodeURIComponent(b.dataset.order)}/status`, { method: 'POST', body: JSON.stringify({ status: b.dataset.next }) });
              loadKitchen();
            })),
      );
  });
}

// ---------- Cortesias ----------
maskCpf($('courtesyCpf'));
$('courtesyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  showMsg($('courtesyMsg'));
  guard(async () => {
    const r = await staff('/backoffice/cortesias', {
      method: 'POST',
      body: JSON.stringify({ buyerName: $('courtesyName').value, buyerEmail: $('courtesyEmail').value, buyerCpf: $('courtesyCpf').value }),
    });
    const link = `${location.origin}/ingresso.html?id=${encodeURIComponent(r.ticketId)}`;
    $('courtesyMsg').innerHTML = `<div class="msg success">Cortesia emitida para ${esc($('courtesyName').value)}. Envie este link ao convidado:</div><div class="copy-row"><input readonly value="${esc(link)}" /><a class="secondary-button" href="${esc(link)}" target="_blank" rel="noopener">Abrir</a></div>`;
    $('courtesyForm').reset();
  }, $('courtesyMsg'));
});

// ---------- Lotes e produtos ----------
async function loadConfig() {
  await guard(async () => {
    const [lots, prods] = await Promise.all([staff('/backoffice/lots'), staff('/backoffice/products')]);
    $('lotTable').innerHTML =
      '<thead><tr><th>Lote</th><th>Preço (R$)</th><th>Vendidos</th><th>Total</th><th>Ativo</th><th></th></tr></thead><tbody>' +
      lots
        .map(
          (l) =>
            `<tr data-lot="${esc(l.id)}"><td>${esc(l.label)}</td><td>${l.category === 'cortesia' ? 'Grátis' : `<input type="number" step="0.01" min="0.01" name="price" value="${l.price}">`}</td><td>${l.quantity_sold}</td><td><input type="number" min="${l.quantity_sold}" name="quantityTotal" value="${l.quantity_total}"></td><td><input type="checkbox" name="active" ${l.active ? 'checked' : ''}></td><td><button class="secondary-button">Salvar</button></td></tr>`,
        )
        .join('') +
      '</tbody>';
    $('productTable').innerHTML =
      '<thead><tr><th>Produto</th><th>Categoria</th><th>Preço (R$)</th><th>Estoque</th><th>Ativo</th><th></th></tr></thead><tbody>' +
      prods
        .map(
          (p) =>
            `<tr data-prod="${esc(p.id)}"><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td><input type="number" step="0.01" min="0.01" name="price" value="${p.price}"></td><td><input type="number" min="0" name="stock" value="${p.stock}"></td><td><input type="checkbox" name="active" ${p.active ? 'checked' : ''}></td><td><button class="secondary-button">Salvar</button></td></tr>`,
        )
        .join('') +
      '</tbody>';
    const bind = (selector, attr, path, fields) =>
      document.querySelectorAll(selector).forEach((row) => {
        row.querySelector('button').onclick = () =>
          guard(async () => {
            const body = { active: row.querySelector('[name=active]').checked };
            fields.forEach((f) => {
              const input = row.querySelector(`[name=${f}]`);
              if (input) body[f] = Number(input.value);
            });
            await staff(`${path}/${encodeURIComponent(row.dataset[attr])}`, { method: 'PATCH', body: JSON.stringify(body) });
            showMsg($('configMsg'), 'success', 'Alterações salvas.');
          }, $('configMsg'));
      });
    bind('[data-lot]', 'lot', '/backoffice/lots', ['price', 'quantityTotal']);
    bind('[data-prod]', 'prod', '/backoffice/products', ['price', 'stock']);
  });
}

// ---------- Leitura de QR pela camera (Chrome/Android e navegadores com BarcodeDetector) ----------
let scanStream = null;
if (!('BarcodeDetector' in window)) document.querySelectorAll('.scan-btn').forEach((b) => (b.hidden = true));

document.querySelectorAll('[data-scan]').forEach(
  (b) =>
    (b.onclick = async () => {
      const target = $(b.dataset.scan);
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = $('scanVideo');
        video.srcObject = scanStream;
        await video.play();
        $('scanDialog').showModal();
        const loop = async () => {
          if (!scanStream) return;
          const codes = await detector.detect(video).catch(() => []);
          if (codes.length) {
            target.value = codes[0].rawValue;
            stopScan();
            // No bar so preenche o codigo; a cobranca exige confirmacao do atendente.
            if (target.form.id !== 'saleForm') target.form.requestSubmit();
          } else requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        stopScan();
        alert('Não foi possível usar a câmera. Digite o código manualmente.');
      }
    }),
);

function stopScan() {
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
  if ($('scanDialog').open) $('scanDialog').close();
}
$('scanClose').onclick = stopScan;

showApp(!!localStorage.getItem(STAFF_TOKEN_KEY));
