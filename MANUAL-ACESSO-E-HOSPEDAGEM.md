# Manual de acesso e hospedagem do Core Tickets

## 1. Rodar no computador

```sh
cd core-tickets
cp .env.example .env
npm install
npm start
```

- Site: `http://localhost:8000`
- Área da equipe: `http://localhost:8000/equipe.html` (senha = `ADMIN_PASSWORD` do `.env`; se ficar vazia, o terminal mostra uma senha temporária ao iniciar)

Deixe o terminal aberto enquanto usa o site. Para parar, pressione `Ctrl+C`.

## 2. Ativar pagamentos reais no Mercado Pago

1. Crie ou acesse sua conta em `https://www.mercadopago.com.br` (de preferência conta PJ/vendedor).
2. Abra `https://www.mercadopago.com.br/developers/panel/app` e crie uma aplicação ("Pagamentos online", produto "Checkout Pro" / "Checkout Transparente").
3. Em **Credenciais de teste**, copie o *Access Token* (começa com `TEST-`) e coloque em `MP_ACCESS_TOKEN` no `.env`. Teste compras com os usuários e cartões de teste do Mercado Pago.
4. Cadastre uma chave Pix na conta do Mercado Pago (necessário para gerar cobranças Pix).
5. Em **Webhooks**, cadastre a URL `https://SEU-ENDERECO/api/webhooks/mercadopago`, marque o evento **Pagamentos** e copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
6. Quando tudo estiver testado, troque para as **Credenciais de produção** (Access Token começando com `APP_USR-`).

Sem `MP_ACCESS_TOKEN` o site fica em modo simulado: nada é cobrado.

> O webhook e o retorno automático do cartão só funcionam com endereço `https://` público (Render ou túnel). No computador, sem túnel, a página do ingresso ainda confirma o pagamento consultando o Mercado Pago a cada poucos segundos.

## 3. Link temporário para testes externos

Com o servidor rodando, em outro terminal:

```sh
npx ngrok http 8000
```

Use o endereço `https://...ngrok-free.app` mostrado e coloque-o em `PUBLIC_URL` no `.env` (reinicie o servidor). Esse link para de funcionar quando o terminal fechar. Não use para vendas reais.

## 4. Hospedagem permanente (Render)

O `render.yaml` publica o site e a API juntos, no plano Starter (pago), com disco persistente de 1 GB para o banco. Nada é ativado ou cobrado até você confirmar no painel do Render.

1. Entre em `https://dashboard.render.com/` e conecte sua conta GitHub.
2. Escolha **New > Blueprint** e selecione o repositório `adrianoaffilho96-oss/core-tickets`, branch `main`.
3. Preencha as variáveis pedidas:
   - `ADMIN_PASSWORD`: senha forte da equipe
   - `PUBLIC_URL`: o endereço do serviço (ex.: `https://core-tickets.onrender.com`) — pode ajustar depois do primeiro deploy
   - `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`: do passo 2 (deixe vazio para começar em modo simulado)
4. Revise o plano e o disco, confirme se estiver de acordo com os preços e aguarde o deploy.
5. Cadastre o webhook do Mercado Pago com o endereço final do Render.

Novos commits na `main` atualizam o site automaticamente. Faça backup do banco (`/var/data/festa.db`) periodicamente.

## 4b. Hospedagem gratuita (Oracle Cloud Always Free) — opção escolhida

Servidor próprio grátis, ligado 24h, com HTTPS automático (Caddy) e backup diário do banco.

- Instalação inicial no servidor: `sudo bash deploy/setup.sh <ip-com-tracos>.sslip.io`
- Atualizar após novos commits: `sudo bash /opt/core-tickets/deploy/update.sh`
- Configuração (senha, Mercado Pago): `/opt/core-tickets/.env`, depois `sudo systemctl restart core-tickets`
- Banco: `/var/lib/core-tickets/festa.db` · Backups: `/var/backups/core-tickets/`
- Ver logs: `sudo journalctl -u core-tickets -f`

## 5. Antes de vender de verdade

- [ ] Credenciais de produção do Mercado Pago configuradas e uma compra real de baixo valor testada (Pix e cartão)
- [ ] Webhook cadastrado e recebendo notificações (painel do Mercado Pago mostra as entregas)
- [ ] `ADMIN_PASSWORD` forte definida
- [ ] Lotes, preços e quantidades revisados em **Equipe > Lotes e produtos**
- [ ] Data, local e textos do evento revisados em `public/index.html`
