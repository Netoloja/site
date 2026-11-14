// O checkout é criado por uma Netlify Function. O navegador envia apenas id + quantidade;
// preço e nome são sempre recalculados no servidor a partir de data/products.json.
const STORAGE_KEY = "minha-loja-carrinho";
const MAX_QTY = 20;
const CHECKOUT_LABEL = "Pagar com PIX ou cartão";

let products = [];
let cart = []; // [{ id, qty }]

const $ = s => document.querySelector(s);
const money = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" fill="#9ca3af" font-family="Arial" font-size="18" text-anchor="middle" dominant-baseline="middle">Sem imagem</text></svg>'
);

// Imagem quebrada → placeholder (o evento "error" não propaga, por isso captura)
document.addEventListener("error", e => {
  const el = e.target;
  if (el && el.tagName === "IMG" && !el.dataset.fb) { el.dataset.fb = "1"; el.src = FALLBACK_IMG; }
}, true);

const findProduct = id => products.find(p => p.id === id);

function saveCart() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (_) {}
}
function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    cart = saved
      .filter(i => i && findProduct(i.id))
      .map(i => ({ id: i.id, qty: Math.min(MAX_QTY, Math.max(1, parseInt(i.qty, 10) || 1)) }));
  } catch (_) { cart = []; }
}

async function loadProducts() {
  try {
    const r = await fetch("/data/products.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    products = (Array.isArray(data) ? data : data.products || []).filter(p => p && p.id && Number(p.price) > 0);
    loadCart();
    renderCategories();
    renderProducts();
    renderCart();
  } catch (e) {
    console.error(e);
    $("#products").innerHTML = "<p>Não foi possível carregar os produtos.</p>";
  }
}

function renderCategories() {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  $("#categoryFilter").innerHTML = '<option value="todos">Todas as categorias</option>' +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
}

function renderProducts() {
  const cat = $("#categoryFilter").value;
  const list = cat === "todos" ? products : products.filter(p => p.category === cat);
  $("#products").innerHTML = list.length ? list.map(p => `<article class="card">
    <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
    <div class="card-body">
      <div class="category">${esc(p.category || "")}</div>
      <h3>${esc(p.name)}</h3>
      <p class="description">${esc(p.description || "")}</p>
      <div class="price">${money(p.price)}</div>
      <button class="buy" data-add="${esc(p.id)}">Adicionar ao carrinho</button>
    </div>
  </article>`).join("") : "<p>Nenhum produto nesta categoria.</p>";
}

function renderCart() {
  const lines = cart.map(i => ({ ...i, p: findProduct(i.id) })).filter(l => l.p);
  $("#cartCount").textContent = lines.reduce((s, l) => s + l.qty, 0);
  $("#cartItems").innerHTML = lines.length ? lines.map(l => `<div class="cart-item">
    <div>
      <strong>${esc(l.p.name)}</strong><br>
      <small>${money(l.p.price)} cada</small>
      <div class="qty">
        <button data-dec="${esc(l.id)}" aria-label="Diminuir quantidade">−</button>
        <span>${l.qty}</span>
        <button data-inc="${esc(l.id)}" aria-label="Aumentar quantidade">+</button>
      </div>
    </div>
    <button class="remove" data-remove="${esc(l.id)}">Remover</button>
  </div>`).join("") : "<p>Seu carrinho está vazio.</p>";
  $("#cartTotal").textContent = money(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.min(MAX_QTY, item.qty + delta);
  if (item.qty < 1) cart = cart.filter(i => i.id !== id);
  saveCart(); renderCart();
}

$("#products").addEventListener("click", e => {
  const id = e.target.closest("[data-add]")?.dataset.add;
  if (!id || !findProduct(id)) return;
  const existing = cart.find(i => i.id === id);
  existing ? (existing.qty = Math.min(MAX_QTY, existing.qty + 1)) : cart.push({ id, qty: 1 });
  saveCart(); renderCart(); openCart();
});

$("#cartItems").addEventListener("click", e => {
  const t = e.target;
  if (t.dataset.inc) changeQty(t.dataset.inc, 1);
  else if (t.dataset.dec) changeQty(t.dataset.dec, -1);
  else if (t.dataset.remove) { cart = cart.filter(i => i.id !== t.dataset.remove); saveCart(); renderCart(); }
});

function openCart() { $("#cart").classList.add("open"); $("#overlay").classList.add("show"); }
function closeCart() { $("#cart").classList.remove("open"); $("#overlay").classList.remove("show"); }
$("#categoryFilter").addEventListener("change", renderProducts);
$("#cartButton").addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
$("#overlay").addEventListener("click", closeCart);

$("#checkout").addEventListener("click", async () => {
  if (!cart.length) return alert("Seu carrinho está vazio.");
  const button = $("#checkout");
  button.disabled = true;
  button.textContent = "Abrindo pagamento...";
  try {
    const r = await fetch("/.netlify/functions/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart.map(({ id, qty }) => ({ id, qty })) })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.init_point) throw new Error(data.error || "Erro ao criar pagamento");
    window.location.href = data.init_point;
  } catch (e) {
    alert(e.message);
    button.disabled = false;
    button.textContent = CHECKOUT_LABEL;
  }
});

// Retorno do Mercado Pago (?pagamento=sucesso|pendente|erro). É só um aviso ao cliente:
// a confirmação real da venda vem do webhook.
function showPaymentBanner() {
  const status = new URLSearchParams(location.search).get("pagamento");
  const msgs = {
    sucesso: ["ok", "Pagamento recebido! Você receberá a confirmação do pedido em instantes."],
    pendente: ["warn", "Pagamento pendente. Assim que for aprovado, confirmaremos seu pedido."],
    erro: ["err", "O pagamento não foi concluído. Você pode tentar novamente."]
  };
  if (!msgs[status]) return;
  const [kind, text] = msgs[status];
  const b = $("#banner");
  b.className = "banner " + kind;
  b.textContent = text;
  b.hidden = false;
  if (status === "sucesso") { cart = []; saveCart(); }
  history.replaceState(null, "", location.pathname);
}

// Netlify Identity: leva o usuário convidado para o /admin após aceitar o convite
if (window.netlifyIdentity) {
  window.netlifyIdentity.on("init", user => {
    if (!user) window.netlifyIdentity.on("login", () => { location.href = "/admin/"; });
  });
}

$("#year").textContent = new Date().getFullYear();
showPaymentBanner();
loadProducts();
