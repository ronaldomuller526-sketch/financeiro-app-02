const TELEGRAM_TOKEN = '8788489860:AAHsemvk1CQL6u5kLasmKYy96Rg1LoXheIc';
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_CONTAS = 'c7e0311365f84b81b4f1129e357dd8f7';

const EMPRESAS = ['Mundo das Compras', 'Leão Home', 'Apollo Home', 'Casa 777', 'Achados do Lar'];
const CATEGORIAS = ['Aluguel', 'Fornecedor', 'Assinatura', 'Imposto/Guia', 'Folha de Pagamento', 'Frete/Logística', 'Água/Luz/Internet', 'Embalagem', 'Seguro', 'ADS', 'Honorários', 'Comissões', 'Gasto Extra', 'Outros'];

const estado = {};

async function sendMessage(chatId, text, keyboard) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallback(id) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}

function parsearTexto(texto) {
  const valorMatch = texto.match(/R?\$?\s*([\d.,]+)/);
  let valor = null;
  if (valorMatch) {
    valor = valorMatch[1].replace(/\./g, '').replace(',', '.');
  }

  const hoje = new Date();
  let data = hoje.toISOString().split('T')[0];

  if (/hoje/i.test(texto)) {
    data = hoje.toISOString().split('T')[0];
  } else if (/ontem/i.test(texto)) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 1);
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
  return EMPRESAS.map(e => [{ text: e, callback_data: 'empresa:' + e }]);
}

function teclasCategorias() {
  const rows = [];
  for (let i = 0; i < CATEGORIAS.length; i += 2) {
    const row = [{ text: CATEGORIAS[i], callback_data: 'cat:' + CATEGORIAS[i] }];
    if (CATEGORIAS[i + 1]) row.push({ text: CATEGORIAS[i + 1], callback_data: 'cat:' + CATEGORIAS[i + 1] });
    rows.push(row);
  }
  return rows;
}

async function salvarNoNotion(d) {
  const valor = parseFloat(d.valor);
  const properties = {
    'Descrição': { title: [{ text: { content: d.descricao || 'Pagamento' } }] },
    'Empresa': { rich_text: [{ text: { content: d.empresa } }] },
    'Valor': { number: isNaN(valor) ? 0 : valor },
    'Vencimento': { date: { start: d.data || new Date().toISOString().split('T')[0] } },
    'Status': { select: { name: 'Pago' } },
    'Tipo': { select: { name: 'PIX' } },
    'Categoria': { select: { name: d.categoria } },
    'Observações': { rich_text: [{ text: { content: 'Registrado via Telegram' } }] }
  };

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + NOTION_TOKEN,
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

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    await answerCallback(cb.id);

    if (!estado[chatId]) estado[chatId] = {};

    if (cb.data.startsWith('empresa:')) {
      estado[chatId].empresa = cb.data.replace('empresa:', '');
      await sendMessage(chatId, '🏢 *' + estado[chatId].empresa + '*\n\nSelecione a categoria:', teclasCategorias());
    }

    if (cb.data.startsWith('cat:')) {
      estado[chatId].categoria = cb.data.replace('cat:', '');
      const d = estado[chatId];
      const ok = await salvarNoNotion(d);

      if (ok) {
        const vf = d.valor ? 'R$ ' + parseFloat(d.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
        const parts = (d.data || '').split('-');
        const df = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : d.data;
        await sendMessage(chatId,
          '✅ *Pagamento registrado!*\n\n' +
          '📄 ' + d.descricao + '\n' +
          '💰 ' + vf + '\n' +
          '📅 ' + df + '\n' +
          '🏢 ' + d.empresa + '\n' +
          '🏷️ ' + d.categoria + '\n\n' +
          '_Lançado como PAGO no Notion_'
        );
      } else {
        await sendMessage(chatId, '❌ Erro ao salvar no Notion. Tente novamente.');
      }

      delete estado[chatId];
    }

    return res.status(200).end();
  }

  const msg = update.message;
  if (!msg || !msg.text) return res.status(200).end();

  const chatId = msg.chat.id;
  const texto = msg.text.trim();

  if (!estado[chatId]) estado[chatId] = {};

  if (texto === '/start' || texto === '/ajuda') {
    await sendMessage(chatId,
      '👋 *Bot Financeiro MC*\n\n' +
      'Descreva o pagamento e eu registro no sistema.\n\n' +
      '*Exemplos:*\n' +
      '• `R$ 1.200 aluguel galpão 08/05`\n' +
      '• `500 embalagem ontem`\n' +
      '• `R$ 3.800 fornecedor Martins hoje`\n' +
      '• `400 honorários contador 01/05`'
    );
    return res.status(200).end();
  }

  const extraido = parsearTexto(texto);
  Object.assign(estado[chatId], extraido);

  const vf = extraido.valor ? 'R$ ' + parseFloat(extraido.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '?';
  const parts = (extraido.data || '').split('-');
  const df = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : '?';

  await sendMessage(chatId,
    '📋 *Dados identificados:*\n\n' +
    '📄 ' + extraido.descricao + '\n' +
    '💰 ' + vf + '\n' +
    '📅 ' + df + '\n\n' +
    'Selecione a empresa:',
    teclasEmpresas()
  );

  return res.status(200).end();
};
