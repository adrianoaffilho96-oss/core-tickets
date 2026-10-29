const typeInput = document.getElementById('type'),
  ticketList = document.getElementById('ticketList'),
  ticketForm = document.getElementById('ticketForm'),
  ticketMsg = document.getElementById('ticketMsg'),
  submitBtn = document.getElementById('submitBtn');

maskCpf(document.getElementById('buyerCpf'));

function renderLot(lot) {
  const remaining = lot.quantity_total - lot.quantity_sold,
    open = lot.status === 'disponivel',
    detail = open ? 'Acesso ao evento' : lot.status === 'esgotado' ? 'Lote encerrado' : 'Abre quando o lote anterior esgotar',
    stock = lot.status === 'esgotado' ? 'Esgotado' : !open ? 'Em breve' : remaining <= 20 ? `Últimos ${remaining}` : 'Disponível';
  return `<button type="button" class="ticket-option" data-ticket-id="${esc(lot.id)}" ${open ? '' : 'disabled'}><span class="ticket-option-main"><strong>${esc(lot.label)}</strong><small>${detail}</small></span><span class="ticket-option-side"><b>${formatCurrency(lot.price)}</b><small>${stock}</small></span><span class="ticket-option-check">✓</span></button>`;
}

function selectLot(id) {
  typeInput.value = id;
  ticketList.querySelectorAll('.ticket-option').forEach((item) => item.classList.toggle('selected', item.dataset.ticketId === id));
}

async function loadTicketTypes() {
  try {
    const lots = await apiRequest('/ticket-types');
    ticketList.innerHTML = lots.length ? `<p class="ticket-group-title">Ingressos</p>${lots.map(renderLot).join('')}` : '';
    ticketList.querySelectorAll('.ticket-option:not(:disabled)').forEach((option) => option.addEventListener('click', () => selectLot(option.dataset.ticketId)));
    const first = lots.find((lot) => lot.status === 'disponivel');
    if (first) selectLot(first.id);
    else showMsg(ticketMsg, 'error', 'Todos os ingressos estão esgotados.');
  } catch (err) {
    showMsg(ticketMsg, 'error', 'Não foi possível carregar os ingressos. Atualize a página.');
  }
}

async function showPaymentMode() {
  try {
    const cfg = await apiRequest('/config');
    if (cfg.paymentMode === 'simulado') {
      document.getElementById('secureNote').textContent = 'Modo de teste: nenhum pagamento real será cobrado.';
    }
  } catch {}
}

ticketForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMsg(ticketMsg);
  if (!typeInput.value) return showMsg(ticketMsg, 'error', 'Escolha um ingresso.');
  if (!ticketForm.reportValidity()) return;
  submitBtn.disabled = true;
  try {
    const r = await apiRequest('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        lotId: typeInput.value,
        buyerName: buyerName.value,
        buyerEmail: buyerEmail.value,
        buyerCpf: buyerCpf.value,
        method: ticketForm.elements.method.value,
      }),
    });
    window.location.href = `ingresso.html?id=${encodeURIComponent(r.ticketId)}`;
  } catch (err) {
    showMsg(ticketMsg, 'error', err.message);
    submitBtn.disabled = false;
    if (err.status === 409) loadTicketTypes();
  }
});

loadTicketTypes();
showPaymentMode();
