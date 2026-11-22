const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const vm = require("node:vm");

const source = readFileSync(resolve(__dirname, "../products.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}; globalThis.catalog = CATALOG; globalThis.groups = GROUPS;`, sandbox);
const { catalog, groups } = sandbox;

test("catalog matches the approved product source snapshot", () => {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "dfd90343316715e6b73f9faf8c40bc364f309b5882dbf361fa424a6c156ca842"
  );
});

test("current products and variants remain unique and valid", () => {
  assert.equal(catalog.length, 46);
  assert.equal(catalog.reduce((sum, product) => sum + product.variants.length, 0), 85);
  assert.equal(new Set(catalog.map((product) => product.id)).size, 46);
  for (const product of catalog) {
    assert.ok(groups.includes(product.group), product.name);
    for (const variant of product.variants) {
      assert.ok(variant.size);
      assert.ok(Number.isFinite(variant.price) && variant.price > 0);
    }
  }
});

test("featured and spotlight entries show the configured minimum prices", () => {
  for (const [id, expected] of [["retatrutide", 66], ["tirzepatide", 39], ["semaglutide", 63], ["bpc-157", 30]]) {
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
      assert.equal(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1], `PURE ${product.name} ${variant.size}`);
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
  assert.equal(brandedPhotos, 83);
  assert.deepEqual(fallbacks, [["bpc-tb-500", "5mg/5mg"], ["needles", "10pk"]], "Variants without a branded image use the supplied fallback.");
  assert.match(readFileSync(resolve(__dirname, "../assets/pure-brand-label.svg"), "utf8"), /<title[^>]*>PURE<\/title>/);
});
