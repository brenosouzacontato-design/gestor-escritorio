// PedidosNfePage.jsx — Fiscal → Pedidos de NF-e (gestor).
// Pedidos de nota de venda que os clientes mandam pelo app ?pedido= (PedidoNfePage): lista com
// filtro por situação, detalhes (destinatário, itens, frete), troca de situação, número/chave da nota
// emitida, reenvio do resumo pelo WhatsApp e o link do app de cada empresa.
// Tabelas em supabase-schema-nfe-solicitacoes.sql.
import { useEffect, useMemo, useState } from 'react';
import { ReceiptTextIcon, RefreshCwIcon, LinkIcon, SendIcon, ChevronDownIcon, ChevronRightIcon, AlertTriangleIcon, BotIcon, FileDownIcon, SparklesIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store';
import { useToast } from '../../components/shared';
import EmpresaCombobox from '../../components/EmpresaCombobox';
import { chavePainel, urlPublica } from '../../lib/linksPublicos';
import { roteiroClaude } from './roteiroClaude';
import { chamarPedidoNfe, STATUS, FRETES, fmtMoeda, fmtQuando, fmtDocumento, numeroPedido } from './pedidoNfeApi';

const FILTROS = [
  ['abertos', 'Em aberto'], ['recebida', 'Recebidos'], ['em_emissao', 'Em emissão'], ['erro', 'Com pendência'],
  ['emitida', 'Emitidos'], ['cancelada', 'Cancelados'], ['todos', 'Todos'],
];
const ABERTOS = ['recebida', 'em_emissao', 'erro'];
// soma dos descontos dos itens (o desconto fica dentro de itens)
const descontoDe = (p) => (p.itens || []).reduce((s, i) => s + (Number(i.desconto) || 0), 0);
const qtd = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
// robô do Emissor (deploy/robo-parcelamentos/emissor.py, supabase-schema-nfe-robo.sql)
const ROBO = {
  na_fila: { label: 'Na fila do robô', cor: 'var(--info)' },
  processando: { label: 'Robô emitindo', cor: 'var(--warn)' },
  aguardando_pessoa: { label: 'Robô esperando alguém na tela remota', cor: 'var(--warn)' },
  ok: { label: 'Robô concluiu', cor: 'var(--ok)' },
  erro: { label: 'Robô parou', cor: 'var(--danger)' },
};

async function abrirArquivo(caminho, show) {
  const aba = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(caminho, 600);
  if (error) { aba?.close(); show('Erro: ' + error.message); return; }
  if (aba) aba.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank');
}

export default function PedidosNfePage() {
  const { show } = useToast();
  const clientes = useStore((s) => s.clientes);
  const [pedidos, setPedidos] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState('abertos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);
  const [empresaLink, setEmpresaLink] = useState('');
  const [importacao, setImportacao] = useState(null); // situação da importação do Emissor da empresa escolhida

  // importação de clientes/produtos do Emissor (robô: emissor_importar.py; SQL: supabase-schema-nfe-importacao.sql)
  const lerImportacao = async (id) => {
    if (!id) { setImportacao(null); return; }
    const { data, error } = await supabase.from('clientes').select('*').eq('id', id).maybeSingle();
    if (error) { setImportacao({ erro: error.message }); return; }
    if (!data || !('emissor_importacao_status' in data)) { setImportacao({ semSql: true }); return; }
    setImportacao({ status: data.emissor_importacao_status, msg: data.emissor_importacao_msg, em: data.emissor_importacao_em });
  };
  useEffect(() => { lerImportacao(empresaLink); }, [empresaLink]);
  useEffect(() => {
    if (!['na_fila', 'processando'].includes(importacao?.status)) return undefined;
    const t = setInterval(() => lerImportacao(empresaLink), 10000);
    return () => clearInterval(t);
  }, [importacao?.status, empresaLink]);

  const importarEmissor = async () => {
    const cli = clientes.find((c) => c.id === empresaLink);
    if (!cli || !window.confirm(`Copiar os clientes e produtos de ${cli.nome} do Emissor para o app de pedido? Nada é apagado; só cria o que falta e completa campos vazios.`)) return;
    const { error } = await supabase.from('clientes').update({
      emissor_importacao_status: 'na_fila', emissor_importacao_msg: null, emissor_importacao_em: new Date().toISOString(),
    }).eq('id', cli.id);
    if (error) { show(/emissor_importacao/.test(error.message) ? 'Falta rodar supabase-schema-nfe-importacao.sql no Supabase.' : 'Erro: ' + error.message); return; }
    show('Na fila: o robô importa em até 1 minuto.');
    lerImportacao(cli.id);
  };

  const carregar = async () => {
    setErro(null);
    const { data, error } = await supabase.from('nfe_solicitacoes')
      .select('*, clientes(id, nome, cnpj)').order('criado_em', { ascending: false }).limit(500);
    if (error) { setErro(/nfe_solicitacoes/.test(error.message) ? 'Tabela ainda não criada: rode supabase-schema-nfe-solicitacoes.sql no Supabase.' : error.message); setPedidos([]); return; }
    setPedidos(data);
  };
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60000);
    return () => clearInterval(t);
  }, []);

  const contagem = useMemo(() => {
    const c = {};
    for (const p of pedidos || []) c[p.status] = (c[p.status] || 0) + 1;
    c.abertos = ABERTOS.reduce((s, k) => s + (c[k] || 0), 0);
    c.todos = (pedidos || []).length;
    return c;
  }, [pedidos]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (pedidos || []).filter((p) => {
      if (filtro === 'abertos' && !ABERTOS.includes(p.status)) return false;
      if (!['abertos', 'todos'].includes(filtro) && p.status !== filtro) return false;
      return !t || `${p.clientes?.nome} ${p.destinatario?.nome} ${numeroPedido(p.id)} ${p.nfe_numero || ''}`.toLowerCase().includes(t);
    });
  }, [pedidos, filtro, busca]);

  const atualizar = async (p, mudancas) => {
    const dados = { ...mudancas, atualizado_em: new Date().toISOString() };
    if (mudancas.status === 'emitida' && !p.emitida_em) dados.emitida_em = dados.atualizado_em;
    const { data, error } = await supabase.from('nfe_solicitacoes').update(dados).eq('id', p.id).select('*, clientes(id, nome, cnpj)').single();
    if (error) { show('Erro: ' + error.message); return; }
    setPedidos((l) => l.map((x) => (x.id === p.id ? data : x)));
    show('Pedido atualizado.');
  };

  const reenviar = async (p) => {
    try {
      const { whatsapp } = await chamarPedidoNfe('reenviar_whatsapp', { id: p.id, cliente_id: p.cliente_id });
      show(whatsapp.ok ? 'Resumo reenviado pelo WhatsApp.' : `Não foi: ${whatsapp.erro}`);
      carregar();
    } catch (e) { show('Erro: ' + e.message); }
  };

  // aprova o pedido para o robô: ele preenche, transmite no Emissor e manda PDF/XML ao cliente
  const mandarRobo = async (p) => {
    if (p.robo_status === 'erro' && /⚠️/.test(p.robo_mensagem || '')
      && !window.confirm('O robô parou depois de transmitir: a nota pode ter saído. Já conferiu no Emissor que ela NÃO foi emitida?')) return;
    if (!window.confirm(`Emitir pelo robô a NF-e de ${p.clientes?.nome} para ${p.destinatario?.nome} (${fmtMoeda(p.valor_total)})?`)) return;
    await atualizar(p, { status: 'em_emissao', robo_status: 'na_fila', robo_mensagem: null, robo_em: new Date().toISOString() });
  };

  // volta o pedido para o cliente corrigir no app (status "Com pendência" + WhatsApp com o motivo)
  const devolver = async (p, motivo) => {
    try {
      const { pedido, whatsapp } = await chamarPedidoNfe('devolver', { id: p.id, cliente_id: p.cliente_id, motivo });
      setPedidos((l) => l.map((x) => (x.id === p.id ? { ...x, ...pedido } : x)));
      show(whatsapp.ok ? 'Pedido devolvido. O cliente foi avisado pelo WhatsApp.' : `Pedido devolvido, mas o WhatsApp não foi: ${whatsapp.erro}`);
    } catch (e) { show('Erro: ' + e.message); }
  };

  // copia o roteiro da nota para colar no Claude (Cowork); no fim o Claude anexa o DANFE e o XML aqui
  const copiarRoteiro = async (p, abrir) => {
    const texto = roteiroClaude(p);
    try {
      await navigator.clipboard.writeText(texto);
      show(abrir ? 'Roteiro copiado e Claude aberto. Se o texto não aparecer lá, cole com Ctrl+V.' : 'Roteiro copiado. Cole no Claude (Cowork).');
    } catch (e) { show('Não consegui copiar: ' + e.message); }
    if (abrir) window.open(`https://claude.ai/new?q=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  // DANFE + XML emitidos fora do robô: grava, marca emitida e (se marcado) manda ao cliente no WhatsApp
  const anexarNota = async (p, { pdf, xml, enviar }) => {
    try {
      const { pedido, whatsapp, aviso } = await chamarPedidoNfe('anexar_nota', {
        id: p.id, cliente_id: p.cliente_id, pdf, xml, enviar_whatsapp: enviar,
      });
      setPedidos((l) => l.map((x) => (x.id === p.id ? { ...x, ...pedido } : x)));
      const zap = !enviar ? '' : whatsapp.ok ? ' DANFE e XML enviados ao cliente no WhatsApp.' : ` WhatsApp não foi: ${whatsapp.erro}`;
      show(`NF ${pedido.nfe_numero} anexada e pedido marcado como emitido.${zap}${aviso ? ' ' + aviso : ''}`);
      return true;
    } catch (e) { show('Erro: ' + e.message); return false; }
  };

  const copiarLink = async () => {
    const cli = clientes.find((c) => c.id === empresaLink);
    if (!cli) return;
    const url = urlPublica({ pedido: chavePainel(cli) });
    try { await navigator.clipboard.writeText(url); show('Link do app copiado. Mande para o cliente instalar no celular.'); }
    catch { window.prompt('Copie o link:', url); }
  };

  return (
    <div className="page">
      <div className="section-hdr" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <ReceiptTextIcon size={18} /> Pedidos de NF-e de venda
        </h2>
        <button type="button" className="btn btn-sm" onClick={carregar}><RefreshCwIcon size={14} /> Atualizar</button>
      </div>

      <div className="card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <LinkIcon size={16} style={{ color: 'var(--text3)' }} />
        <span style={{ fontSize: 13, color: 'var(--text2)' }}>Link do app para o cliente:</span>
        <div style={{ flex: 1, minWidth: 220 }}><EmpresaCombobox empresas={clientes} value={empresaLink} onChange={setEmpresaLink} /></div>
        <button type="button" className="btn btn-sm btn-accent" disabled={!empresaLink} onClick={copiarLink}>Copiar link</button>
        <button type="button" className="btn btn-sm" disabled={!empresaLink || ['na_fila', 'processando'].includes(importacao?.status)} onClick={importarEmissor}
          title="O robô copia os clientes e produtos desta empresa no Emissor para o app de pedido">
          <BotIcon size={14} /> Importar do Emissor
        </button>
        {empresaLink && importacao && (importacao.status || importacao.semSql || importacao.erro) && (
          <div style={{ flexBasis: '100%', fontSize: 12, color: importacao.status === 'erro' || importacao.erro ? 'var(--danger)' : 'var(--text3)' }}>
            {importacao.semSql ? 'Importação do Emissor: falta rodar supabase-schema-nfe-importacao.sql no Supabase.'
              : importacao.erro ? importacao.erro
                : <>Importação do Emissor: <b>{{ na_fila: 'na fila do robô', processando: 'robô lendo o Emissor...', ok: 'concluída', erro: 'falhou' }[importacao.status]}</b>
                  {importacao.msg ? ` — ${importacao.msg}` : ''}{importacao.em ? ` (${fmtQuando(importacao.em)})` : ''}</>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTROS.map(([id, rotulo]) => (
          <button key={id} type="button" className={`btn btn-sm ${filtro === id ? 'btn-accent' : ''}`} onClick={() => setFiltro(id)}>
            {rotulo}{contagem[id] ? ` (${contagem[id]})` : ''}
          </button>
        ))}
        <input style={{ flex: 1, minWidth: 180 }} placeholder="Buscar empresa, destinatário, pedido ou NF" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {erro && <div className="notice notice-warn" style={{ marginBottom: 10 }}>{erro}</div>}
      {!pedidos && <div className="center"><div className="spinner" /></div>}
      {pedidos && !visiveis.length && !erro && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Nenhum pedido aqui.</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {visiveis.map((p) => (
          <LinhaPedido key={p.id} p={p} aberto={aberto === p.id} onAlternar={() => setAberto(aberto === p.id ? null : p.id)}
            onAtualizar={(m) => atualizar(p, m)} onReenviar={() => reenviar(p)} onRobo={() => mandarRobo(p)} onDevolver={(m) => devolver(p, m)}
            onArquivo={(caminho) => abrirArquivo(caminho, show)} onClaude={(abrir) => copiarRoteiro(p, abrir)} onAnexar={(arq) => anexarNota(p, arq)} />
        ))}
      </div>
    </div>
  );
}

function LinhaPedido({ p, aberto, onAlternar, onAtualizar, onReenviar, onRobo, onArquivo, onDevolver, onClaude, onAnexar }) {
  const podeDevolver = !['emitida', 'cancelada'].includes(p.status);
  const [motivo, setMotivo] = useState('');
  // robô parou por falta de dado: já sugere o motivo (sem o aviso de "pode ter emitido")
  useEffect(() => { setMotivo(p.robo_status === 'erro' && !/⚠️/.test(p.robo_mensagem || '') ? (p.robo_mensagem || '') : ''); }, [p.robo_status, p.robo_mensagem]);
  const s = STATUS[p.status] || STATUS.recebida;
  const r = p.robo_status ? ROBO[p.robo_status] : null;
  const roboOcupado = ['na_fila', 'processando', 'aguardando_pessoa'].includes(p.robo_status);
  const d = p.destinatario || {};
  const [status, setStatus] = useState(p.status);
  const [mensagem, setMensagem] = useState(p.status_mensagem || '');
  const [numero, setNumero] = useState(p.nfe_numero || '');
  const [chave, setChave] = useState(p.nfe_chave || '');
  useEffect(() => { setStatus(p.status); setMensagem(p.status_mensagem || ''); setNumero(p.nfe_numero || ''); setChave(p.nfe_chave || ''); }, [p]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button type="button" onClick={onAlternar} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', width: '100%', boxSizing: 'border-box' }}>
        {aberto ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.clientes?.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {numeroPedido(p.id)} · {fmtQuando(p.criado_em)} · para {d.nome} · {p.itens?.length || 0} item(ns)
          </div>
        </div>
        {r && <span title={p.robo_mensagem || r.label}><BotIcon size={15} color={r.cor} /></span>}
        {p.whatsapp_erro && !p.whatsapp_enviado_em && <span title={p.whatsapp_erro}><AlertTriangleIcon size={15} color="var(--warn)" /></span>}
        <b style={{ fontSize: 14 }}>{fmtMoeda(p.valor_total)}</b>
        <span className="badge" style={{ color: s.cor, background: s.fundo }}>{s.label}{p.nfe_numero ? ` · NF ${p.nfe_numero}` : ''}</span>
      </button>

      {aberto && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 14, display: 'grid', gap: 14, fontSize: 13 }}>
          <div>
            <div className="form-label">Destinatário</div>
            <div><b>{d.nome}</b> · {fmtDocumento(d.documento)}{d.ie ? ` · IE ${d.ie}` : ''}</div>
            <div style={{ color: 'var(--text2)' }}>
              {[d.logradouro, d.numero].filter(Boolean).join(', ')}{d.complemento ? ` – ${d.complemento}` : ''} – {d.bairro} – {d.municipio}/{d.uf} – CEP {d.cep}
            </div>
            {(d.email || d.telefone) && <div style={{ color: 'var(--text3)' }}>{[d.email, d.telefone].filter(Boolean).join(' · ')}</div>}
          </div>

          <div className="tabela-rolagem">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                <th>#</th><th>Produto</th><th>NCM</th><th style={{ textAlign: 'right' }}>Qtd</th><th>Un</th><th style={{ textAlign: 'right' }}>Valor unit.</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Desconto</th>
              </tr></thead>
              <tbody>
                {(p.itens || []).map((i, n) => (
                  <tr key={n} style={{ borderTop: '1px solid var(--border)' }}>
                    <td>{n + 1}</td><td>{i.descricao}{i.codigo ? ` (${i.codigo})` : ''}</td><td>{i.ncm || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{qtd(i.quantidade)}</td><td>{i.unidade}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoeda(i.valor_unitario)}</td><td style={{ textAlign: 'right' }}>{fmtMoeda(i.valor_total)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(i.desconto) > 0 ? fmtMoeda(i.desconto) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Produtos: <b>{fmtMoeda(p.valor_produtos)}</b></span>
            {descontoDe(p) > 0 && <span>Descontos: <b>− {fmtMoeda(descontoDe(p))}</b></span>}
            <span>Frete: <b>{FRETES.find((f) => f.id === p.frete_modalidade)?.label}</b>{p.frete_valor ? ` · ${fmtMoeda(p.frete_valor)}` : ''}</span>
            <span>Total: <b>{fmtMoeda(p.valor_total)}</b></span>
          </div>
          {p.observacao && <div className="notice notice-info">📝 {p.observacao}</div>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {p.status !== 'emitida' && p.status !== 'cancelada' && (
              <button type="button" className="btn btn-sm btn-accent" disabled={roboOcupado} onClick={onRobo}>
                <BotIcon size={14} /> {p.robo_status === 'erro' ? 'Mandar de novo ao robô' : 'Emitir pelo robô'}
              </button>
            )}
            {p.status !== 'emitida' && p.status !== 'cancelada' && (
              <>
                <button type="button" className="btn btn-sm" disabled={roboOcupado} onClick={() => onClaude(false)}
                  title="Copia o roteiro desta nota para colar no Claude (Cowork), que preenche o Emissor no seu navegador e anexa a nota aqui">
                  <SparklesIcon size={14} /> Emitir pelo Claude
                </button>
                <button type="button" className="btn btn-sm" disabled={roboOcupado} onClick={() => onClaude(true)}
                  title="Copia o roteiro e abre o Claude (claude.ai) já com ele">
                  Abrir no Claude
                </button>
              </>
            )}
            {r && <span style={{ fontSize: 12, color: r.cor }}><b>{r.label}</b>{p.robo_mensagem ? ` — ${p.robo_mensagem}` : ''}{p.robo_em ? ` (${fmtQuando(p.robo_em)})` : ''}</span>}
            {p.nfe_pdf_path && <button type="button" className="btn btn-sm" onClick={() => onArquivo(p.nfe_pdf_path)}><FileDownIcon size={14} /> DANFE</button>}
            {p.nfe_xml_path && <button type="button" className="btn btn-sm" onClick={() => onArquivo(p.nfe_xml_path)}><FileDownIcon size={14} /> XML</button>}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            WhatsApp: {p.whatsapp_enviado_em ? `resumo enviado em ${fmtQuando(p.whatsapp_enviado_em)} para ${p.whatsapp_destino}` : `não enviado${p.whatsapp_erro ? ` — ${p.whatsapp_erro}` : ''}`}
            {' '}<button type="button" className="btn btn-sm" onClick={onReenviar}><SendIcon size={12} /> Reenviar resumo</button>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
            <label className="form-field"><span className="form-label">Situação</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(STATUS).map(([id, st]) => <option key={id} value={id}>{st.label}</option>)}
              </select>
            </label>
            <label className="form-field"><span className="form-label">Número da NF</span><input value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
            <label className="form-field"><span className="form-label">Chave de acesso</span><input value={chave} onChange={(e) => setChave(e.target.value.replace(/\D/g, '').slice(0, 44))} /></label>
          </div>
          {p.status !== 'cancelada' && <AnexarNota onAnexar={onAnexar} jaTem={!!p.nfe_pdf_path} />}
          {podeDevolver && (
            <div className="card" style={{ padding: 10, display: 'grid', gap: 8, background: 'var(--surface2)' }}>
              <label className="form-field" style={{ margin: 0 }}><span className="form-label">Devolver ao cliente para corrigir</span>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="O que falta ou está errado. Ex.: NCM do produto X, IE do destinatário" />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" disabled={!motivo.trim()} onClick={() => onDevolver(motivo.trim())}>
                  <SendIcon size={12} /> Devolver e avisar no WhatsApp
                </button>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>O pedido fica "Com pendência" e o cliente corrige o mesmo pedido no app.</span>
              </div>
            </div>
          )}
          <label className="form-field"><span className="form-label">Recado para o cliente (aparece no app)</span>
            <input value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Ex.: falta a inscrição estadual do destinatário" />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-accent" onClick={() => onAtualizar({
              status, status_mensagem: mensagem.trim() || null, nfe_numero: numero.trim() || null, nfe_chave: chave || null,
            })}>Salvar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// lê o arquivo escolhido como base64 (sem o prefixo "data:...;base64,")
const base64 = (arquivo) => new Promise((ok, falha) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => falha(r.error);
  r.readAsDataURL(arquivo);
});

// Nota emitida fora do robô (à mão ou pelo Claude): DANFE + XML; número e chave saem do XML.
function AnexarNota({ onAnexar, jaTem }) {
  const [pdf, setPdf] = useState(null);
  const [xml, setXml] = useState(null);
  const [enviar, setEnviar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const grande = [pdf, xml].some((a) => a && a.size > 4 * 1024 * 1024);
  const anexar = async () => {
    setEnviando(true);
    const ok = await onAnexar({ pdf: await base64(pdf), xml: await base64(xml), enviar });
    setEnviando(false);
    if (ok) { setPdf(null); setXml(null); }
  };
  return (
    <div className="card" style={{ padding: 10, display: 'grid', gap: 8, background: 'var(--surface2)' }} aria-label="Anexar nota emitida">
      <span className="form-label" style={{ margin: 0 }}>Anexar nota emitida{jaTem ? ' (substitui a anexada)' : ''}</span>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label className="form-field" style={{ margin: 0 }}><span className="form-label">DANFE (PDF)</span>
          <input type="file" accept="application/pdf,.pdf" aria-label="DANFE (PDF)" onChange={(e) => setPdf(e.target.files?.[0] || null)} />
        </label>
        <label className="form-field" style={{ margin: 0 }}><span className="form-label">XML da nota</span>
          <input type="file" accept=".xml,application/xml,text/xml" aria-label="XML da nota" onChange={(e) => setXml(e.target.files?.[0] || null)} />
        </label>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
        <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} /> Mandar DANFE e XML ao cliente no WhatsApp
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-accent" disabled={!pdf || !xml || grande || enviando} onClick={anexar}>
          <FileDownIcon size={12} /> {enviando ? 'Anexando...' : 'Anexar e marcar como emitida'}
        </button>
        <span style={{ fontSize: 11, color: grande ? 'var(--danger)' : 'var(--text3)' }}>
          {grande ? 'Arquivo grande demais (máx. 4 MB).' : 'O número e a chave são lidos do XML.'}
        </span>
      </div>
    </div>
  );
}
