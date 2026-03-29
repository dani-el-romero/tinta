require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { makeWebhookHandler } = require('./webhooks/publica');
const { syncCancelledOrders } = require('./sync/syncCancellations');
const { getAllCountries } = require('./config/countries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  const countries = getAllCountries().map((c) => c.code);
  res.json({ status: 'ok', service: 'tinta-automations', countries });
});

// Webhook da Publica.la — uma rota por país
// Chile → POST /webhooks/publica/cl
// Peru  → POST /webhooks/publica/pe
app.post('/webhooks/publica/cl', makeWebhookHandler('CL'));
app.post('/webhooks/publica/pe', makeWebhookHandler('PE'));

// ----------------------------------------------------------------
// DIAGNÓSTICO — captura qualquer POST em /webhooks/* que não bateu
// nas rotas acima. Ajuda a identificar URL errada no monitor.publica.la.
// Remover após confirmar que os webhooks chegam no caminho correto.
// ----------------------------------------------------------------
app.post('/webhooks/*', (req, res) => {
  console.warn('[DIAGNÓSTICO] POST recebido em rota não registrada:', req.path);
  console.warn('[DIAGNÓSTICO] Headers:', JSON.stringify(req.headers, null, 2));
  console.warn('[DIAGNÓSTICO] Body:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Sync diário de cancelamentos — DESABILITADO temporariamente
// Para reativar: remova o comentário do bloco abaixo
/*
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Iniciando sync de cancelamentos para todos os países...');
  for (const country of getAllCountries()) {
    try {
      console.log(`[CRON] Sincronizando cancelamentos: ${country.name} (${country.code})`);
      await syncCancelledOrders(country);
      console.log(`[CRON] ${country.code}: concluído.`);
    } catch (err) {
      console.error(`[CRON] Erro em ${country.code}:`, err.message);
    }
  }
});
*/

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log('Webhooks da Publica.la:');
  console.log(`  Chile → POST http://localhost:${PORT}/webhooks/publica/cl`);
  console.log(`  Peru  → POST http://localhost:${PORT}/webhooks/publica/pe`);
});
