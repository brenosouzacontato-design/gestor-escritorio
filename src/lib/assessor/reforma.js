// Lembretes da Reforma Tributária ajustados ao perfil de cada cliente
// (regime, atividade, município e configuração da NFS-e).
//
// Cada lembrete tem uma janela de datas em que aparece. Datas e regras vêm
// de noticias.js / LC 214/2025; quando um prazo mudar, ajuste aqui e lá.

import { entre, diasEntre, dataBR } from './datas.js'
import { NOTICIAS } from './noticias.js'

const fonte = (id) => NOTICIAS.find((n) => n.id === id)?.fonte || null
const ref = (p) => ({ id: p.id, nome: p.nome })

export function lembretesReforma(perfis, hoje) {
  const cards = []
  const sn = perfis.filter((p) => p.regime === 'SN')
  const lucro = perfis.filter((p) => p.regime === 'LP' || p.regime === 'LR')
  const presumido = perfis.filter((p) => p.regime === 'LP')

  // 1) Simples: opção pelo IBS/CBS no regime regular (1º semestre de 2027)
  const PRAZO_OPCAO = '2026-10-30'
  if (sn.length && entre(hoje, '2026-09-01', PRAZO_OPCAO)) {
    const dias = diasEntre(hoje, PRAZO_OPCAO)
    cards.push({
      id: 'reforma-sn-opcao-regime-regular',
      tipo: 'reforma',
      nivel: dias <= 7 ? 'urgente' : 'atencao',
      titulo: `Simples: opção pelo IBS/CBS fora do DAS termina em ${dataBR(PRAZO_OPCAO)}${dias === 0 ? ' (hoje)' : dias === 1 ? ' (amanhã)' : ` (${dias} dias)`}`,
      texto: 'Decida, cliente a cliente, se vale recolher IBS/CBS pelo regime regular em 2027. Costuma compensar para quem vende para outras empresas que aproveitam crédito; para quem atende pessoa física (ex.: consultório), em geral não. Sem opção, tudo segue dentro do DAS. A escolha é feita no Portal do Simples Nacional.',
      clientes: sn.map(ref),
      fonte: fonte('cgsn-194-prorrogacao'),
    })
  }
  if (sn.length && entre(hoje, '2026-10-31', '2026-12-20')) {
    cards.push({
      id: 'reforma-sn-cancelamento-opcao',
      tipo: 'reforma',
      nivel: 'atencao',
      titulo: 'Simples: dá para cancelar a opção de IBS/CBS até 20/12/2026',
      texto: 'Entre 03/11 e 20/12/2026 o Portal do Simples aceita cancelar a opção pelo regime regular feita em outubro. Revise quem optou antes do fim do ano.',
      clientes: sn.map(ref),
      fonte: fonte('cgsn-194-prorrogacao'),
    })
  }

  // 2) NFS-e: campos do Simples (regApIBSCBSSN / cAtvSN) obrigatórios em 01/01/2027
  const snSemCampos = perfis.filter((p) => p.nfse?.ativo && p.nfse.faltaSimples)
  if (snSemCampos.length && entre(hoje, '2026-10-01', '2027-03-31')) {
    const dias = diasEntre(hoje, '2027-01-01')
    cards.push({
      id: 'reforma-nfse-simples-campos',
      tipo: 'reforma',
      nivel: dias <= 30 ? 'urgente' : 'atencao',
      titulo: 'NFS-e do Simples: configurar regime de IBS/CBS e atividade',
      texto: 'A partir de 01/01/2027 as notas de empresas do Simples precisam informar o regime de IBS/CBS (regApIBSCBSSN) e a atividade (cAtvSN). Sem isso a emissão em lote pode ser rejeitada.',
      clientes: snSemCampos.map(ref),
      acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
      fonte: fonte('ato-conjunto-04-2026'),
      mercado: 'ERPs como Domínio, Questor e Omie pedem a mesma informação no cadastro do produto/serviço; aqui ela fica na configuração de cada empresa (Emitir NFS-e → Editar).',
    })
  }

  // 3) IBS/CBS nas notas (cIndOp, CST, cClassTrib) — obrigatório desde 01/10/2026
  const semIbsCbs = perfis.filter((p) => p.nfse?.ativo && p.nfse.faltaIbsCbs)
  if (semIbsCbs.length && entre(hoje, '2026-08-01', null)) {
    cards.push({
      id: 'reforma-nfse-ibscbs',
      tipo: 'reforma',
      nivel: entre(hoje, '2026-10-01', null) ? 'urgente' : 'atencao',
      titulo: 'Empresas emitindo NFS-e sem IBS/CBS configurado',
      texto: 'Desde 01/10/2026 os campos de IBS/CBS (cIndOp, CST e cClassTrib) são obrigatórios. A Receita flexibilizou a validação, mas nota sem eles pode ficar em desconformidade.',
      clientes: semIbsCbs.map(ref),
      acao: { pagina: 'nfse', rotulo: 'Configurar em Emitir NFS-e' },
      fonte: fonte('ato-conjunto-04-2026'),
    })
  }

  // 4) Lucro Presumido / Real: destaque no ano-teste e virada de 2027
  if (lucro.length && entre(hoje, '2026-01-01', '2026-12-31')) {
    cards.push({
      id: 'reforma-lucro-ano-teste',
      tipo: 'reforma',
      nivel: 'atencao',
      titulo: 'Lucro Presumido/Real: destaque de CBS 0,9% e IBS 0,1% nas notas de 2026',
      texto: 'No ano-teste o valor é destacado e compensado com PIS/Cofins, sem desembolso para quem entrega as obrigações acessórias. Confira se os clientes que emitem por sistema próprio já estão destacando.',
      clientes: lucro.map(ref),
      fonte: fonte('ato-conjunto-04-2026'),
    })
  }
  if (lucro.length && entre(hoje, '2026-09-01', '2027-03-31')) {
    cards.push({
      id: 'reforma-lucro-2027',
      tipo: 'reforma',
      nivel: entre(hoje, '2026-11-01', '2027-01-31') ? 'atencao' : 'dica',
      titulo: '2027: PIS/Cofins acabam e a CBS passa a ser cobrada',
      texto: 'Reveja preço e contratos de longo prazo (cláusula de reequilíbrio) e a nova regra de créditos amplos. É o momento de recalcular a carga e conversar com o cliente antes de janeiro.',
      clientes: lucro.map(ref),
      fonte: fonte('lc-214'),
    })
  }
  if (presumido.length && entre(hoje, '2026-11-01', '2027-01-31')) {
    cards.push({
      id: 'reforma-planejamento-regime',
      tipo: 'reforma',
      nivel: 'dica',
      titulo: 'Planejamento de regime para 2027 com IBS/CBS',
      texto: 'Com crédito amplo de CBS, alguns clientes do Presumido podem ficar melhor no Real (ou no Simples híbrido). Vale simular antes da opção de janeiro.',
      clientes: presumido.map(ref),
      acao: { pagina: 'central', rotulo: 'Abrir comparativos na Central' },
    })
  }

  // 5) Alíquotas reduzidas por atividade
  const saude = perfis.filter((p) => p.atividade === 'saude')
  if (saude.length) {
    cards.push({
      id: 'reforma-reducao-saude',
      tipo: 'reforma',
      nivel: 'dica',
      titulo: 'Serviços de saúde: redução de 60% no IBS/CBS',
      texto: 'Serviços de saúde da lista da LC 214 têm alíquota de IBS/CBS reduzida em 60%. Confira se o cClassTrib configurado na NFS-e é o da redução (e não o da alíquota cheia). Para quem está no Simples, a redução só pesa se optar pelo regime regular.',
      clientes: saude.map(ref),
      acao: { pagina: 'nfse', rotulo: 'Conferir em Emitir NFS-e' },
      fonte: fonte('lc-214'),
    })
  }
  const regulamentadas = perfis.filter((p) => p.atividade === 'regulamentada')
  if (regulamentadas.length) {
    cards.push({
      id: 'reforma-reducao-regulamentadas',
      tipo: 'reforma',
      nivel: 'dica',
      titulo: 'Profissões regulamentadas: redução de 30% no IBS/CBS',
      texto: 'Contabilidade, advocacia, engenharia e outras profissões intelectuais regulamentadas têm redução de 30%. Confira o cClassTrib usado nas notas desses clientes.',
      clientes: regulamentadas.map(ref),
      fonte: fonte('lc-214'),
    })
  }

  // 6) Município: ISS em transição para o IBS
  const porMunicipio = {}
  for (const p of perfis) if (p.municipio) (porMunicipio[p.municipio] ||= []).push(p)
  const municipios = Object.keys(porMunicipio)
  if (municipios.length) {
    const lista = municipios.sort((a, b) => porMunicipio[b].length - porMunicipio[a].length)
    cards.push({
      id: 'reforma-iss-municipios',
      tipo: 'reforma',
      nivel: 'dica',
      titulo: `ISS dos seus ${lista.length} município(s) começa a cair em 2029`,
      texto: `De 2029 a 2032 o ISS cai 10% ao ano e o IBS ocupa o espaço; em 2033 o ISS acaba. Benefícios municipais (ISS fixo, alíquota reduzida) deixam de valer aos poucos. Municípios com mais clientes: ${lista.slice(0, 5).map((m) => `${m} (${porMunicipio[m].length})`).join(', ')}.`,
      clientes: [],
    })
  }

  // 7) MEI
  const mei = perfis.filter((p) => p.regime === 'MEI')
  if (mei.length) {
    cards.push({
      id: 'reforma-mei',
      tipo: 'reforma',
      nivel: 'dica',
      titulo: 'MEI: IBS/CBS continuam dentro do valor fixo',
      texto: 'O MEI segue recolhendo IBS/CBS no valor fixo mensal, sem opção pelo regime regular. O que muda é o leiaute das notas: confira se a NFS-e desses clientes está saindo com o código de MEI.',
      clientes: mei.map(ref),
      fonte: fonte('lc-214'),
    })
  }

  return cards
}
