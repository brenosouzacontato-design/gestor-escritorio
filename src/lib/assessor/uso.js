// Feedback de uso: o que os dados do próprio sistema mostram que está
// parado, faltando ou sendo pouco usado.

import { diasEntre, dataBR } from './datas.js'

const nomeDe = (mapa, id) => ({ id, nome: mapa.get(id) || '—' })
const unicos = (ids) => [...new Set(ids.filter(Boolean))]
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

export function feedbackUso(dados, hoje) {
  const { perfis = [], guiasAnexadas = new Set() } = dados
  const eventosPainel = dados.eventosPainel ?? null // null = tabela indisponível (não opina)
  const nomes = new Map(perfis.map((p) => [p.id, p.nome]))
  // Só clientes ativos (os da lista): obrigação/nota/tarefa de cliente
  // inativo ou excluído não vira alerta.
  const ativo = (x) => nomes.has(x.cliente_id)
  const obrigacoesAbertas = (dados.obrigacoesAbertas || []).filter(ativo)
  const notas = (dados.notas || []).filter(ativo)
  const tarefas = (dados.tarefas || []).filter((t) => !t.cliente_id || ativo(t))
  const clientesDe = (ids) => unicos(ids).map((id) => nomeDe(nomes, id))
  const cards = []

  // 1) Impostos perto do vencimento ainda sem guia anexada
  const impostosSemGuia = obrigacoesAbertas.filter((o) => {
    if (!o.eh_imposto || guiasAnexadas.has(o.id) || !o.vencimento) return false
    const d = diasEntre(hoje, o.vencimento)
    return d != null && d >= 0 && d <= 5
  })
  if (impostosSemGuia.length) {
    const proximo = impostosSemGuia.map((o) => o.vencimento).sort()[0]
    cards.push({
      id: 'uso-impostos-sem-guia',
      tipo: 'uso',
      nivel: 'urgente',
      titulo: `${plural(impostosSemGuia.length, 'imposto vence', 'impostos vencem')} em até 5 dias sem guia anexada`,
      texto: `O primeiro vence em ${dataBR(proximo)}. Enquanto a guia não é anexada, o painel do cliente mostra "aguardando guia", sem valor nem código de barras.`,
      clientes: clientesDe(impostosSemGuia.map((o) => o.cliente_id)),
      acao: { pagina: 'empresas', rotulo: 'Abrir Fechamento' },
      mercado: 'Em sistemas como Domínio e Questor a guia sai junto da apuração. Aqui, anexar a guia na obrigação é o que libera valor, código de barras e PIX no painel do cliente.',
    })
  }

  // 2) Obrigações vencidas
  const vencidas = obrigacoesAbertas.filter((o) =>
    o.status === 'vencido' || (o.status === 'pendente' && o.vencimento && diasEntre(hoje, o.vencimento) < 0))
  if (vencidas.length) {
    cards.push({
      id: 'uso-obrigacoes-vencidas',
      tipo: 'uso',
      nivel: 'urgente',
      titulo: `${plural(vencidas.length, 'obrigação vencida', 'obrigações vencidas')} em aberto`,
      texto: 'Se já foram entregues, marque como concluídas: assim o painel do cliente e os indicadores ficam certos. Se não se aplicam, use "não se aplica".',
      clientes: clientesDe(vencidas.map((o) => o.cliente_id)),
      acao: { pagina: 'empresas', rotulo: 'Ver obrigações' },
    })
  }

  // 3) NFS-e: notas rejeitadas / indeterminadas / paradas com pendência
  const problema = notas.filter((n) => n.estado === 'rejeitada' || n.estado === 'indeterminada')
  if (problema.length) {
    const indeterminadas = problema.filter((n) => n.estado === 'indeterminada').length
    cards.push({
      id: 'uso-nfse-rejeitadas',
      tipo: 'uso',
      nivel: 'urgente',
      titulo: `${plural(problema.length, 'NFS-e rejeitada ou sem resposta', 'NFS-e rejeitadas ou sem resposta')}`,
      texto: indeterminadas
        ? `${plural(indeterminadas, 'nota está', 'notas estão')} sem resposta da Sefin: consulte antes de reenviar, para não emitir em duplicidade.`
        : 'Veja a mensagem da Sefin em cada nota, corrija e reenvie.',
      clientes: clientesDe(problema.map((n) => n.cliente_id)),
      acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
    })
  }
  const paradas = notas.filter((n) =>
    (n.estado === 'importada' || n.estado === 'validada') &&
    n.status_validacao !== 'pronto' &&
    diasEntre(n.criado_em, hoje) >= 2)
  if (paradas.length) {
    cards.push({
      id: 'uso-nfse-paradas',
      tipo: 'uso',
      nivel: 'atencao',
      titulo: `${plural(paradas.length, 'nota a emitir parada', 'notas a emitir paradas')} há 2 dias ou mais por falta de informação`,
      texto: 'Faltam dados como CPF, endereço ou valor. Peça ao cliente pelo link de notas: ele vê o que falta e completa lá mesmo.',
      clientes: clientesDe(paradas.map((n) => n.cliente_id)),
      acao: { pagina: 'nfse', rotulo: 'Ver pendências' },
    })
  }

  // 4) Certificado A1 vencendo / vencido
  const cert = perfis.filter((p) => p.nfse?.ativo && p.nfse.certValidoAte)
    .map((p) => ({ p, dias: diasEntre(hoje, p.nfse.certValidoAte) }))
    .filter((x) => x.dias != null && x.dias <= 30)
  if (cert.length) {
    const vencido = cert.some((x) => x.dias < 0)
    cards.push({
      id: 'uso-certificado',
      tipo: 'uso',
      nivel: vencido || cert.some((x) => x.dias <= 7) ? 'urgente' : 'atencao',
      titulo: vencido ? 'Certificado digital vencido: emissão de NFS-e travada' : 'Certificado digital vence em até 30 dias',
      texto: 'Peça a renovação do A1 ao cliente com antecedência e troque o arquivo em Emitir NFS-e → Editar.',
      clientes: cert.map((x) => ({ id: x.p.id, nome: x.p.nome })),
      acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
    })
  }

  // 5) Empresas de NFS-e ainda em homologação
  const homolog = perfis.filter((p) => p.nfse?.ativo && p.nfse.ambiente === 'homologacao')
  if (homolog.length) {
    cards.push({
      id: 'uso-nfse-homologacao',
      tipo: 'uso',
      nivel: 'dica',
      titulo: `${plural(homolog.length, 'empresa ainda emite', 'empresas ainda emitem')} NFS-e só em homologação (teste)`,
      texto: 'Notas de homologação não valem como nota fiscal. Quando os testes estiverem ok, mude o ambiente para produção.',
      clientes: homolog.map((p) => ({ id: p.id, nome: p.nome })),
      acao: { pagina: 'nfse', rotulo: 'Abrir Emitir NFS-e' },
    })
  }

  // 6) Clientes que não abrem o painel
  if (Array.isArray(eventosPainel) && eventosPainel.length) {
    const ativos = new Set(eventosPainel.map((e) => e.cliente_id))
    const parados = perfis.filter((p) => !ativos.has(p.id))
    if (parados.length) {
      cards.push({
        id: 'uso-painel-sem-acesso',
        tipo: 'uso',
        nivel: 'dica',
        titulo: `${plural(parados.length, 'cliente não abriu', 'clientes não abriram')} o painel nos últimos 60 dias`,
        texto: 'Reenvie o link do painel pelo WhatsApp junto da próxima guia e ative o aviso no celular (push). Cliente que abre o painel pergunta menos e paga em dia.',
        clientes: parados.map((p) => ({ id: p.id, nome: p.nome })),
        acao: { pagina: 'paineis', rotulo: 'Abrir Painéis' },
        mercado: 'Plataformas como Contabilizei e Omie avisam o cliente a cada guia nova pelo app. O equivalente aqui é o link do painel com aviso por push/WhatsApp.',
      })
    }
  }

  // 7) Tarefas atrasadas
  const atrasadas = tarefas.filter((t) => !t.concluida && t.vencimento && diasEntre(hoje, t.vencimento) < 0)
  if (atrasadas.length) {
    cards.push({
      id: 'uso-tarefas-atrasadas',
      tipo: 'uso',
      nivel: atrasadas.length >= 10 ? 'atencao' : 'dica',
      titulo: `${plural(atrasadas.length, 'tarefa atrasada', 'tarefas atrasadas')}`,
      texto: 'Conclua o que já foi feito e remarque o resto. Lista enxuta deixa os alertas de verdade aparecerem.',
      clientes: clientesDe(atrasadas.map((t) => t.cliente_id)),
      // tarefa avulsa (sem cliente) também conta, mas não entra na lista
      acao: { pagina: 'tarefas', rotulo: 'Abrir Tarefas' },
    })
  }

  // 8) Cadastro incompleto (deixa o Assessor menos preciso)
  const incompletos = perfis.filter((p) => !p.regime || !p.municipio)
  if (incompletos.length) {
    cards.push({
      id: 'uso-cadastro-incompleto',
      tipo: 'uso',
      nivel: 'dica',
      titulo: `${plural(incompletos.length, 'cliente sem', 'clientes sem')} regime ou município no cadastro`,
      texto: 'Os lembretes da Reforma dependem do regime e do município. Complete o cadastro (a leitura da Declaração do Simples preenche o município sozinha).',
      clientes: incompletos.map((p) => ({ id: p.id, nome: p.nome })),
      acao: { pagina: 'clientes', rotulo: 'Abrir Clientes' },
    })
  }

  return cards
}
