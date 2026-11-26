/* A locally saved selection that uses the regular PURE cart for each reorder. */
(() => {
  'use strict';

  const planKey = 'pure-subscribe-plan-v1';
  const limit = 4;

  function mount() {
    const root = document.querySelector('[data-pss-planner]');
    const store = window.AltaStore;
    if (!root || !store || root.dataset.ready) return;
    root.dataset.ready = 'true';
    const catalog = new Map(store.catalog
      .filter(product => product.category === 'injectables')
      .map(product => [product.id, product.variants.filter(variant => Number.isFinite(variant.price) && variant.price > 0)])
      .filter(([, variants]) => variants.length));
    const products = root.querySelector('[data-pss-products]');
    const selection = root.querySelector('[data-pss-selection]');
    const progress = root.querySelector('[data-pss-count]');
    const subtotal = root.querySelector('[data-pss-subtotal]');
    const cart = root.querySelector('[data-pss-cart]');
    const search = root.querySelector('[data-pss-search]');
    const status = root.querySelector('[data-pss-status]');
    const chosen = new Map();
    const sizes = new Map();
    const price = amount => store.priceMarkup(amount, { trimWhole: true });
    const findVariant = (id, size) => catalog.get(id)?.find(variant => variant.size === size);
    const saved = store.read(planKey, []);
    if (Array.isArray(saved)) {
      for (const item of saved.slice(0, limit)) {
        if (findVariant(item?.id, item?.size)) chosen.set(item.id, item.size);
      }
    }
    const storePlan = () => store.write(planKey, [...chosen].map(([id, size]) => ({ id, size })));
    const savedMessage = () => storePlan() ? 'Plan saved on this device.' : 'Selections are available for this visit. Your browser blocked saving.';
    const params = new URLSearchParams(location.search);
    const incomingId = params.get('product');
    const incomingSize = params.get('size');
    if (incomingId || incomingSize) {
      if (!findVariant(incomingId, incomingSize)) {
        status.textContent = 'That product or strength is unavailable for this plan.';
      } else {
        sizes.set(incomingId, incomingSize);
        if (chosen.has(incomingId) || chosen.size < limit) {
          chosen.set(incomingId, incomingSize);
          status.textContent = savedMessage();
        } else {
          search.value = store.product(incomingId).name;
          status.textContent = 'Your plan is full. Remove a product to add this selection.';
        }
      }
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('product');
      cleanUrl.searchParams.delete('size');
      history.replaceState(null, '', cleanUrl);
    }

    function renderSummary() {
      const rows = [...chosen];
      progress.textContent = rows.length + ' / ' + limit;
      cart.disabled = rows.length !== limit;
      subtotal.innerHTML = price(rows.reduce((sum, [id, size]) => sum + findVariant(id, size).price, 0));
      selection.innerHTML = rows.map(([id, size]) => {
        const name = store.esc(store.product(id).name);
        return `<li><span><strong>${name}</strong><small>${store.esc(size)} · Qty 1</small></span><button type="button" class="pss-remove" data-pss-remove="${store.esc(id)}" aria-label="Remove ${name}">×</button></li>`;
      }).join('') || '<li>Choose four different products.</li>';
    }

    function renderProducts() {
      const query = search.value.trim().toLowerCase();
      products.innerHTML = [...catalog].filter(([id, variants]) => {
        const product = store.product(id);
        return [product.name, product.group, ...variants.map(variant => variant.size)].join(' ').toLowerCase().includes(query);
      }).map(([id, variants]) => {
        const product = store.product(id);
        const name = store.esc(product.name);
        const size = chosen.get(id) || sizes.get(id) || variants[0].size;
        const picked = chosen.has(id);
        const options = variants.map(variant =>
          `<option value="${store.esc(variant.size)}"${variant.size === size ? ' selected' : ''}>${store.esc(variant.size)}</option>`
        ).join('');
        return `<article class="pss-card" data-pss-product="${store.esc(id)}">
          <img src="${store.esc(store.image(product, size))}" alt="" loading="lazy" width="160" height="180">
          <div class="pss-card-body">
            <h3>${name}</h3>
            <label><span class="ap-sr">Strength for ${name}</span><select data-pss-size>${options}</select></label>
            <strong data-pss-price>${price(findVariant(id, size).price)}</strong>
            <button type="button" class="ap-button${picked ? ' ap-button-secondary' : ''}" data-pss-pick aria-pressed="${picked}" aria-label="${picked ? 'Remove' : 'Select'} ${name}"${!picked && chosen.size === limit ? ' disabled' : ''}>${picked ? 'Selected' : 'Select'}</button>
          </div>
        </article>`;
      }).join('') || '<p>No products match your search.</p>';
    }

    function updatePlan() {
      renderSummary();
      renderProducts();
      status.textContent = savedMessage();
    }

    search.addEventListener('input', renderProducts);
    products.addEventListener('change', event => {
      if (!event.target.matches('[data-pss-size]')) return;
      const article = event.target.closest('[data-pss-product]');
      const id = article.dataset.pssProduct;
      const size = event.target.value;
      const variant = findVariant(id, size);
      if (!variant) return;
      sizes.set(id, size);
      article.querySelector('img').src = store.image(store.product(id), size);
      article.querySelector('[data-pss-price]').innerHTML = price(variant.price);
      if (!chosen.has(id)) return;
      chosen.set(id, size);
      renderSummary();
      status.textContent = savedMessage();
    });
    products.addEventListener('click', event => {
      const button = event.target.closest('[data-pss-pick]');
      if (!button) return;
      const article = button.closest('[data-pss-product]');
      const id = article.dataset.pssProduct;
      const size = article.querySelector('[data-pss-size]').value;
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < limit && findVariant(id, size)) chosen.set(id, size);
      else return;
      updatePlan();
      [...products.querySelectorAll('[data-pss-product]')].find(card => card.dataset.pssProduct === id)?.querySelector('[data-pss-pick]').focus();
    });
    selection.addEventListener('click', event => {
      const remove = event.target.closest('[data-pss-remove]');
      if (!remove || !chosen.delete(remove.dataset.pssRemove)) return;
      updatePlan();
      (selection.querySelector('button') || search).focus();
    });
    cart.addEventListener('click', () => {
      if (chosen.size !== limit) return;
      const items = [...chosen].map(([id, size]) => ({ id, size, qty: 1 }));
      const existing = new Map(store.cart.map(item => [item.key, item.qty]));
      const keys = items.map(item => item.id + ':' + item.size);
      if (new Set([...existing.keys(), ...keys]).size > 60 || keys.some(key => (existing.get(key) || 0) >= 100)) {
        status.textContent = 'Remove or reduce items in your cart before adding the plan.';
        return;
      }
      try {
        store.addItems(items);
        status.textContent = 'Plan added to your cart.';
        document.querySelector('.ap-header [data-action="cart"]')?.click();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    renderSummary();
    renderProducts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
