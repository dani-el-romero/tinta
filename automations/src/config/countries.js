/**
 * Configurações por país.
 *
 * Cada entrada define as credenciais e parâmetros específicos de uma operação.
 * As variáveis de ambiente seguem o padrão NOME_VARIAVEL_XX, onde XX é o
 * código do país em maiúsculas (CL = Chile, PE = Peru).
 *
 * Para adicionar um novo país no futuro:
 *   1. Adicione as variáveis no .env com o novo sufixo (ex: _BR)
 *   2. Adicione uma entrada aqui seguindo o mesmo padrão
 *   3. Configure a rota do webhook em src/index.js
 */

const COUNTRIES = {
  CL: {
    code: 'CL',
    name: 'Chile',
    // Prefixo DDI para normalização de telefone (sem o +)
    phonePrefix: '56',
    // Fuso horário para exibição de datas na planilha
    timezone: 'America/Santiago',
    // Publica.la
    storeDomain: process.env.PUBLICA_STORE_DOMAIN_CL,
    apiToken: process.env.PUBLICA_API_TOKEN_CL,
    webhookSecret: process.env.PUBLICA_WEBHOOK_SECRET_CL,
    // Mailchimp — tags aplicadas na audience única (MAILCHIMP_AUDIENCE_ID)
    mailchimpCountryTag: 'Chile',          // tag permanente de país
    mailchimpCancelledTag: 'cancelados chile', // tag adicional ao cancelar
    // Google Sheets (aba)
    sheetsTabName: process.env.GOOGLE_SHEET_NAME_CL || 'Vendas Chile',
  },

  PE: {
    code: 'PE',
    name: 'Peru',
    phonePrefix: '51',
    timezone: 'America/Lima',
    // Publica.la
    storeDomain: process.env.PUBLICA_STORE_DOMAIN_PE,
    apiToken: process.env.PUBLICA_API_TOKEN_PE,
    webhookSecret: process.env.PUBLICA_WEBHOOK_SECRET_PE,
    // Mailchimp — tags aplicadas na audience única (MAILCHIMP_AUDIENCE_ID)
    mailchimpCountryTag: 'Perú',           // tag permanente de país
    mailchimpCancelledTag: 'cancelados perú', // tag adicional ao cancelar
    // Google Sheets (aba)
    sheetsTabName: process.env.GOOGLE_SHEET_NAME_PE || 'Vendas Peru',
  },
};

/**
 * Retorna a config de um país pelo código.
 * Lança erro se o código não for reconhecido.
 * @param {string} code - 'CL' | 'PE'
 * @returns {object} Country config
 */
function getCountry(code) {
  const country = COUNTRIES[code?.toUpperCase()];
  if (!country) throw new Error(`País não reconhecido: ${code}`);
  return country;
}

/**
 * Retorna todos os países configurados como array.
 * @returns {object[]}
 */
function getAllCountries() {
  return Object.values(COUNTRIES);
}

module.exports = { COUNTRIES, getCountry, getAllCountries };
