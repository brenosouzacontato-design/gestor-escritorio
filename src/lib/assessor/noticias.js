// Notícias e marcos da Reforma Tributária, curados à mão.
// Para atualizar: acrescente um item (data em 'YYYY-MM-DD', fonte com link)
// e abra um PR. Prefira fonte oficial; quando for site de notícia, deixe
// claro no texto que vale conferir no ato oficial.

export const ATUALIZADO_EM = '2026-10-28'

export const NOTICIAS = [
  {
    id: 'cgsn-194-prorrogacao',
    data: '2026-09-28',
    titulo: 'Simples: prazo para IBS/CBS pelo regime regular vai até 30/10/2026',
    resumo: 'A Resolução CGSN nº 194/2026 prorrogou para 30/10/2026 a opção, para quem já é do Simples, de recolher IBS e CBS fora do DAS (regime regular) no 1º semestre de 2027. Quem não optar segue com IBS/CBS dentro do Simples. Cancelamento: de 03/11 a 20/12/2026.',
    regimes: ['SN'],
    fonte: { rotulo: 'Jornal Contábil', url: 'https://jornalcontabil.com.br/noticia/empresas-do-simples-ganham-mais-tempo-para-decidir-sobre-ibs-e-cbs-para-2027/' },
  },
  {
    id: 'receita-alerta-opcao-2027',
    data: '2026-09-03',
    titulo: 'Receita alerta: opção pelo Simples e pelo modelo de IBS/CBS para 2027',
    resumo: 'São duas escolhas diferentes, feitas no Portal do Simples Nacional: entrar (ou voltar) no Simples em 2027 e, para optantes, recolher IBS/CBS pelo regime regular.',
    regimes: ['SN', 'LP', 'LR'],
    fonte: { rotulo: 'COAD', url: 'https://www.coad.com.br/home/noticias-detalhe/139518/receita-federal-alerta-sobre-o-prazo-para-opcao-pelo-simples-nacional-e-para-a-escolha-do-modelo-de-recolhimento-do-ibs-e-da-cbs-em-2027' },
  },
  {
    id: 'ato-conjunto-04-2026',
    data: '2026-08-03',
    titulo: 'IBS/CBS nas notas: obrigatório desde 01/10/2026, com escalonamento',
    resumo: 'O Ato Conjunto RFB/CGIBS nº 04/2026 remarcou o preenchimento obrigatório dos campos de IBS/CBS para 01/10/2026, com nova fase em 01/12/2026 e entrada do Simples Nacional em 01/01/2027. A Receita flexibilizou a validação logo depois, mas nota sem IBS/CBS pode ficar em desconformidade.',
    regimes: ['SN', 'LP', 'LR'],
    fonte: { rotulo: 'Guia Tributário', url: 'https://guiatributario.net/2026/08/03/' },
  },
  {
    id: 'nfse-perguntas-respostas',
    data: '2026-09-16',
    titulo: 'Portal da NFS-e publica perguntas e respostas sobre IBS/CBS',
    resumo: 'No emissor nacional o principal campo novo é a classificação tributária (cClassTrib); o cálculo de IBS/CBS é feito pelo próprio portal.',
    regimes: ['SN', 'LP', 'LR'],
    fonte: { rotulo: 'LegisWeb', url: 'https://www.legisweb.com.br/noticia/?id=34401' },
  },
  {
    id: 'lc-214',
    data: '2025-01-16',
    titulo: 'LC 214/2025: a lei que regulamenta IBS, CBS e Imposto Seletivo',
    resumo: 'Base de tudo: alíquotas reduzidas (60% para saúde e educação, 30% para profissões intelectuais regulamentadas), regimes específicos, split payment e regras do Simples.',
    regimes: ['SN', 'LP', 'LR', 'MEI'],
    fonte: { rotulo: 'Planalto', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm' },
  },
]

// Cronograma da transição (EC 132/2023 e LC 214/2025).
export const CRONOGRAMA = [
  { id: '2026', inicio: '2026-01-01', titulo: '2026 — ano-teste', texto: 'CBS 0,9% e IBS 0,1% destacados nos documentos fiscais, compensáveis com PIS/Cofins. Sem recolhimento efetivo para quem cumpre as obrigações acessórias.' },
  { id: '2027', inicio: '2027-01-01', titulo: '2027 — CBS plena', texto: 'PIS e Cofins acabam; a CBS passa a ser cobrada de verdade. Começa o Imposto Seletivo. IPI zerado (exceto Zona Franca). IBS segue em teste.' },
  { id: '2029', inicio: '2029-01-01', titulo: '2029 a 2032 — transição ICMS/ISS', texto: 'ICMS e ISS caem 10%, 20%, 30% e 40% (um passo por ano) enquanto o IBS sobe na mesma proporção.' },
  { id: '2033', inicio: '2033-01-01', titulo: '2033 — modelo completo', texto: 'ICMS e ISS deixam de existir. Ficam IBS, CBS e Imposto Seletivo.' },
]

export function etapaAtual(hoje) {
  const h = String(hoje).slice(0, 10)
  let atual = CRONOGRAMA[0]
  for (const e of CRONOGRAMA) if (h >= e.inicio) atual = e
  return atual
}
