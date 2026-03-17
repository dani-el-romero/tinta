const axios = require('axios');
const { markAsInactive } = require('../integrations/mailchimp');
const { getAllCountries } = require('../config/countries');

/**
 * Cria um cliente Axios para a API da Publica.la de um país específico.
 */
function createPubliApi(country) {
  return axios.create({
    baseURL: `https://${country.storeDomain}/api/v3`,
    headers: { 'X-User-Token': country.apiToken },
  });
}

/**
 * Busca todos os pedidos com um status específico, paginando automaticamente.
 *
 * @param {object} publApi - Cliente Axios configurado para o país
 * @param {string} status - 'cancelled' | 'approved' | 'paused'
 * @returns {Array} lista de pedidos
 */
async function fetchAllOrdersByStatus(publApi, status) {
  const allOrders = [];
  let page = 1;
  const perPage = 500;

  while (true) {
    const res = await publApi.get('/orders', {
      params: {
        status,
        include: 'user',
        fields: 'id,uuid,status,updated_at',
        per_page: perPage,
        page,
      },
    });

    const orders = res.data?.data || [];
    allOrders.push(...orders);

    if (orders.length < perPage) break;
    page++;
  }

  return allOrders;
}

/**
 * Busca pedidos cancelados nas últimas 48h de um país e marca os contatos
 * como inativos na audience Mailchimp correspondente.
 *
 * @param {object} country - Config do país (src/config/countries.js)
 */
async function syncCancelledOrders(country) {
  const publApi = createPubliApi(country);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];

  const res = await publApi.get('/orders', {
    params: {
      status: 'cancelled',
      include: 'user',
      'updated_at[from]': twoDaysAgo,
      per_page: 500,
    },
  });

  const orders = res.data?.data || [];
  console.log(`[SYNC/${country.code}] ${orders.length} cancelamentos encontrados desde ${twoDaysAgo}`);

  for (const order of orders) {
    const email = order.user?.email;
    if (!email) continue;

    try {
      await markAsInactive(email, country.mailchimpAudienceId);
    } catch (err) {
      console.error(`[SYNC/${country.code}] Erro ao marcar ${email} como inativo:`, err.message);
    }
  }
}

/**
 * Roda o sync de cancelamentos para todos os países.
 * Chamado pelo cron em src/index.js.
 */
async function syncAllCountries() {
  for (const country of getAllCountries()) {
    await syncCancelledOrders(country);
  }
}

module.exports = { syncCancelledOrders, syncAllCountries, fetchAllOrdersByStatus, createPubliApi };
