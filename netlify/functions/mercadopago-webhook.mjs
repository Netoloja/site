import { createHmac, timingSafeEqual } from "node:crypto";

// Valida o header x-signature conforme a documentação do Mercado Pago.
export function isValidSignature(req, dataId, secret) {
  if (!secret) return false;
  const signature = req.headers.get("x-signature") || "";
  const requestId = req.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(
    signature.split(",").map(p => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; })
  );
  if (!parts.ts || !parts.v1 || !dataId) return false;

  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Aviso por e-mail via Resend (opcional: só envia se RESEND_API_KEY e NOTIFY_EMAIL existirem).
async function notifyOwner(order) {
  const { RESEND_API_KEY, NOTIFY_EMAIL, NOTIFY_FROM } = process.env;
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.log("Aviso por e-mail desativado (RESEND_API_KEY/NOTIFY_EMAIL ausentes)");
    return;
  }
  const rows = order.items.map(i => `<li>${esc(i.quantity)}× ${esc(i.title)} — ${brl(i.unit_price)}</li>`).join("");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: NOTIFY_FROM || "Minha Loja <onboarding@resend.dev>",
      to: [NOTIFY_EMAIL],
      subject: `Nova venda aprovada — ${brl(order.amount)}`,
      html: `<h2>Nova venda aprovada</h2>
        <p><strong>Pedido:</strong> ${esc(order.reference)}<br>
        <strong>Pagamento:</strong> ${esc(order.paymentId)} (${esc(order.method)})<br>
        <strong>Cliente:</strong> ${esc(order.payer.name || "—")} · ${esc(order.payer.email || "—")}</p>
        <ul>${rows}</ul>
        <p><strong>Total:</strong> ${brl(order.amount)}</p>`
    })
  });
  if (!res.ok) console.error("Falha ao enviar e-mail:", res.status, await res.text());
}

// Grava o pedido (Netlify Blobs, sem banco externo) e avisa o dono. Idempotente:
// o Mercado Pago pode reenviar o mesmo webhook, então o mesmo pagamento só é processado uma vez.
async function onPaymentApproved(payment) {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("orders");
  const key = `payment-${payment.id}`;

  if (await store.get(key)) {
    console.log(`Pagamento ${payment.id} já processado`);
    return;
  }

  const info = payment.additional_info || {};
  const order = {
    paymentId: payment.id,
    reference: payment.external_reference,
    status: payment.status,
    amount: payment.transaction_amount,
    method: payment.payment_method_id,
    approvedAt: payment.date_approved,
    payer: {
      name: [info.payer?.first_name, info.payer?.last_name].filter(Boolean).join(" "),
      email: payment.payer?.email
    },
    items: (info.items || []).map(i => ({
      id: i.id, title: i.title, quantity: Number(i.quantity), unit_price: Number(i.unit_price)
    }))
  };

  await store.setJSON(key, order);
  console.log("Pedido gravado:", key);

  try { await notifyOwner(order); }
  catch (e) { console.error("Erro no aviso ao dono (pedido já está salvo):", e); }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const url = new URL(req.url);
    const event = await req.json().catch(() => ({}));
    const type = url.searchParams.get("type") || event.type;
    const dataId = url.searchParams.get("data.id") || event?.data?.id;

    if (!isValidSignature(req, dataId ? String(dataId) : "", process.env.MP_WEBHOOK_SECRET)) {
      console.warn("Webhook rejeitado: assinatura inválida ou MP_WEBHOOK_SECRET ausente");
      return new Response("Invalid signature", { status: 401 });
    }

    if (type === "payment" && dataId) {
      // Nunca confie no corpo do webhook: consulte o status real na API.
      const { MercadoPagoConfig, Payment } = await import("mercadopago");
      const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const payment = await new Payment(client).get({ id: String(dataId) });
      if (payment.status === "approved") await onPaymentApproved(payment);
      else console.log(`Pagamento ${payment.id}: status ${payment.status}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error(error);
    // 500 faz o Mercado Pago tentar novamente mais tarde
    return Response.json({ received: false }, { status: 500 });
  }
};
