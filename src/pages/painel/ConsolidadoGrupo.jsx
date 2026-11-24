import { useEffect, useState } from 'react';
import {
  AlertTriangleIcon, ClockIcon, TrendingUpIcon, Building2Icon, CalendarIcon, FileTextIcon, ChevronRightIcon, LayersIcon,
  CheckCircle2Icon, DownloadIcon,
} from 'lucide-react';
import { supabase, clienteComToken } from '../../lib/supabase';
import { sessaoDoToken } from './AcessoPainel';
import {
  obterItensConsolidados, obterDocumentosPorObrigacao, obterGerenciaisPorCompetencia, obterDadosGerenciais,
  obterHistoricoFaturamento, obterSituacaoFiscalMaisRecente, obterCndVigente, obterHonorariosPainel, avisarEventoPainel,
} from './painelApi';
import { baixarArquivoDaEmpresa } from '../documentos/documentosApi';
import { ehImposto, ehDas, filtrarOutrasCompetencias, montarGuias } from './painelRegras';
import { resumirEmpresa, consolidarGrupo } from './consolidadoGrupo';
import { GraficoFaturamento } from './PainelClientePage';

// Aba "Consolidado" do painel de grupo (PainelGrupoPage.jsx): as empresas do
// link somadas — faturamento e DAS do grupo, vencidos / a vencer, impostos em
// aberto de todas, situação fiscal e certidões de cada uma. Cada empresa é
// lida com o token dela (no link público o RLS só libera a própria empresa)
// e pelas mesmas funções do painel individual (painelApi.js / painelRegras.js),
// então os números batem com o painel de cada empresa. Clicar numa empresa
// (ou num imposto) abre o painel dela.

// Lê uma empresa do grupo com o mesmo recorte do painel dela.
// chave: token do painel (link público) ou id do cliente (admin).
async function carregarEmpresaConsolidado(chave, competencia, admin) {
  let db = supabase;
  let sessao = null;
  let clienteId = chave;
  if (!admin) {
    sessao = await sessaoDoToken(chave);
    db = clienteComToken(chave);
    clienteId = sessao.id;
  }
  const clientePromise = sessao
    ? Promise.resolve(sessao)
    : db.from('clientes').select('nome, cnpj, regime, painel_secoes_ocultas').eq('id', clienteId).single()
      .then(({ data, error }) => { if (error) throw error; return data; });
  const [cliente, consolidados, gerenciais, historico, situacaoFiscal, cndManual, honorarios] = await Promise.all([
    clientePromise,
    obterItensConsolidados(clienteId, competencia, db),
    obterDadosGerenciais(clienteId, competencia, db).catch(() => null),
    obterHistoricoFaturamento(clienteId, db).catch(() => []),
    obterSituacaoFiscalMaisRecente(clienteId, competencia, db).catch(() => null),
    obterCndVigente(clienteId, competencia, db).catch(() => null),
    obterHonorariosPainel(clienteId, competencia, db).catch(() => []),
  ]);
  const impostos = consolidados.obrigacoes.filter(ehImposto);
  const competenciasDas = [...new Set(impostos.filter(ehDas).map((o) => o.competencia).filter((c) => c && c !== competencia))];
  const [anexos, gerenciaisOutras] = await Promise.all([
    obterDocumentosPorObrigacao(impostos.map((o) => o.id), db).catch(() => ({})),
    obterGerenciaisPorCompetencia(clienteId, competenciasDas, db).catch(() => ({})),
  ]);
  const gerenciaisPorComp = { ...gerenciaisOutras, ...(gerenciais ? { [competencia]: gerenciais } : {}) };
  const visiveis = filtrarOutrasCompetencias({ impostos, outrasObrigacoes: [], tarefasArea: [], anexos }, competencia);
  const guias = montarGuias({ impostos: visiveis.impostos, anexos, gerenciais, gerenciaisPorComp }, competencia);
  return resumirEmpresa(chave, { cliente, guias, gerenciais: gerenciais && { ...gerenciais, competencia }, historico, situacaoFiscal, cndManual, honorarios });
}

const fmt = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const fmtData = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR') : '');
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
function fmtDias(dias) {
  if (dias == null) return null;
  if (dias === 0) return 'vence hoje';
  if (dias > 0) return `vence em ${plural(dias, 'dia', 'dias')}`;
  return `venceu há ${plural(Math.abs(dias), 'dia', 'dias')}`;
}
// Últimas 6 competências até a do link (mesmo seletor do painel da empresa)
function opcoesCompetencia(base) {
  const [mes, ano] = base.split('/').map(Number);
  const lista = [];
  for (let i = 4; i >= -1; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    lista.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  return lista;
}

const COR_S = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', neutral: 'var(--text1)' };
const LISTA = { display: 'flex', flexDirection: 'column', gap: 6 };

export default function ConsolidadoGrupo({ empresas, competencia: competenciaInicial, admin = false, onAbrirEmpresa }) {
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const [resumos, setResumos] = useState(null); // [{ ...resumirEmpresa } | { id, nome, erro }]

  const chaveEmpresas = empresas.map((e) => e.id).join(',');
  useEffect(() => {
    let ativo = true;
    setResumos(null);
    Promise.all(empresas.map((e) => carregarEmpresaConsolidado(e.id, competencia, admin)
      .catch((erro) => ({ id: e.id, nome: e.nome, erro: erro.message }))))
      .then((lista) => ativo && setResumos(lista));
    return () => { ativo = false; };
  }, [chaveEmpresas, competencia, admin]);

  // Guia / comprovante de uma empresa do grupo: no link público vai com o
  // token daquela empresa (empresaId é o token), e o escritório é avisado do
  // download como no painel dela.
  const [baixando, setBaixando] = useState(null);
  const [erroDownload, setErroDownload] = useState(null);
  const baixar = async (empresaId, arquivo) => {
    const chave = `${empresaId}:${arquivo.storage_path}`;
    setBaixando(chave);
    setErroDownload(null);
    if (!admin) avisarEventoPainel(empresaId, 'download', { descricao: arquivo.nome_arquivo, competencia, documentoId: arquivo.id, token: empresaId });
    try {
      await baixarArquivoDaEmpresa(arquivo.storage_path, arquivo.nome_arquivo, admin ? null : empresaId);
    } catch (e) {
      setErroDownload(e.message || 'Não foi possível baixar o arquivo.');
    } finally {
      setBaixando(null);
    }
  };
  const acoes = { baixar, baixando };

  const ok = (resumos || []).filter((r) => !r.erro);
  const comErro = (resumos || []).filter((r) => r.erro);
  const total = resumos && consolidarGrupo(ok);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 12px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
        {/* ── Cabeçalho ── */}
        <div style={{ padding: '20px 22px', background: 'var(--navy)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Painel consolidado
            </div>
            <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>Grupo · {plural(empresas.length, 'empresa', 'empresas')}</div>
            {total && (total.comPendencia + total.regulares > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '3px 9px', color: '#fff',
                  background: total.comPendencia ? 'var(--danger)' : 'var(--ok)' }}>
                  {total.comPendencia
                    ? `Situação fiscal: ${plural(total.comPendencia, 'empresa com pendências', 'empresas com pendências')}`
                    : 'Situação fiscal: todas regulares'}
                </span>
              </div>
            )}
          </div>
          <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
            style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
              borderRadius: 6, padding: '5px 8px', fontWeight: 600 }}>
            {opcoesCompetencia(competenciaInicial).map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
          </select>
        </div>

        <div style={{ padding: 22 }}>
          {!resumos && <p style={{ color: 'var(--text2)' }}>Carregando as empresas do grupo...</p>}
          {resumos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {comErro.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--warn)', background: 'var(--warn-dim)', borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
                  Não consegui carregar {comErro.map((r) => r.nome || 'uma empresa').join(', ')}: fica de fora da soma. ({comErro[0].erro})
                </div>
              )}

              {erroDownload && (
                <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-dim)', borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
                  {erroDownload}
                </div>
              )}

              {/* ── Vencidos / a vencer / pagos do grupo ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <Indicador icone={<AlertTriangleIcon size={13} />} titulo="Vencidos — grupo"
                  valor={total.vencidos.qtd === 0 ? 'Nenhum' : total.vencidos.temValor ? fmt(total.vencidos.valor) : 'Valor na guia'}
                  sub={total.vencidos.qtd === 0 ? 'Nada vencido em nenhuma empresa'
                    : `${plural(total.vencidos.qtd, 'item', 'itens')} em ${plural(total.vencidos.empresas, 'empresa', 'empresas')}${total.vencidos.semValor && total.vencidos.temValor ? ' · + valores nas guias' : ''}`}
                  s={total.vencidos.qtd > 0 ? 'danger' : 'ok'} />
                <Indicador icone={<ClockIcon size={13} />} titulo="A vencer — grupo"
                  valor={total.aVencer.qtd === 0 ? 'Nenhum' : total.aVencer.temValor ? fmt(total.aVencer.valor) : 'Valor na guia'}
                  sub={total.aVencer.qtd === 0 ? 'Nada a vencer'
                    : `${plural(total.aVencer.qtd, 'item', 'itens')}${total.aVencer.proximo ? ` · próximo: ${fmtData(total.aVencer.proximo)}` : ''}${total.aVencer.semValor && total.aVencer.temValor ? ' · + valores nas guias' : ''}`}
                  s={total.aVencer.qtd === 0 ? 'ok' : 'neutral'} />
                <Indicador icone={<CheckCircle2Icon size={13} />} titulo={`Pagos — ${competencia}`}
                  valor={total.pagos.qtd === 0 ? 'Nenhum' : total.pagos.temValor ? fmt(total.pagos.valor) : plural(total.pagos.qtd, 'guia', 'guias')}
                  sub={total.pagos.qtd === 0 ? 'Nenhum pagamento confirmado na competência'
                    : `${plural(total.pagos.qtd, 'imposto', 'impostos')} em ${plural(total.pagos.empresas, 'empresa', 'empresas')}`}
                  s={total.pagos.qtd > 0 ? 'ok' : 'neutral'} />
              </div>

              {/* ── Faturamento do grupo ── */}
              {(total.faturamento != null || total.historico.length > 0) && (
                <Secao titulo={`Faturamento do grupo — competência ${competencia}`} icone={<TrendingUpIcon size={14} />}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {total.faturamento != null && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                          <Mini label="Faturamento do grupo" valor={fmt(total.faturamento)} />
                          <Mini label="DAS do grupo" valor={fmt(total.das)} />
                          <Mini label="Alíquota efetiva média" valor={fmtPct(total.aliquota)} cor="var(--accent)" />
                        </div>
                        {total.comDeclaracao < ok.length && (
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                            Soma de {total.comDeclaracao} de {plural(ok.length, 'empresa', 'empresas')}: as outras ainda não têm a Declaração do Simples de {competencia}.
                          </div>
                        )}
                      </>
                    )}
                    {total.historico.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>
                          Evolução do faturamento (soma das empresas)
                        </div>
                        <GraficoFaturamento dados={total.historico} />
                        {total.historico.some((h) => h.parcial) && (
                          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4 }}>
                            Alguns meses não têm a declaração de todas as empresas: a soma desses meses é parcial.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Secao>
              )}

              {/* ── Por empresa ── */}
              <Secao titulo="Por empresa" icone={<Building2Icon size={14} />}>
                <div style={LISTA}>
                  {ok.map((r) => <LinhaEmpresa key={r.id} r={r} onAbrir={() => onAbrirEmpresa(r.id)} />)}
                </div>
              </Secao>

              {/* ── Impostos em aberto de todas as empresas ── */}
              <Secao titulo="Impostos e guias em aberto — todas as empresas" icone={<CalendarIcon size={14} />}
                extra={total.guiasAbertas.some((g) => g.valor != null) && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text1)' }}>
                    {fmt(total.guiasAbertas.reduce((s, g) => s + (Number(g.valor) || 0), 0))}
                  </span>
                )}>
                {total.guiasAbertas.length === 0
                  ? <Vazio>Nenhum imposto em aberto nas empresas do grupo.</Vazio>
                  : <div style={LISTA}>{total.guiasAbertas.map((g) => (
                    <LinhaGuiaGrupo key={`${g.empresaId}-${g.id}`} g={g} acoes={acoes} onAbrir={() => onAbrirEmpresa(g.empresaId)} />
                  ))}</div>}
              </Secao>

              {/* ── Impostos pagos de todas as empresas, com guia e comprovante ── */}
              <Secao titulo={`Impostos pagos — competência ${competencia}`} icone={<CheckCircle2Icon size={14} />}
                extra={total.pagos.temValor && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ok)' }}>{fmt(total.pagos.valor)}</span>
                )}>
                {total.guiasPagas.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
                    Nenhum pagamento de imposto confirmado nas empresas do grupo em {competencia}.
                  </div>
                  : <div style={LISTA}>{total.guiasPagas.map((g) => (
                    <LinhaGuiaGrupo key={`${g.empresaId}-${g.id}`} g={g} acoes={acoes} onAbrir={() => onAbrirEmpresa(g.empresaId)} />
                  ))}</div>}
              </Secao>

              {/* ── Certidões ── */}
              {ok.some((r) => Object.values(r.certidoes).some(Boolean)) && (
                <Secao titulo="Certidões negativas (CND)" icone={<FileTextIcon size={14} />}>
                  <div style={LISTA}>
                    {ok.filter((r) => Object.values(r.certidoes).some(Boolean)).map((r) => (
                      <button key={r.id} type="button" onClick={() => onAbrirEmpresa(r.id)}
                        style={{ ...estiloLinha(Object.values(r.certidoes).includes('pendente') ? 'var(--danger)' : Object.values(r.certidoes).includes('vencida') ? 'var(--warn)' : 'var(--ok)'),
                          flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {[['federal', 'Federal'], ['estadual', 'Estadual'], ['municipal', 'Municipal']].map(([esfera, rotulo]) => (
                            <ChipCertidao key={esfera} rotulo={rotulo} situacao={r.certidoes[esfera]} />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </Secao>
              )}

              <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                Baixe a guia ou o comprovante direto aqui, ou toque numa empresa para ver o painel completo dela.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function estiloLinha(corBorda) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
    cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${corBorda}`,
    borderRadius: 'var(--r-md)', padding: '10px 12px', font: 'inherit',
  };
}

function LinhaEmpresa({ r, onAbrir }) {
  const cor = r.vencidos.qtd > 0 ? 'var(--danger)' : r.situacao === 'pendente' ? 'var(--warn)' : 'var(--ok)';
  const valorCard = (c) => (c.qtd === 0 ? '—' : c.temValor ? fmt(c.valor) : 'na guia');
  return (
    <button type="button" onClick={onAbrir} style={{ ...estiloLinha(cor), flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{[r.cnpj, r.regime].filter(Boolean).join(' · ')}</div>
        </div>
        {r.situacao && (
          <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '3px 8px', whiteSpace: 'nowrap',
            color: r.situacao === 'pendente' ? 'var(--danger)' : 'var(--ok)', background: r.situacao === 'pendente' ? 'var(--danger-dim)' : 'var(--ok-dim)' }}>
            {r.situacao === 'pendente' ? 'Com pendências' : 'Regular'}
          </span>
        )}
        <ChevronRightIcon size={15} style={{ color: 'var(--text3)', flexShrink: 0 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 6 }}>
        <MiniLinha label="Faturamento" valor={r.faturamento == null ? '—' : fmt(r.faturamento)} />
        <MiniLinha label="DAS" valor={r.semMovimento ? 'Sem mov.' : r.das == null ? '—' : fmt(r.das)} />
        <MiniLinha label="Vencidos" valor={valorCard(r.vencidos)} cor={r.vencidos.qtd > 0 ? 'var(--danger)' : undefined} />
        <MiniLinha label="A vencer" valor={valorCard(r.aVencer)} />
      </div>
    </button>
  );
}

// Linha de imposto (em aberto ou pago) de uma empresa do grupo. A parte de
// texto abre o painel da empresa; os botões baixam a guia e o comprovante.
function LinhaGuiaGrupo({ g, acoes, onAbrir }) {
  const vencida = !g.paga && g.dias != null && g.dias < 0;
  const urgente = !g.paga && g.dias != null && g.dias >= 0 && g.dias <= 3;
  const cor = g.paga ? 'var(--ok)' : vencida ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--accent)';
  const anexo = g.anexo;
  const guia = anexo?.storage_path
    ? { id: anexo.id, storage_path: anexo.storage_path, nome_arquivo: anexo.nome_arquivo || `Guia ${g.titulo}` } : null;
  const comprovante = g.paga && anexo?.comprovante_path
    ? { id: anexo.id, storage_path: anexo.comprovante_path, nome_arquivo: anexo.comprovante_nome || `Comprovante ${g.titulo}` } : null;
  return (
    <div style={{ ...estiloLinha(cor), cursor: 'default', flexWrap: 'wrap' }}>
      <button type="button" onClick={onAbrir} title="Abrir o painel da empresa"
        style={{ flex: '1 1 220px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)' }}>
          {g.titulo} <span style={{ fontWeight: 500, color: 'var(--text3)' }}>{g.competencia}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><LayersIcon size={10} /> {g.empresa}</span>
          {g.paga
            ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>· paga{g.pagoEm ? ` em ${fmtData(String(g.pagoEm).slice(0, 10))}` : ''}
              {g.baixaManual && <span style={{ color: 'var(--text2)', fontWeight: 400, fontStyle: 'italic' }}> · baixa manual{g.baixaJustificativa ? `: ${g.baixaJustificativa}` : ''}</span>}</span>
            : g.vencimento && <span style={{ color: vencida ? 'var(--danger)' : 'var(--text3)' }}>· {fmtData(g.vencimento)} ({fmtDias(g.dias)})</span>}
          {g.aguardandoGuia && <span style={{ color: 'var(--text3)' }}>· aguardando guia</span>}
        </div>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: g.paga ? 'var(--ok)' : vencida ? 'var(--danger)' : 'var(--text1)', whiteSpace: 'nowrap' }}>
          {g.valor != null ? fmt(g.valor) : g.aguardandoGuia ? '—' : 'na guia'}
        </div>
        {guia && <BotaoArquivo rotulo="Guia" arquivo={guia} empresaId={g.empresaId} acoes={acoes} />}
        {comprovante && <BotaoArquivo rotulo="Comprovante" arquivo={comprovante} empresaId={g.empresaId} acoes={acoes} cor="ok" />}
      </div>
    </div>
  );
}

function BotaoArquivo({ rotulo, arquivo, empresaId, acoes, cor = 'accent' }) {
  const ocupado = acoes.baixando === `${empresaId}:${arquivo.storage_path}`;
  return (
    <button type="button" disabled={ocupado} onClick={() => acoes.baixar(empresaId, arquivo)}
      title={`Baixar ${arquivo.nome_arquivo}`} aria-label={`Baixar ${rotulo.toLowerCase()}: ${arquivo.nome_arquivo}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
        color: `var(--${cor})`, background: `var(--${cor}-dim)`, border: 'none', borderRadius: 99, padding: '4px 9px',
        cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.6 : 1 }}>
      <DownloadIcon size={11} /> {ocupado ? 'Baixando...' : rotulo}
    </button>
  );
}

function ChipCertidao({ rotulo, situacao }) {
  const [texto, cor, fundo] = !situacao ? ['—', 'var(--text3)', 'var(--surface2)']
    : situacao === 'vencida' ? ['vencida', 'var(--warn)', 'var(--warn-dim)']
      : situacao === 'pendente' ? ['pendência', 'var(--danger)', 'var(--danger-dim)']
        : ['ok', 'var(--ok)', 'var(--ok-dim)'];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: fundo, borderRadius: 99, padding: '3px 8px', whiteSpace: 'nowrap' }}>
      {rotulo}: {texto}
    </span>
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

function Vazio({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--ok)', background: 'var(--ok-dim)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>{children}</div>;
}

function Mini({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 3 }}>{valor}</div>
    </div>
  );
}

function MiniLinha({ label, valor, cor }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: cor || 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valor}</div>
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
