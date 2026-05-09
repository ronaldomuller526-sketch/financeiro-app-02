const TELEGRAM_TOKEN = '8788489860:AAHsemvk1CQL6u5kLasmKYy96Rg1LoXheIc';
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_CONTAS = 'c7e0311365f84b81b4f1129e357dd8f7';

const EMPRESAS = ['Mundo das Compras', 'Leão Home', 'Apollo Home', 'Casa 777', 'Achados do Lar'];
const CATEGORIAS = ['Aluguel', 'Fornecedor', 'Assinatura', 'Imposto/Guia', 'Folha de Pagamento', 'Frete/Logística', 'Água/Luz/Internet', 'Embalagem', 'Seguro', 'ADS', 'Honorários', 'Comissões', 'Gasto Extra', 'Outros'];

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

function parsearTexto(texto) {
  // Extrair valor — R$ 1.200,50 ou 1200.50 ou 1.200
  const valorMatch = texto.match(/R?\$?\s*([\d.,]+)/);
  let valor = null;
  if (valorMatch) {
    valor = valorMatch[1].replace(/\./g, '').replace(',', '.');
  }

  // Extrair data — DD/MM, DD/MM/YYYY, DD-MM, hoje, ontem
  let data = new Date().toISOString().split('T')[0];
  const hoje = new Date();

  if (/hoje/i.test(texto)) {
    data = hoje.toISOString().split('T')[0];
  } else if (/ontem/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() - 1);
    data = d.toISOString().split('T')[0];
  } else {
    const dataMatch = texto.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (dataMatch) {
      const dia = dataMatch[1].padStart(2, '0');
      const mes = dataMatch[2].padStart(2, '0');
      const ano = dataMatch[3] ? (dataMatch[3].length === 2 ? '20' + dataMatch[3] : dataMatch[3]) : hoje.getFullYear();
      data = `${ano}-${mes}-${dia}`;
    }
  }

  // Extrair descrição — tudo que não é número/data/R$
  let descricao = texto
    .replace(/R?\$?\s*[\d.,]+/g, '')
    .replace(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/g, '')
    .replace(/\b(hoje|ontem)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!descricao) descricao = 'Pagamento';

  return { valor, data, descricao };
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

async function salvarNoNotion(dados) {
  const valor = parseFloat(dados.valor);
  const properties = {
    'Descrição': { title: [{ text: { content: dados.descricao || 'Pagamento' } }] },
    'Empresa': { rich_text: [{ text: { content: dados.empresa } }] },
    'Valor': { number: isNaN(valor) ? 0 : valor },
    'Vencimento': { date: { start: dados.data || new Date().toISOString().split('T')[0] } },
    'Status': { select: { name: 'Pago' } },
    'Tipo': { select: { name: 'PIX' } },
    'Categoria': { select: { name: dados.categoria } },
    'Observações': { rich_text: [{ text: { content: '✅ Registrado via Telegram' } }] }
  };

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ parent: { database_id: DB_CONTAS }, properties })
  });

  return r.ok;
}

module.exports = async function handler(req, res) {
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
