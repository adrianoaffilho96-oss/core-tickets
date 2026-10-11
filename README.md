# Core Tickets

Plataforma de ingressos e experiências da Core X para o evento **GLAMUROSA**: venda de ingressos com Pix e cartão (Mercado Pago), ingresso digital com QR code, carteira cashless, check-in, caixa, bar e cozinha.

## Páginas

| Endereço | Para quem | O que faz |
|---|---|---|
| `/` | Público | Apresentação do evento e compra de ingressos/camarotes |
| `/ingresso.html` | Público | Pagamento (Pix/cartão), QR de entrada, carteira cashless, extrato e transferência. Sem `?id=`, busca ingressos por CPF + e-mail |
| `/equipe.html` | Equipe (senha) | Painel de vendas, check-in (com leitura de QR pela câmera), recarga no caixa, bar, cozinha e cadastro de lotes/produtos |

## Rodar no computador

```sh
cp .env.example .env    # edite a senha da equipe
npm install
npm start               # http://localhost:8000
npm test                # testes automáticos da API
```

Sem `MP_ACCESS_TOKEN`, o site roda em **modo simulado**: nenhum pagamento é cobrado e a página do ingresso mostra um botão "Simular pagamento aprovado".

## Pagamentos (Mercado Pago)

- **Pix**: QR code e copia-e-cola gerados direto na página do ingresso; a confirmação é automática.
- **Cartão**: o cliente é levado ao Checkout Pro do Mercado Pago (crédito em até 12x). Os dados do cartão nunca passam pelo nosso servidor.
- A confirmação chega pelo webhook `POST /api/webhooks/mercadopago` (assinatura validada com `MP_WEBHOOK_SECRET`) e, como garantia, a página do ingresso também consulta o Mercado Pago enquanto o pagamento está pendente.
- Pedidos não pagos expiram em 30 minutos (`PAYMENT_EXPIRATION_MINUTES`) e o ingresso volta ao estoque. Estornos e chargebacks cancelam o ingresso e bloqueiam a carteira.

Passo a passo de credenciais e publicação: [MANUAL-ACESSO-E-HOSPEDAGEM.md](MANUAL-ACESSO-E-HOSPEDAGEM.md).

## Estrutura

```
backend/
  server.js       servidor Express (API + arquivos de public/)
  db.js           banco SQLite, migrações e dados iniciais
  gateway.js      integração Mercado Pago / modo simulado
  payments.js     ciclo do pagamento: cobrar, confirmar, expirar, estornar
  auth.js         login da equipe
  routes/         tickets (público), webhooks, auth, backoffice, checkin, pos (caixa), bar (bar e cozinha)
public/           site (index, ingresso, equipe), estilos, scripts e imagens
test/             testes automáticos (node --test)
```
