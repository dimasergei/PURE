const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const source = readFileSync(resolve(__dirname, "../products.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}; globalThis.catalog = CATALOG; globalThis.groups = GROUPS;`, sandbox);
const { catalog, groups } = sandbox;

test("USD list prices end in .95 and rise with strength within each product", () => {
  for (const product of catalog) {
    let previousPrice = 0;
    for (const variant of product.variants) {
      const label = `${product.name} ${variant.size}`;
      assert.equal(Math.round(variant.price * 100) % 100, 95, label);
      assert.ok(variant.price > previousPrice, label);
      previousPrice = variant.price;
    }
  }
});

test("current products and variants remain unique and valid", () => {
  const ids = catalog.map((product) => product.id);
  assert.equal(catalog.length, 45);
  assert.equal(catalog.reduce((sum, product) => sum + product.variants.length, 0), 84);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("needles"), "The withdrawn supplies SKU is not selectable.");
  for (const product of catalog) {
    assert.ok(groups.includes(product.group), product.name);
    assert.equal(new Set(product.variants.map(variant => variant.size)).size, product.variants.length, product.id);
    for (const variant of product.variants) {
      assert.ok(variant.size);
      assert.ok(Number.isFinite(variant.price) && variant.price > 0);
    }
  }
});

test("featured and spotlight entries show the configured minimum prices", () => {
  for (const [id, expected] of [["retatrutide", 78.95], ["tirzepatide", 74.95], ["semaglutide", 62.95], ["bpc-157", 29.95]]) {
    const product = catalog.find((item) => item.id === id);
    assert.equal(Math.min(...product.variants.map((variant) => variant.price)), expected);
  }
});

test("category cards keep the PURE neutral palette and variants resolve to their exact branded photos", () => {
  const imageSource = readFileSync(resolve(__dirname, "../product-images.js"), "utf8");
  vm.runInContext(`${imageSource}; globalThis.images = PRODUCT_IMAGES; globalThis.fallbacks = PRODUCT_IMAGE_FALLBACKS;`, sandbox);
  const storefront = readFileSync(resolve(__dirname, "../storefront-v2.js"), "utf8");
  const resolverStart = storefront.indexOf("const image="), resolverEnd = storefront.indexOf("function normalizeLines", resolverStart);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, "The live storefront exposes its image resolver.");
  vm.runInContext(`${storefront.slice(resolverStart, resolverEnd)}; globalThis.resolveProductImage = image;`, sandbox);
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
  for (const group of groups.filter((group) => group !== "All")) {
    const rule = `.card[data-group="${group}"]`;
    assert.ok(css.includes(rule), `Missing background for ${group}`);
    const color = css.slice(css.indexOf(rule)).match(/--card-bg:\s*#([a-f0-9]{6})/i)?.[1];
    assert.ok(color, `Missing neutral background value for ${group}`);
    assert.equal(color.slice(0, 2), color.slice(2, 4), `${group} uses a neutral tone`);
    assert.equal(color.slice(2, 4), color.slice(4, 6), `${group} uses a neutral tone`);
  }
  let brandedPhotos = 0;
  const fallbacks = [];
  for (const product of catalog) {
    for (const variant of product.variants) {
      const image = sandbox.images[product.id]?.[variant.size];
      if (!image) {
        fallbacks.push([product.id, variant.size]);
        const fallback = sandbox.fallbacks[product.id];
        assert.equal(new URL(fallback).protocol, "https:");
        assert.equal(sandbox.resolveProductImage(product, variant.size), fallback);
        continue;
      }
      assert.match(image, /^assets\/products-pure\/[^/]+\.svg$/);
      const svg = readFileSync(resolve(__dirname, "..", image), "utf8");
      const assetName = product.name === "Reconstitution Solution" ? "Recon Solution" : product.name;
      assert.equal(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1], `PURE ${assetName} ${variant.size}`);
      assert.match(svg, /viewBox="0 0 1081 1455"/);
      const photo = svg.match(/(?:xlink:)?href="data:image\/webp;base64,([^"]+)"/)?.[1];
      assert.ok(photo, `${product.id} ${variant.size} contains its photographic vial frame`);
      const bytes = Buffer.from(photo, "base64");
      assert.ok(bytes.length > 1000);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
      assert.equal(sandbox.resolveProductImage(product, variant.size), "/" + image);
      brandedPhotos++;
    }
  }
  assert.equal(brandedPhotos, 84);
  assert.deepEqual(fallbacks, [], "Variants without a branded image use the supplied fallback.");
  assert.match(readFileSync(resolve(__dirname, "../assets/pure-brand-label.svg"), "utf8"), /<title[^>]*>PURE<\/title>/);
});
