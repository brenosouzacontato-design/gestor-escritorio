// Dicas de uso e fluxos recomendados do próprio Gestor. Cada uma aparece
// só quando faz sentido para o que o escritório já usa (`quando`).

export const FLUXOS = [
  {
    id: 'fluxo-mes',
    titulo: 'Fechamento do mês, do começo ao fim',
    passos: [
      'Empresas: escolha a competência e acompanhe as obrigações de cada cliente.',
      'Documentos: anexe a guia na obrigação (a IA lê valor e vencimento).',
      'O painel do cliente mostra a guia com código de barras e PIX.',
      'Quando o comprovante chega no WhatsApp, a guia é marcada como paga sozinha.',
    ],
    acao: { pagina: 'empresas', rotulo: 'Começar por Empresas' },
  },
  {
    id: 'fluxo-nfse',
    titulo: 'Notas fiscais de serviço em lote',
    passos: [
      'O cliente manda a lista no WhatsApp ou preenche no link de notas.',
      'Emitir NFS-e: importe o lote e resolva o que estiver pendente.',
      'Emita; o sistema evita duplicidade e guarda XML e DANFSe.',
      'O cliente vê as notas emitidas no link, com PDF e XML.',
    ],
    quando: (i) => i.empresasNfse > 0,
    acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
  },
]

export const DICAS = [
  {
    id: 'dica-recorrentes',
    titulo: 'Notas que se repetem todo mês? Use recorrentes',
    texto: 'Para paciente ou contrato fixo, cadastre a nota como recorrente: ela entra sozinha no lote do mês e só falta conferir.',
    quando: (i) => i.empresasNfse > 0,
    acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
  },
  {
    id: 'dica-lembretes-whatsapp',
    titulo: 'Lembrete no WhatsApp para obrigação com data própria',
    texto: 'Em qualquer obrigação ou tarefa dá para criar um lembrete com data e hora; ele chega no grupo do escritório.',
    quando: (i) => i.obrigacoesAbertas > 0,
    acao: { pagina: 'empresas', rotulo: 'Abrir Empresas' },
  },
  {
    id: 'dica-secoes-ocultas',
    titulo: 'Painel mais limpo para cada cliente',
    texto: 'No modo de edição do painel dá para ocultar seções que não se aplicam ao cliente (ex.: honorários, notas de entrada).',
    quando: (i) => i.clientes > 0,
    acao: { pagina: 'paineis', rotulo: 'Abrir Painéis' },
  },
  {
    id: 'dica-carteiras',
    titulo: 'Divida o trabalho por carteira',
    texto: 'Cada responsável pode ter um link da própria carteira com o painel de todas as empresas dela.',
    quando: (i) => i.clientes >= 15,
    acao: { pagina: 'paineis', rotulo: 'Abrir Painéis' },
    mercado: 'Sistemas como Domínio e Questor separam a carteira por usuário; aqui o link por carteira faz esse papel sem criar login novo.',
  },
  {
    id: 'dica-atualizar',
    titulo: 'Botão Atualizar no topo',
    texto: 'Ele recarrega os dados da tela aberta sem recarregar a página inteira, e mantém o que você estava vendo.',
    quando: () => true,
  },
]

export function dicasRelevantes(indicadores) {
  const ok = (d) => !d.quando || d.quando(indicadores)
  return {
    fluxos: FLUXOS.filter(ok).map(({ quando, ...f }) => f),
    dicas: DICAS.filter(ok).map(({ quando, ...d }) => ({ ...d, tipo: 'dica', nivel: 'dica' })),
  }
}
