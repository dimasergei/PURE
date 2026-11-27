'use strict';

const { site: { name, company, support } } = require('../config/site.ts');

const supportLines = [company.phone, support.email];
const publicAddress = ['145 Columbia St W', 'Waterloo, ON N2L 0K7', 'Canada'];
const escapeText = line => line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const render = lines => `<address class="pure-business-contact">${lines.map(escapeText).join('<br>')}</address>`;

module.exports = {
  footer: render(supportLines),
  contactPage: render([name, ...publicAddress, ...supportLines])
};
