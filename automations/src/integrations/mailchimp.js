const mailchimp = require('@mailchimp/mailchimp_marketing');
const crypto = require('crypto');

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY?.split('-').pop(), // extrai o datacenter (ex: us1)
});

// Audience única compartilhada por todos os países
const LIST_ID = process.env.MAILCHIMP_AUDIENCE_ID;

// Tags de status — aplicadas exclusivamente (só uma ativa por vez)
const TAGS = {
  ACTIVE: 'cliente-ativo',
  INACTIVE: 'cliente-inativo',
  LEAD: 'lead',
};

/**
 * Gera o MD5 hash do e-mail (identificador do contato no Mailchimp).
 */
function subscriberHash(email) {
  return crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
}

/**
 * Adiciona ou atualiza um contato na audience.
 *
 * Estratégia de tags:
 *   - Tags de status (TAGS.*) são mutuamente exclusivas: só a `statusTag` fica ativa.
 *   - `countryTag` (ex: 'Chile', 'Perú') é permanente e nunca desativada.
 *   - `extraActiveTags` são ativadas adicionalmente (ex: 'cancelados chile').
 *
 * @param {object} customer        - { email, name, phone }
 * @param {string} statusTag       - 'cliente-ativo' | 'cliente-inativo' | 'lead'
 * @param {string} countryTag      - Tag permanente de país (countries.mailchimpCountryTag)
 * @param {string[]} extraActiveTags - Tags extras a ativar (ex: tag de cancelamento)
 */
async function upsertContact(customer, statusTag, countryTag, extraActiveTags = []) {
  if (!customer.email) {
    console.warn('[MAILCHIMP] Contato sem e-mail, ignorando.');
    return;
  }

  const hash = subscriberHash(customer.email);
  const [firstName, ...rest] = (customer.name || '').split(' ');
  const lastName = rest.join(' ');

  // Upsert do contato (cria ou atualiza sem reenviar e-mail de confirmação)
  await mailchimp.lists.setListMember(LIST_ID, hash, {
    email_address: customer.email.toLowerCase().trim(),
    status_if_new: 'subscribed',
    merge_fields: {
      FNAME: firstName || '',
      LNAME: lastName || '',
      PHONE: customer.phone || '',
    },
  });

  // Tags de status: exclusivas entre si (ex: ativa 'cliente-ativo', desativa as demais)
  const statusTagUpdates = Object.values(TAGS).map((tag) => ({
    name: tag,
    status: tag === statusTag ? 'active' : 'inactive',
  }));

  // Tags permanentes: país + extras (nunca desativadas por esta função)
  const permanentTagUpdates = [countryTag, ...extraActiveTags].map((tag) => ({
    name: tag,
    status: 'active',
  }));

  await mailchimp.lists.updateListMemberTags(LIST_ID, hash, {
    tags: [...statusTagUpdates, ...permanentTagUpdates],
  });

  console.log(`[MAILCHIMP] ${customer.email} → status: ${statusTag} | país: ${countryTag}${extraActiveTags.length ? ` | extras: ${extraActiveTags.join(', ')}` : ''}`);
}

/**
 * Marca um contato como cancelado/inativo.
 * Aplica 'cliente-inativo' + a tag de cancelamento específica do país.
 *
 * @param {string} email
 * @param {string} countryTag      - Ex: 'Chile' ou 'Perú'
 * @param {string} cancelledTag    - Ex: 'cancelados chile' ou 'cancelados perú'
 */
async function markAsInactive(email, countryTag, cancelledTag) {
  const customer = { email, name: '', phone: '' };
  await upsertContact(customer, TAGS.INACTIVE, countryTag, [cancelledTag]);
}

/**
 * Adiciona um lead (sem compra ainda).
 *
 * @param {object} customer
 * @param {string} countryTag - Ex: 'Chile' ou 'Perú'
 */
async function addLead(customer, countryTag) {
  await upsertContact(customer, TAGS.LEAD, countryTag);
}

module.exports = { upsertContact, markAsInactive, addLead, TAGS };
