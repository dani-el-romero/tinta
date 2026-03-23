/**
 * Script de sincronização inicial.
 *
 * Usa a API da Publica.la para buscar o histórico completo de cada país e:
 *   1. Popula o Mailchimp via Users API (planos ativos e cancelados)
 *   2. Preenche a planilha via Orders API (histórico de vendas aprovadas)
 *
 * Execute UMA VEZ após configurar as credenciais:
 *   npm run sync
 *
 * Para sincronizar apenas um país específico:
 *   npm run sync -- CL
 *   npm run sync -- PE
 */

require('dotenv').config();
const axios = require('axios');
const { upsertContact, markAsInactive, TAGS } = require('../src/integrations/mailchimp');
const { appendSaleRow } = require('../src/integrations/sheets');
const { getAllCountries, getCountry } = require('../src/config/countries');

const targetCode = process.argv[2]?.toUpperCase();
const countries = targetCode ? [getCountry(targetCode)] : getAllCountries();

/**
 * Cria cliente Axios para a API da Publica.la de um país.
 * Base URL: https://{storeDomain}/integration-api/v1
 */
function createPubliApi(country) {
  return axios.create({
    baseURL: `https://${country.storeDomain}/integration-api/v1`,
    headers: { 'X-User-Token': country.apiToken },
  });
}

/**
 * Busca todos os usuários paginando automaticamente.
 *
 * @param {object} publApi - Cliente Axios do país
 * @param {string|null} query - null = ativos | 'deactivated' = cancelados/inativos
 * @returns {Array} lista de usuários
 */
async function fetchAllUsers(publApi, query = null) {
  const all = [];
  let page = 1;

  while (true) {
    const params = { per_page: 500, page };
    if (query) params.query = query;

    const res = await publApi.get('/dashboard/users', { params });
    const users = res.data?.data || [];
    all.push(...users);
    console.log(`  Página ${page}: ${users.length} usuários`);

    if (users.length < 500) break;
    page++;
  }

  return all;
}

/**
 * Busca todos os pedidos aprovados paginando automaticamente.
 * Usado para popular a planilha com o histórico de vendas.
 *
 * @param {object} publApi - Cliente Axios do país
 * @returns {Array} lista de pedidos
 */
async function fetchAllApprovedOrders(publApi) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await publApi.get('/orders', {
      params: {
        status: 'approved',
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa o sync completo para um único país.
 *
 * Fase 1 — Mailchimp (Users API):
 *   - Usuários ativos   → tag cliente-ativo + tag do país
 *   - Usuários inativos → tag cliente-inativo + tag de cancelamento do país
 *
 * Fase 2 — Google Sheets (Orders API):
 *   - Pedidos aprovados → linha por venda na aba do país
 */
async function syncCountry(country) {
  const publApi = createPubliApi(country);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`SYNC: ${country.name} (${country.code})`);
  console.log(`  Mailchimp tags: ${country.mailchimpCountryTag} / ${country.mailchimpCancelledTag}`);
  console.log(`  Sheets tab: ${country.sheetsTabName}`);
  console.log('='.repeat(50));

  // -------------------------------------------------------
  // FASE 1A — Usuários ATIVOS → Mailchimp "cliente-ativo"
  // -------------------------------------------------------
  console.log('\n[FASE 1A] Buscando usuários ativos...');
  const activeUsers = await fetchAllUsers(publApi, null);
  console.log(`Total ativos: ${activeUsers.length}\n`);

  let activeOk = 0, activeErrors = 0;

  for (const user of activeUsers) {
    const email = user.email;
    if (!email) continue;

    try {
      await upsertContact(
        { email, name: user.name || '', phone: user.phone || null },
        TAGS.ACTIVE,
        country.mailchimpCountryTag,
      );
      activeOk++;
      await sleep(150);
    } catch (err) {
      activeErrors++;
      console.error(`  Erro (ativo) ${email}:`, err.message);
    }
  }

  console.log(`Ativos → Mailchimp: ${activeOk} OK | ${activeErrors} erros`);

  // -------------------------------------------------------
  // FASE 1B — Usuários INATIVOS → Mailchimp "cliente-inativo"
  // -------------------------------------------------------
  console.log('\n[FASE 1B] Buscando usuários inativos/cancelados...');
  const inactiveUsers = await fetchAllUsers(publApi, 'deactivated');
  console.log(`Total inativos: ${inactiveUsers.length}\n`);

  let inactiveOk = 0, inactiveErrors = 0;

  for (const user of inactiveUsers) {
    const email = user.email;
    if (!email) continue;

    try {
      await markAsInactive(email, country.mailchimpCountryTag, country.mailchimpCancelledTag);
      inactiveOk++;
      await sleep(150);
    } catch (err) {
      inactiveErrors++;
      console.error(`  Erro (inativo) ${email}:`, err.message);
    }
  }

  console.log(`Inativos → Mailchimp: ${inactiveOk} OK | ${inactiveErrors} erros`);

  // -------------------------------------------------------
  // FASE 2 — Pedidos APROVADOS → Google Sheets
  // -------------------------------------------------------
  console.log('\n[FASE 2] Buscando pedidos aprovados para a planilha...');
  const orders = await fetchAllApprovedOrders(publApi);
  console.log(`Total pedidos aprovados: ${orders.length}\n`);

  let sheetsOk = 0, sheetsErrors = 0;

  for (const order of orders) {
    const email = order.user?.email;
    if (!email) continue;

    try {
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
        timezone: country.timezone,
      };

      await appendSaleRow(
        { email, name: order.user?.name || '', phone: null },
        sale,
        country.sheetsTabName,
      );
      sheetsOk++;
      await sleep(150);
    } catch (err) {
      sheetsErrors++;
      console.error(`  Erro (sheets) pedido ${order.id}:`, err.message);
    }
  }

  console.log(`Pedidos → Sheets: ${sheetsOk} OK | ${sheetsErrors} erros`);
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
