/* Monthly selections are separate from the regular cart. */
(() => {
  'use strict';
  const planKey = 'pure-subscribe-plan-v1';
  const setSize = 4;

  function mount() {
    const root = document.querySelector('[data-pss-planner]');
    const store = window.AltaStore;
    if (!root || !store || root.dataset.ready) return;
    root.dataset.ready = 'true';
    const get = name => root.querySelector('[data-pss-' + name + ']');
    const catalog = new Map(store.catalog
      .filter(product => product.category === 'injectables')
      .map(product => [product.id, product.variants.filter(variant => Number.isFinite(variant.price) && variant.price > 0)])
      .filter(([, variants]) => variants.length));
    const findVariant = (id, size) => catalog.get(id)?.find(variant => variant.size === size);
    const esc = store.esc;
    const price = amount => store.priceMarkup(amount, { trimWhole: true });
    const monthlyCents = amount => Math.round(Math.round(amount * 100) * 0.6);
    const products = get('products');
    const selection = get('selection');
    const cart = get('cart');
    const search = get('search');
    const summary = get('summary');
    const drawer = get('drawer');
    const mobileReview = get('mobile-review');
    const mobileContinue = get('mobile-continue');
    const monthly = get('monthly');
    const monthlyLines = root.querySelectorAll('[data-pss-monthly-line]');
    const gift = store.product('bac-3');
    const giftVariant = gift?.variants.find(variant => variant.size === '3 mL');
    const giftUnitCents = Number.isFinite(giftVariant?.price) && giftVariant.price > 0
      ? Math.round(giftVariant.price * 100)
      : 0;
    const sizes = new Map();
    const saved = store.read(planKey, []);
    const chosen = Array.isArray(saved) ? saved.filter(item => findVariant(item?.id, item?.size)) : [];
    for (const item of chosen) sizes.set(item.id, item.size);
    const minimumSlots = () => Math.max(setSize, Math.ceil(chosen.length / setSize) * setSize);
    let capacity = minimumSlots();
    let group = '';
    let monthlyAvailable = false;
    const useMonthlyPricing = () => monthlyAvailable && chosen.length <= 60;
    const itemPrice = (id, size) => {
      const amount = findVariant(id, size).price;
      return price(useMonthlyPricing() ? monthlyCents(amount) / 100 : amount);
    };
    const groups = [...new Set([...catalog.keys()].map(id => store.product(id).group).filter(Boolean))];

    function status(message) {
      get('status').textContent = message;
      get('review-status').textContent = message;
    }

    function save() {
      if (!store.write(planKey, chosen)) status('Your browser could not save this plan on this device.');
    }

    const params = new URL(location.href);
    const incomingId = params.searchParams.get('product');
    const incomingSize = params.searchParams.get('size');
    if (incomingId || incomingSize) {
      if (!findVariant(incomingId, incomingSize)) {
        status('That product or strength is unavailable for this plan.');
      } else {
        sizes.set(incomingId, incomingSize);
        if (chosen.length < capacity) {
          chosen.push({ id: incomingId, size: incomingSize });
          save();
        } else {
          search.value = store.product(incomingId).name;
          status('Your plan is full. Remove an item from your plan to make room.');
        }
      }
      params.searchParams.delete('product');
      params.searchParams.delete('size');
      history.replaceState(null, '', params);
    }

    function renderFilters() {
      get('filters').innerHTML = ['', ...groups].map(label =>
        `<button type="button" data-pss-group="${esc(label)}" aria-pressed="${group === label}">${esc(label || 'All products')}</button>`
      ).join('');
    }

    function renderProducts() {
      const query = search.value.trim().toLowerCase();
      products.innerHTML = [...catalog].filter(([id, variants]) => {
        const product = store.product(id);
        return (!group || group === product.group) &&
          [product.name, product.group, ...variants.map(variant => variant.size)].join(' ').toLowerCase().includes(query);
      }).map(([id, variants]) => {
        const product = store.product(id);
        const size = sizes.get(id) || variants[0].size;
        const matched = chosen.filter(item => item.id === id && item.size === size).length;
        const chips = variants.map(variant =>
          `<button type="button" data-pss-size="${esc(variant.size)}" aria-pressed="${variant.size === size}">${esc(variant.size)}</button>`
        ).join('');
        return `<article class="pss-card" data-pss-product="${esc(id)}">
          <img src="${esc(store.image(product, size))}" alt="" loading="lazy" width="180" height="180">
          <div class="pss-card-body">
            <h3>${esc(product.name)}</h3>
            <div class="pss-sizes" role="group" aria-label="Strength for ${esc(product.name)}">${chips}</div>
            <strong class="pss-card-price">${itemPrice(id, size)}${useMonthlyPricing() ? ' <small>/mo</small>' : ''}</strong>
            <button type="button" class="ap-button pss-pick" data-pss-pick aria-label="Add ${esc(product.name)} ${esc(size)} to your plan"${chosen.length === capacity ? ' disabled' : ''}>${matched ? 'Added ×' + matched + ' · Add again' : 'Add to plan'}</button>
          </div>
        </article>`;
      }).join('') || '<p class="pss-empty">No products match your search.</p>';
    }

    function renderReview() {
      const count = chosen.length;
      const monthlyPricing = useMonthlyPricing();
      const itemsCents = chosen.reduce((sum, item) => sum + Math.round(findVariant(item.id, item.size).price * 100), 0);
      const monthlyTotalCents = chosen.reduce((sum, item) => sum + monthlyCents(findVariant(item.id, item.size).price), 0);
      const includedCount = monthlyPricing ? Math.floor(count / setSize) : 0;
      const giftCents = giftUnitCents * includedCount;
      const remaining = capacity - count;
      get('count').textContent = count + ' / ' + capacity;
      get('mobile-count').textContent = count + '/' + capacity;
      get('progress').max = capacity;
      get('progress').value = count;
      get('subtotal').innerHTML = price((itemsCents + giftCents) / 100);
      get('monthly-total').innerHTML = price(monthlyTotalCents / 100) + ' <small>/mo</small>';
      get('savings').innerHTML = (itemsCents ? '−' : '') + price((itemsCents - monthlyTotalCents) / 100);
      get('gift-savings').innerHTML = giftCents ? '−' + price(giftCents / 100) : 'Included';
      get('gift-line').hidden = !includedCount;
      for (const line of monthlyLines) line.hidden = !monthlyPricing;
      get('timeline').hidden = !monthlyPricing;
      const amountLabel = 'Continue · ' + price(monthlyTotalCents / 100) + '/mo';
      const chooseLabel = count ? 'Choose ' + remaining + ' more' : 'Choose four products';
      monthly.innerHTML = remaining ? chooseLabel : monthlyPricing ? amountLabel : 'Continue';
      mobileContinue.innerHTML = monthly.hidden ? cart.textContent : monthly.innerHTML;
      cart.disabled = remaining > 0;
      monthly.disabled = !monthlyPricing || cart.disabled;
      mobileContinue.disabled = monthly.hidden ? cart.disabled : monthly.disabled;
      const rows = chosen.map(({ id, size }, index) => {
        const product = store.product(id);
        return `<li class="pss-selected">
          <img width="42" height="48" src="${esc(store.image(product, size))}" alt="">
          <span class="pss-item-text"><strong>${esc(product.name)}</strong><small>${esc(size)}</small></span>
          <b class="pss-row-price">${itemPrice(id, size)}</b>
          <button type="button" class="pss-remove" data-pss-remove="${index}" aria-label="Remove ${esc(product.name)} ${esc(size)}">×</button>
        </li>`;
      }).join('');
      const openSlots = Array.from({ length: remaining }, (_, index) =>
        `<li class="pss-open-slot"><button type="button" data-pss-choose aria-label="Choose a product for selection ${count + index + 1}"><span aria-hidden="true">+</span>Choose a product</button></li>`
      ).join('');
      const included = includedCount ? `<li class="pss-included">
        <img width="42" height="48" src="${esc(store.image(gift, '3 mL'))}" alt="">
        <span class="pss-item-text"><strong>Reconstitution solution</strong><small>3 mL${includedCount > 1 ? ' × ' + includedCount : ''} · Every delivery</small></span>
        <span class="pss-gift-label">Included</span>
      </li>` : '';
      selection.innerHTML = `<ul class="pss-selection" aria-label="Plan selections">${rows}${openSlots}${included}</ul>`;
    }

    function render() {
      renderProducts();
      renderReview();
    }

    function focusCard(id, selector) {
      [...products.querySelectorAll('[data-pss-product]')].find(card => card.dataset.pssProduct === id)?.querySelector(selector)?.focus({ preventScroll: true });
    }

    search.addEventListener('input', renderProducts);
    get('filters').addEventListener('click', event => {
      const button = event.target.closest('[data-pss-group]');
      if (!button) return;
      group = button.dataset.pssGroup;
      for (const option of get('filters').children) option.setAttribute('aria-pressed', String(option === button));
      renderProducts();
    });
    products.addEventListener('click', event => {
      const button = event.target.closest('button');
      const card = button?.closest('[data-pss-product]');
      if (!card) return;
      const id = card.dataset.pssProduct;
      if (button.hasAttribute('data-pss-size')) {
        sizes.set(id, button.dataset.pssSize);
        renderProducts();
        focusCard(id, '[aria-pressed="true"]');
        return;
      }
      if (!button.hasAttribute('data-pss-pick') || chosen.length >= capacity) return;
      const size = sizes.get(id) || catalog.get(id)[0].size;
      chosen.push({ id, size });
      status(store.product(id).name + ' ' + size + ' added to your plan.');
      save();
      render();
      focusCard(id, '[data-pss-pick]');
    });
    let focusAfterDrawer = mobileReview;
    const focusSearch = () => {
      if (drawer.open) {
        focusAfterDrawer = search;
        drawer.close();
      } else {
        search.focus();
      }
    };
    mobileReview.addEventListener('click', event => {
      if (typeof drawer.showModal !== 'function' || drawer.open) return;
      event.preventDefault();
      drawer.append(summary);
      drawer.showModal();
      get('close').focus();
    });
    get('close').addEventListener('click', () => drawer.close());
    drawer.addEventListener('close', () => {
      drawer.before(summary);
      focusAfterDrawer.focus();
      focusAfterDrawer = mobileReview;
    });
    const mobileViewport = window.matchMedia?.('(max-width: 800px)');
    mobileViewport?.addEventListener?.('change', event => {
      if (!event.matches && drawer.open) drawer.close();
    });
    selection.addEventListener('click', event => {
      if (event.target.closest('[data-pss-choose]')) {
        focusSearch();
        return;
      }
      const remove = event.target.closest('[data-pss-remove]');
      if (!remove) return;
      chosen.splice(Number(remove.dataset.pssRemove), 1);
      capacity = minimumSlots();
      status('Item removed.');
      save();
      render();
      (selection.querySelector('.pss-remove') || selection.querySelector('[data-pss-choose]')).focus();
    });
    function orderLines() {
      const items = new Map();
      for (const { id, size } of chosen) {
        const key = id + ':' + size;
        const row = items.get(key) || { id, size, qty: 0 };
        row.qty++;
        items.set(key, row);
      }
      return items;
    }
    mobileContinue.addEventListener('click', () => (monthly.hidden ? cart : monthly).click());
    monthly.addEventListener('click', () => {
      if (!useMonthlyPricing() || cart.disabled) return;
      try {
        sessionStorage.setItem('pure-monthly-builder', JSON.stringify([...orderLines().values()]));
      } catch {
        status('Allow this site to save your selection to review monthly invoices.');
        return;
      }
      location.assign('/subscribe-and-save/checkout');
    });
    cart.addEventListener('click', () => {
      if (!chosen.length || chosen.length % setSize !== 0) return;
      const items = orderLines();
      const existing = new Map(store.cart.map(item => [item.key, item.qty]));
      if (new Set([...existing.keys(), ...items.keys()]).size > 60 ||
          [...items].some(([key, item]) => (existing.get(key) || 0) + item.qty > 100)) {
        status('Remove or reduce items in your plan or cart before adding the plan.');
        return;
      }
      try {
        store.addItems([...items.values()]);
        status('Plan added to your cart.');
        document.querySelector('.ap-header [data-action="cart"]')?.click();
      } catch (error) {
        status(error.message);
      }
    });

    function unavailable() {
      monthly.hidden = true;
      cart.hidden = false;
      status('Monthly checkout is unavailable. You can still add these products to your cart.');
      renderReview();
    }

    renderFilters();
    render();
    if (window.fetch) fetch('/api/customer-config?repeat_orders=status')
      .then(response => response.ok ? response.json() : null)
      .then(config => {
        if (config?.available === true) {
          monthlyAvailable = true;
          render();
        } else unavailable();
      }).catch(unavailable);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
