/* ═══════════════════════════════════════════════════════════
   STRIPE WEBHOOK — conferma pagamento → booking confermato,
   email di conferma, consumo coupon.
   NB: montato PRIMA di express.json() con body raw.
═══════════════════════════════════════════════════════════ */
const express = require('express');
const config = require('../config');
const { q } = require('../db');
const { stripe } = require('../services/stripe');
const { sendPaymentConfirmedEmail } = require('../services/email');
const { redeemCoupon } = require('../services/catalog');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!config.stripeWebhookSecret || !stripe) return res.sendStatus(200);
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const paidEur = (pi.amount_received || pi.amount) / 100;

      /* v5: la prenotazione è già legata al PI; v4 legacy: match su stripe_payment_id */
      await q(
        "UPDATE bookings SET status='confirmed', stripe_payment_id=$1, amount=$2, updated_at=NOW() WHERE stripe_payment_id=$1 OR id=$3",
        [pi.id, paidEur, pi.metadata?.bookingId || '—']
      );

      const bookingRes = await q('SELECT * FROM bookings WHERE stripe_payment_id=$1 OR id=$2 LIMIT 1', [pi.id, pi.metadata?.bookingId || '—']);
      const booking = bookingRes?.rows?.[0];

      if (booking?.coupon_code) await redeemCoupon(booking.coupon_code);

      if (booking && !booking.email_payment_confirmed_sent) {
        const mailResult = await sendPaymentConfirmedEmail(booking, pi);
        if (mailResult?.success) {
          await q('UPDATE bookings SET email_payment_confirmed_sent=TRUE, updated_at=NOW() WHERE id=$1', [booking.id]);
        }
      }
      console.log(`✅ Pagamento confermato via webhook: ${pi.id} — €${paidEur}`);
    }

    /* link di pagamento quick-create (Stripe Checkout) */
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const bid = s.metadata?.bookingId;
      if (bid) {
        await q(
          `UPDATE bookings SET status='confirmed', payment_status='paid',
             stripe_payment_id=COALESCE($1, stripe_payment_id),
             amount=COALESCE($2, amount), updated_at=NOW()
           WHERE id=$3`,
          [s.payment_intent || null, s.amount_total ? s.amount_total / 100 : null, bid]
        );
        console.log(`✅ Link di pagamento pagato: booking ${bid} — €${(s.amount_total || 0) / 100}`);
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      await q("UPDATE bookings SET status='payment_failed', updated_at=NOW() WHERE stripe_payment_id=$1 AND status='pending'", [pi.id]);
      console.log(`⚠️ Pagamento fallito: ${pi.id}`);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('[Webhook]', e.message);
    res.status(400).send('Webhook Error: ' + e.message);
  }
});

module.exports = router;
