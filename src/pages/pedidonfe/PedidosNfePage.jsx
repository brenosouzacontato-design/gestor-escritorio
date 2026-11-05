// PedidosNfePage.jsx — Fiscal → Pedidos de NF-e (gestor).
// Pedidos de nota de venda que os clientes mandam pelo app ?pedido= (PedidoNfePage): lista com
// filtro por situação, detalhes (destinatário, itens, frete), troca de situação, número/chave da nota
// emitida, reenvio do resumo pelo WhatsApp e o link do app de cada empresa.
// Tabelas em supabase-schema-nfe-solicitacoes.sql.
import { useEffect, useMemo, useState } from 'react';
import { ReceiptTextIcon, RefreshCwIcon, LinkIcon, SendIcon, ChevronDownIcon, ChevronRightIcon, AlertTriangleIcon, BotIcon, FileDownIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store';
import { useToast } from '../../components/shared';
import EmpresaCombobox from '../../components/EmpresaCombobox';
import { chavePainel, urlPublica } from '../../lib/linksPublicos';
import { chamarPedidoNfe, STATUS, FRETES, fmtMoeda, fmtQuando, fmtDocumento, numeroPedido } from './pedidoNfeApi';

const FILTROS = [
  ['abertos', 'Em aberto'], ['recebida', 'Recebidos'], ['em_emissao', 'Em emissão'], ['erro', 'Com pendência'],
  ['emitida', 'Emitidos'], ['cancelada', 'Cancelados'], ['todos', 'Todos'],
];
const ABERTOS = ['recebida', 'em_emissao', 'erro'];
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

  const carregar = async () => {
    setErro(null);
    const { data, error } = await supabase.from('nfe_solicitacoes')
      .select('*, clientes(id, nome)').order('criado_em', { ascending: false }).limit(500);
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
    const { data, error } = await supabase.from('nfe_solicitacoes').update(dados).eq('id', p.id).select('*, clientes(id, nome)').single();
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
            onAtualizar={(m) => atualizar(p, m)} onReenviar={() => reenviar(p)} onRobo={() => mandarRobo(p)}
            onArquivo={(caminho) => abrirArquivo(caminho, show)} />
        ))}
      </div>
    </div>
  );
}

function LinhaPedido({ p, aberto, onAlternar, onAtualizar, onReenviar, onRobo, onArquivo }) {
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
                <th>#</th><th>Produto</th><th>NCM</th><th style={{ textAlign: 'right' }}>Qtd</th><th>Un</th><th style={{ textAlign: 'right' }}>Valor unit.</th><th style={{ textAlign: 'right' }}>Total</th>
              </tr></thead>
              <tbody>
                {(p.itens || []).map((i, n) => (
                  <tr key={n} style={{ borderTop: '1px solid var(--border)' }}>
                    <td>{n + 1}</td><td>{i.descricao}{i.codigo ? ` (${i.codigo})` : ''}</td><td>{i.ncm || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{qtd(i.quantidade)}</td><td>{i.unidade}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoeda(i.valor_unitario)}</td><td style={{ textAlign: 'right' }}>{fmtMoeda(i.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Produtos: <b>{fmtMoeda(p.valor_produtos)}</b></span>
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
