'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {site} = require('../config/site.ts');
const {buildHeadSEO} = require('../seo-build.cjs');
const {buildAddedPages} = require('./additive-storefront.cjs');
const {buildQueries} = require('../restore-query-build.cjs');

async function publish(out = path.resolve('public-build')) {
  // Use the same verified facts in public documents and serverless form/search handlers.
  fs.writeFileSync(path.resolve('lib/public-site-facts.json'), JSON.stringify(site) + '\n');
  await buildAddedPages(out, site);
  await buildHeadSEO(out, site);
  await buildQueries(out, site);
}

if (require.main === module) publish().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = {publish};
