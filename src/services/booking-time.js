/* AURA — Server-side booking notice guard (calendar dates are local to Rome).
   No business data/Stripe dependencies: easy to test in isolation. */
'use strict';

const ROME_TZ = 'Europe/Rome';
const MIN_NOTICE_MS = 2 * 60 * 60 * 1000;
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ROME_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function partsInRome(ms) {
  const parts = {};
  for (const { type, value } of formatter.formatToParts(new Date(ms))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/* A Rome wall-clock time can be non-existent (spring DST) or occur twice
   (autumn DST). Treat duplicate times as the EARLIER instant: this errs
   on the side of a longer notice period and avoids accepting a short lead. */
function romeSlotEpoch(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const tm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
  if (!dm || !tm) return null;
  const y = Number(dm[1]), m = Number(dm[2]), d = Number(dm[3]);
  const h = Number(tm[1]), min = Number(tm[2]);
  if (y < 2000 || y > 2100) return null;
  const wall = Date.UTC(y, m - 1, d, h, min);
  const parsed = new Date(wall);
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d || parsed.getUTCHours() !== h ||
      parsed.getUTCMinutes() !== min) return null;

  // Italy: UTC+1 winter, UTC+2 summer. Verify rather than assume an offset.
  const matches = [1, 2]
    .map(offset => wall - offset * 3600000)
    .filter(ms => {
      const p = partsInRome(ms);
      return p.year === y && p.month === m && p.day === d &&
        p.hour === h && p.minute === min;
    });
  return matches.length ? Math.min(...matches) : null;
}

function checkBookingLeadTime(date, time, nowMs = Date.now()) {
  if (!date || !time) {
    return { ok: false, code: 'INVALID_BOOKING_TIME', error: 'Seleziona una data e un orario per il tour.' };
  }
  const startMs = romeSlotEpoch(date, time);
  if (startMs === null) {
    return { ok: false, code: 'INVALID_BOOKING_TIME', error: 'Data o orario non valido per Roma.' };
  }
  if (startMs - nowMs < MIN_NOTICE_MS) {
    return { ok: false, code: 'BOOKING_TOO_SOON', error: 'Prenotazione online disponibile almeno 2 ore prima del tour (ora di Roma). Scegli un orario successivo.' };
  }
  return { ok: true, startMs };
}

module.exports = { ROME_TZ, MIN_NOTICE_MS, romeSlotEpoch, checkBookingLeadTime };
