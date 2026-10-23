import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  CalendarIcon, ChevronDownIcon, DownloadIcon, CheckCircleIcon, AlertTriangleIcon, ClockIcon, TrendingUpIcon,
  ClipboardListIcon, EyeIcon, EyeOffIcon, WalletIcon, CopyIcon, FileTextIcon, SettingsIcon, UserIcon, MessageSquareIcon, PartyPopperIcon, BellIcon, SendIcon, BarcodeIcon, QrCodeIcon,
} from 'lucide-react';
import { chavePainelPorId, urlPublica } from '../../lib/linksPublicos';
import { supabase } from '../../lib/supabase';
import AcessoPainel, { obterClientePagina } from './AcessoPainel';
import { listarNfseEmitidas, baixarNfse, listarNfsePendentes, completarNfse, linkPdfNfse, numeroWhatsapp } from './nfsePainelApi';
import { descreverAparelho } from './aparelho';
import { abrirLinkAssinado, criarLinkAssinado } from '../documentos/documentosApi';
import { lerCodigosDaGuia } from './codigosGuia';
import { GraficoFaturamento, ComparativoDas, NotasEntrada, TarefasDoCliente } from './PainelClientePage';
import { calcularAliquotaNominal } from '../../lib/simplesNacional';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterDadosGerenciais, obterDocumentosPorObrigacao,
  obterDocumentosPorTarefa, obterSituacaoFiscalMaisRecente, obterCndManual, obterHistoricoFaturamento,
  obterUltimaVisualizacaoPainel, extrairValorGuia, obterHonorariosPainel, obterDocumentosFiscais,
  definirSecoesOcultasPainel, atualizarDadosGerenciais, atualizarValorGuia, obterTarefasDoCliente,
  avisarEventoPainel, obterEventosPainel, obterRecadosPainel, salvarRecadoPainel, marcarGuiaPaga, salvarCodigosGuia,
} from './painelApi';
import { obterConfigPix } from '../honorarios/honorariosApi';
import {
  prepararPainelComoApp, situacaoNotificacoesPainel, ativarNotificacoesPainel, contarAparelhosPush, enviarNotificacaoCliente,
} from './painelPush';

// Nova versão do painel do cliente (link compartilhado, ?painel=<token do painel>&competencia=MM/YYYY
// — ver main.jsx; a versão completa antiga continua em PainelClientePage.jsx,
// acessível com &versao=1). Página única, nessa ordem:
//   1. Fiscal: números da Declaração do Simples do mês + evolução do faturamento;
//   2. cards de impostos em aberto (Relatório de Situação Fiscal), a vencer e
//      vencidos (guias anexadas);
//   3. impostos da competência: com guia anexada (valor + download) ou "aguardando
//      guia" (só o vencimento, sem entrar nos cards) — o DAS de
//      mês com faturamento zerado aparece como "Sem movimento";
//   4. pendências do Relatório de Situação Fiscal (RFB/PGFN), com nome legível
//      do tributo, competência e valor atualizado;
//   5. demais obrigações/tarefas de Fiscal e Folha — concluídas só aparecem
//      se tiverem anexo pra baixar.
// `admin` (prévia de dentro do app) mostra a última vez que o cliente abriu o
// link e libera o modo de edição (engrenagem no cabeçalho): ocultar seções
// pro cliente (clientes.painel_secoes_ocultas, mesma coluna e mesmas chaves
// do painel completo onde a seção é a mesma) e corrigir os números da
// Declaração do Simples e o valor das guias.

// Mesmo fallback de PainelClientePage.jsx pra obrigações legadas sem
// tipo_obrigacao_id, mais reconhecimento pelo nome (FGTS, DARF etc. nem
// sempre estão marcados como eh_imposto) — anexo de obrigação que não é
// imposto (ex: holerites na obrigação "Folha") não é guia a pagar.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
  'INSS MENSAL',
]);
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i;
function ehImposto(o) {
  return o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`);
}
// Recálculo do PGDAS não é o DAS do mês: não herda o valor da declaração
// nem a regra de "Sem movimento" — só aparece se tiver guia anexada.
function ehDas(o) {
  const texto = `${o.titulo || ''} ${o.tipo || ''}`;
  return /\b(pg)?das\b/i.test(texto) && !/rec[aá]lculo/i.test(texto);
}

// Área (Fiscal/Folha) pelo departamento — o resto (Contábil, Societário...)
// fica de fora da lista de obrigações/tarefas.
function areaObrigacao(o) {
  const nome = (o.departamentos?.nome || '').toLowerCase();
  if (/folha|pessoal|dp\b/.test(nome)) return 'Folha';
  if (/fiscal/.test(nome)) return 'Fiscal';
  return null;
}
function areaTarefa(t) {
  const d = (t.departamento || '').toLowerCase();
  if (d === 'folha' || d === 'pessoal') return 'Folha';
  if (d === 'fiscal') return 'Fiscal';
  return null;
}

// O relatório da RFB traz o código da receita ("1099-01 - CP-SEGUR.") —
// traduz pro nome que o cliente reconhece. Sem correspondência, usa o
// texto original sem o período (que já aparece ao lado do nome).
const NOMES_TRIBUTO = [
  [/CP[\s.-]*SEGUR|1099|INSS\s*MENSAL/i, 'INSS Mensal'],
  [/CP[\s.-]*PATRONAL|1138/i, 'INSS Patronal'],
  [/CP[\s.-]*TERCEIROS|1170|1176|1191|1196|1200/i, 'INSS Terceiros'],
  [/CP[\s.-]*(GIL)?RAT|CP[\s.-]*SAT|1646/i, 'INSS RAT'],
  [/SIMPLES\s*NAC|\bDAS\b|\bSN\b/i, 'DAS — Simples Nacional'],
  [/\bMEI\b|SIMEI/i, 'DAS MEI'],
  [/IRRF|0561/i, 'IRRF'],
  [/IRPJ/i, 'IRPJ'],
  [/CSLL/i, 'CSLL'],
  [/COFINS/i, 'COFINS'],
  [/\bPIS\b/i, 'PIS'],
  [/FGTS/i, 'FGTS'],
];
function nomeTributo(texto) {
  const t = texto || '';
  const achado = NOMES_TRIBUTO.find(([re]) => re.test(t));
  if (achado) return achado[1];
  return t.replace(/\s*(PA\s*)?\d{2}\/\d{4}\s*$/i, '').trim() || 'Débito';
}

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtPct(v) {
  return v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}
function fmtData(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function fmtDataHora(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
function fmtHaQuanto(ts) {
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  return `há ${dias} dia${dias !== 1 ? 's' : ''}`;
}
function diasParaVencer(vencimento) {
  if (!vencimento) return null;
  const hoje = new Date(new Date().toDateString());
  return Math.round((new Date(vencimento + 'T00:00:00') - hoje) / 86400000);
}
function fmtDias(dias) {
  if (dias == null) return null;
  if (dias === 0) return 'vence hoje';
  if (dias > 0) return `vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`;
}
// inicio: 'AAAA-MM-DD' (clientes.inicio_escritorio) — nada antes do mês em que o cliente entrou
function opcoesCompetencia(base, inicio = null) {
  const [mesBase, anoBase] = base.split('/').map(Number);
  const opcoes = [];
  for (let i = 4; i >= -1; i--) {
    const d = new Date(anoBase, mesBase - 1 - i, 1);
    opcoes.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  if (!inicio) return opcoes;
  const primeira = `${String(inicio).slice(5, 7)}/${String(inicio).slice(0, 4)}`;
  const validas = opcoes.filter((c) => competenciaOrdinal(c) >= competenciaOrdinal(primeira));
  return validas.length ? validas : [primeira];
}
function competenciaOrdinal(c) {
  if (!c) return 0;
  const [mes, ano] = c.split('/').map(Number);
  return ano * 100 + mes;
}
// Relatórios extraídos antes do campo "competencia" existir só trazem o
// período dentro do texto do tributo (ex: "1099-01 - CP-SEGUR. 06/2026").
function competenciaDoTexto(texto) {
  const m = /(\d{2})\/(\d{4})/.exec(texto || '');
  return m ? `${m[1]}/${m[2]}` : null;
}
const somaValores = (itens) => itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
const temValor = (itens) => itens.some((it) => it.valor != null);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
// Número digitado no modo de edição: aceita "1.234,56" e "1234.56". Vazio
// vira null (apaga o valor); texto que não é número devolve undefined.
function parseNumero(texto) {
  const t = (texto || '').replace(/[R$%\s]/g, '');
  if (t === '') return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : undefined;
}

// Link público: resolve o token antes de montar a página (AcessoPainel.jsx);
// dentro do app (admin) o id já é o do cliente.
export default function PainelCompartilhadoPage(props) {
  if (props.admin) return <PainelCompartilhado {...props} />;
  return (
    <AcessoPainel valor={props.clienteId}>
      {(sessao) => <PainelCompartilhado {...props} clienteId={sessao.id} sessao={sessao} />}
    </AcessoPainel>
  );
}

// `semRegistro`: link público aberto pelo escritório (link da carteira,
// PainelCarteiraPage.jsx) — mesma página do cliente, mas download não vira
// evento do cliente e não oferece ativar as notificações dele.
// `largura`: o cliente vê no celular (720); telas de trabalho do escritório
// (link da carteira) passam uma largura maior pra usar a tela toda.
function PainelCompartilhado({ clienteId, competencia: competenciaInicial, admin = false, sessao = null, semRegistro = false, largura = 720 }) {
  const registrar = !admin && !semRegistro;
  const [competencia, setCompetencia] = useState(competenciaInicial);
  // Início do cliente no escritório: no link público vem da sessão; dentro do app, do banco
  // (sem a coluna no banco, a consulta falha e o seletor fica sem limite).
  const [inicioEscritorio, setInicioEscritorio] = useState(sessao ? sessao.inicio_escritorio || null : null);
  useEffect(() => {
    if (sessao) return undefined;
    let ativo = true;
    supabase.from('clientes').select('inicio_escritorio').eq('id', clienteId).maybeSingle()
      .then(({ data, error }) => { if (ativo && !error) setInicioEscritorio(data?.inicio_escritorio || null); });
    return () => { ativo = false; };
  }, [clienteId, sessao]);
  const opcoesComp = opcoesCompetencia(competenciaInicial, inicioEscritorio);
  const chaveOpcoes = opcoesComp.join();
  // Link com competência anterior ao início: abre na primeira competência permitida
  useEffect(() => {
    if (!chaveOpcoes.split(',').includes(competencia)) setCompetencia(chaveOpcoes.split(',')[0]);
  }, [chaveOpcoes, competencia]);
  const [dados, setDados] = useState(null);
  const [ultimaVisualizacao, setUltimaVisualizacao] = useState(undefined); // undefined = carregando/indisponível
  const [eventos, setEventos] = useState([]); // últimas aberturas/downloads do cliente (painel_eventos)
  const [lendoGuias, setLendoGuias] = useState(() => new Set()); // ids de documentos sendo lidos pela IA
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [editandoPainel, setEditandoPainel] = useState(false);
  const [erroEdicao, setErroEdicao] = useState(null);
  const [nfseEmitidas, setNfseEmitidas] = useState([]); // notas de serviço emitidas pelo gestor (módulo NFS-e)
  const [nfsePendentes, setNfsePendentes] = useState([]); // notas a emitir em que falta informação (o cliente completa)
  const editando = admin && editandoPainel;

  // Fora do Promise.all do painel: sem o módulo de NFS-e no banco (ou com a
  // function fora do ar) a seção só não aparece.
  useEffect(() => {
    let ativo = true;
    listarNfseEmitidas(clienteId, competencia)
      .then((notas) => ativo && setNfseEmitidas(notas))
      .catch(() => ativo && setNfseEmitidas([]));
    return () => { ativo = false; };
  }, [clienteId, competencia]);

  // Pendentes não dependem da competência do painel: são tudo o que ainda falta emitir
  useEffect(() => {
    let ativo = true;
    listarNfsePendentes(clienteId)
      .then((notas) => ativo && setNfsePendentes(notas))
      .catch(() => ativo && setNfsePendentes([]));
    return () => { ativo = false; };
  }, [clienteId]);

  const completarPendente = async (nota, campos) => {
    const salva = await completarNfse(clienteId, nota.id, campos);
    setNfsePendentes((lista) => lista.map((n) => (n.id === salva.id ? salva : n)));
    return salva;
  };

  const enviarNotaWhatsapp = async (nota, numero) => {
    // abre a aba já no clique (antes do await) para não cair no bloqueio de pop-up
    const aba = window.open('', '_blank');
    try {
      const { url } = await linkPdfNfse(clienteId, nota.id);
      const texto = `Olá${nota.tomador ? `, ${nota.tomador.split(' ')[0]}` : ''}! Segue a nota fiscal de serviço nº ${nota.numero || ''}`
        + `${nota.valor != null ? ` (${fmt(nota.valor)})` : ''}: ${url}`;
      const destino = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
      if (aba) aba.location.href = destino; else window.location.href = destino;
      if (registrar) avisarEventoPainel(clienteId, 'download', { descricao: `NFS-e nº ${nota.numero} enviada por WhatsApp`, competencia });
    } catch (e) {
      if (aba) aba.close();
      window.alert(e.message);
    }
  };

  const baixarNotaEmitida = (nota, formato) => {
    if (registrar) avisarEventoPainel(clienteId, 'download', { descricao: `NFS-e nº ${nota.numero} (${formato.toUpperCase()})`, competencia });
    return baixarNfse(clienteId, nota, formato).catch((e) => window.alert(e.message));
  };

  useEffect(() => {
    if (!admin) return;
    obterUltimaVisualizacaoPainel(clienteId).then(setUltimaVisualizacao).catch(() => setUltimaVisualizacao(undefined));
    // tabela nova (supabase-schema-painel-eventos.sql) — tolera ainda não existir
    obterEventosPainel(clienteId).then(setEventos).catch(() => setEventos([]));
  }, [clienteId, admin]);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, obs, tarefas, gerenciais, historico, situacaoFiscal, cndManual, honorarios, configPix, notasEntrada, tarefasCliente, recados] = await Promise.all([
          obterClientePagina(clienteId, sessao, 'nome, cnpj, regime, painel_secoes_ocultas'),
          obterResumoObrigacoes(clienteId, competencia),
          obterResumoTarefas(clienteId, competencia),
          // tabelas novas toleram ainda não existir no banco, igual ao painel completo
          obterDadosGerenciais(clienteId, competencia).catch(() => null),
          obterHistoricoFaturamento(clienteId).catch(() => []),
          obterSituacaoFiscalMaisRecente(clienteId, competencia).catch(() => null),
          obterCndManual(clienteId, competencia).catch(() => null),
          obterHonorariosPainel(clienteId, competencia).catch(() => []),
          obterConfigPix().catch(() => ({ chavePix: '', favorecido: '' })),
          obterDocumentosFiscais(clienteId, competencia, 'entrada').catch(() => []),
          obterTarefasDoCliente(clienteId).catch(() => []),
          // tabela nova (supabase-schema-painel-recados.sql) — tolera ainda não existir
          obterRecadosPainel(clienteId).catch(() => ({})),
        ]);
        if (errCliente) throw errCliente;
        const impostos = obs.itens.filter(ehImposto);
        const outrasObrigacoes = obs.itens.filter((o) => !ehImposto(o) && areaObrigacao(o));
        const tarefasArea = tarefas.itens.filter((t) => areaTarefa(t));
        const [anexos, anexosTarefa] = await Promise.all([
          obterDocumentosPorObrigacao([...impostos, ...outrasObrigacoes].map((o) => o.id)).catch(() => ({})),
          obterDocumentosPorTarefa(tarefasArea.map((t) => t.id)).catch(() => ({})),
        ]);
        setDados({ cliente, impostos, outrasObrigacoes, tarefasArea, anexos, anexosTarefa, gerenciais, historico, situacaoFiscal, cndManual, honorarios, configPix, notasEntrada, tarefasCliente, recados });
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [clienteId, competencia]);

  // Guias anexadas que a IA ainda não leu: dispara a leitura (uma requisição
  // por guia, em paralelo) e vai preenchendo o valor conforme cada uma volta.
  // Só roda quando a coluna valor_guia_extraido_em existe — antes do schema
  // aplicado o painel segue mostrando "valor na guia".
  useEffect(() => {
    if (!dados) return;
    const pendentes = dados.impostos
      .map((o) => dados.anexos[o.id])
      .filter((a) => a && 'valor_guia_extraido_em' in a && !a.valor_guia_extraido_em && !lendoGuias.has(a.id));
    if (pendentes.length === 0) return;
    setLendoGuias((prev) => new Set([...prev, ...pendentes.map((a) => a.id)]));
    pendentes.forEach((anexo) => {
      extrairValorGuia(anexo.id)
        .then((r) => setDados((d) => d && {
          ...d,
          anexos: Object.fromEntries(Object.entries(d.anexos).map(([k, a]) => [k, a.id === anexo.id
            ? { ...a, valor_guia: r.valor, vencimento_guia: r.vencimento, valor_guia_extraido_em: new Date().toISOString() }
            : a])),
        }))
        .catch(() => {})
        .finally(() => setLendoGuias((prev) => { const n = new Set(prev); n.delete(anexo.id); return n; }));
    });
  }, [dados]);

  // Código de barras e PIX copia e cola das guias em aberto: lidos uma vez
  // por guia no navegador de quem abrir o painel primeiro (codigosGuia.js) e
  // gravados já conferidos (painel-codigos-guia.js). Uma guia por vez, pra
  // não baixar e desenhar vários PDFs ao mesmo tempo no celular do cliente.
  // Só roda quando a coluna codigos_extraidos_em existe (schema aplicado).
  const codigosEmLeitura = useRef(new Set());
  useEffect(() => {
    if (!dados) return;
    const pendentes = dados.impostos
      .map((o) => dados.anexos[o.id])
      .filter((a) => a && 'codigos_extraidos_em' in a && !a.codigos_extraidos_em && !a.pago_em && !codigosEmLeitura.current.has(a.id));
    if (pendentes.length === 0) return;
    pendentes.forEach((a) => codigosEmLeitura.current.add(a.id));
    (async () => {
      for (const anexo of pendentes) {
        try {
          const lidos = await lerCodigosDaGuia(await criarLinkAssinado(anexo.storage_path), anexo.tipo_mime);
          const r = await salvarCodigosGuia(anexo.id, lidos);
          setDados((d) => d && {
            ...d,
            anexos: Object.fromEntries(Object.entries(d.anexos).map(([k, a]) => [k, a.id === anexo.id
              ? { ...a, linha_digitavel: r.linhaDigitavel, pix_copia_cola: r.pixCopiaCola, codigos_extraidos_em: new Date().toISOString() }
              : a])),
          });
        } catch {
          // falha de rede/leitura: tenta de novo na próxima vez que o painel abrir
        }
      }
    })();
  }, [dados]);

  // `descricao` diz o que é o arquivo no aviso pro escritório — só o link
  // público avisa (o download feito na prévia de dentro do app não conta)
  const baixar = (storagePath, descricao) => {
    if (registrar) avisarEventoPainel(clienteId, 'download', { descricao, competencia });
    return abrirLinkAssinado(storagePath).catch(() => null);
  };

  const secoesOcultas = dados?.cliente?.painel_secoes_ocultas || [];
  const oculta = (chave) => secoesOcultas.includes(chave);
  const toggleSecao = async (chave) => {
    const proxima = oculta(chave) ? secoesOcultas.filter((s) => s !== chave) : [...secoesOcultas, chave];
    setDados((d) => ({ ...d, cliente: { ...d.cliente, painel_secoes_ocultas: proxima } }));
    try {
      await definirSecoesOcultasPainel(clienteId, proxima);
      setErroEdicao(null);
    } catch (e) {
      setDados((d) => ({ ...d, cliente: { ...d.cliente, painel_secoes_ocultas: secoesOcultas } }));
      setErroEdicao(`Não foi possível salvar: ${e.message}`);
    }
  };
  const propsOc = { secoesOcultas, editando, onToggle: toggleSecao };

  // Correções do modo de edição: aplica na tela na hora e desfaz se o banco recusar
  const salvarGerencial = async (campo, valor) => {
    const anterior = dados.gerenciais;
    setDados((d) => ({ ...d, gerenciais: { ...d.gerenciais, [campo]: valor } }));
    try {
      await atualizarDadosGerenciais(clienteId, competencia, { [campo]: valor });
      setErroEdicao(null);
    } catch (e) {
      setDados((d) => ({ ...d, gerenciais: anterior }));
      setErroEdicao(`Não foi possível salvar: ${e.message}`);
    }
  };
  // Recado manual do escritório numa linha (guia, honorário, pendência, obrigação)
  const salvarRecado = async (chave, mensagem) => {
    const anterior = dados.recados;
    setDados((d) => ({ ...d, recados: { ...d.recados, [chave]: mensagem.trim() } }));
    try {
      await salvarRecadoPainel(clienteId, chave, mensagem);
      setErroEdicao(null);
    } catch (e) {
      setDados((d) => ({ ...d, recados: anterior }));
      setErroEdicao(/painel_recados/.test(e.message || '')
        ? 'Não foi possível salvar o recado: falta criar a tabela — rode supabase-schema-painel-recados.sql no SQL Editor do Supabase.'
        : `Não foi possível salvar o recado: ${e.message}`);
    }
  };
  const salvarGuiaPaga = async (anexo, paga) => {
    const trocar = (novo) => setDados((d) => ({
      ...d, anexos: Object.fromEntries(Object.entries(d.anexos).map(([k, a]) => [k, a.id === anexo.id ? novo : a])),
    }));
    // marcar como paga na mão = baixa manual: pede a justificativa (fica no
    // histórico da tela Pagamentos)
    let justificativa = null;
    if (paga) {
      justificativa = window.prompt('Baixa manual — informe a justificativa (ex: cliente confirmou o pagamento, conferido no e-CAC):');
      if (justificativa === null) return;
      if (!justificativa.trim()) { setErroEdicao('A baixa manual precisa de justificativa.'); return; }
    }
    try {
      const patch = await marcarGuiaPaga(anexo.id, paga, justificativa);
      trocar({ ...anexo, ...patch });
      setErroEdicao(null);
    } catch (e) {
      setErroEdicao(/baixa_manual|baixa_justificativa|baixa_por|baixa_registrada_em/.test(e.message || '')
        ? 'Não foi possível marcar: faltam as colunas de baixa — rode supabase-schema-comprovantes-pagamento.sql no SQL Editor do Supabase.'
        : /pago_em|valor_pago|comprovante/.test(e.message || '')
          ? 'Não foi possível marcar: faltam as colunas de pagamento — rode supabase-schema-guia-pagamento.sql no SQL Editor do Supabase.'
          : `Não foi possível salvar: ${e.message}`);
    }
  };
  const salvarValorGuia = async (anexo, valor) => {
    const trocar = (novo) => setDados((d) => ({
      ...d, anexos: Object.fromEntries(Object.entries(d.anexos).map(([k, a]) => [k, a.id === anexo.id ? novo : a])),
    }));
    trocar({ ...anexo, valor_guia: valor, valor_guia_extraido_em: new Date().toISOString() });
    try {
      await atualizarValorGuia(anexo.id, valor);
      setErroEdicao(null);
    } catch (e) {
      trocar(anexo);
      setErroEdicao(`Não foi possível salvar: ${e.message}`);
    }
  };

  const guias = dados && montarGuias(dados, competencia).map((g) => ({ ...g, lendo: g.anexo && lendoGuias.has(g.anexo.id) }));
  const pendencias = dados && montarPendencias(dados.situacaoFiscal);
  // o que foi atribuído ao cliente já aparece em "Suas tarefas" — não repete na lista geral
  const idsDoCliente = new Set((dados?.tarefasCliente || []).map((t) => t.id));
  const itensArea = dados && montarObrigacoesTarefas(dados, competencia).filter((it) => !idsDoCliente.has(it.id));
  const honorarios = dados ? montarHonorarios(dados.honorarios) : [];
  // Seção oculta pro cliente também sai da soma dos cards de vencidos/a
  // vencer — senão o total mostraria um valor que ele não tem como conferir
  // "Aguardando guia" fica só na lista de impostos: sem valor nem guia, não entra nos cards
  // de vencidos / a vencer nem na conta de "tudo quitado".
  const guiasCard = guias && !oculta('impostos') ? guias.filter((g) => !g.aguardandoGuia) : [];
  const honorariosCard = oculta('honorarios') ? [] : honorarios;
  const pendenciasCard = pendencias && !oculta('pendencias') ? pendencias : [];
  const honorariosAVencer = honorariosCard.filter((h) => !h.concluida && !(h.dias != null && h.dias < 0));
  const honorariosVencidos = honorariosCard.filter(alertaVencida);
  // Débito que o relatório da Receita já lista mas ainda está no prazo (ex:
  // INSS declarado na DCTFWeb antes do dia 20) é "a vencer", não vencido. Se
  // a guia do mesmo tributo/competência já está anexada, ela é que entra na
  // soma — o débito do relatório ficaria contado em dobro.
  const guiasAVencer = guiasCard.filter((g) => !g.semMovimento && !g.paga && !alertaVencida(g) && !(g.concluida && g.dias != null && g.dias < 0));
  const pendenciasVencidas = pendenciasCard.filter((p) => !p.aVencer);
  const pendenciasAVencer = pendenciasCard.filter((p) => p.aVencer
    && !guiasCard.some((g) => g.competencia === p.competencia && nomeTributo(g.titulo) === p.nome));
  const aVencer = [
    ...guiasAVencer,
    ...honorariosAVencer,
    ...pendenciasAVencer,
  ].sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
  const guiasVencidas = guiasCard.filter(alertaVencida);
  // "Vencidos" junta as guias vencidas sem baixa, os honorários atrasados e
  // os débitos do Relatório de Situação Fiscal (que por definição já
  // passaram do prazo)
  const vencidos = [...guiasVencidas, ...honorariosVencidos, ...pendenciasVencidas];
  // Tudo quitado: toda guia com valor a pagar da competência está paga, e não
  // sobrou honorário em aberto, débito vencido na Receita nem tarefa do cliente
  const guiasAPagar = guias ? guias.filter((g) => !g.semMovimento && g.anexo) : [];
  const tudoQuitado = !!dados && guiasAPagar.length > 0 && guiasAPagar.every((g) => g.paga)
    && honorarios.every((h) => h.concluida)
    && (pendencias || []).every((p) => p.aVencer)
    && dados.tarefasCliente.length === 0;
  const proximoVencimento = aVencer.find((g) => g.vencimento && g.dias >= 0)?.vencimento;
  const datasAVencer = new Set(aVencer.filter((g) => g.vencimento).map((g) => g.vencimento));
  const semMovimento = dados?.gerenciais?.faturamento_periodo != null && Number(dados.gerenciais.faturamento_periodo) === 0;

  return (
    <RecadosContext.Provider value={{ recados: dados?.recados || {}, editando, salvar: salvarRecado }}>
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 12px' }}>
      <div style={{ maxWidth: largura, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>

        {/* ── Cabeçalho ── */}
        <div style={{ padding: '20px 22px', background: 'var(--navy)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Painel fiscal
              </div>
              <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando && !dados ? '...' : dados?.cliente?.nome}</div>
              {dados?.cliente && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {dados.cliente.cnpj && <ChipCabecalho>{dados.cliente.cnpj}</ChipCabecalho>}
                  <ChipCabecalho>{dados.cliente.regime || 'SN'}</ChipCabecalho>
                  <ChipSituacao situacaoFiscal={dados.situacaoFiscal} cndManual={dados.cndManual} soAVencer={pendencias.length > 0 && pendencias.every((p) => p.aVencer)} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                  borderRadius: 6, padding: '5px 8px', fontWeight: 600 }}>
                {opcoesComp.map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
              </select>
              {admin && (
                <button type="button" onClick={() => setEditandoPainel((v) => !v)}
                  title={editandoPainel ? 'Sair do modo de edição' : 'Ocultar seções e corrigir valores antes de compartilhar'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, borderRadius: 8, padding: '0 10px', flexShrink: 0,
                    cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap',
                    border: `1px solid ${editandoPainel ? 'var(--accent)' : 'rgba(255,255,255,.2)'}`,
                    background: editandoPainel ? 'var(--accent)' : 'rgba(255,255,255,.1)' }}>
                  <SettingsIcon size={13} /> {editandoPainel ? 'Concluir edição' : 'Editar painel'}
                </button>
              )}
            </div>
          </div>
          {editando && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 10px' }}>
              Modo de edição — só você vê isso. Use o olho pra escolher o que o cliente enxerga, corrija os valores nos campos e escreva um recado em qualquer linha; tudo é salvo na hora.
              {erroEdicao && <div style={{ color: '#fff', fontWeight: 700, marginTop: 4 }}>⚠ {erroEdicao}</div>}
            </div>
          )}
          {admin && ultimaVisualizacao !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: 'var(--navy-text)',
              background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 10px' }}>
              <EyeIcon size={12} />
              {ultimaVisualizacao
                ? <span>Última visualização do cliente: <b style={{ color: '#fff' }}>{fmtDataHora(ultimaVisualizacao.visualizado_em)}</b> ({fmtHaQuanto(ultimaVisualizacao.visualizado_em)}){ultimaVisualizacao.competencia ? ` · competência ${ultimaVisualizacao.competencia}` : ''}</span>
                : <span>O cliente ainda não abriu o link do painel.</span>}
            </div>
          )}
          {admin ? <EnviarNotificacao clienteId={clienteId} competencia={competencia} /> : registrar && <AtivarNotificacoes clienteId={clienteId} />}
          {admin && eventos.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 10px' }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>Atividade recente do cliente</div>
              {eventos.map((ev) => (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
                  {ev.tipo === 'download' ? <DownloadIcon size={11} /> : <EyeIcon size={11} />}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.tipo === 'download' ? `Baixou ${ev.descricao || 'um arquivo'}` : `Abriu o painel${ev.competencia ? ` (${ev.competencia})` : ''}`}
                  </span>
                  {ev.user_agent && (
                    <span style={{ whiteSpace: 'nowrap', opacity: 0.7, flexShrink: 0 }}>· {descreverAparelho(ev.user_agent).nome}</span>
                  )}
                  <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', opacity: 0.8 }}>{fmtDataHora(ev.criado_em)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 22 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && dados && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* ── Parabéns: todas as obrigações da competência quitadas ── */}
              {tudoQuitado && (
                <Ocultavel chave="parabens" {...propsOc}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 'var(--r-lg)', background: 'var(--ok)', color: '#fff' }}>
                    <PartyPopperIcon size={26} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>Parabéns! Tudo quitado em {competencia}.</div>
                      <div style={{ fontSize: 12, marginTop: 2, opacity: 0.92 }}>Todas as suas obrigações da competência estão pagas. Obrigado pelo comprometimento!</div>
                    </div>
                  </div>
                </Ocultavel>
              )}

              {/* ── Tarefas atribuídas ao cliente e ainda pendentes (qualquer competência) ── */}
              {dados.tarefasCliente.length > 0 && (
                <Ocultavel chave="tarefas_cliente" {...propsOc}>
                  <Secao titulo="Suas tarefas — o que precisamos de você" icone={<UserIcon size={14} />}>
                    <TarefasDoCliente itens={dados.tarefasCliente} />
                  </Secao>
                </Ocultavel>
              )}

              {/* ── 1. Fiscal: Declaração do Simples + evolução do faturamento ── */}
              {(() => {
                const g = dados.gerenciais;
                const temGrafico = dados.historico.length > 0;
                // Simples "cheio" (alíquota da tabela pelo RBT12/anexo) x DAS real pago — mostra a economia
                const aliquotaCheia = g ? calcularAliquotaNominal(g.anexo, g.rbt12) : null;
                const temComparativo = !semMovimento && aliquotaCheia != null && Number(g.faturamento_periodo) > 0 && g.valor_das != null;
                const algoVisivel = (g && !oculta('kpis')) || (temComparativo && !oculta('comparativo')) || (temGrafico && !oculta('grafico'));
                if (!(g || temGrafico) || !(editando || algoVisivel)) return null;
                return (
                  <Secao titulo={`Fiscal — competência ${competencia}`} icone={<TrendingUpIcon size={14} />}
                    extra={g?.storage_path && <BotaoLink onClick={() => baixar(g.storage_path, `Declaração do Simples ${competencia}`)}>Declaração</BotaoLink>}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {g && (
                        <Ocultavel chave="kpis" {...propsOc}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                            {editando ? (
                              <>
                                {[['faturamento_periodo', 'Faturamento do mês (R$)'], ['rbt12', 'RBT12 (R$)'], ['aliquota_efetiva', 'Alíquota efetiva (%)'], ['valor_das', 'DAS (R$)']].map(([campo, label]) => (
                                  <Mini key={`${competencia}-${campo}`} label={label}
                                    valor={<CampoNumero valor={g[campo]} onSalvar={(v) => salvarGerencial(campo, v)} />} />
                                ))}
                              </>
                            ) : (
                              <>
                                <Mini label="Faturamento do mês" valor={fmt(g.faturamento_periodo)} />
                                <Mini label="RBT12" valor={fmt(g.rbt12)} />
                                <Mini label="Alíquota efetiva" valor={semMovimento ? '—' : fmtPct(g.aliquota_efetiva)} cor="var(--accent)" />
                                <Mini label="DAS" valor={semMovimento ? 'Sem movimento' : fmt(g.valor_das)} cor={semMovimento ? 'var(--ok)' : undefined} />
                              </>
                            )}
                          </div>
                        </Ocultavel>
                      )}
                      {temComparativo && (
                        <Ocultavel chave="comparativo" {...propsOc}>
                          <ComparativoDas aliquotaReal={aliquotaCheia} faturamento={Number(g.faturamento_periodo)} dasPago={Number(g.valor_das)} />
                        </Ocultavel>
                      )}
                      {temGrafico && (
                        <Ocultavel chave="grafico" {...propsOc}>
                          <div>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Evolução do faturamento</div>
                            <GraficoFaturamento dados={dados.historico} />
                          </div>
                        </Ocultavel>
                      )}
                    </div>
                  </Secao>
                );
              })()}

              {/* ── Notas fiscais de entrada (integração Omie/OneFlow): total, abre por nota ── */}
              {dados.notasEntrada.length > 0 && (
                <Ocultavel chave="notas_entrada" {...propsOc}>
                  <Secao titulo={`Notas fiscais de entrada — ${competencia}`} icone={<FileTextIcon size={14} />}>
                    <NotasEntrada documentos={dados.notasEntrada} />
                  </Secao>
                </Ocultavel>
              )}

              {/* ── 2. Cards: vencidos / a vencer (valor total) ── */}
              <Ocultavel chave="indicadores" {...propsOc}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <Indicador icone={<AlertTriangleIcon size={13} />} titulo="Vencidos"
                  valor={vencidos.length === 0 ? 'Nenhum' : temValor(vencidos) ? fmt(somaValores(vencidos)) : vencidos.some((v) => v.lendo) ? 'Lendo guias…' : 'Valor na guia'}
                  sub={vencidos.length === 0 ? 'Nada vencido' : [
                    pendenciasVencidas.length > 0 && plural(pendenciasVencidas.length, 'débito na Receita/PGFN', 'débitos na Receita/PGFN'),
                    guiasVencidas.length > 0 && plural(guiasVencidas.length, 'guia vencida', 'guias vencidas'),
                    honorariosVencidos.length > 0 && plural(honorariosVencidos.length, 'honorário vencido', 'honorários vencidos'),
                  ].filter(Boolean).join(' · ') + (vencidos.some((v) => v.valor == null) && temValor(vencidos) ? ' · + valores nas guias' : '')}
                  s={vencidos.length > 0 ? 'danger' : 'ok'} />
                <Indicador icone={<ClockIcon size={13} />} titulo="A vencer"
                  valor={aVencer.length === 0 ? 'Nenhum' : temValor(aVencer) ? fmt(somaValores(aVencer)) : aVencer.some((g) => g.lendo) ? 'Lendo guias…' : 'Valor na guia'}
                  sub={aVencer.length === 0 ? 'Nada a vencer' : proximoVencimento
                    ? `${datasAVencer.size > 1 ? 'Próximo vencimento' : 'Vencimento'}: ${fmtData(proximoVencimento)}${aVencer.some((g) => g.valor == null) && temValor(aVencer) ? ' · + valores nas guias' : ''}`
                    : plural(aVencer.length, 'guia', 'guias')}
                  s={aVencer.length === 0 ? 'ok' : aVencer.some(alertaUrgente) ? 'warn' : 'neutral'} />
              </div>
              </Ocultavel>

              {/* ── 3. Impostos (com guia anexada ou aguardando guia) ── */}
              <Ocultavel chave="impostos" {...propsOc}>
              <Secao titulo={`Impostos da competência ${competencia}`} icone={<CalendarIcon size={14} />}
                extra={temValor(guias) && <Total valor={somaValores(guias)} />}>
                {guias.length === 0
                  ? <Vazio>Nenhum imposto previsto para essa competência.</Vazio>
                  : <div style={LISTA}>{guias.map((g) => <LinhaGuia key={g.id} g={g} onBaixar={baixar} editando={editando} onSalvarValor={salvarValorGuia} onMarcarPaga={salvarGuiaPaga} />)}</div>}
              </Secao>
              </Ocultavel>

              {/* ── Notas fiscais de serviço (módulo NFS-e): totais emitido / a emitir, recolhidos;
                  abrindo, as emitidas (PDF, XML, WhatsApp) e as que faltam informação ── */}
              {(nfseEmitidas.length > 0 || nfsePendentes.length > 0) && (
                <Ocultavel chave="nfse_emitidas" {...propsOc}>
                <Secao titulo={`Notas fiscais de serviço — ${competencia}`} icone={<FileTextIcon size={14} />}>
                  <NotasServico emitidas={nfseEmitidas} pendentes={nfsePendentes}
                    onBaixar={baixarNotaEmitida} onWhatsapp={enviarNotaWhatsapp} onCompletar={completarPendente} />
                </Secao>
                </Ocultavel>
              )}

              {/* ── Honorários (módulo Honorários) + chave PIX pra copiar ── */}
              {honorarios.length > 0 && (
                <Ocultavel chave="honorarios" {...propsOc}>
                <Secao titulo="Honorários" icone={<WalletIcon size={14} />}
                  extra={honorarios.some((h) => !h.concluida) && <Total valor={somaValores(honorarios.filter((h) => !h.concluida))} />}>
                  <div style={LISTA}>{honorarios.map((h) => <LinhaHonorario key={h.id} h={h} />)}</div>
                  {honorarios.some((h) => !h.concluida) && dados.configPix?.chavePix && (
                    <ChavePix chave={dados.configPix.chavePix} favorecido={dados.configPix.favorecido} />
                  )}
                </Secao>
                </Ocultavel>
              )}

              {/* ── 4. Pendências (Relatório de Situação Fiscal) ── */}
              <Ocultavel chave="pendencias" {...propsOc}>
              <Secao titulo="Pendências — Relatório de Situação Fiscal" icone={<AlertTriangleIcon size={14} />}
                extra={pendencias.some((p) => !p.aVencer) && <Total valor={somaValores(pendencias.filter((p) => !p.aVencer))} cor="var(--danger)" />}>
                {!dados.situacaoFiscal
                  ? <Vazio>Relatório de Situação Fiscal ainda não enviado.</Vazio>
                  : pendencias.length === 0
                    ? <Vazio ok>Nenhuma pendência na Receita Federal nem em Dívida Ativa.</Vazio>
                    : <div style={LISTA}>{pendencias.map((p) => <LinhaPendencia key={p.id} p={p} />)}</div>}
                {dados.situacaoFiscal && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
                    <span>
                      Relatório emitido em {dados.situacaoFiscal.data_emissao ? fmtData(dados.situacaoFiscal.data_emissao) : dados.situacaoFiscal.competencia}
                      {pendencias.length > 0 ? ' · saldo atualizado conforme o relatório.' : '.'}
                    </span>
                    {dados.situacaoFiscal.storage_path && (
                      <BotaoLink onClick={() => baixar(dados.situacaoFiscal.storage_path, 'Relatório de Situação Fiscal')}>Baixar relatório</BotaoLink>
                    )}
                  </div>
                )}
              </Secao>
              </Ocultavel>

              {/* ── 5. Obrigações e tarefas (Fiscal/Folha) ── */}
              {itensArea.length > 0 && (
                <Ocultavel chave="obrigacoes" {...propsOc}>
                <Secao titulo="Obrigações e tarefas do mês" icone={<ClipboardListIcon size={14} />}>
                  <div style={LISTA}>{itensArea.map((it) => <LinhaObrigacao key={it.id} it={it} onBaixar={baixar} />)}</div>
                </Secao>
                </Ocultavel>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Gerado pelo Gestor — Escritório Contábil.
        </div>
      </div>
    </div>
    </RecadosContext.Provider>
  );
}

// Impostos da competência: com guia anexada, ou "aguardando guia" se ainda não concluídos. Exceção: o DAS de um mês
// com faturamento zerado na Declaração do Simples não tem guia (não há o
// que pagar) — entra como "Sem movimento" pro cliente saber que está ok.
function montarGuias({ impostos, anexos, gerenciais }, competencia) {
  const semMovimento = gerenciais != null && gerenciais.faturamento_periodo != null && Number(gerenciais.faturamento_periodo) === 0;
  const guias = impostos
    // Sem guia anexada ainda: aparece como "aguardando guia" (com o vencimento), a não ser que a
    // obrigação já esteja concluída / não se aplique (ex.: apurado sem valor a pagar).
    .filter((o) => anexos[o.id] || (semMovimento && ehDas(o)) || !(o.status === 'concluido' || o.status === 'nao_aplica'))
    .map((o) => {
      const das = ehDas(o);
      const anexo = anexos[o.id] || null;
      const aguardandoGuia = !anexo && !(das && semMovimento);
      // valor lido da própria guia (IA) tem prioridade — já vem com multa/
      // juros se for o caso; o DAS cai no valor da declaração enquanto a
      // guia não foi lida
      const valorGuia = anexo?.valor_guia != null ? Number(anexo.valor_guia) : null;
      // vencimento impresso na guia é o que vale pro pagamento — o da
      // obrigação às vezes está cadastrado errado (ex: FGTS Digital)
      const vencimento = anexo?.vencimento_guia || o.vencimento || null;
      return {
        id: o.id,
        titulo: o.titulo || o.tipo,
        competencia: o.competencia || competencia,
        area: o.departamentos?.nome || null,
        vencimento,
        // vencida + concluída = o escritório já deu baixa, não é alerta
        dias: diasParaVencer(vencimento),
        concluida: o.status === 'concluido' || o.status === 'nao_aplica',
        // pagamento confirmado pelo comprovante (ou marcado na mão no modo de edição)
        paga: !!anexo?.pago_em,
        pagoEm: anexo?.pago_em || null,
        semMovimento: das && semMovimento,
        aguardandoGuia,
        valor: (das && semMovimento) || aguardandoGuia ? null
          : valorGuia ?? (das && gerenciais?.valor_das != null ? Number(gerenciais.valor_das) : null),
        anexo,
      };
    });
  if (semMovimento && !impostos.some(ehDas)) {
    guias.push({ id: 'das-sem-movimento', titulo: 'DAS — Simples Nacional', competencia, area: 'Fiscal',
      vencimento: null, dias: null, concluida: true, semMovimento: true, valor: null, anexo: null });
  }
  return guias.sort((a, b) => (a.vencimento || '9999-99-99').localeCompare(b.vencimento || '9999-99-99'));
}

// Débitos (RFB) + inscrições em Dívida Ativa (PGFN) do relatório mais
// recente, ordenados por competência. `valor` já é o saldo atualizado
// (ver extrair-situacao-fiscal.js).
function montarPendencias(situacaoFiscal) {
  if (!situacaoFiscal) return [];
  const debitos = (situacaoFiscal.debitos || []).map((d, i) => ({
    id: `deb-${i}`, origem: 'Receita Federal', nome: nomeTributo(d.tributo), codigo: d.tributo || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: d.vencimento || null,
    valorOriginal: d.valorOriginal ?? null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  const dividas = (situacaoFiscal.dividas_ativas || []).map((d, i) => ({
    id: `pgfn-${i}`, origem: 'Dívida Ativa (PGFN)', nome: d.tributo ? nomeTributo(d.tributo) : 'Dívida ativa',
    codigo: [d.tributo, d.inscricao ? `Inscrição ${d.inscricao}` : null].filter(Boolean).join(' · ') || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: null,
    valorOriginal: null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  // "A vencer": o vencimento do relatório ainda não passou; relatório lido
  // antes do campo vencimento existir só tem o texto da situação ("A VENCER")
  return [...debitos, ...dividas].map((p) => {
    const dias = diasParaVencer(p.vencimento);
    // `chave` identifica o débito pro recado da linha — o id é só a posição
    // no relatório e mudaria a cada relatório novo enviado
    const chave = `pend-${p.id.split('-')[0]}-${p.codigo || p.nome}-${p.competencia || ''}`;
    return { ...p, chave, dias, aVencer: dias != null ? dias >= 0 : /a\s*vencer/i.test(p.situacao || '') };
  }).sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia));
}

// Obrigações (não-imposto) e tarefas de Fiscal/Folha do mês. Concluída sem
// anexo não interessa ao cliente (não há nada pra ele ver/baixar) — só
// entra concluída se tiver documento anexado; pendente entra sempre.
function montarObrigacoesTarefas({ outrasObrigacoes, tarefasArea, anexos, anexosTarefa }, competencia) {
  const obrigacoes = outrasObrigacoes
    .filter((o) => !(o.status === 'concluido' || o.status === 'nao_aplica') || anexos[o.id])
    .map((o) => ({
      id: o.id, titulo: o.titulo || o.tipo, area: areaObrigacao(o), competencia: o.competencia || competencia,
      status: o.status, vencimento: o.vencimento, anexo: anexos[o.id] || null,
    }));
  const tarefas = tarefasArea
    .filter((t) => !t.concluida || anexosTarefa[t.id])
    .map((t) => ({
      id: t.id, titulo: t.titulo, area: areaTarefa(t), competencia,
      status: t.concluida ? 'concluido' : 'pendente', vencimento: t.vencimento, anexo: anexosTarefa[t.id] || null,
    }));
  const ordemStatus = { vencido: 0, pendente: 1, concluido: 2, nao_aplica: 3 };
  return [...obrigacoes, ...tarefas].sort((a, b) => (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9)
    || (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
}

// Honorário como "obrigação a pagar" — mesmo formato das guias pra entrar
// nos cards de vencidos/a vencer. Avulso usa a descrição como título.
function montarHonorarios(honorarios) {
  return (honorarios || []).map((h) => ({
    id: `hon-${h.id}`,
    titulo: h.tipo === 'avulso' ? (h.descricao || 'Honorário avulso') : 'Honorário contábil',
    competencia: h.competencia,
    vencimento: h.vencimento,
    dias: diasParaVencer(h.vencimento),
    concluida: h.status === 'pago',
    dataPagamento: h.data_pagamento,
    valor: h.valor != null ? Number(h.valor) : null,
  }));
}

const alertaVencida = (g) => !g.semMovimento && !g.concluida && !g.paga && g.dias != null && g.dias < 0;
const alertaUrgente = (g) => !g.semMovimento && !g.paga && g.dias != null && g.dias >= 0 && g.dias <= 3;

const LISTA = { display: 'flex', flexDirection: 'column', gap: 6 };
const COR_S = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', neutral: 'var(--text1)' };
const STATUS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

function ChipCabecalho({ children }) {
  return (
    <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
      {children}
    </span>
  );
}

// Situação perante o fisco nas 3 esferas — federal vem do Relatório de
// Situação Fiscal (IA), estadual/municipal da marcação manual (cnd_manual).
// `soAVencer`: o relatório só lista débito ainda no prazo — a IA marca a
// situação geral como "pendente" mesmo assim, mas não há nada em atraso.
function ChipSituacao({ situacaoFiscal, cndManual, soAVencer }) {
  const esferas = [soAVencer && situacaoFiscal?.situacao_geral === 'pendente' ? 'regular' : situacaoFiscal?.situacao_geral, cndManual?.situacao_estadual, cndManual?.situacao_municipal].filter(Boolean);
  if (esferas.length === 0) return null;
  const pendente = esferas.includes('pendente');
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '3px 9px', color: '#fff',
      background: pendente ? 'var(--danger)' : 'var(--ok)' }}>
      {pendente ? 'Situação fiscal: com pendências' : 'Situação fiscal: regular'}
    </span>
  );
}

// Lado do cliente: botão pra ativar as notificações push do painel naquele
// aparelho (painelPush.js). Some quando o navegador não tem suporte; no
// iPhone explica o passo de adicionar à tela de início, sem o qual o iOS
// não libera notificações.
function AtivarNotificacoes({ clienteId }) {
  const [situacao, setSituacao] = useState(null);
  const [ativando, setAtivando] = useState(false);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    prepararPainelComoApp();
    situacaoNotificacoesPainel().then(setSituacao).catch(() => setSituacao('sem_suporte'));
  }, []);
  const ativar = async () => {
    setAtivando(true);
    setErro(null);
    try {
      await ativarNotificacoesPainel(clienteId);
    } catch (e) {
      setErro(e.message);
    }
    setSituacao(await situacaoNotificacoesPainel().catch(() => 'sem_suporte'));
    setAtivando(false);
  };
  if (!situacao || situacao === 'sem_suporte') return null;
  const caixa = { marginTop: 12, fontSize: 11, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '7px 10px' };
  if (situacao === 'ativo') {
    return <div style={{ ...caixa, display: 'flex', alignItems: 'center', gap: 6 }}><BellIcon size={12} /> Notificações ativas neste aparelho.</div>;
  }
  if (situacao === 'ios_instalar') {
    return <div style={caixa}><b style={{ color: '#fff' }}>Quer receber avisos no iPhone?</b> Toque em Compartilhar → “Adicionar à Tela de Início”, abra o painel pelo ícone criado e ative as notificações.</div>;
  }
  if (situacao === 'bloqueado') {
    return <div style={caixa}>As notificações estão bloqueadas neste navegador. Libere nas configurações do site pra receber os avisos do escritório.</div>;
  }
  return (
    <div style={{ ...caixa, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 180px' }}>Receba no celular os avisos do escritório (guia disponível, vencimentos, recados).</span>
      <button type="button" onClick={ativar} disabled={ativando}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'var(--accent)',
          border: 'none', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap', opacity: ativando ? 0.6 : 1 }}>
        <BellIcon size={13} /> {ativando ? 'Ativando…' : 'Ativar notificações'}
      </button>
      {erro && <span style={{ flex: '1 1 100%', color: '#fff', fontWeight: 700 }}>⚠ {erro}</span>}
    </div>
  );
}

// Lado do escritório (prévia de dentro do app): manda uma notificação push
// pros aparelhos em que o cliente ativou as notificações do painel.
function EnviarNotificacao({ clienteId, competencia }) {
  const [aparelhos, setAparelhos] = useState(null); // null = tabela indisponível/carregando
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  useEffect(() => {
    setResultado(null);
    contarAparelhosPush(clienteId).then(setAparelhos).catch(() => setAparelhos(null));
  }, [clienteId]);
  if (aparelhos == null) return null;
  const enviar = async () => {
    setEnviando(true);
    setResultado(null);
    try {
      const url = urlPublica({ painel: await chavePainelPorId(clienteId), competencia });
      const r = await enviarNotificacaoCliente(clienteId, { titulo: 'Recado do seu escritório contábil', mensagem: mensagem.trim(), url });
      setResultado(r.enviadas > 0 ? `Enviada pra ${plural(r.enviadas, 'aparelho', 'aparelhos')}.` : 'Nenhum aparelho recebeu — o cliente precisa ativar as notificações de novo.');
      if (r.enviadas > 0) setMensagem('');
      contarAparelhosPush(clienteId).then(setAparelhos).catch(() => {});
    } catch (e) {
      setResultado(`Não enviou: ${e.message}`);
    }
    setEnviando(false);
  };
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '7px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <BellIcon size={12} /> Notificação no celular do cliente
        <span style={{ fontWeight: 400, opacity: 0.85 }}>
          {aparelhos === 0 ? '— o cliente ainda não ativou as notificações no painel' : `— ${plural(aparelhos, 'aparelho ativo', 'aparelhos ativos')}`}
        </span>
      </div>
      {aparelhos > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={300} placeholder="Ex: Sua guia do DAS já está disponível no painel."
            onKeyDown={(e) => { if (e.key === 'Enter' && mensagem.trim() && !enviando) enviar(); }}
            style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, padding: '6px 8px', fontFamily: 'inherit' }} />
          <button type="button" onClick={enviar} disabled={enviando || !mensagem.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none',
              borderRadius: 6, padding: '0 11px', cursor: 'pointer', whiteSpace: 'nowrap', opacity: enviando || !mensagem.trim() ? 0.6 : 1 }}>
            <SendIcon size={12} /> {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      )}
      {resultado && <div style={{ marginTop: 5, color: '#fff' }}>{resultado}</div>}
    </div>
  );
}

// Envolve uma seção pra deixá-la ocultável pelo escritório. Fora do modo de
// edição (inclusive pro cliente, que nunca tem `editando`) a seção oculta
// simplesmente não renderiza; no modo de edição ela continua aparecendo,
// esmaecida, com o botão pra mostrar/ocultar numa faixa própria acima (não
// por cima do conteúdo, onde cobriria o total da seção).
function Ocultavel({ chave, secoesOcultas, editando, onToggle, children }) {
  const oculta = secoesOcultas.includes(chave);
  if (!editando) return oculta ? null : children;
  return (
    <div style={{ border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)', padding: 10 }}>
      <button type="button" onClick={() => onToggle(chave)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 10, fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 99,
          padding: '4px 10px', cursor: 'pointer', background: oculta ? 'var(--surface3)' : 'var(--accent-dim)', color: oculta ? 'var(--text3)' : 'var(--accent)' }}>
        {oculta ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
        {oculta ? 'Oculto pro cliente — clique pra mostrar' : 'Visível pro cliente — clique pra ocultar'}
      </button>
      <div style={{ opacity: oculta ? 0.4 : 1 }}>{children}</div>
    </div>
  );
}

// Campo de valor do modo de edição — salva ao sair do campo ou no Enter.
function CampoNumero({ valor, onSalvar, placeholder }) {
  const [texto, setTexto] = useState(valor == null ? '' : String(valor).replace('.', ','));
  const [invalido, setInvalido] = useState(false);
  const confirmar = () => {
    const n = parseNumero(texto);
    setInvalido(n === undefined);
    if (n === undefined || n === (valor == null ? null : Number(valor))) return;
    onSalvar(n);
  };
  return (
    <input value={texto} inputMode="decimal" placeholder={placeholder || '—'}
      onChange={(e) => setTexto(e.target.value)} onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 13, fontWeight: 700, color: 'var(--text1)', background: 'var(--surface)',
        border: `1px solid ${invalido ? 'var(--danger)' : 'var(--border2)'}`, borderRadius: 6, padding: '4px 7px', fontFamily: 'inherit' }} />
  );
}

function Secao({ titulo, icone, extra, children }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {icone} {titulo}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Total({ valor, cor }) {
  return <span style={{ fontSize: 13, fontWeight: 800, color: cor || 'var(--text1)', whiteSpace: 'nowrap' }}>{fmt(valor)}</span>;
}

function Vazio({ children, ok }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 'var(--r-md)', fontSize: 12.5,
      background: ok ? 'var(--ok-dim)' : 'var(--bg)', color: ok ? 'var(--ok)' : 'var(--text3)', border: ok ? 'none' : '1px dashed var(--border)' }}>
      {ok && <CheckCircleIcon size={15} />} {children}
    </div>
  );
}

function BotaoLink({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)',
        background: 'var(--accent-dim)', border: 'none', borderRadius: 99, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <DownloadIcon size={11} /> {children}
    </button>
  );
}

function BotaoGuia({ anexo, onBaixar, label = 'Guia', descricao }) {
  return (
    <button type="button" onClick={() => onBaixar(anexo.storage_path, descricao || anexo.nome_arquivo)} title={`Baixar ${anexo.nome_arquivo}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'var(--accent)',
        border: 'none', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <DownloadIcon size={13} /> {label}
    </button>
  );
}

function Mini({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 3 }}>{valor}</div>
    </div>
  );
}

function Indicador({ icone, titulo, valor, sub, s }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: `3px solid ${s === 'neutral' ? 'var(--border2)' : COR_S[s]}`,
      borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {titulo}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: COR_S[s], marginTop: 6 }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// Linha base: título com a competência ao lado ("INSS Mensal 06/2026"),
// detalhes embaixo, valor/ações à direita.
// Recados por linha: `recados` = { chave do item: mensagem }; no modo de
// edição cada linha ganha a caixa pra escrever/apagar o recado dela.
const RecadosContext = createContext({ recados: {}, editando: false, salvar: () => {} });

function RecadoLinha({ chave }) {
  const { recados, editando, salvar } = useContext(RecadosContext);
  const atual = recados[chave] || '';
  const [texto, setTexto] = useState(atual);
  if (editando) {
    return (
      <textarea value={texto} rows={1} placeholder="Recado para o cliente nesta linha (opcional)"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => { if (texto.trim() !== atual) salvar(chave, texto); }}
        style={{ flex: '1 1 100%', minWidth: 0, boxSizing: 'border-box', fontSize: 12, color: 'var(--text1)', background: 'var(--surface)',
          border: '1px dashed var(--border2)', borderRadius: 6, padding: '6px 8px', fontFamily: 'inherit', resize: 'vertical' }} />
    );
  }
  if (!atual) return null;
  return (
    <div style={{ flex: '1 1 100%', display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--text1)',
      background: 'var(--accent-dim)', borderRadius: 6, padding: '7px 9px', whiteSpace: 'pre-wrap' }}>
      <MessageSquareIcon size={13} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} /> {atual}
    </div>
  );
}

function Linha({ chave, corBorda, titulo, competencia, detalhes, direita }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${corBorda}`, borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 700 }}>
          {titulo}{competencia && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{competencia}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap', fontSize: 10.5 }}>{detalhes}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>{direita}</div>
      {chave && <RecadoLinha key={chave} chave={chave} />}
    </div>
  );
}

function LinhaGuia({ g, onBaixar, editando, onSalvarValor, onMarcarPaga }) {
  // só dá pra corrigir o valor de guia anexada (é gravado no documento) e
  // com a coluna valor_guia já existente no banco
  const editavel = editando && !g.semMovimento && g.anexo && 'valor_guia' in g.anexo;
  const vencida = alertaVencida(g);
  const urgente = alertaUrgente(g);
  const corBorda = g.semMovimento || g.paga ? 'var(--ok)' : vencida ? 'var(--danger)' : urgente ? 'var(--warn)' : g.aguardandoGuia ? 'var(--border)' : 'var(--accent)';
  return (
    <Linha chave={g.id} corBorda={corBorda} titulo={g.titulo} competencia={g.competencia}
      detalhes={(
        <>
          {g.area && <span style={{ color: 'var(--text3)' }}>{g.area}</span>}
          {g.vencimento && !g.semMovimento && (
            <span style={{ color: vencida ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {fmtData(g.vencimento)}{g.paga || (g.concluida && g.dias < 0) ? '' : ` · ${fmtDias(g.dias)}`}
            </span>
          )}
          {g.paga && (
            <span style={{ color: 'var(--ok)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckCircleIcon size={10} /> Paga em {new Date(g.pagoEm).toLocaleDateString('pt-BR')}
            </span>
          )}
        </>
      )}
      direita={(
        <>
          {g.semMovimento ? (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)', background: 'var(--ok-dim)', borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap' }}>
              Sem movimento
            </span>
          ) : g.aguardandoGuia ? (
            <span title="O escritório ainda vai apurar e anexar a guia deste imposto"
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', background: 'var(--surface2, var(--bg))', border: '1px solid var(--border)',
                borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ClockIcon size={11} /> Aguardando guia
            </span>
          ) : editavel ? (
            <div style={{ width: 110 }} title="Valor da guia (R$)">
              <CampoNumero valor={g.anexo.valor_guia} onSalvar={(v) => onSalvarValor(g.anexo, v)}
                placeholder={g.valor != null ? String(g.valor).replace('.', ',') : 'Valor (R$)'} />
            </div>
          ) : (
            <span style={{ fontSize: g.valor != null ? 14 : 11, fontWeight: g.valor != null ? 800 : 500, color: g.valor != null ? 'var(--text1)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
              {g.valor != null ? fmt(g.valor) : g.lendo ? 'lendo guia…' : 'valor na guia'}
            </span>
          )}
          {g.paga && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ok)', background: 'var(--ok-dim)', borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>Paga</span>
          )}
          {g.anexo && <BotaoGuia anexo={g.anexo} onBaixar={onBaixar} descricao={`Guia — ${g.titulo} ${g.competencia || ''}`.trim()} />}
          {/* pagar sem baixar a guia: código de barras e PIX copia e cola lidos da própria guia */}
          {!g.paga && !g.semMovimento && g.anexo?.linha_digitavel && (
            <BotaoCopiar texto={g.anexo.linha_digitavel} icone={<BarcodeIcon size={13} />} label="Código de barras"
              title="Copiar a linha digitável pra colar no app do banco" />
          )}
          {!g.paga && !g.semMovimento && g.anexo?.pix_copia_cola && (
            <BotaoCopiar texto={g.anexo.pix_copia_cola} icone={<QrCodeIcon size={13} />} label="PIX copia e cola"
              title="Copiar o PIX copia e cola da guia pra colar no app do banco" />
          )}
          {g.anexo?.comprovante_path && (
            <BotaoGuia anexo={{ storage_path: g.anexo.comprovante_path, nome_arquivo: g.anexo.comprovante_nome || 'comprovante' }} onBaixar={onBaixar}
              label="Comprovante" descricao={`Comprovante — ${g.titulo} ${g.competencia || ''}`.trim()} />
          )}
          {editando && g.anexo && !g.semMovimento && (
            <button type="button" onClick={() => onMarcarPaga(g.anexo, !g.paga)}
              title={g.paga ? 'Voltar a guia pra "em aberto" (remove o comprovante do painel)' : 'Marcar a guia como paga, sem comprovante'}
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'var(--surface)', border: '1px dashed var(--border2)',
                borderRadius: 8, padding: '5px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {g.paga ? 'Desfazer pagamento' : 'Marcar paga'}
            </button>
          )}
        </>
      )} />
  );
}

function LinhaHonorario({ h }) {
  const vencido = alertaVencida(h);
  const urgente = !h.concluida && alertaUrgente(h);
  const [cor, dim] = h.concluida ? STATUS_COR.concluido : vencido ? STATUS_COR.vencido : STATUS_COR.pendente;
  return (
    <Linha corBorda={h.concluida ? 'var(--ok)' : vencido ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--accent)'}
      chave={h.id} titulo={h.titulo} competencia={h.competencia}
      detalhes={h.concluida
        ? <span style={{ color: 'var(--text3)' }}>{h.dataPagamento ? `Pago em ${fmtData(h.dataPagamento)}` : 'Pago'}</span>
        : h.vencimento && (
          <span style={{ color: vencido ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
            <CalendarIcon size={10} /> {fmtData(h.vencimento)} · {fmtDias(h.dias)}
          </span>
        )}
      direita={(
        <>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)', whiteSpace: 'nowrap' }}>{h.valor != null ? fmt(h.valor) : '—'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: dim, borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
            {h.concluida ? 'Pago' : vencido ? 'Vencido' : 'A pagar'}
          </span>
        </>
      )} />
  );
}

// Mesmo formato das notas de entrada: cada grupo (Emitidas / A emitir) fechado mostra o total e a
// quantidade; "Ver por nota" abre a lista dele. Se alguma a emitir precisa de informação do
// cliente, o aviso aparece no resumo.
function NotasServico({ emitidas, pendentes, onBaixar, onWhatsapp, onCompletar }) {
  const faltando = pendentes.filter((n) => !n.pronta).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <GrupoNotas rotulo="Emitidas" lista={emitidas} cor="var(--ok)" vazio="Nenhuma nota emitida nesta competência.">
        <div style={LISTA}>{emitidas.map((n) => <LinhaNfseEmitida key={n.id} n={n} onBaixar={onBaixar} onWhatsapp={onWhatsapp} />)}</div>
      </GrupoNotas>
      <GrupoNotas rotulo="A emitir" lista={pendentes} cor="var(--warn)" vazio="Nenhuma nota aguardando emissão."
        aviso={faltando > 0 && `${faltando} nota${faltando !== 1 ? 's' : ''} precisa${faltando !== 1 ? 'm' : ''} de informação sua (ex.: CPF do paciente)`}
        abertoInicial={faltando > 0}>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>
          Complete o que falta (normalmente o CPF do paciente). Quando a nota fica pronta, o escritório emite e ela passa para "Emitidas", com o botão para enviar pelo WhatsApp.
        </div>
        <div style={LISTA}>{pendentes.map((n) => <LinhaNfsePendente key={n.id} n={n} onSalvar={onCompletar} />)}</div>
      </GrupoNotas>
    </div>
  );
}

function GrupoNotas({ rotulo, lista, cor, vazio, aviso = null, abertoInicial = false, children }) {
  const [aberto, setAberto] = useState(abertoInicial);
  const total = lista.reduce((t, n) => t + Number(n.valor || 0), 0);
  const temNotas = lista.length > 0;
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${temNotas ? cor : 'var(--border)'}`,
      borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <button type="button" onClick={() => temNotas && setAberto((v) => !v)} aria-expanded={aberto} disabled={!temNotas}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none',
          cursor: temNotas ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'inherit', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
            {rotulo} · {lista.length} nota{lista.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: temNotas ? 'var(--text1)' : 'var(--text3)', marginTop: 3 }}>{fmt(total)}</div>
        </div>
        {temNotas ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)',
            background: 'var(--accent-dim)', borderRadius: 99, padding: '5px 10px', whiteSpace: 'nowrap' }}>
            {aberto ? 'Ocultar notas' : 'Ver por nota'}
            <ChevronDownIcon size={13} style={{ transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </span>
        ) : <span style={{ fontSize: 11, color: 'var(--text3)' }}>{vazio}</span>}
        {aviso && (
          <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--warn)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangleIcon size={12} /> {aviso}
          </span>
        )}
      </button>
      {aberto && temNotas && <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 12px' }}>{children}</div>}
    </div>
  );
}

function LinhaNfseEmitida({ n, onBaixar, onWhatsapp }) {
  const emitida = n.emitidaEm ? fmtData(String(n.emitidaEm).slice(0, 10)) : null;
  const [enviando, setEnviando] = useState(false); // mostra o campo do número
  const [numero, setNumero] = useState('');
  const destino = numeroWhatsapp(numero);
  const enviar = () => { if (destino) { onWhatsapp(n, destino); setEnviando(false); setNumero(''); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <Linha chave={n.id} corBorda="var(--ok)" titulo={`NFS-e nº ${n.numero || '—'}${n.tomador ? ` — ${n.tomador}` : ''}`}
      detalhes={(
        <>
          {emitida && <span style={{ color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={10} /> Emitida em {emitida}</span>}
          {n.descricao && <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{n.descricao}</span>}
          {n.ambiente === 'homologacao' && <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Homologação (teste)</span>}
        </>
      )}
      direita={(
        <>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)', whiteSpace: 'nowrap' }}>{n.valor != null ? fmt(n.valor) : '—'}</span>
          <BotaoLink onClick={() => onBaixar(n, 'pdf')}>PDF</BotaoLink>
          <BotaoLink onClick={() => onBaixar(n, 'xml')}>XML</BotaoLink>
          {onWhatsapp && n.ambiente !== 'homologacao' && (
            <button type="button" onClick={() => setEnviando((v) => !v)} title="Enviar o PDF para o paciente pelo WhatsApp"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: '#25D366',
                border: 'none', borderRadius: 99, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <SendIcon size={11} /> WhatsApp
            </button>
          )}
        </>
      )} />
    {enviando && (
      <form onSubmit={(e) => { e.preventDefault(); enviar(); }}
        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '0 4px 4px' }}>
        <input autoFocus type="tel" inputMode="tel" placeholder="WhatsApp do paciente, ex: (31) 99999-9999" value={numero}
          onChange={(e) => setNumero(e.target.value)}
          style={{ flex: '1 1 220px', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)' }} />
        <button type="submit" disabled={!destino}
          style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: destino ? '#25D366' : 'var(--text3)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: destino ? 'pointer' : 'default' }}>
          Abrir no WhatsApp
        </button>
        <span style={{ fontSize: 10.5, color: 'var(--text3)', flexBasis: '100%' }}>
          Vai uma mensagem com o link do PDF (vale por 30 dias). Você confere e envia no WhatsApp.
        </span>
      </form>
    )}
    </div>
  );
}

// Nota ainda não emitida: o cliente preenche o que falta (CPF, nome, descrição)
function LinhaNfsePendente({ n, onSalvar }) {
  const falta = (rotulo) => n.pendencias.includes(rotulo);
  const [cpf, setCpf] = useState(n.cpf || '');
  const [nome, setNome] = useState(n.nome || '');
  const [descricao, setDescricao] = useState(n.descricao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const pedeCpf = falta('CPF') || n.erros.some((e) => /CPF/.test(e));
  const pedeNome = falta('Nome');
  const pedeDescricao = falta('Descrição');
  const temCampos = pedeCpf || pedeNome || pedeDescricao;
  const corBorda = n.pronta ? 'var(--ok)' : n.erros.length ? 'var(--danger)' : 'var(--warn)';

  const salvar = async (e) => {
    e.preventDefault();
    const campos = {};
    if (pedeCpf) campos.cpf = cpf;
    if (pedeNome) campos.nome = nome;
    if (pedeDescricao) campos.descricao = descricao;
    setSalvando(true); setErro(null);
    try { await onSalvar(n, campos); } catch (err) { setErro(err.message); } finally { setSalvando(false); }
  };

  const campo = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${corBorda}`, borderRadius: 'var(--r-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', flex: '1 1 180px' }}>{n.nome || 'Paciente sem nome'}</span>
        {n.data && <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={10} /> {fmtData(n.data)}</span>}
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)' }}>{n.valor != null ? fmt(n.valor) : '—'}</span>
      </div>
      {n.pronta ? (
        <span style={{ fontSize: 11.5, color: 'var(--ok)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          <CheckCircleIcon size={12} /> Pronta — o escritório vai emitir
        </span>
      ) : (
        <>
          <span style={{ fontSize: 11, color: n.erros.length ? 'var(--danger)' : 'var(--warn)', fontWeight: 600 }}>
            {[...n.erros, ...(n.pendencias.length ? [`Falta: ${n.pendencias.join(', ')}`] : [])].join(' · ')}
          </span>
          {n.avisos.length > 0 && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{n.avisos.join(' · ')}</span>}
          {temCampos && (
            <form onSubmit={salvar} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {pedeNome && <input placeholder="Nome completo do paciente" value={nome} onChange={(e) => setNome(e.target.value)} style={{ ...campo, flex: '2 1 200px' }} />}
              {pedeCpf && <input placeholder="CPF do paciente" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} style={{ ...campo, flex: '1 1 150px' }} />}
              {pedeDescricao && <input placeholder="Descrição do serviço" value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...campo, flex: '2 1 200px' }} />}
              <button type="submit" disabled={salvando}
                style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </form>
          )}
          {!temCampos && <span style={{ fontSize: 11, color: 'var(--text3)' }}>O escritório vai conferir esta nota.</span>}
          {erro && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{erro}</span>}
        </>
      )}
    </div>
  );
}

// Chave PIX do escritório (Honorários → Configurar PIX) com botão de copiar
// — o cliente cola direto no app do banco.
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // fallback pra navegador/webview sem Clipboard API (ex: navegador interno do WhatsApp)
    const el = document.createElement('textarea');
    el.value = texto;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

// Botão de copiar um código de pagamento da guia, com confirmação na hora.
function BotaoCopiar({ texto, icone, label, title }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    await copiarTexto(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };
  return (
    <button type="button" onClick={copiar} title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
        borderRadius: 8, padding: '5px 10px', border: `1px solid ${copiado ? 'var(--ok)' : 'var(--accent)'}`,
        color: copiado ? '#fff' : 'var(--accent)', background: copiado ? 'var(--ok)' : 'var(--surface)' }}>
      {copiado ? <CheckCircleIcon size={13} /> : icone} {copiado ? 'Copiado!' : label}
    </button>
  );
}

function ChavePix({ chave, favorecido }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    await copiarTexto(chave);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '12px 14px', borderRadius: 'var(--r-md)',
      background: 'var(--accent-dim)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>
          Pague via PIX{favorecido ? ` · ${favorecido}` : ''}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)', marginTop: 3, wordBreak: 'break-all' }}>{chave}</div>
      </div>
      <button type="button" onClick={copiar}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#fff',
          background: copiado ? 'var(--ok)' : 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {copiado ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />} {copiado ? 'Chave copiada!' : 'Copiar chave PIX'}
      </button>
    </div>
  );
}

function LinhaPendencia({ p }) {
  return (
    <Linha corBorda={p.aVencer ? 'var(--accent)' : 'var(--danger)'} chave={p.chave} titulo={p.nome} competencia={p.competencia}
      detalhes={(
        <>
          <span style={{ color: p.aVencer ? 'var(--text3)' : 'var(--danger)', fontWeight: 600 }}>{p.origem}</span>
          {p.aVencer
            ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>A vencer</span>
            : p.situacao && <span style={{ color: 'var(--text3)' }}>{p.situacao}</span>}
          {p.vencimento && <span style={{ color: 'var(--text3)' }}>venc. {fmtData(p.vencimento)}{p.aVencer ? ` · ${fmtDias(p.dias)}` : ''}</span>}
          {p.codigo && <span style={{ color: 'var(--text3)', opacity: 0.8 }}>{p.codigo}</span>}
        </>
      )}
      direita={(
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)', whiteSpace: 'nowrap' }}>{p.valor != null ? fmt(p.valor) : '—'}</div>
          {p.valorOriginal != null && Number(p.valorOriginal) !== Number(p.valor) && (
            <div style={{ fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>original {fmt(p.valorOriginal)}</div>
          )}
        </div>
      )} />
  );
}

function LinhaObrigacao({ it, onBaixar }) {
  const [cor, dim] = STATUS_COR[it.status] || ['var(--text3)', 'var(--surface2)'];
  const dias = diasParaVencer(it.vencimento);
  const aberta = it.status === 'pendente' || it.status === 'vencido';
  return (
    <Linha chave={it.id} corBorda={cor} titulo={it.titulo} competencia={it.competencia}
      detalhes={(
        <>
          {it.area && <span style={{ color: 'var(--text3)' }}>{it.area}</span>}
          {it.vencimento && (
            <span style={{ color: aberta && dias < 0 ? 'var(--danger)' : 'var(--text3)', fontWeight: aberta ? 600 : 400, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {fmtData(it.vencimento)}{aberta ? ` · ${fmtDias(dias)}` : ''}
            </span>
          )}
        </>
      )}
      direita={(
        <>
          {it.anexo && <BotaoGuia anexo={it.anexo} onBaixar={onBaixar} label="Baixar" descricao={`${it.titulo} ${it.competencia || ''}`.trim()} />}
          <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: dim, borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
            {STATUS_LABEL[it.status] || it.status}
          </span>
        </>
      )} />
  );
}
