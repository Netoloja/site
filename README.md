# Minha Loja — PIX e cartão com Netlify + Mercado Pago

## O que está pronto
- Catálogo lido de `data/products.json` (editável em `/admin`)
- Carrinho com quantidades, salvo no navegador
- Checkout Pro do Mercado Pago (PIX e cartão) via Netlify Function
- **Preço e nome validados no servidor** (o navegador só envia `id` + `qty`)
- Webhook com **validação de assinatura** e consulta do status real do pagamento

## Variáveis de ambiente (Netlify → Project configuration → Environment variables)
| Nome | Onde pegar |
|---|---|
| `MP_ACCESS_TOKEN` | Mercado Pago Developers → Suas integrações → Credenciais |
| `MP_WEBHOOK_SECRET` | Mesma aplicação → Webhooks → "Assinatura secreta" |
| `RESEND_API_KEY` | (opcional) resend.com → API Keys, para receber e-mail a cada venda |
| `NOTIFY_EMAIL` | (opcional) e-mail que recebe o aviso de venda |
| `NOTIFY_FROM` | (opcional) remetente; sem domínio verificado, o padrão só entrega no e-mail da sua conta Resend |

Nunca coloque essas chaves no código ou no GitHub. Depois de criar, faça um novo deploy.

## Webhook
Em Suas integrações → Webhooks, cadastre (evento **Pagamentos**):
`https://SEU-SITE.netlify.app/.netlify/functions/mercadopago-webhook`

## Painel /admin (Decap CMS)
1. Netlify → Site configuration → Identity → **Enable Identity**.
2. Identity → Registration: **Invite only**. Services → **Enable Git Gateway**.
3. Convide seu e-mail, aceite o convite e acesse `/admin/`.
4. A branch em `admin/config.yml` (`main`) deve ser a branch do deploy.

Imagens: coloque em `images/products/` (ou envie pelo painel). Sem imagem, aparece um placeholder.

## Testando antes de vender
Use as credenciais de **teste** do Mercado Pago e as contas/cartões de teste da documentação. Troque para o token de produção só no final.

## Pedidos
Cada pagamento aprovado é gravado no Netlify Blobs (store `orders`, chave `payment-<id>`) e, se configurado, enviado por e-mail. Para ver: Netlify → seu site → Blobs. O painel do Mercado Pago continua sendo a fonte oficial de vendas.

## Limitações atuais
- Sem controle de estoque e sem frete.
- Não há página para listar pedidos; use o painel do Netlify (Blobs) ou o do Mercado Pago.
