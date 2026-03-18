const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let _sheets = null;

/**
 * Inicializa o cliente autenticado do Google Sheets via Service Account.
 *
 * Estratégia de autenticação (em ordem de prioridade):
 *   1. Variável de ambiente GOOGLE_SERVICE_ACCOUNT_KEY com o JSON completo
 *      → usada no Railway e outros ambientes de nuvem
 *   2. Arquivo em GOOGLE_SERVICE_ACCOUNT_KEY_PATH (padrão: ./google-credentials.json)
 *      → usado localmente durante o desenvolvimento
 */
async function getSheetsClient() {
  if (_sheets) return _sheets;

  let authOptions;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // Nuvem: lê as credenciais direto da variável de ambiente
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    authOptions = {
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    };
    console.log('[SHEETS] Autenticando via variável de ambiente GOOGLE_SERVICE_ACCOUNT_KEY');
  } else {
    // Local: lê as credenciais do arquivo JSON
    const keyFile = path.resolve(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './google-credentials.json'
    );
    authOptions = {
      keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    };
    console.log(`[SHEETS] Autenticando via arquivo: ${keyFile}`);
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

/**
 * Garante que a aba tem um cabeçalho na primeira linha.
 * Só cria o cabeçalho se a aba estiver vazia.
 *
 * @param {object} sheets - Cliente autenticado do Google Sheets
 * @param {string} sheetName - Nome da aba (tab) na planilha
 */
async function ensureHeader(sheets, sheetName) {
  const range = `${sheetName}!A1:J1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values || [];

  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          'Data',
          'Nome',
          'E-mail',
          'Telefone',
          'Produto',
          'Tipo',
          'Valor',
          'Moeda',
          'Gateway',
          'Método de Pagamento',
        ]],
      },
    });
    console.log(`[SHEETS] Cabeçalho criado na aba "${sheetName}".`);
  }
}

/**
 * Adiciona uma linha de venda na aba correta da planilha.
 *
 * @param {object} customer - { name, email, phone }
 * @param {object} sale - { productName, subtype, amount, currency, gateway, method, date, timezone }
 * @param {string} sheetName - Nome da aba do país (ex: 'Vendas Chile', 'Vendas Peru')
 */
async function appendSaleRow(customer, sale, sheetName) {
  if (!sheetName) {
    throw new Error('sheetName não informado para appendSaleRow');
  }

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, sheetName);

  const subtypeLabels = {
    single: 'Avulso',
    plan: 'Assinatura (início)',
    recurring: `Assinatura (ciclo ${sale.recurringCycle || '?'})`,
  };

  const timezone = sale.timezone || 'America/Santiago';

  const row = [
    new Date(sale.date).toLocaleString('es', { timeZone: timezone }),
    customer.name || '',
    customer.email || '',
    customer.phone || '',
    sale.productName || '',
    subtypeLabels[sale.subtype] || sale.subtype,
    sale.amount || '0.00',
    sale.currency || '',
    sale.gateway || '',
    sale.method || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log(`[SHEETS] Venda registrada na aba "${sheetName}": ${customer.email} | ${sale.productName} | ${sale.currency} ${sale.amount}`);
}

module.exports = { appendSaleRow };
