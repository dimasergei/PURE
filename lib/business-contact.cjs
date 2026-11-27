'use strict';

const { site: { company, support } } = require('../config/site.ts');

const lines = [company.name, ...company.address, company.phone, support.email];
const escapeText = line => line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

module.exports = `<address class="pure-business-contact">${lines.map(escapeText).join('<br>')}</address>`;
