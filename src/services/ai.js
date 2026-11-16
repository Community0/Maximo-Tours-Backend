/* ═══════════════════════════════════════════════════════════
   AI — concierge chatbot (prezzi sempre live dal catalogo),
   traduzioni CMS, analisi campagne Ads.
═══════════════════════════════════════════════════════════ */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { getTours, getContentKey } = require('./catalog');

let anthropic = null;
try {
  if (config.anthropicApiKey) anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
} catch (e) { console.error('[Anthropic]', e.message); }

const LANG_NAME = {
  it: 'Italiano', en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português',
  zh: '中文', ja: '日本語', ru: 'Русский', ar: 'العربية', he: 'עברית', ko: '한국어',
  ro: 'Română', pl: 'Polski', uk: 'Українська', nl: 'Nederlands', no: 'Norsk', cs: 'Čeština',
  sq: 'Shqip', th: 'ไทย', fil: 'Filipino', ga: 'Gaeilge', lv: 'Latviešu',
};

function normalizeLang(lang) {
  if (!lang) return 'it';
  const s = String(lang).toLowerCase().trim();
  return LANG_NAME[s] ? s : 'en';
}

/* ── System prompt costruito live dal catalogo:
   se cambi un prezzo da Microwade, il chatbot lo sa subito. ── */
let promptCache = { text: null, at: 0 };

async function buildSystemPrompt() {
  if (promptCache.text && Date.now() - promptCache.at < 60000) return promptCache.text;

  const [tours, settings, extras] = await Promise.all([
    getTours().catch(() => []),
    getContentKey('business_settings', {}),
    getContentKey('booking_extras', {}),
  ]);

  const tourLines = (tours || []).map(t => {
    const name = t.names?.it || t.id;
    const parts = [`- ${name} (${t.duration || 'durata da definire'})`];
    if (t.pricing?.private) {
      const p = t.pricing.private;
      parts.push(`  Privato: 1–3 pax €${p['1-3']} · 4–5 pax €${p['4-5']} · 6–7 pax €${p['6-7']}`);
    }
    if (t.pricing?.shared) {
      parts.push(`  Condiviso: €${t.pricing.shared.perPerson} a persona (${t.pricing.shared.minPax || 1}–${t.pricing.shared.maxPax || 15} ospiti)`);
    }
    if (t.custom?.extraStopFee) {
      parts.push(`  Su misura: ${t.custom.includedStops} tappe incluse, +€${t.custom.extraStopFee} per tappa extra`);
    }
    return parts.join('\n');
  }).join('\n');

  const childSeat = extras?.childSeat?.price ?? 25;
  const wa = settings?.whatsapp || config.publicWhatsapp;
  const phone = settings?.phone || config.publicPhone; /* vuoto se non configurato */

  const text = `Sei l'assistente virtuale di Maximo Tours, azienda che offre tour privati esclusivi in golf cart nel centro storico di Roma.

OBIETTIVO:
- Rispondi in modo rapido, chiaro e orientato alla prenotazione.
- Se manca un dato essenziale (data, numero persone, hotel/area, lingua), chiedilo con UNA domanda.
- Se l'utente chiede prezzi, dai i prezzi chiari e indica che quelli privati sono "per gruppo".

TOUR E PREZZI ATTUALI (fonte ufficiale, aggiornata in tempo reale):
${tourLines || '- Catalogo momentaneamente non disponibile: invita a scrivere su WhatsApp.'}

EXTRA:
- Seggiolino bimbo prenotabile in anticipo: +€${childSeat}.
- Acqua fresca sempre gratuita durante il tour.
- Bevande fresche su richiesta (da concordare via WhatsApp).

ACCESSIBILITÀ:
- Nessuna barriera architettonica; adatto a tutte le età. Invita a indicare eventuali necessità nelle note.

PICKUP:
- ${settings?.pickupNote || 'Pickup in hotel o punto concordato nel centro di Roma'}.

PAGAMENTO:
- Pagamento online sicuro con carta (Stripe). Conferma prenotazione dopo pagamento.
- Cancellazione gratuita fino a ${settings?.cancellationHours || 24} ore prima.

CONTATTI:
- WhatsApp: ${wa}${phone ? `\n- Tel: ${phone}` : ''}

REGOLE:
- Non inventare disponibilità: invita a scegliere data e orario e conferma via prenotazione.
- Se l'utente chiede "prenota", guida ai passaggi e riepiloga: tour, data, pax, pickup, note.
- Non inventare mai prezzi diversi da quelli sopra.`;

  promptCache = { text, at: Date.now() };
  return text;
}

function invalidatePrompt() { promptCache = { text: null, at: 0 }; }

async function chat(messages, lang) {
  if (!anthropic) return null;
  const system = await buildSystemPrompt();
  const nLang = normalizeLang(lang);
  const response = await anthropic.messages.create({
    model: config.anthropicChatModel,
    max_tokens: 450,
    system: `${system}\n\nRISPOSTA: Rispondi sempre in ${LANG_NAME[nLang] || 'Italiano'}.`,
    messages,
  });
  return response.content?.[0]?.text || null;
}

/* ── Traduzione CMS: oggetto {chiave: testo} → tutte le lingue ── */
const CMS_LANGS = ['it', 'en', 'fr', 'de', 'es', 'pt'];

async function translateContent(source, sourceLang = 'it', langs = CMS_LANGS) {
  if (!anthropic) return { translations: null, mode: 'unavailable' };
  const prompt = `You are translating premium travel website copy for Maximo Tours, a luxury private golf cart tour operator in Rome.

Source language: ${sourceLang}
Target languages: ${langs.join(', ')}

Return ONLY valid JSON in this exact shape:
{${langs.map(l => `"${l}":{...}`).join(',')}}

Rules:
- Keep the exact same keys as the source object.
- Preserve premium/luxury conversion tone.
- Keep CTA copy short and elegant.
- No markdown, no explanations, JSON only.

Source object:
${JSON.stringify(source)}`;
  try {
    const r = await anthropic.messages.create({
      model: config.anthropicProModel,
      max_tokens: 4000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    });
    let txt = (r.content?.[0]?.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const translations = JSON.parse(txt);
    for (const l of langs) if (!translations[l]) translations[l] = { ...source };
    return { translations, mode: 'anthropic' };
  } catch (e) {
    return { translations: null, mode: 'error', warning: e.message };
  }
}

/* ── Analisi campagne Ads da CSV ── */
function csvPreviewPack(csvFiles) {
  const MAX_TOTAL_CHARS = 180000;
  const MAX_ROWS_PER_FILE = 70;
  let totalRows = 0, used = 0;
  const parts = [];
  for (const f of csvFiles) {
    const lines = String(f.text || '').split(/\r?\n/).filter(Boolean);
    const header = lines[0] || '';
    const rows = lines.slice(1);
    totalRows += rows.length;
    const sample = [header, ...rows.slice(0, MAX_ROWS_PER_FILE)].join('\n');
    const piece = `\n\n### FILE: ${f.name}\nRows: ${rows.length}\n${sample}`;
    if (used + piece.length > MAX_TOTAL_CHARS) break;
    parts.push(piece);
    used += piece.length;
  }
  return { text: parts.join('\n'), totalRows };
}

async function analyzeAds({ platform, goal, files = [] }) {
  const pack = csvPreviewPack(files);
  if (!anthropic) {
    return {
      report: `Anthropic non configurato: aggiungi ANTHROPIC_API_KEY su Railway.\n\nCSV ricevuti: ${files.length} file, ${pack.totalRows} righe totali.\nQuando configuri la chiave riceverai qui il report operativo completo.`,
      rows: pack.totalRows,
    };
  }
  const prompt = `You are a senior Google Ads / Meta Ads performance strategist for Maximo Tours, a premium private golf cart tour operator in Rome.

Business context:
- Product: private premium golf cart tours in Rome.
- Primary conversion: direct paid booking. Secondary: WhatsApp lead.
- Brand position: premium, elegant, private — not cheap/mass market.
- Goal from admin: ${goal || 'Increase profitable direct bookings'}

Platform: ${platform || 'generic'}
Files included: ${files.map(f => f.name).join(', ')}
Total CSV rows: ${pack.totalRows}

CSV data:
${pack.text}

Analyze the data and produce an operational report in Italian with this exact structure:

1. Sintesi secca
2. Punti forti
3. Punti deboli / sprechi
4. Campagne, gruppi, keyword o annunci da attenzionare
5. Cosa aumentare / cosa ridurre
6. Negative keywords consigliate se applicabile
7. Consigli landing page / messaggi
8. Priorità operative per le prossime 48 ore
9. Domande o dati mancanti

Be direct, practical, and conversion-first. Do not invent metrics not present in the CSV. If columns are missing, say it clearly.`;

  const r = await anthropic.messages.create({
    model: config.anthropicProModel,
    max_tokens: 3500,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });
  return { report: r.content?.map(b => b.text || '').join('\n').trim(), rows: pack.totalRows };
}

module.exports = {
  isAvailable: () => !!anthropic,
  chat,
  normalizeLang,
  translateContent,
  analyzeAds,
  invalidatePrompt,
  CMS_LANGS,
};
