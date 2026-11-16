/* ═══════════════════════════════════════════════════════════
   EMAIL — Resend + log su DB. Layout unico oro/nero Aura,
   template per: richiesta ricevuta, pagamento confermato,
   verifica account, alert admin.
═══════════════════════════════════════════════════════════ */
const config = require('../config');
const { q, isReady } = require('../db');

const GOLD = '#C8A96A';
const BG = '#080706';
const TEXT = '#E8E0D0';
const MUTED = '#9A9088';
const BORDER = 'rgba(200,169,106,0.15)';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateDisplay(value) {
  if (!value) return 'Da definire';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [y, m, d] = String(value).split('-');
    return `${d}/${m}/${y}`;
  }
  return String(value);
}

function formatMoneyEUR(amountCents) {
  if (amountCents == null || amountCents === '') return 'Da confermare';
  const eur = Number(amountCents) / 100;
  if (!Number.isFinite(eur)) return 'Da confermare';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(eur);
}

function inferMailDomain() {
  const match = (config.resendFromEmail || '').match(/@([^>\s]+)/);
  return match?.[1] || 'maximotours.it';
}

function getSender(kind = 'default') {
  const domain = inferMailDomain();
  const defaults = {
    default: `Maximo Tours <noreply@${domain}>`,
    booking: `Maximo Bookings <bookings@${domain}>`,
    welcome: `Welcome Team <welcome@${domain}>`,
    experience: `Guest Experience <experience@${domain}>`,
    review: `Reviews Team <reviews@${domain}>`,
    admin: `Maximo Operations <operations@${domain}>`,
  };
  const envMap = {
    booking: process.env.RESEND_FROM_EMAIL_BOOKING,
    welcome: process.env.RESEND_FROM_EMAIL_WELCOME,
    experience: process.env.RESEND_FROM_EMAIL_EXPERIENCE,
    review: process.env.RESEND_FROM_EMAIL_REVIEW,
    admin: process.env.RESEND_FROM_EMAIL_ADMIN,
    default: config.resendFromEmail,
  };
  return envMap[kind] || defaults[kind] || defaults.default;
}

/* ── Log su DB ── */
async function createEmailLog(entry = {}) {
  if (!isReady()) return null;
  const r = await q(
    `INSERT INTO email_logs
      (kind,direction,sender,recipient,subject,status,provider,provider_message_id,related_booking_id,related_user_email,reply_to,error,html_preview)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      entry.kind || null, entry.direction || 'outbound', entry.sender || null,
      entry.recipient || null, entry.subject || null, entry.status || 'queued',
      entry.provider || 'resend', entry.provider_message_id || null,
      entry.related_booking_id || null, entry.related_user_email || null,
      entry.reply_to || null, entry.error || null,
      entry.html_preview ? String(entry.html_preview).slice(0, 50000) : null,
    ]
  );
  return r?.rows?.[0]?.id || null;
}

async function updateEmailLog(id, patch = {}) {
  if (!isReady() || !id) return false;
  const fields = []; const vals = []; let i = 1;
  const allowed = ['status', 'provider_message_id', 'error'];
  for (const key of allowed) {
    if (patch[key] !== undefined) { fields.push(`${key}=$${i++}`); vals.push(patch[key]); }
  }
  if (!fields.length) return true;
  fields.push('updated_at=NOW()');
  vals.push(id);
  return !!(await q(`UPDATE email_logs SET ${fields.join(', ')} WHERE id=$${i}`, vals));
}

/* ── Invio ── */
async function sendMail(to, subject, html, options = {}) {
  const kind = options.kind || 'default';
  const from = options.from || getSender(kind);
  const replyTo = options.replyTo || config.replyToEmail;
  const logId = await createEmailLog({
    kind, sender: from, recipient: to, subject,
    status: config.resendApiKey ? 'queued' : 'failed',
    related_booking_id: options.relatedBookingId || null,
    related_user_email: options.relatedUserEmail || null,
    reply_to: replyTo || null,
    error: config.resendApiKey ? null : 'RESEND_API_KEY non configurata',
    html_preview: html || null,
  });

  if (!config.resendApiKey) {
    console.log(`[Email mock] To: ${to}, Subject: ${subject}`);
    return { success: false, reason: 'no_api_key', logId };
  }
  try {
    const payload = { from, to: [to], subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.resendApiKey}` },
      body: JSON.stringify(payload),
    });
    const respText = await resp.text();
    if (!resp.ok) {
      console.error(`❌ Email a ${to} FALLITA [${resp.status}]:`, respText);
      await updateEmailLog(logId, { status: 'failed', error: respText });
      return { success: false, reason: respText, logId };
    }
    const data = JSON.parse(respText);
    await updateEmailLog(logId, { status: 'sent', provider_message_id: data.id || null, error: null });
    console.log(`📧 Email inviata a ${to} — ID: ${data.id}`);
    return { success: true, id: data.id, logId };
  } catch (e) {
    console.warn('⚠️ Email error:', e.message);
    await updateEmailLog(logId, { status: 'failed', error: e.message });
    return { success: false, reason: e.message, logId };
  }
}

/* ── Layout comune ── */
function layout({ headerLabel, bodyHtml }) {
  return `
<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;background:${BG};color:${TEXT};border-radius:14px;overflow:hidden;border:1px solid ${BORDER}">
  <div style="background:linear-gradient(180deg,#13100d 0%,#0b0907 100%);padding:36px 34px 28px;text-align:center;border-bottom:1px solid ${BORDER}">
    <div style="font-family:Georgia,serif;color:${GOLD};font-size:30px;line-height:1.1">Maximo Tours</div>
    <div style="color:${MUTED};font-size:11px;letter-spacing:.22em;text-transform:uppercase;margin-top:8px">${headerLabel}</div>
  </div>
  <div style="padding:34px">${bodyHtml}</div>
  <div style="padding:18px 34px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;line-height:1.7;text-align:center">
    Maximo Tours · <a href="${config.siteUrl}" style="color:${GOLD}">${config.siteUrl.replace(/^https?:\/\//, '')}</a> · ${config.supportEmail}
  </div>
</div>`;
}

function row(label, value, width = 130) {
  if (!value) return '';
  return `<tr>
    <td style="padding:10px 0;color:${MUTED};font-size:13px;width:${width}px;border-bottom:1px solid ${BORDER}">${label}</td>
    <td style="padding:10px 0;font-size:14px;border-bottom:1px solid ${BORDER}">${value}</td>
  </tr>`;
}

function ctaButtons(bookingId) {
  return `<div style="text-align:center">
    <a href="${config.whatsappHref}?text=${encodeURIComponent(`Ciao! Ho prenotato il tour [${bookingId}]`)}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 6px 10px">WhatsApp</a>
    <a href="mailto:${config.supportEmail}?subject=Booking ${bookingId}" style="display:inline-block;background:${GOLD};color:${BG};text-decoration:none;padding:14px 22px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 6px 10px">Email Support</a>
  </div>`;
}

/* ── Template: richiesta di prenotazione ricevuta (cliente + admin) ── */
async function sendBookingRequestEmails(booking) {
  if (!config.resendApiKey) return { success: false, reason: 'no_api_key' };

  const bookingId = escapeHtml(booking.bookingId);
  const customerName = escapeHtml(booking.name);
  const phoneDigits = String(booking.phone || '').replace(/\D/g, '');

  const clienteHtml = layout({
    headerLabel: 'Booking Request Received',
    bodyHtml: `
    <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 10px;color:#fff;font-weight:500">La tua richiesta è stata ricevuta</h1>
    <p style="margin:0 0 22px;color:${MUTED};font-size:15px;line-height:1.7">Ciao <strong style="color:#fff">${customerName}</strong>, grazie per aver scelto Maximo Tours. Abbiamo registrato la tua prenotazione: riceverai la conferma definitiva e tutti i dettagli operativi appena il pagamento sarà verificato.</p>
    <div style="background:rgba(200,169,106,.06);border:1px solid ${BORDER};border-radius:12px;padding:20px 22px;margin-bottom:22px">
      <div style="color:${GOLD};font-size:11px;letter-spacing:.22em;text-transform:uppercase;margin-bottom:12px">Dettagli prenotazione</div>
      <table style="width:100%;border-collapse:collapse">
        ${row('Booking ID', `<strong style="color:${GOLD}">${bookingId}</strong>`)}
        ${row('Tour', `<strong>${escapeHtml(booking.tour)}</strong>`)}
        ${row('Guests', escapeHtml(booking.people || 'Da definire'))}
        ${row('Date', escapeHtml(formatDateDisplay(booking.date)))}
        ${row('Time', escapeHtml(booking.time || 'Da definire'))}
        ${row('Payment', 'In attesa di conferma definitiva')}
        ${booking.notes ? row('Notes', `<em>${escapeHtml(booking.notes)}</em>`) : ''}
      </table>
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid ${BORDER};border-radius:12px;padding:18px 20px;margin-bottom:24px">
      <p style="margin:0 0 10px;color:#fff;font-size:14px"><strong>Cosa succede ora</strong></p>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.75">Pickup in hotel o punto concordato nel centro di Roma, assistenza rapida su WhatsApp, cancellazione gratuita fino a 24 ore prima e supporto diretto per richieste speciali.</p>
    </div>
    ${ctaButtons(booking.bookingId)}`,
  });

  const adminHtml = layout({
    headerLabel: 'Internal alert · Nuova prenotazione',
    bodyHtml: `
    <p style="margin:0 0 18px;font-size:18px;color:#fff"><strong>${customerName}</strong> · <span style="color:${GOLD}">${bookingId}</span></p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
      ${row('Cliente', customerName)}
      ${row('Email', `<a href="mailto:${escapeHtml(booking.email)}" style="color:${GOLD}">${escapeHtml(booking.email)}</a>`)}
      ${row('Telefono', booking.phone ? `<a href="tel:${escapeHtml(booking.phone)}" style="color:${GOLD}">${escapeHtml(booking.phone)}</a>` : null)}
      ${row('Tour', `<strong>${escapeHtml(booking.tour)}</strong>`)}
      ${row('Persone', escapeHtml(booking.people || 'Da definire'))}
      ${row('Data', escapeHtml(formatDateDisplay(booking.date)))}
      ${row('Ora', escapeHtml(booking.time || 'Da definire'))}
      ${row('Importo', booking.amount ? `€${escapeHtml(booking.amount)}` : 'Da confermare')}
      ${booking.couponCode ? row('Coupon', escapeHtml(booking.couponCode)) : ''}
      ${row('Pagamento', booking.stripePaymentId ? `Stripe · <code style="color:${GOLD}">${escapeHtml(booking.stripePaymentId)}</code>` : escapeHtml(booking.paymentMethod || 'Da confermare'))}
      ${booking.notes ? row('Note', `<em>${escapeHtml(booking.notes)}</em>`) : ''}
    </table>
    <div>
      ${phoneDigits ? `<a href="https://wa.me/${phoneDigits}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 8px 8px 0">WhatsApp cliente</a>` : ''}
      <a href="mailto:${escapeHtml(booking.email)}?subject=Booking ${booking.bookingId}" style="display:inline-block;background:${GOLD};color:${BG};text-decoration:none;padding:12px 18px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 8px 8px 0">Email cliente</a>
    </div>`,
  });

  try {
    const customerResult = await sendMail(
      booking.email,
      `Richiesta ricevuta [${booking.bookingId}] — Maximo Tours`,
      clienteHtml,
      { kind: 'booking', relatedBookingId: booking.bookingId, relatedUserEmail: booking.email }
    );
    await sendMail(
      config.adminEmail,
      `Nuova prenotazione [${booking.bookingId}] — ${booking.name}`,
      adminHtml,
      { kind: 'admin', relatedBookingId: booking.bookingId, relatedUserEmail: booking.email }
    );
    return customerResult;
  } catch (e) {
    console.warn('⚠️ Invio email fallito:', e.message);
    return { success: false, reason: e.message };
  }
}

/* ── Template: pagamento confermato ── */
async function sendPaymentConfirmedEmail(booking, paymentIntent) {
  if (!config.resendApiKey || !booking?.email || !paymentIntent?.id) return;
  const bookingId = escapeHtml(booking.id || booking.bookingId);
  const amountPaid = formatMoneyEUR(paymentIntent.amount_received || paymentIntent.amount);
  const paidAt = paymentIntent.created ? new Date(paymentIntent.created * 1000).toLocaleString('it-IT') : null;

  const html = layout({
    headerLabel: 'Payment Confirmed',
    bodyHtml: `
    <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 10px;color:#fff;font-weight:500">Pagamento confermato ✅</h1>
    <p style="margin:0 0 22px;color:${MUTED};font-size:15px;line-height:1.7">Ciao <strong style="color:#fff">${escapeHtml(booking.name)}</strong>, il pagamento della tua esperienza è stato confermato. La tua prenotazione è ora bloccata e registrata nel nostro sistema.</p>
    <div style="background:rgba(200,169,106,.06);border:1px solid ${BORDER};border-radius:12px;padding:20px 22px;margin-bottom:22px">
      <div style="color:${GOLD};font-size:11px;letter-spacing:.22em;text-transform:uppercase;margin-bottom:12px">Dettagli conferma</div>
      <table style="width:100%;border-collapse:collapse">
        ${row('Booking ID', `<strong style="color:${GOLD}">${bookingId}</strong>`, 145)}
        ${row('Tour', `<strong>${escapeHtml(booking.tour || paymentIntent.metadata?.tour || 'Tour privato')}</strong>`, 145)}
        ${row('Guests', escapeHtml(booking.people || paymentIntent.metadata?.people || 'Da definire'), 145)}
        ${row('Date', escapeHtml(formatDateDisplay(booking.date)), 145)}
        ${row('Time', escapeHtml(booking.time || 'Da definire'), 145)}
        ${row('Importo pagato', `<strong style="color:#fff">${escapeHtml(amountPaid)}</strong>`, 145)}
        ${row('Payment ID', `<code style="color:${GOLD}">${escapeHtml(paymentIntent.id)}</code>`, 145)}
        ${row('Confermato il', paidAt ? escapeHtml(paidAt) : null, 145)}
      </table>
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid ${BORDER};border-radius:12px;padding:18px 20px;margin-bottom:24px">
      <p style="margin:0 0 10px;color:#fff;font-size:14px"><strong>Prossimi step</strong></p>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.75">Ti contatteremo per gli ultimi dettagli logistici. Pickup in hotel o punto concordato nel centro di Roma, supporto rapido su WhatsApp e assistenza dedicata per richieste speciali.</p>
    </div>
    ${ctaButtons(booking.id || booking.bookingId)}`,
  });

  return sendMail(
    booking.email,
    `Pagamento confermato [${booking.id || booking.bookingId}] — Maximo Tours`,
    html,
    { kind: 'booking', relatedBookingId: booking.id || booking.bookingId, relatedUserEmail: booking.email }
  );
}

/* ── Template: codice di verifica account ── */
async function sendVerifyCodeEmail(email, name, code, { isNew = true } = {}) {
  const html = layout({
    headerLabel: isNew ? 'Account Verification' : 'New Verification Code',
    bodyHtml: `
    <h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 10px;color:#fff;font-weight:500">${isNew ? 'Conferma la tua email' : 'Nuovo codice di verifica'}</h1>
    <p style="margin:0 0 22px;color:${MUTED};font-size:15px;line-height:1.7">Ciao <strong style="color:#fff">${escapeHtml(name)}</strong>! Inserisci questo codice per completare la verifica:</p>
    <div style="background:rgba(200,169,106,.08);border:1px solid ${BORDER};padding:1.2rem;text-align:center;border-radius:10px;margin-bottom:22px">
      <div style="font-family:monospace;font-size:2.2rem;font-weight:700;color:${GOLD};letter-spacing:.3em">${escapeHtml(code)}</div>
      <div style="font-size:.72rem;color:${MUTED};margin-top:.4rem">Valido per 30 minuti</div>
    </div>
    <p style="color:${MUTED};font-size:.8rem;margin:0">Se non hai richiesto questa operazione, ignora questa email.</p>`,
  });
  return sendMail(email, `${code} — Codice di verifica Maximo Tours`, html, {
    kind: 'welcome', relatedUserEmail: String(email).toLowerCase().trim(),
  });
}

module.exports = {
  sendMail,
  sendBookingRequestEmails,
  sendPaymentConfirmedEmail,
  sendVerifyCodeEmail,
  escapeHtml,
  formatDateDisplay,
};
