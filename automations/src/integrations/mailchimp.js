const mailchimp = require('@mailchimp/mailchimp_marketing');
const crypto = require('crypto');

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY?.split('-').pop(), // extrai o datacenter (ex: us1)
});

// Tags usadas em todas as audiences
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
 * Adiciona ou atualiza um contato em uma audience específica.
 *
 * @param {object} customer - { email, name, phone }
 * @param {'cliente-ativo'|'cliente-inativo'|'lead'} activeTag - Tag a aplicar
 * @param {string} audienceId - ID da audience do país (MAILCHIMP_AUDIENCE_ID_CL ou _PE)
 */
async function upsertContact(customer, activeTag, audienceId) {
  if (!customer.email) {
    console.warn('[MAILCHIMP] Contato sem e-mail, ignorando.');
    return;
  }
  if (!audienceId) {
    throw new Error('audienceId não informado para upsertContact');
  }

  const hash = subscriberHash(customer.email);
  const [firstName, ...rest] = (customer.name || '').split(' ');
  const lastName = rest.join(' ');

  // Upsert do contato (cria ou atualiza sem reenviar e-mail de confirmação)
  await mailchimp.lists.setListMember(audienceId, hash, {
    email_address: customer.email.toLowerCase().trim(),
    status_if_new: 'subscribed',
    merge_fields: {
      FNAME: firstName || '',
      LNAME: lastName || '',
      PHONE: customer.phone || '',
    },
  });

  // Define as tags: ativa a correta e remove as outras
  const allTags = Object.values(TAGS);
  const tagUpdates = allTags.map((tag) => ({
    name: tag,
    status: tag === activeTag ? 'active' : 'inactive',
  }));

  await mailchimp.lists.updateListMemberTags(audienceId, hash, {
    tags: tagUpdates,
  });

  console.log(`[MAILCHIMP] ${customer.email} → audience: ${audienceId} | tag: ${activeTag}`);
}

/**
 * Marca um contato como inativo/cancelado em uma audience.
 *
 * @param {string} email
 * @param {string} audienceId
 */
async function markAsInactive(email, audienceId) {
  const customer = { email, name: '', phone: '' };
  await upsertContact(customer, TAGS.INACTIVE, audienceId);
}

/**
 * Adiciona um lead (sem compra ainda) em uma audience.
 *
 * @param {object} customer
 * @param {string} audienceId
 */
async function addLead(customer, audienceId) {
  await upsertContact(customer, TAGS.LEAD, audienceId);
}

module.exports = { upsertContact, markAsInactive, addLead, TAGS };
