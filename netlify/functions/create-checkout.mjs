import { randomUUID } from "node:crypto";

const MAX_QTY = 20;
const MAX_ITEMS = 50;

const json = (body, status = 200) => Response.json(body, { status });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!process.env.MP_ACCESS_TOKEN) {
    console.error("MP_ACCESS_TOKEN não configurado");
    return json({ error: "Pagamento indisponível no momento." }, 500);
  }

  try {
    const body = await req.json().catch(() => null);
    const items = body?.items;
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) {
      return json({ error: "Carrinho vazio ou inválido" }, 400);
    }

    const origin = new URL(req.url).origin;
    const siteUrl = process.env.URL || origin;

    // Catálogo oficial publicado no site: preço e nome NUNCA vêm do navegador.
    const catalogRes = await fetch(`${origin}/data/products.json`, { headers: { "Cache-Control": "no-cache" } });
    if (!catalogRes.ok) throw new Error("Catálogo indisponível: HTTP " + catalogRes.status);
    const catalogData = await catalogRes.json();
    const catalog = new Map((Array.isArray(catalogData) ? catalogData : catalogData.products || []).map(p => [String(p.id), p]));

    const merged = new Map(); // junta ids repetidos
    for (const raw of items) {
      const id = String(raw?.id ?? "");
      const qty = Number(raw?.qty);
      if (!catalog.has(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
        return json({ error: "Item inválido no carrinho" }, 400);
      }
      merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
    }

    const mpItems = [...merged].map(([id, quantity]) => {
      const p = catalog.get(id);
      const unit_price = Math.round(Number(p.price) * 100) / 100;
      if (!(unit_price > 0)) throw new Error("Preço inválido no catálogo: " + id);
      return { id, title: String(p.name).slice(0, 250), quantity, unit_price, currency_id: "BRL" };
    });

    const { MercadoPagoConfig, Preference } = await import("mercadopago");
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const result = await new Preference(client).create({
      body: {
        items: mpItems,
        external_reference: randomUUID(),
        back_urls: {
          success: `${siteUrl}/?pagamento=sucesso`,
          failure: `${siteUrl}/?pagamento=erro`,
          pending: `${siteUrl}/?pagamento=pendente`
        },
        auto_return: "approved",
        notification_url: `${siteUrl}/.netlify/functions/mercadopago-webhook`
      }
    });

    return json({ init_point: result.init_point });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível iniciar o pagamento" }, 500);
  }
};
