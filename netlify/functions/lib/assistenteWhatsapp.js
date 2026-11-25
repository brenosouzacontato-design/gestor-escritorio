// netlify/functions/lib/assistenteWhatsapp.js
//
// Assistente guiado do grupo "ANALISTA JR" do WhatsApp (WHATSAPP_ANALISTA_GROUP_ID). A pessoa digita
// "oi" e o robô conduz passo a passo, com listas numeradas:
//
//   oi → 1 Emitir NFS-e      → empresa → tomador/modelo → valor → data → prévia (responde "sim")
//        2 Agendar NFS-e     → empresa → modelo recorrente → valor → dia e hora → prévia ("sim")
//        3 Tarefa  4 Lembrete  5 Reunião  6 Obrigação → descreve em uma mensagem → gravado no gestor
//
// Cada pessoa do grupo tem a sua conversa (tabela whatsapp_conversas). "voltar" volta ao menu,
// "sair" encerra; parada há mais de VALIDADE_MIN minutos, recomeça do menu.
// No fim, o webhook faz o mesmo que os comandos já existentes (nfse, agendar nfse, tarefa:, ...):
// aqui só ficam os passos, sem banco nem rede (testes em __tests__/assistenteWhatsapp.test.cjs).

const { parseValor } = require('./nfse/importador')
const nfseWpp = require('./nfseWhatsapp')

const VALIDADE_MIN = 30

const OPCOES = [
  { n: 1, fluxo: 'nfse', rotulo: '🧾 Emitir NFS-e' },
  { n: 2, fluxo: 'agendar', rotulo: '⏰ Agendar NFS-e' },
  { n: 3, fluxo: 'tarefa', rotulo: '📝 Criar tarefa' },
  { n: 4, fluxo: 'lembrete', rotulo: '🔔 Criar lembrete' },
  { n: 5, fluxo: 'reuniao', rotulo: '🤝 Marcar reunião' },
  { n: 6, fluxo: 'obrigacao', rotulo: '📌 Criar obrigação' },
]

const PEDIDO_TEXTO = {
  tarefa: '📝 *Nova tarefa.* Escreva numa mensagem o que é, o cliente e o prazo.\n_Ex.: conferir DAS da Padaria até sexta_',
  lembrete: '🔔 *Novo lembrete.* Escreva o que lembrar e quando (dia e hora); eu aviso no WhatsApp.\n_Ex.: ligar para a Clínica amanhã 9h_',
  reuniao: '🤝 *Nova reunião.* Escreva com quem, o dia e a hora.\n_Ex.: com a Loja Silva sexta 14h_',
  obrigacao: '📌 *Nova obrigação.* Escreva qual, de qual cliente e o vencimento.\n_Ex.: DCTFWeb da Loja vence dia 15_',
}

const RODAPE = '\n\n_Responda com o número. *voltar* = menu · *sair* = encerrar_'

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*_~]/g, '').trim()

// Mensagens que abrem o menu
const RE_INICIO = /^(?:oi+e?|ola|ol[aá]+|bom dia|boa tarde|boa noite|menu|opcoes|opcao|inicio|comecar|ajuda|analista)[\s!.?,]*$/
const ehInicio = (t) => RE_INICIO.test(norm(t))
const ehSair = (t) => /^(?:sair|cancelar|cancela|encerrar|fim|tchau|obrigad[oa])[\s!.]*$/.test(norm(t))
const ehVoltar = (t) => /^(?:voltar|volta|menu)[\s!.]*$/.test(norm(t))

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const lista = (itens) => itens.map((x, i) => `*${i + 1}* · ${x}`).join('\n')

function menu() {
  return `👋 Oi! Sou o *Analista Jr.* O que vamos fazer?\n\n${OPCOES.map((o) => `*${o.n}* · ${o.rotulo}`).join('\n')}${RODAPE}`
}

// Escolha numa lista: o número, ou um texto que bate com um item só. Devolve o índice ou -1.
function escolher(texto, nomes) {
  const t = norm(texto)
  const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN
  if (n >= 1 && n <= nomes.length) return n - 1
  if (t.length < 3) return -1
  const achados = nomes.map((nome, i) => [norm(nome), i]).filter(([nome]) => nome.includes(t) || t.includes(nome))
  return achados.length === 1 ? achados[0][1] : -1
}

// Empresas que podem entrar no fluxo (agendar: só as com modelo recorrente; MEI fica de fora)
function empresasDo(fluxo, empresas, cadastros) {
  return (empresas || []).filter((e) => e.ativo !== false)
    .filter((e) => fluxo !== 'agendar' || (!e.mei && modelosDe(cadastros, e.cliente_id).length))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
}

const modelosDe = (cadastros, id) => ((cadastros || {})[id]?.modelos || [])
  .filter((m) => m.ativo !== false && (m.periodicidade === 'semanal' || (m.periodicidade === 'mensal' && m.inicio)))

// Tomadores da empresa como o comando "nfse" os conhece: { tipo: 'recorrente'|'tomador'|'mei', item, rotulo }
function tomadoresDe(fluxo, empresa, cadastros) {
  const cad = (cadastros || {})[empresa.cliente_id] || {}
  const recorrentes = modelosDe(cadastros, empresa.cliente_id).map((m) => ({
    tipo: 'recorrente', item: m, rotulo: `${m.nome} _(recorrente ${m.periodicidade === 'mensal' ? 'mensal' : 'semanal'})_`,
  }))
  if (fluxo === 'agendar') return recorrentes
  return [
    ...recorrentes,
    ...(cad.tomadores || []).filter((t) => t.ativo !== false).sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
      .map((t) => ({ tipo: 'tomador', item: t, rotulo: t.nome })),
    ...(cad.mei || []).filter((m) => m.ativo !== false).map((m) => ({
      tipo: 'mei', item: { ...m, nome: m.tomador_nome || 'Tomador não identificado', cpf: m.tomador_doc || '' },
      rotulo: `${m.tomador_nome || 'Tomador não identificado'} _(modelo MEI)_`,
    })),
  ]
}

const valorSugerido = (item) => {
  const v = item.valor != null ? item.valor : item.valor_padrao
  return v != null && Number(v) > 0 ? Number(v).toFixed(2) : null
}

// Um passo da conversa.
//   estado: null (sem conversa) ou { etapa, fluxo, empresa_id, ref: { tipo, id }, valor }
//   ctx: { empresas, cadastros, hoje: 'AAAA-MM-DD', hora: 'HH:mm' }  (empresas/cadastros: carregarCadastrosNfse)
// Devolve { estado (null = encerrou), mensagens: [texto], acao? }
//   acao: { tipo: 'nfse', r }            → r como o de nfseWhatsapp.interpretarPedido (vai para a prévia)
//         { tipo: 'agendar', r, q }      → q como o de nfseWhatsapp.extrairQuando
//         { tipo: 'comando', categoria, texto }  → como "tarefa: texto" no grupo do escritório
function passo(estado, texto, ctx) {
  const t = String(texto || '').trim()
  if (ehSair(t)) return { estado: null, mensagens: ['👋 Até mais! Quando precisar, é só mandar *oi*.'] }
  if (!estado || ehInicio(t) || ehVoltar(t)) return { estado: { etapa: 'menu' }, mensagens: [menu()] }

  const s = { ...estado }
  const empresa = () => (ctx.empresas || []).find((e) => e.cliente_id === s.empresa_id)
  const tomador = () => {
    const e = empresa()
    return e && tomadoresDe(s.fluxo, e, ctx.cadastros).find((x) => x.tipo === s.ref?.tipo && x.item.id === s.ref?.id)
  }
  const perdeu = () => ({ estado: { etapa: 'menu' }, mensagens: [`⚠️ Não achei mais esse cadastro. Vamos de novo.\n\n${menu()}`] })

  switch (s.etapa) {
    case 'menu': {
      const i = escolher(t, OPCOES.map((o) => o.rotulo))
      if (i < 0) return { estado: s, mensagens: [`Não entendi. Responda com o número da opção.\n\n${menu()}`] }
      const fluxo = OPCOES[i].fluxo
      if (PEDIDO_TEXTO[fluxo]) return { estado: { etapa: 'texto', fluxo }, mensagens: [`${PEDIDO_TEXTO[fluxo]}${RODAPE.replace('Responda com o número. ', '')}`] }
      const emps = empresasDo(fluxo, ctx.empresas, ctx.cadastros)
      if (!emps.length) {
        return { estado: { etapa: 'menu' }, mensagens: [fluxo === 'agendar'
          ? '⚠️ Nenhuma empresa tem nota recorrente cadastrada (Gestor → Emitir NFS-e → Notas recorrentes).'
          : '⚠️ Nenhuma empresa está configurada para emitir NFS-e no gestor.'] }
      }
      return { estado: { etapa: 'empresa', fluxo }, mensagens: [`${fluxo === 'agendar' ? '⏰ *Agendar NFS-e*' : '🧾 *Emitir NFS-e*'}\nDe qual empresa?\n\n${lista(emps.map((e) => `${e.nome}${e.mei ? ' _(MEI)_' : ''}`))}${RODAPE}`] }
    }

    case 'empresa': {
      const emps = empresasDo(s.fluxo, ctx.empresas, ctx.cadastros)
      const i = escolher(t, emps.map((e) => e.nome))
      if (i < 0) return { estado: s, mensagens: [`Não achei essa empresa. Responda com o número:\n\n${lista(emps.map((e) => e.nome))}${RODAPE}`] }
      const e = emps[i]
      const toms = tomadoresDe(s.fluxo, e, ctx.cadastros)
      if (!toms.length) {
        return { estado: s, mensagens: [`⚠️ ${e.nome} não tem tomador cadastrado nem nota recorrente. Cadastre em Gestor → Emitir NFS-e, ou escolha outra empresa.`] }
      }
      const novo = { ...s, etapa: 'tomador', empresa_id: e.cliente_id }
      if (toms.length === 1) return passo(novo, '1', ctx) // um só: já segue
      return { estado: novo, mensagens: [`🏢 *${e.nome}*\n${s.fluxo === 'agendar' ? 'Qual nota recorrente?' : 'Para quem é a nota?'}\n\n${lista(toms.map((x) => x.rotulo))}${RODAPE}`] }
    }

    case 'tomador': {
      const e = empresa()
      if (!e) return perdeu()
      const toms = tomadoresDe(s.fluxo, e, ctx.cadastros)
      const i = escolher(t, toms.map((x) => x.item.nome))
      if (i < 0) return { estado: s, mensagens: [`Não achei. Responda com o número:\n\n${lista(toms.map((x) => x.rotulo))}${RODAPE}`] }
      const tom = toms[i]
      const sug = valorSugerido(tom.item)
      return {
        estado: { ...s, etapa: 'valor', ref: { tipo: tom.tipo, id: tom.item.id } },
        mensagens: [`👤 *${tom.item.nome}*\nQual o valor da nota?${sug ? `\n*1* · usar ${brl(sug)}` : ''}\n_Ou digite o valor, ex.: 1.250,00_${RODAPE.replace('Responda com o número. ', '')}`],
      }
    }

    case 'valor': {
      const tom = tomador()
      if (!tom) return perdeu()
      const sug = valorSugerido(tom.item)
      const valor = sug && /^1$/.test(norm(t)) ? sug : parseValor(t.replace(/^r\$\s*/i, ''))
      if (!valor || !(Number(valor) > 0)) return { estado: s, mensagens: ['Não entendi o valor. Digite só o número, ex.: *1.250,00*'] }
      const novo = { ...s, etapa: s.fluxo === 'agendar' ? 'quando' : 'data', valor }
      const pergunta = s.fluxo === 'agendar'
        ? `💰 ${brl(valor)}\nQuando emitir? Dia e hora, ex.: *30/11 14:00* _(sem hora: 9h)_`
        : `💰 ${brl(valor)}\nData do ${tom.tipo === 'mei' ? 'serviço (competência)' : 'atendimento'}?\n*1* · ${tom.tipo === 'recorrente' ? `a ${tom.item.periodicidade === 'mensal' ? 'do mês' : 'da semana'} sugerida` : 'hoje'}\n_Ou digite a data, ex.: 10/11_`
      return { estado: novo, mensagens: [pergunta + RODAPE.replace('Responda com o número. ', '')] }
    }

    case 'data': {
      const tom = tomador()
      if (!tom) return perdeu()
      let data = null
      if (!/^(?:1|hoje|ok)$/.test(norm(t))) {
        data = nfseWpp.extrairDataValor(t, ctx.hoje).data
        if (!data) return { estado: s, mensagens: ['Não entendi a data. Digite assim: *10/11* (ou *1* para a sugerida).'] }
        if (data > ctx.hoje) return { estado: s, mensagens: ['A data do atendimento não pode ser futura. Para emitir depois, use *voltar* → *Agendar NFS-e*.'] }
      }
      const r = { empresa: empresa(), tipo: tom.tipo, item: tom.item, valor: s.valor, data, unico: false }
      return { estado: null, mensagens: [], acao: { tipo: 'nfse', r } }
    }

    case 'quando': {
      const tom = tomador()
      if (!tom) return perdeu()
      const q = nfseWpp.extrairQuando(t, { dia: ctx.hoje, hora: ctx.hora })
      if (q.erro) return { estado: s, mensagens: [`⚠️ ${q.erro} Digite assim: *30/11 14:00*`] }
      if (q.resto) return { estado: s, mensagens: ['Não entendi o dia e a hora. Digite assim: *30/11 14:00*'] }
      const r = { empresa: empresa(), tipo: tom.tipo, item: tom.item, valor: s.valor, data: null, unico: false }
      return { estado: null, mensagens: [], acao: { tipo: 'agendar', r, q } }
    }

    case 'texto': {
      if (t.length < 4) return { estado: s, mensagens: [PEDIDO_TEXTO[s.fluxo] || menu()] }
      return { estado: null, mensagens: [], acao: { tipo: 'comando', categoria: s.fluxo, texto: t.slice(0, 1000) } }
    }

    default:
      return { estado: { etapa: 'menu' }, mensagens: [menu()] }
  }
}

module.exports = { passo, menu, escolher, ehInicio, ehSair, tomadoresDe, empresasDo, OPCOES, VALIDADE_MIN }
