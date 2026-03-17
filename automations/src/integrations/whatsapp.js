const axios = require('axios');

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const TEMPLATE_NAME = process.env.WHATSAPP_WELCOME_TEMPLATE;
const TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR';

const API_URL = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

/**
 * Envia uma mensagem de boas-vindas via template aprovado na Meta.
 *
 * O template deve ser criado no Meta Business Manager com as variáveis:
 *   {{1}} → primeiro nome do cliente
 *   {{2}} → nome do produto adquirido
 *
 * Exemplo de template:
 *   "Olá, {{1}}! 🎉 Bem-vindo(a)! Seu acesso a {{2}} já está disponível."
 *
 * @param {object} customer - { phone, name }
 * @param {object} sale - { productName }
 */
async function sendWelcomeMessage(customer, sale) {
  if (!customer.phone) {
    console.warn(`[WHATSAPP] Cliente ${customer.email} sem telefone, mensagem não enviada.`);
    return;
  }

  const firstName = (customer.name || '').split(' ')[0] || 'cliente';

  const body = {
    messaging_product: 'whatsapp',
    to: customer.phone.replace('+', ''), // Meta espera sem o '+'
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANGUAGE },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: sale.productName },
          ],
        },
      ],
    },
  };

  const response = await axios.post(API_URL, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  console.log(`[WHATSAPP] Mensagem enviada para ${customer.phone} | ID: ${response.data?.messages?.[0]?.id}`);
}

module.exports = { sendWelcomeMessage };
