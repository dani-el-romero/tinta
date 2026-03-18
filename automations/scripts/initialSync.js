/**
 * Script de sincronização inicial.
 *
 * Usa a API da Publica.la para buscar TODOS os pedidos históricos de cada país e:
 *   1. Popula a audience do Mailchimp com as tags corretas (por país)
 *   2. Preenche a planilha de controle de vendas (aba por país)
 *
 * Execute UMA VEZ após configurar as credenciais:
 *   npm run sync
 *
 * Para sincronizar apenas um país específico, passe o código como argumento:
 *   npm run sync -- CL
 *   npm run sync -- PE
 */

require('dotenv').config();
const axios = require('axios');
const { upsertContact, markAsInactive, TAGS } = require('../src/integrations/mailchimp');
const { appendSaleRow } = require('../src/integrations/sheets');
const { getAllCountries, getCountry } = require('../src/config/countries');

// Suporte a filtro por país via argumento (ex: node scripts/initialSync.js CL)
const targetCode = process.argv[2]?.toUpperCase();
const countries = targetCode ? [getCountry(targetCode)] : getAllCountries();

/**
 * Cria cliente Axios para a API da Publica.la de um país.
 */
function createPubliApi(country) {
  return axios.create({
    baseURL: `https://${country.storeDomain}/api/v3`,
    headers: { 'X-User-Token': country.apiToken },
  });
}

/**
 * Busca todos os pedidos de um status para um país, com paginação automática.
 */
async function fetchAllOrders(publApi, status) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await publApi.get('/orders', {
      params: {
        status,
        type: 'sale',
        include: 'user,products',
        per_page: 500,
        page,
      },
    });

    const orders = res.data?.data || [];
    all.push(...orders);
    console.log(`  Página ${page}: ${orders.length} pedidos`);

    if (orders.length < 500) break;
    page++;
  }

  return all;
}

/**
 * Pausa a execução para respeitar os rate limits das APIs.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa o sync completo para um único país.
 */
async function syncCountry(country) {
  const publApi = createPubliApi(country);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`SYNC: ${country.name} (${country.code})`);
  console.log(`  Mailchimp tags: ${country.mailchimpCountryTag} / ${country.mailchimpCancelledTag}`);
  console.log(`  Sheets tab: ${country.sheetsTabName}`);
  console.log('='.repeat(50));

  // -------------------------------------------------------
  // 1. Pedidos APROVADOS → Mailchimp "cliente-ativo" + Sheets
  // -------------------------------------------------------
  console.log('\nBuscando pedidos aprovados...');
  const approved = await fetchAllOrders(publApi, 'approved');
  console.log(`Total aprovados: ${approved.length}\n`);

  let mailchimpOk = 0, sheetsOk = 0, errors = 0;

  for (const order of approved) {
    try {
      const email = order.user?.email;
      if (!email) continue;

      const customer = {
        email,
        name: order.user?.name || '',
        phone: null,
      };

      // Mailchimp
      await upsertContact(customer, TAGS.ACTIVE, country.mailchimpCountryTag);
      mailchimpOk++;

      // Google Sheets
      const product = order.products?.[0] || {};
      const sale = {
        productName: product.name || 'Produto',
        subtype: product.type === 'subscription' ? 'plan' : 'single',
        amount: ((order.unit_price || 0) / 100).toFixed(2),
        currency: order.currency_id || (country.code === 'CL' ? 'CLP' : 'PEN'),
        gateway: '',
        method: '',
        recurringCycle: null,
        date: order.created_at || new Date().toISOString(),
        countryCode: country.code,
        timezone: country.timezone,
      };

      await appendSaleRow(customer, sale, country.sheetsTabName);
      sheetsOk++;

      // Pequena pausa para não sobrecarregar as APIs
      await sleep(150);
    } catch (err) {
      errors++;
      console.error(`  Erro no pedido ${order.id}:`, err.message);
    }
  }

  console.log(`Aprovados → Mailchimp: ${mailchimpOk} | Sheets: ${sheetsOk} | Erros: ${errors}`);

  // -------------------------------------------------------
  // 2. Pedidos CANCELADOS → Mailchimp "cliente-inativo"
  // -------------------------------------------------------
  console.log('\nBuscando pedidos cancelados...');
  const cancelled = await fetchAllOrders(publApi, 'cancelled');
  console.log(`Total cancelados: ${cancelled.length}\n`);

  let inactiveOk = 0;
  errors = 0;

  for (const order of cancelled) {
    try {
      const email = order.user?.email;
      if (!email) continue;

      await markAsInactive(email, country.mailchimpCountryTag, country.mailchimpCancelledTag);
      inactiveOk++;
      await sleep(150);
    } catch (err) {
      errors++;
      console.error(`  Erro no pedido cancelado ${order.id}:`, err.message);
    }
  }

  console.log(`Cancelados → Mailchimp: ${inactiveOk} | Erros: ${errors}`);
}

async function main() {
  console.log('=== SYNC INICIAL - PUBLICA.LA ===');
  console.log(`Países a sincronizar: ${countries.map((c) => c.code).join(', ')}`);

  for (const country of countries) {
    await syncCountry(country);
  }

  console.log('\n=== SYNC INICIAL CONCLUÍDO ===');
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
