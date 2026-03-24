const jwt = require('jsonwebtoken');
const { getCountry } = require('../config/countries');
const { upsertContact } = require('../integrations/mailchimp');
const { sendWelcomeMessage } = require('../integrations/whatsapp');
const { appendSaleRow } = require('../integrations/sheets');

/**
 * Verifica e decodifica o JWT do webhook da Publica.la.
 * Usa o webhookSecret específico do país.
 */
function verifyWebhookToken(rawToken, webhookSecret) {
  return jwt.verify(rawToken, webhookSecret, {
    algorithms: ['HS256'],
    issuer: 'farfalla',
  });
}

/**
 * Fábrica de handlers de webhook por país.
 * Retorna um middleware Express já vinculado ao countryCode informado.
 *
 * @param {string} countryCode - 'CL' | 'PE'
 * @returns {Function} middleware Express
 */
function makeWebhookHandler(countryCode) {
  const country = getCountry(countryCode);

  return async function handleWebhook(req, res) {
    // ----------------------------------------------------------------
    // LOG TEMPORÁRIO — remover após identificar o formato do payload
    // ----------------------------------------------------------------
    console.log(`[DEBUG/${countryCode}] ===== REQUISIÇÃO RECEBIDA =====`);
    console.log(`[DEBUG/${countryCode}] Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[DEBUG/${countryCode}] Body:`, JSON.stringify(req.body, null, 2));
    console.log(`[DEBUG/${countryCode}] ================================`);
    // ----------------------------------------------------------------

    // Responde 200 imediatamente para evitar reenvios desnecessários
    res.sendStatus(200);

    try {
      const rawToken = req.body?.json?.token;
      if (!rawToken) {
        console.warn(`[WEBHOOK/${countryCode}] Payload sem token recebido:`, JSON.stringify(req.body));
        return;
      }

      const decoded = verifyWebhookToken(rawToken, country.webhookSecret);
      const { event_type, event_subtype, payload } = decoded;

      console.log(`[WEBHOOK/${countryCode}] Evento recebido: ${event_type}/${event_subtype}`);

      if (event_type === 'sale') {
        await handleSaleEvent(payload, event_subtype, country);
      } else {
        console.log(`[WEBHOOK/${countryCode}] Evento não tratado: ${event_type}/${event_subtype}`);
      }
    } catch (err) {
      console.error(`[WEBHOOK/${countryCode}] Erro ao processar evento:`, err.message);
    }
  };
}

/**
 * Processa um evento de venda.
 * Dispara: Mailchimp + WhatsApp (apenas primeira compra) + Google Sheets
 *
 * @param {object} payload - Payload decodificado do JWT
 * @param {string} subtype - 'single' | 'plan' | 'recurring'
 * @param {object} country - Config do país (src/config/countries.js)
 */
async function handleSaleEvent(payload, subtype, country) {
  const customer = extractCustomer(payload, country);
  const sale = extractSale(payload, subtype, country);

  console.log(`[SALE/${country.code}] Cliente: ${customer.email} | Produto: ${sale.productName} | ${sale.currency} ${sale.amount}`);

  // Executa as integrações em paralelo para ganhar velocidade
  const results = await Promise.allSettled([
    upsertContact(customer, 'cliente-ativo', country.mailchimpCountryTag),
    appendSaleRow(customer, sale, country.sheetsTabName),
    // Mensagem de boas-vindas apenas na primeira compra
    shouldSendWelcome(subtype, payload)
      ? sendWelcomeMessage(customer, sale)
      : Promise.resolve(),
  ]);

  results.forEach((result, i) => {
    const labels = ['Mailchimp', 'Google Sheets', 'WhatsApp'];
    if (result.status === 'rejected') {
      console.error(`[SALE/${country.code}] Erro em ${labels[i]}:`, result.reason?.message || result.reason);
    } else {
      console.log(`[SALE/${country.code}] ${labels[i]}: OK`);
    }
  });
}

/**
 * Retorna true se deve enviar mensagem de boas-vindas.
 * - Avulso: sempre
 * - Plano: apenas na primeira assinatura
 * - Recorrente: apenas no primeiro ciclo
 */
function shouldSendWelcome(subtype, payload) {
  if (subtype === 'single') return true;
  if (subtype === 'plan') return true;
  if (subtype === 'recurring') {
    const cycle = payload?.recurring_cycle;
    return cycle === null || cycle === undefined || cycle === 1;
  }
  return false;
}

/**
 * Extrai os dados do cliente do payload do webhook.
 * Usa o country para normalizar o telefone com o DDI correto.
 */
function extractCustomer(payload, country) {
  const user = payload?.user || {};
  const billing = payload?.billing_information || {};
  const phone = billing?.phone || user?.phone || null;

  return {
    email: user?.email || billing?.email || '',
    name: user?.name || billing?.name || '',
    phone: normalizePhone(phone, country.phonePrefix),
    nationalId: user?.national_id || billing?.national_id || '',
  };
}

/**
 * Extrai os dados da venda do payload.
 */
function extractSale(payload, subtype, country) {
  const payment = payload?.payment_details || {};
  const issue = payload?.issue || {};
  const plan = payload?.plan || {};

  const productName = subtype === 'single'
    ? (issue?.name || 'Publicación avulsa')
    : (plan?.name || 'Plan');

  const amountCents = payment?.payout_amount_in_cents || 0;
  const currency = payment?.payout_currency_id || (country.code === 'CL' ? 'CLP' : 'PEN');

  return {
    productName,
    amount: (amountCents / 100).toFixed(2),
    currency,
    gateway: payment?.gateway || '',
    method: payment?.method || '',
    subtype,
    recurringCycle: payload?.recurring_cycle || null,
    date: new Date().toISOString(),
    countryCode: country.code,
    timezone: country.timezone,
  };
}

/**
 * Normaliza número de telefone para formato E.164.
 * Usa o DDI do país para completar números sem código de país.
 *
 * @param {string|null} phone - Telefone bruto do payload
 * @param {string} prefix - DDI sem o '+' (ex: '56' para Chile, '51' para Peru)
 * @returns {string|null} Telefone no formato +XXXXXXXXXXX ou null
 */
function normalizePhone(phone, prefix) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');

  // Já tem o DDI correto
  if (digits.startsWith(prefix) && digits.length >= prefix.length + 8) {
    return `+${digits}`;
  }

  // Número local — adiciona o DDI do país
  if (digits.length >= 8) {
    return `+${prefix}${digits}`;
  }

  return null;
}

module.exports = { makeWebhookHandler };
