/* ═══════════════════════════════════════════════════════════
   STRIPE — istanza condivisa
═══════════════════════════════════════════════════════════ */
const Stripe = require('stripe');
const config = require('../config');

let stripe = null;
try {
  if (config.stripeSecretKey) {
    stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2024-12-18.acacia' });
  }
} catch (e) { console.error('[Stripe]', e.message); }

module.exports = {
  stripe,
  isAvailable: () => !!stripe,
};
