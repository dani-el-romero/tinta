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
    // Responde 200 imediatamente para evitar reenvios desnecessários
    res.sendStatus(200);

    const body = req.body;

    try {
      // ------------------------------------------------------------------
      // FORMATO 1 — monitor.publica.la
      // JSON direto com campo "event" no body (sem wrapper JWT).
      // ------------------------------------------------------------------
      if (body?.event === 'subscription.created') {
        console.log(`[WEBHOOK/${countryCode}] subscription.created (monitor.publica.la)`);
        await handleMonitorEvent(body, country);
        return;
      }

      // ------------------------------------------------------------------
      // FORMATO 2 — publica.la clássico
      // JWT assinado HS256 embrulhado em { json: { token: "..." } }.
      // ------------------------------------------------------------------
      const rawToken = body?.json?.token;
      if (rawToken) {
        const decoded = verifyWebhookToken(rawToken, country.webhookSecret);
        const { event_type, event_subtype, payload } = decoded;
        console.log(`[WEBHOOK/${countryCode}] Evento JWT: ${event_type}/${event_subtype}`);
        if (event_type === 'sale') {
          await handleSaleEvent(payload, event_subtype, country);
        } else {
          console.log(`[WEBHOOK/${countryCode}] Evento JWT não tratado: ${event_type}/${event_subtype}`);
        }
        return;
      }

      // ------------------------------------------------------------------
      // Formato desconhecido — loga o body completo para diagnóstico
      // ------------------------------------------------------------------
      console.warn(`[WEBHOOK/${countryCode}] Formato não reconhecido. Body:`, JSON.stringify(body));
    } catch (err) {
      console.error(`[WEBHOOK/${countryCode}] Erro ao processar evento:`, err.message);
    }
  };
}

/**
 * Processa um evento de nova assinatura vindo do monitor.publica.la.
 *
 * O monitor envia JSON direto (sem JWT), então a extração usa os campos
 * do body diretamente. Se algum campo ficar em branco nos logs, ajuste
 * os caminhos em extractCustomerFromMonitor / extractSaleFromMonitor.
 *
 * @param {object} body    - req.body completo
 * @param {object} country - Config do país
 */
async function handleMonitorEvent(body, country) {
  const customer = extractCustomerFromMonitor(body, country);
  const sale = extractSaleFromMonitor(body, country);

  console.log(`[MONITOR/${country.code}] Cliente: ${customer.email} | Produto: ${sale.productName} | ${sale.currency} ${sale.amount}`);

  // subscription.created é sempre a primeira assinatura → envia boas-vindas
  const results = await Promise.allSettled([
    upsertContact(customer, 'cliente-ativo', country.mailchimpCountryTag),
    appendSaleRow(customer, sale, country.sheetsTabName),
    sendWelcomeMessage(customer, sale),
  ]);

  results.forEach((result, i) => {
    const labels = ['Mailchimp', 'Google Sheets', 'WhatsApp'];
    if (result.status === 'rejected') {
      console.error(`[MONITOR/${country.code}] Erro em ${labels[i]}:`, result.reason?.message || result.reason);
    } else {
      console.log(`[MONITOR/${country.code}] ${labels[i]}: OK`);
    }
  });
}

/**
 * Extrai dados do cliente do payload do monitor.publica.la.
 *
 * Campos confirmados pelo fornecedor:
 *   user.email | user.name | user.phone (pode ser null)
 */
function extractCustomerFromMonitor(body, country) {
  const user = body?.user || {};

  return {
    email: user.email || '',
    name:  user.name  || '',
    phone: normalizePhone(user.phone || null, country.phonePrefix),
  };
}

/**
 * Extrai dados da venda do payload do monitor.publica.la.
 *
 * Campos confirmados pelo fornecedor:
 *   plan.name       → nome do plano
 *   total_amount    → valor total cobrado em unidade principal (NÃO centavos)
 *   currency        → "CLP" ou "PEN"
 *   created_at      → data/hora da assinatura
 *   coupon          → { code, discount_percentage } ou null
 */
function extractSaleFromMonitor(body, country) {
  return {
    productName:   body?.plan?.name || 'Plan',
    amount:        (body?.total_amount ?? 0).toFixed(2),
    currency:      body?.currency || (country.code === 'CL' ? 'CLP' : 'PEN'),
    gateway:       '',
    method:        '',
    subtype:       'plan',
    recurringCycle: null,
    date:          body?.created_at || new Date().toISOString(),
    countryCode:   country.code,
    timezone:      country.timezone,
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
