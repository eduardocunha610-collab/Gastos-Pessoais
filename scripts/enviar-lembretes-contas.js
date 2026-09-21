// Script executado automaticamente pelo GitHub Actions, duas vezes por dia.
// Consulta a tabela "contas" do Gastos Pessoais e envia lembretes via Telegram
// para todos os chat_ids configurados: contas que vencem hoje e contas vencidas.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS; // ex: "8509176750,7081310806"

function faltaVariavel(nome, valor){
  if(!valor){
    console.error(`Variável de ambiente ausente: ${nome}. Verifique os Secrets do repositório.`);
    process.exit(1);
  }
}
faltaVariavel('SUPABASE_URL', SUPABASE_URL);
faltaVariavel('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY);
faltaVariavel('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN);
faltaVariavel('TELEGRAM_CHAT_IDS', TELEGRAM_CHAT_IDS);

const CHAT_IDS = TELEGRAM_CHAT_IDS.split(',').map(s => s.trim()).filter(Boolean);

function hojeBrasil(){
  // Calcula a data de "hoje" já no fuso de Brasília (UTC-3, sem horário de verão),
  // já que o GitHub Actions roda os servidores em UTC.
  const agora = new Date();
  const offsetBrasilMs = -3 * 60 * 60 * 1000;
  const localBrasil = new Date(agora.getTime() + offsetBrasilMs);
  const y = localBrasil.getUTCFullYear();
  const m = String(localBrasil.getUTCMonth() + 1).padStart(2, '0');
  const d = String(localBrasil.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatarMoeda(valor){
  const n = Number(valor);
  return n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

async function consultarSupabase(query){
  const url = `${SUPABASE_URL}/rest/v1/contas?${query}&select=*&order=vencimento.asc`;
  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if(!resp.ok){
    const texto = await resp.text();
    throw new Error(`Erro ao consultar Supabase (${resp.status}): ${texto}`);
  }
  return resp.json();
}

async function buscarContasDeHoje(){
  const hoje = hojeBrasil();
  return consultarSupabase(`vencimento=eq.${hoje}&status=neq.Pago`);
}

async function buscarContasVencidas(){
  return consultarSupabase(`status=eq.Vencido`);
}

function montarMensagem(contasHoje, contasVencidas){
  const linhas = [];
  const hojeFormatado = hojeBrasil().split('-').reverse().join('/');

  if(contasHoje.length > 0){
    linhas.push(`📅 *Contas vencendo hoje (${hojeFormatado})*`, '');
    contasHoje.forEach(c=>{
      linhas.push(`• ${c.nome}: R$ ${formatarMoeda(c.valor)}`);
    });
    linhas.push('');
  }

  if(contasVencidas.length > 0){
    linhas.push(`🔴 *Contas vencidas*`, '');
    contasVencidas.forEach(c=>{
      const dataFormatada = c.vencimento.split('-').reverse().join('/');
      linhas.push(`• ${c.nome}: R$ ${formatarMoeda(c.valor)} (venceu em ${dataFormatada})`);
    });
  }

  return linhas.join('\n');
}

async function enviarTelegram(chatId, texto){
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'Markdown'
    })
  });
  const data = await resp.json();
  if(!data.ok){
    throw new Error(`Erro ao enviar mensagem pro chat_id ${chatId}: ${JSON.stringify(data)}`);
  }
}

async function main(){
  const [contasHoje, contasVencidas] = await Promise.all([
    buscarContasDeHoje(),
    buscarContasVencidas()
  ]);

  if(contasHoje.length === 0 && contasVencidas.length === 0){
    console.log('Nenhuma conta vencendo hoje nem vencida. Nenhuma mensagem enviada.');
    return;
  }

  const mensagem = montarMensagem(contasHoje, contasVencidas);

  for(const chatId of CHAT_IDS){
    await enviarTelegram(chatId, mensagem);
    console.log(`Lembrete enviado para chat_id ${chatId}.`);
  }

  console.log(`Concluído: ${contasHoje.length} conta(s) vencendo hoje, ${contasVencidas.length} vencida(s), enviado para ${CHAT_IDS.length} destinatário(s).`);
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});
