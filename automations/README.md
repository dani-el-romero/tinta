# Tinta Automações

Servidor local que integra **Publica.la** com **Mailchimp**, **WhatsApp** e **Google Sheets**.

Suporta múltiplas operações por país — atualmente **Chile (CL)** e **Peru (PE)** — com lojas, audiences e abas de planilha independentes por país.

## O que faz

| Trigger | País | Ação |
|---|---|---|
| Nova venda aprovada (Publica.la) | CL ou PE | Upsert do contato na audience Mailchimp do país como `cliente-ativo` |
| Nova venda aprovada | CL ou PE | Envia mensagem de boas-vindas no WhatsApp (mesmo número) |
| Nova venda aprovada | CL ou PE | Registra a venda na aba correta do Google Sheets |
| Cancelamento (diário, meia-noite) | CL e PE | Atualiza contato no Mailchimp para `cliente-inativo` |

---

## Pré-requisitos

- Node.js 18+
- Conta na Publica.la com acesso ao dashboard
- Conta no Mailchimp (audience criada)
- WhatsApp Business com acesso ao Meta Business Manager
- Conta Google com planilha criada

---

## Setup

### 1. Instalar dependências

```bash
cd automations
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais (veja cada seção abaixo).

---

### 3. Publica.la (por país)

Repita os passos abaixo para **cada loja** (Chile e Peru):

**API Token:**
1. Acesse `/dashboard/settings#api` na loja do país
2. Copie o token e cole em `PUBLICA_API_TOKEN_CL` ou `PUBLICA_API_TOKEN_PE`

**Webhook:**
1. Acesse `/dashboard/settings#integrations`
2. Configure a URL do webhook:
   - Chile → `https://SEU-NGROK-URL/webhooks/publica/cl`
   - Peru → `https://SEU-NGROK-URL/webhooks/publica/pe`
3. Crie uma chave de assinatura e cole em `PUBLICA_WEBHOOK_SECRET_CL` ou `PUBLICA_WEBHOOK_SECRET_PE`

---

### 4. Mailchimp

**API Key:**
1. Acesse [mailchimp.com](https://mailchimp.com) → Account → Extras → API Keys
2. Crie uma nova chave e cole em `MAILCHIMP_API_KEY`
   - O servidor (ex: `us1`) é extraído automaticamente do final da chave

**Audiences (uma por país):**
1. Crie duas audiences: uma para o Chile e outra para o Peru
   - Acesse Audience → Create Audience
2. Para cada uma, vá em Audience → Settings → "Audience name and defaults" e copie o **Audience ID**
3. Cole em `MAILCHIMP_AUDIENCE_ID_CL` e `MAILCHIMP_AUDIENCE_ID_PE`

---

### 5. WhatsApp (Meta Cloud API)

**Phone Number ID:**
1. Acesse [business.facebook.com](https://business.facebook.com)
2. Vá em WhatsApp → Números de Telefone
3. Copie o **Phone Number ID** e cole em `WHATSAPP_PHONE_NUMBER_ID`

**Access Token permanente:**
1. Em Meta Business Manager → Configurações → Usuários do Sistema
2. Crie um usuário do sistema com função "Admin"
3. Gere um token de acesso com permissão `whatsapp_business_messaging`
4. Cole em `WHATSAPP_ACCESS_TOKEN`

**Template de boas-vindas:**
1. Acesse WhatsApp → Modelos de Mensagem → Criar modelo
2. Crie um template com categoria "Utilitário" e duas variáveis:
   - `{{1}}` = Primeiro nome do cliente
   - `{{2}}` = Nome do produto
3. Exemplo (em espanhol para CL/PE): *"¡Hola, {{1}}! 🎉 ¡Bienvenido/a! Tu acceso a {{2}} ya está disponible."*
4. Após aprovação da Meta, cole o nome exato em `WHATSAPP_WELCOME_TEMPLATE`
5. Configure o idioma: `WHATSAPP_TEMPLATE_LANGUAGE=es`

> **Nota:** O mesmo número e template são usados para Chile e Peru.

---

### 6. Google Sheets

**Criar a Service Account:**
1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto (ou use um existente)
3. Ative a **Google Sheets API**: APIs e Serviços → Biblioteca → Google Sheets API
4. Vá em APIs e Serviços → Credenciais → Criar credencial → Conta de serviço
5. Baixe o arquivo JSON de credenciais e salve como `automations/google-credentials.json`

**Compartilhar a planilha e configurar abas:**
1. Abra o arquivo JSON baixado e copie o campo `client_email`
2. Abra sua planilha no Google Sheets
3. Clique em Compartilhar e adicione o `client_email` com permissão de **Editor**
4. Crie duas abas na planilha (clique no `+` no rodapé):
   - Uma chamada `Vendas Chile` (ou o nome que colocar em `GOOGLE_SHEET_NAME_CL`)
   - Uma chamada `Vendas Peru` (ou o nome que colocar em `GOOGLE_SHEET_NAME_PE`)
5. Copie o ID da planilha da URL: `docs.google.com/spreadsheets/d/ESTE-ID/edit`
6. Cole em `GOOGLE_SPREADSHEET_ID`

> Os cabeçalhos são criados automaticamente na primeira execução de cada aba.

---

### 7. Rodar localmente com ngrok

Para receber webhooks no seu computador:

```bash
# Terminal 1 — Instale o ngrok (se não tiver)
brew install ngrok  # macOS

# Inicie o túnel
ngrok http 3000
```

Configure as URLs nas duas lojas da Publica.la:
- Chile → `https://abc123.ngrok-free.app/webhooks/publica/cl`
- Peru → `https://abc123.ngrok-free.app/webhooks/publica/pe`

---

## Executar

### Sync inicial (rode uma vez para popular o histórico)

```bash
# Sincroniza todos os países de uma vez
npm run sync

# Ou sincroniza apenas um país específico
npm run sync -- CL
npm run sync -- PE
```

### Servidor de automações

```bash
npm start          # produção
npm run dev        # desenvolvimento (recarrega automaticamente)
```

---

## Estrutura do projeto

```
automations/
├── .env                      # Suas credenciais (não commitar)
├── .env.example              # Template de variáveis
├── google-credentials.json   # Credenciais Google (não commitar)
├── package.json
├── scripts/
│   └── initialSync.js        # Sync histórico completo (todos os países ou um específico)
└── src/
    ├── index.js              # Servidor Express + cron diário (ambos os países)
    ├── config/
    │   └── countries.js      # Mapa de configurações por país (CL, PE)
    ├── webhooks/
    │   └── publica.js        # Factory de handlers por país
    ├── integrations/
    │   ├── mailchimp.js      # Mailchimp API (audienceId por parâmetro)
    │   ├── whatsapp.js       # Meta WhatsApp Cloud API (compartilhado)
    │   └── sheets.js         # Google Sheets API (sheetName por parâmetro)
    └── sync/
        └── syncCancellations.js  # Sync diário de cancelamentos (por país)
```

---

## Tags no Mailchimp

| Tag | Significado |
|---|---|
| `cliente-ativo` | Tem assinatura/compra ativa |
| `cliente-inativo` | Cancelou ou está inadimplente |
| `lead` | Ainda não comprou |

Para usar nas campanhas: filtre a audience do país pela tag desejada.

---

## Adicionar um novo país no futuro

1. Adicione as variáveis no `.env` com o novo sufixo (ex: `_BR` para Brasil)
2. Adicione uma entrada em `src/config/countries.js` seguindo o padrão existente
3. Adicione a rota do webhook em `src/index.js`:
   ```js
   app.post('/webhooks/publica/br', makeWebhookHandler('BR'));
   ```
4. Crie a audience no Mailchimp e a aba na planilha do Google Sheets
