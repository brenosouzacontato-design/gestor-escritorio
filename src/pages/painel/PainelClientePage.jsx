import { useEffect, useState } from 'react';
import {
  WalletIcon, ClipboardListIcon, CheckSquareIcon, PaperclipIcon, BarChart3Icon,
  SearchIcon, CalendarIcon, DownloadIcon, CheckCircleIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listarLancamentosAIdentificar, salvarObservacaoCliente } from '../contabil/contabilApi';
import { criarLinkAssinado } from '../documentos/documentosApi';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterResumoFinanceiro, obterDadosGerenciais,
  obterDocumentosDoMes, obterDocumentosPorObrigacao,
} from './painelApi';

const STATUS_OBS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_OBS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

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

// Recalculado a cada carregamento da página a partir da data de hoje —
// não precisa de job/cron pra "atualizar diariamente", já nasce correto
// toda vez que alguém abre o link.
function diasParaVencer(vencimento) {
  if (!vencimento) return null;
  const hoje = new Date(new Date().toDateString());
  const venc = new Date(vencimento + 'T00:00:00');
  return Math.round((venc - hoje) / 86400000);
}
function fmtDiasParaVencer(dias) {
  if (dias == null) return null;
  if (dias === 0) return 'vence hoje';
  if (dias > 0) return `vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`;
}

// "MM/YYYY" -> primeiro/último dia do mês (formato usado por
// calcularDREPorConta/listarLancamentosAIdentificar, que trabalham com
// intervalo de datas, não competência-texto).
function competenciaParaPeriodo(competencia) {
  const [mes, ano] = competencia.split('/').map(Number);
  const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { dataInicio, dataFim };
}

// Página pública (sem login) com a visão consolidada do cliente naquela
// competência: financeiro, obrigações, tarefas, documentos, lançamentos a
// identificar (quando houver) e dados gerenciais do Simples Nacional
// (quando enviados). Acessada via ?painel=<clienteId>&competencia=MM/YYYY
// (ver main.jsx). Mesmo padrão visual de RelatorioCompartilhadoPage.jsx /
// IdentificarLancamentosPage.jsx.
export default function PainelClientePage({ clienteId, competencia }) {
  const [clienteNome, setClienteNome] = useState('');
  const [obs, setObs] = useState(null);
  const [tarefas, setTarefas] = useState(null);
  const [financeiro, setFinanceiro] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [gerenciais, setGerenciais] = useState(null);
  const [documentos, setDocumentos] = useState([]);
  const [anexosObrigacao, setAnexosObrigacao] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const { dataInicio, dataFim } = competenciaParaPeriodo(competencia);
        const [{ data: cliente, error: errCliente }, resObs, resTarefas, resFinanceiro, itensIdentificar, dadosSimples, docs] = await Promise.all([
          supabase.from('clientes').select('nome').eq('id', clienteId).single(),
          obterResumoObrigacoes(clienteId, competencia),
          obterResumoTarefas(clienteId, competencia),
          obterResumoFinanceiro(clienteId, { dataInicio, dataFim }),
          listarLancamentosAIdentificar(clienteId, { dataInicio, dataFim }),
          // tabela nova (dados_gerenciais_simples) — tolera ainda não existir
          // no banco (schema pendente de aplicar) sem quebrar o resto do painel
          obterDadosGerenciais(clienteId, competencia).catch(() => null),
          obterDocumentosDoMes(clienteId, { dataInicio, dataFim }).catch(() => []),
        ]);
        if (errCliente) throw errCliente;
        setClienteNome(cliente?.nome ?? '');
        setObs(resObs);
        setTarefas(resTarefas);
        setFinanceiro(resFinanceiro);
        setLancamentos(itensIdentificar);
        setGerenciais(dadosSimples);
        setDocumentos(docs);
        const anexos = await obterDocumentosPorObrigacao(resObs.itens.map((o) => o.id)).catch(() => ({}));
        setAnexosObrigacao(anexos);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [clienteId, competencia]);

  const baixarAnexo = async (documento) => {
    const url = await criarLinkAssinado(documento.storage_path).catch(() => null);
    if (url) window.open(url, '_blank');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 26px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            📋 Painel do cliente
          </div>
          <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando ? '...' : clienteNome}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>Competência {competencia}</div>
        </div>

        <div style={{ padding: 26 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Financeiro — primeiro, é o que mais importa pro cliente ver de cara */}
              <div>
                <SecaoTitulo icone={<WalletIcon size={14} />}>Financeiro</SecaoTitulo>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <Metrica label="Conciliados" valor={financeiro.conciliados} />
                  <Metrica label="A conciliar" valor={financeiro.aConciliar} cor={financeiro.aConciliar > 0 ? 'var(--warn)' : 'var(--ok)'} />
                  <Metrica label="Resultado do período" valor={financeiro.resultado != null ? fmt(financeiro.resultado) : '—'}
                    cor={financeiro.resultado < 0 ? 'var(--danger)' : 'var(--ok)'} />
                </div>
              </div>

              {/* Informações gerenciais (Simples Nacional) — só se já enviaram a declaração */}
              {gerenciais && (
                <div>
                  <SecaoTitulo icone={<BarChart3Icon size={14} />}>Informações gerenciais — Simples Nacional</SecaoTitulo>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    <Metrica label="Faturamento do período" valor={fmt(gerenciais.faturamento_periodo)} />
                    <Metrica label="RBT12" valor={fmt(gerenciais.rbt12)} />
                    <Metrica label="Alíquota efetiva" valor={fmtPct(gerenciais.aliquota_efetiva)} />
                    <Metrica label="DAS a pagar" valor={fmt(gerenciais.valor_das)} />
                  </div>
                  {gerenciais.anexo && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Enquadrado no Anexo {gerenciais.anexo} do Simples Nacional.</div>
                  )}
                </div>
              )}

              {/* Obrigações + Tarefas */}
              <div>
                <SecaoTitulo icone={<ClipboardListIcon size={14} />}>Obrigações e tarefas do mês</SecaoTitulo>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: (obs.itens.length > 0 || tarefas.itens.length > 0) ? 10 : 0 }}>
                  <ResumoCard titulo="Obrigações" icone={<ClipboardListIcon size={13} />} pct={obs.total ? Math.round((obs.ok / obs.total) * 100) : 0}
                    linha1={`${obs.ok}/${obs.total} concluídas`} alerta={obs.vencido > 0 ? `${obs.vencido} vencida${obs.vencido !== 1 ? 's' : ''}` : null} />
                  <ResumoCard titulo="Tarefas" icone={<CheckSquareIcon size={13} />} pct={tarefas.total ? Math.round((tarefas.concluidas / tarefas.total) * 100) : 0}
                    linha1={`${tarefas.concluidas}/${tarefas.total} concluídas`} alerta={null} />
                </div>
                {obs.itens.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: tarefas.itens.length > 0 ? 10 : 0 }}>
                    {obs.itens.map((o) => {
                      const dias = diasParaVencer(o.vencimento);
                      const anexo = anexosObrigacao[o.id];
                      return (
                        <ItemLista key={o.id} titulo={o.titulo || o.tipo} sub={o.departamentos?.nome}
                          statusLabel={STATUS_OBS_LABEL[o.status]} statusCor={STATUS_OBS_COR[o.status]}
                          vencimentoTexto={o.vencimento ? `${fmtData(o.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                          vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : dias != null && dias <= 3 ? 'var(--warn)' : 'var(--text3)'}
                          anexo={anexo} onBaixarAnexo={baixarAnexo} />
                      );
                    })}
                  </div>
                )}
                {tarefas.itens.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tarefas.itens.map((t) => {
                      const dias = diasParaVencer(t.vencimento);
                      return (
                        <ItemLista key={t.id} titulo={t.titulo} sub={t.departamento}
                          statusLabel={t.concluida ? 'Concluída' : 'Pendente'} statusCor={t.concluida ? ['var(--ok)', 'var(--ok-dim)'] : ['var(--warn)', 'var(--warn-dim)']}
                          vencimentoTexto={t.vencimento && !t.concluida ? `${fmtData(t.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                          vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : dias != null && dias <= 3 ? 'var(--warn)' : 'var(--text3)'} />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Documentos do mês — só se houver algum confirmado no período */}
              {documentos.length > 0 && (
                <div>
                  <SecaoTitulo icone={<PaperclipIcon size={14} />}>Documentos do mês</SecaoTitulo>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {documentos.map((d) => (
                      <ItemLista key={d.id} titulo={d.tipo_documento_sugerido || d.nome_arquivo} sub={fmtData(d.created_at?.slice(0, 10))}
                        anexo={d} onBaixarAnexo={baixarAnexo} />
                    ))}
                  </div>
                </div>
              )}

              {/* Lançamentos a identificar — só aparece se houver algum */}
              {lancamentos.length > 0 && (
                <div>
                  <SecaoTitulo icone={<SearchIcon size={14} />}>Lançamentos a identificar</SecaoTitulo>
                  <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                    Escreva embaixo de cada lançamento o que foi essa movimentação — a resposta salva sozinha ao sair do campo.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {lancamentos.map((l) => <LinhaIdentificar key={l.id} lancamento={l} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 26px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Gerado pelo Gestor — Escritório Contábil.
        </div>
      </div>
    </div>
  );
}

function SecaoTitulo({ children, icone }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
      {icone} {children}
    </div>
  );
}

function ResumoCard({ titulo, icone, pct, linha1, alerta }) {
  const completo = pct === 100 && !alerta;
  return (
    <div style={{ background: completo ? 'var(--ok)' : 'var(--bg)', border: `1px solid ${completo ? 'var(--ok)' : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: completo ? 'rgba(255,255,255,.85)' : 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {titulo}
      </div>
      {completo ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <CheckCircleIcon size={20} color="#fff" />
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Completo</span>
        </div>
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, color: alerta ? 'var(--danger)' : 'var(--ok)', marginTop: 5 }}>{pct}%</div>
      )}
      <div style={{ fontSize: 11, color: completo ? 'rgba(255,255,255,.85)' : 'var(--text2)', marginTop: 2 }}>{linha1}</div>
      {alerta && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2, fontWeight: 600 }}>⚠ {alerta}</div>}
    </div>
  );
}

function ItemLista({ titulo, sub, statusLabel, statusCor, vencimentoTexto, vencimentoCor, anexo, onBaixarAnexo }) {
  const [cor, corDim] = statusCor || [];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          {sub && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{sub}</span>}
          {vencimentoTexto && (
            <span style={{ fontSize: 10.5, color: vencimentoCor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {vencimentoTexto}
            </span>
          )}
        </div>
      </div>
      {anexo && (
        <button onClick={() => onBaixarAnexo(anexo)} title={`Baixar ${anexo.nome_arquivo}`}
          style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 26, height: 26, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
          <DownloadIcon size={13} />
        </button>
      )}
      {statusLabel && (
        <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: corDim, borderRadius: 99, padding: '3px 9px', flexShrink: 0 }}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}

function Metrica({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 3 }}>{valor}</div>
    </div>
  );
}

// Mesma lógica de IdentificarLancamentosPage.jsx (autosave no onBlur).
function LinhaIdentificar({ lancamento }) {
  const [observacao, setObservacao] = useState(lancamento.observacaoCliente);
  const [status, setStatus] = useState('idle');

  async function salvar() {
    if (observacao === lancamento.observacaoCliente) return;
    setStatus('salvando');
    try {
      await salvarObservacaoCliente(lancamento.id, observacao);
      lancamento.observacaoCliente = observacao;
      setStatus('salvo');
    } catch {
      setStatus('erro');
    }
  }

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtData(lancamento.data)}</span>
        <span style={{ fontSize: 13, fontWeight: 700,
          color: lancamento.natureza === 'saida' ? 'var(--danger)' : lancamento.natureza === 'entrada' ? 'var(--ok)' : 'var(--text1)' }}>
          {lancamento.natureza === 'entrada' ? '+ ' : lancamento.natureza === 'saida' ? '− ' : ''}{fmt(lancamento.valor)}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text1)', marginTop: 4, fontWeight: 500 }}>{lancamento.historico}</div>
      <textarea
        value={observacao}
        onChange={(e) => { setObservacao(e.target.value); setStatus('idle'); }}
        onBlur={salvar}
        placeholder="O que foi esse lançamento?"
        rows={2}
        style={{ width: '100%', marginTop: 8, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical' }}
      />
      {status === 'salvando' && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>Salvando...</div>}
      {status === 'salvo' && <div style={{ fontSize: 10.5, color: 'var(--ok)', marginTop: 3 }}>✓ Salvo</div>}
      {status === 'erro' && <div style={{ fontSize: 10.5, color: 'var(--danger)', marginTop: 3 }}>Erro ao salvar, tente de novo.</div>}
    </div>
  );
}
