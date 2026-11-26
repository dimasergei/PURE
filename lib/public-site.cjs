'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Serverless handlers and static pages share the snapshot made by the same build.
// Source-only unit tests and local tools can also run before that build exists.
const emitted = path.join(__dirname, 'public-site-facts.json');
module.exports = fs.existsSync(emitted)
  ? {site: require('./public-site-facts.json')}
  : require('../config/site.ts');
