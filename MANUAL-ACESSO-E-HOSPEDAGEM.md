# Manual de acesso e hospedagem do Core Tickets

## Acesso no computador

1. Abra um terminal na pasta do projeto e entre em `backend`:

   ```sh
   cd core-tickets/backend
   ```

2. Instale as dependencias (na primeira vez) e inicie o servidor:

   ```sh
   npm install
   npm start
   ```

3. Abra `http://localhost:8000/checkout.html` no navegador.

Deixe o terminal aberto enquanto estiver usando o site localmente. Para parar o servidor, pressione `Ctrl+C`.

## Link temporario para testes externos

Com o servidor local ainda rodando, abra outro terminal na pasta do projeto e execute:

```sh
npx localtunnel --subdomain corex-teste --port 8000
```

Use `https://corex-teste.loca.lt/checkout.html` enquanto esse processo estiver ativo. Esse link e temporario: se o computador, o servidor ou o terminal desligar, o acesso externo para. Nao use esse metodo para vendas reais.

## Hospedagem permanente

O projeto inclui `render.yaml` para publicar o site e o backend juntos no Render. Essa configuracao escolhe o plano pago Starter, mantem o servico ligado e usa um disco persistente de 1 GB para o banco SQLite. Nenhum servico foi ativado nem nenhuma cobranca autorizada por este manual.

1. Entre em `https://dashboard.render.com/` e conecte sua conta GitHub.
2. Escolha **New** e depois **Blueprint**.
3. Selecione o repositorio `adrianoaffilho96-oss/core-tickets` e a branch `main`.
4. Revise o plano Starter e o disco persistente mostrados pelo Blueprint. Confirme somente se estiver de acordo com os precos exibidos na sua conta.
5. Crie o servico e aguarde o deploy terminar.
6. Copie o endereco `onrender.com` mostrado no painel e acesse `/checkout.html` no final do endereco.

Depois do primeiro deploy, novos commits enviados para `main` atualizam o servico automaticamente. Guarde o endereco do painel Render e faca backups do banco periodicamente. O endereco do servico pode mudar se voce o excluir e criar novamente; um dominio proprio e opcional.

## O que fica disponivel hoje

- O GitHub guarda o codigo e as imagens: `https://github.com/adrianoaffilho96-oss/core-tickets`.
- GitHub Pages, como no Port Scanner, publica somente arquivos estaticos. O Core Tickets tambem precisa da API e do banco, por isso Pages sozinho nao executa o fluxo de compra.
- No momento, o deploy do GitHub Pages esta bloqueado por uma pendencia de cobranca na conta GitHub Actions. O endereco Pages retorna 404 ate essa pendencia ser resolvida.
- O gateway em `backend/gateway.js` e simulado. Pix e cartao ainda nao processam pagamentos reais; nao anuncie o checkout para venda real antes de integrar e testar um provedor de pagamentos.
- Um servico pago pode ficar continuamente disponivel enquanto a conta e a hospedagem estiverem ativas, mas nenhum provedor pode garantir disponibilidade para sempre.