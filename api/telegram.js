const TELEGRAM_TOKEN = '8788489860:AAHsemvk1CQL6u5kLasmKYy96Rg1LoXheIc';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_CONTAS = 'c7e0311365f84b81b4f1129e357dd8f7';

const EMPRESAS = ['Mundo das Compras', 'Leão Home', 'Apollo Home', 'Casa 777', 'Achados do Lar'];
const CATEGORIAS = ['Aluguel', 'Fornecedor', 'Assinatura', 'Imposto/Guia', 'Folha de Pagamento', 'Frete/Logística', 'Água/Luz/Internet', 'Embalagem', 'Gasto Extra', 'Outros'];

// Estado temporário por usuário
const estado = {};

async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallback(callbackQueryId) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

async function getFile(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const data = await r.json();
  const path = data.result.file_path;
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${path}`;
  const fileRes = await fetch(url);
  const buffer = await fileRes.arrayBuffer();
  return { buffer, path };
}

async function extrairComIA(buffer, mediaType, isDoc) {
  const base64 = Buffer.from(buffer).toString('base64');

  const content = isDoc
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Extraia do comprovante de pagamento: beneficiário (para quem foi pago), valor total pago, data do pagamento (formato YYYY-MM-DD). Responda SOMENTE em JSON: {"beneficiario":"","valor":"","data":""}' }
      ]
    : [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Extraia do comprovante de pagamento: beneficiário (para quem foi pago), valor total pago, data do pagamento (formato YYYY-MM-DD). Responda SOMENTE em JSON: {"beneficiario":"","valor":"","data":""}' }
      ];

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 300, messages: [{ role: 'user', content }] })
  });

  const data = await r.json();
  const text = data.content?.[0]?.text || '{}';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function extrairDeTexto(texto) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extraia do texto a seguir: beneficiário, valor pago, data (formato YYYY-MM-DD, se não houver use hoje ${new Date().toISOString().split('T')[0]}). Responda SOMENTE em JSON: {"beneficiario":"","valor":"","data":""}. Texto: ${texto}`
      }]
    })
  });
  const data = await r.json();
  const text = data.content?.[0]?.text || '{}';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function salvarNoNotion(dados) {
  const valor = parseFloat(String(dados.valor).replace(/[R$\s.]/g, '').replace(',', '.'));
  const properties = {
    'Descrição': { title: [{ text: { content: dados.beneficiario || 'Pagamento' } }] },
    'Empresa': { rich_text: [{ text: { content: dados.empresa } }] },
    'Valor': { number: isNaN(valor) ? 0 : valor },
    'Vencimento': { date: { start: dados.data || new Date().toISOString().split('T')[0] } },
    'Status': { select: { name: 'Pago' } },
    'Tipo': { select: { name: 'PIX' } },
    'Categoria': { select: { name: dados.categoria } },
    'Cedente': { rich_text: [{ text: { content: 'Via Telegram Bot' } }] },
    'Observações': { rich_text: [{ text: { content: '✅ Pagamento registrado via Telegram' } }] }
  };

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { database_id: DB_CONTAS }, properties })
  });

  return r.ok;
}

function teclasEmpresas() {
  return EMPRESAS.map(e => [{ text: e, callback_data: `empresa:${e}` }]);
}

function teclasCategorias() {
  const rows = [];
  for (let i = 0; i < CATEGORIAS.length; i += 2) {
    const row = [{ text: CATEGORIAS[i], callback_data: `cat:${CATEGORIAS[i]}` }];
    if (CATEGORIAS[i + 1]) row.push({ text: CATEGORIAS[i + 1], callback_data: `cat:${CATEGORIAS[i + 1]}` });
    rows.push(row);
  }
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  const update = req.body;

  // CALLBACK de botão
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;
    await answerCallback(cb.id);

    if (!estado[chatId]) estado[chatId] = {};

    if (data.startsWith('empresa:')) {
      estado[chatId].empresa = data.replace('empresa:', '');
      await sendMessage(chatId, `🏢 *${estado[chatId].empresa}*\n\nAgora selecione a categoria:`, teclasCategorias());
    }

    if (data.startsWith('cat:')) {
      estado[chatId].categoria = data.replace('cat:', '');
      const d = estado[chatId];

      const ok = await salvarNoNotion(d);

      if (ok) {
        const valorFmt = d.valor ? `R$ ${parseFloat(String(d.valor).replace(/[R$\s.]/g, '').replace(',', '.')).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
        await sendMessage(chatId,
          `✅ *Pagamento registrado!*\n\n` +
          `📄 ${d.beneficiario}\n` +
          `💰 ${valorFmt}\n` +
          `📅 ${d.data}\n` +
          `🏢 ${d.empresa}\n` +
          `🏷️ ${d.categoria}\n\n` +
          `_Lançado como PAGO no Notion_`
        );
      } else {
        await sendMessage(chatId, '❌ Erro ao salvar no Notion. Tente novamente.');
      }

      delete estado[chatId];
    }

    return res.status(200).end();
  }

  // MENSAGEM
  const msg = update.message;
  if (!msg) return res.status(200).end();

  const chatId = msg.chat.id;
  if (!estado[chatId]) estado[chatId] = {};

  try {
    // FOTO
    if (msg.photo) {
      await sendMessage(chatId, '🤖 Lendo o comprovante...');
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const { buffer } = await getFile(fileId);
      const extraido = await extrairComIA(buffer, 'image/jpeg', false);
      Object.assign(estado[chatId], extraido);
      await sendMessage(chatId,
        `📋 *Dados extraídos:*\n\n` +
        `📄 Beneficiário: *${extraido.beneficiario || '?'}*\n` +
        `💰 Valor: *${extraido.valor || '?'}*\n` +
        `📅 Data: *${extraido.data || '?'}*\n\n` +
        `Selecione a empresa:`,
        teclasEmpresas()
      );
      return res.status(200).end();
    }

    // DOCUMENTO PDF
    if (msg.document) {
      await sendMessage(chatId, '🤖 Lendo o PDF...');
      const { buffer } = await getFile(msg.document.file_id);
      const extraido = await extrairComIA(buffer, 'application/pdf', true);
      Object.assign(estado[chatId], extraido);
      await sendMessage(chatId,
        `📋 *Dados extraídos:*\n\n` +
        `📄 Beneficiário: *${extraido.beneficiario || '?'}*\n` +
        `💰 Valor: *${extraido.valor || '?'}*\n` +
        `📅 Data: *${extraido.data || '?'}*\n\n` +
        `Selecione a empresa:`,
        teclasEmpresas()
      );
      return res.status(200).end();
    }

    // TEXTO
    if (msg.text) {
      const texto = msg.text.trim();

      if (texto === '/start') {
        await sendMessage(chatId,
          `👋 *Bot Financeiro MC*\n\n` +
          `Manda um comprovante ou descreva o pagamento e eu registro automaticamente no sistema.\n\n` +
          `*Exemplos:*\n` +
          `• Foto/print do comprovante PIX\n` +
          `• PDF do comprovante\n` +
          `• _"Paguei R$ 1.200 de aluguel para João Silva hoje"_`
        );
        return res.status(200).end();
      }

      await sendMessage(chatId, '🤖 Extraindo dados do texto...');
      const extraido = await extrairDeTexto(texto);
      Object.assign(estado[chatId], extraido);
      await sendMessage(chatId,
        `📋 *Dados extraídos:*\n\n` +
        `📄 Beneficiário: *${extraido.beneficiario || '?'}*\n` +
        `💰 Valor: *${extraido.valor || '?'}*\n` +
        `📅 Data: *${extraido.data || '?'}*\n\n` +
        `Selecione a empresa:`,
        teclasEmpresas()
      );
      return res.status(200).end();
    }

  } catch (e) {
    await sendMessage(chatId, '❌ Erro ao processar. Tente novamente.');
    console.error(e);
  }

  return res.status(200).end();
}
