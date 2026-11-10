// AdmissoesPage.jsx — Clientes → Admissões (gestor).
// Gera o link da ficha de admissão (?admissao=<token>, FichaAdmissaoPage) e
// manda ao funcionário pelo WhatsApp; acompanha quem já preencheu, confere os
// dados e documentos, devolve para correção e baixa a planilha para o OneFlow.
// Tabela em supabase-schema-admissoes.sql; servidor em netlify/functions/admissao.js.
import { useEffect, useMemo, useState } from 'react';
import {
  UserPlusIcon, RefreshCwIcon, CopyIcon, SendIcon, FileSpreadsheetIcon, ChevronDownIcon, ChevronRightIcon,
  Undo2Icon, CheckIcon, XIcon, FileTextIcon, AlertTriangleIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store';
import { useToast, Modal } from '../../components/shared';
import EmpresaCombobox from '../../components/EmpresaCombobox';
import { CAMPOS, STATUS, chamarAdmissao, campoAtivo, mascarar, baixarBase64 } from './admissaoApi';

const FILTROS = [
  ['abertas', 'Em aberto'], ['enviada', 'Recebidas'], ['devolvida', 'Devolvidas'],
  ['concluida', 'Cadastradas'], ['cancelada', 'Canceladas'], ['todas', 'Todas'],
];
const ABERTAS = ['aguardando', 'preenchendo', 'enviada', 'devolvida'];
const linkDe = (a) => `${window.location.origin}/?admissao=${a.token}`;
const fmtData = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const fmtQuando = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmtMoeda = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export default function AdmissoesPage() {
  const { show } = useToast();
  const clientes = useStore((s) => s.clientes);
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState('abertas');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState(null);
  const [selecionadas, setSelecionadas] = useState(new Set());
  const [nova, setNova] = useState(false);
  const [baixando, setBaixando] = useState(false);

  const carregar = async () => {
    setErro(null);
    const { data, error } = await supabase.from('admissoes').select('*, clientes(id, nome, cnpj)').order('criado_em', { ascending: false }).limit(500);
    if (error) {
      setErro(/admissoes/.test(error.message) ? 'Tabela ainda não criada: rode supabase-schema-admissoes.sql no Supabase.' : error.message);
      setLista([]);
      return;
    }
    setLista(data);
  };
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60000);
    return () => clearInterval(t);
  }, []);

  const contagem = useMemo(() => {
    const c = {};
    for (const a of lista || []) c[a.status] = (c[a.status] || 0) + 1;
    c.abertas = ABERTAS.reduce((s, k) => s + (c[k] || 0), 0);
    c.todas = (lista || []).length;
    return c;
  }, [lista]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (lista || []).filter((a) => {
      if (filtro === 'abertas' && !ABERTAS.includes(a.status)) return false;
      if (!['abertas', 'todas'].includes(filtro) && a.status !== filtro) return false;
      return !t || `${a.dados?.nome || a.nome_previsto} ${a.clientes?.nome} ${a.cargo || ''} ${a.dados?.cpf || ''}`.toLowerCase().includes(t);
    });
  }, [lista, filtro, busca]);

  const trocar = (nova) => setLista((l) => l.map((x) => (x.id === nova.id ? nova : x)));

  const atualizar = async (a, mudancas, msg) => {
    const { data, error } = await supabase.from('admissoes').update({ ...mudancas, atualizado_em: new Date().toISOString() })
      .eq('id', a.id).select('*, clientes(id, nome, cnpj)').single();
    if (error) { show('Erro: ' + error.message); return; }
    trocar(data);
    show(msg);
  };

  const acao = async (nome, dados, msgOk) => {
    try {
      const r = await chamarAdmissao(nome, dados);
      if (r.whatsapp) show(r.whatsapp.ok ? msgOk : `WhatsApp não foi: ${r.whatsapp.erro}`);
      if (r.admissao) trocar(r.admissao);
      return r;
    } catch (e) { show('Erro: ' + e.message); return null; }
  };

  const baixarPlanilha = async (ids) => {
    if (!ids.length) { show('Marque ao menos uma admissão.'); return; }
    setBaixando(true);
    try {
      const { arquivo, nome } = await chamarAdmissao('planilha', { ids });
      baixarBase64(arquivo, nome);
    } catch (e) { show('Erro: ' + e.message); } finally { setBaixando(false); }
  };

  const marcar = (id) => setSelecionadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <UserPlusIcon size={22} />
        <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>Admissões</h1>
        <button type="button" className="btn btn-sm" onClick={carregar} title="Atualizar"><RefreshCwIcon size={15} /></button>
        <button type="button" className="btn btn-sm" disabled={baixando || !selecionadas.size} onClick={() => baixarPlanilha([...selecionadas])}
          title="Planilha com os dados, dependentes e links dos documentos, para importar no OneFlow">
          <FileSpreadsheetIcon size={15} /> {baixando ? 'Gerando…' : `Planilha OneFlow${selecionadas.size ? ` (${selecionadas.size})` : ''}`}
        </button>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => setNova(true)}><UserPlusIcon size={15} /> Nova admissão</button>
      </div>
      <p style={{ color: 'var(--text3)', fontSize: 13, marginTop: -6 }}>
        Gere o link e mande ao funcionário: ele preenche a ficha e fotografa os documentos pelo celular, e recebe o resumo no WhatsApp.
      </p>

      {erro && <div className="notice notice-warn" style={{ marginBottom: 12 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="tabs">
          {FILTROS.map(([id, rotulo]) => (
            <button key={id} type="button" className={`tab-btn ${filtro === id ? 'active' : ''}`} onClick={() => setFiltro(id)}>
              {rotulo}{contagem[id] ? ` (${contagem[id]})` : ''}
            </button>
          ))}
        </div>
        <input placeholder="Buscar nome, empresa, CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 260 }} />
      </div>

      {lista === null ? <div className="center"><div className="spinner" /></div> : visiveis.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>Nenhuma admissão aqui.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {visiveis.map((a) => (
            <LinhaAdmissao key={a.id} a={a} aberta={aberta === a.id} selecionada={selecionadas.has(a.id)}
              onMarcar={() => marcar(a.id)} onAbrir={() => setAberta(aberta === a.id ? null : a.id)}
              onAcao={acao} onAtualizar={atualizar} onPlanilha={() => baixarPlanilha([a.id])} show={show} />
          ))}
        </div>
      )}

      {nova && <NovaAdmissao clientes={clientes} onFechar={() => setNova(false)} onCriada={(adm) => { setLista((l) => [adm, ...(l || [])]); setFiltro('abertas'); }} show={show} />}
    </div>
  );
}

function SeloStatus({ status }) {
  const s = STATUS[status] || { label: status, cor: 'var(--text3)' };
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.cor, border: `1px solid ${s.cor}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function LinhaAdmissao({ a, aberta, selecionada, onMarcar, onAbrir, onAcao, onAtualizar, onPlanilha, show }) {
  const nome = a.dados?.nome || a.nome_previsto;
  const nDocs = (a.documentos || []).length;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(linkDe(a)); show('Link copiado.'); } catch { window.prompt('Copie o link:', linkDe(a)); }
  };
  const devolver = async () => {
    const motivo = window.prompt('O que o funcionário precisa corrigir? (vai pelo WhatsApp com o link)');
    if (motivo?.trim()) await onAcao('devolver', { id: a.id, motivo }, 'Devolvido. Funcionário avisado pelo WhatsApp.');
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <input type="checkbox" checked={selecionada} onChange={onMarcar} title="Incluir na planilha" />
        <button type="button" onClick={onAbrir} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
          {aberta ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.clientes?.nome}{a.cargo ? ` · ${a.cargo}` : ''}{a.data_admissao ? ` · admissão ${fmtData(a.data_admissao)}` : ''}
              {a.enviado_em ? ` · recebida ${fmtQuando(a.enviado_em)}` : ` · criada ${fmtQuando(a.criado_em)}`}
            </div>
          </div>
        </button>
        {a.whatsapp_erro && a.status === 'enviada' && <AlertTriangleIcon size={15} color="var(--warn)" title={`Resumo não chegou: ${a.whatsapp_erro}`} />}
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{nDocs} doc{nDocs === 1 ? '' : 's'}</span>
        <SeloStatus status={a.status} />
      </div>

      {aberta && (
        <div style={{ padding: '0 12px 14px 40px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" className="btn btn-sm" onClick={copiar}><CopyIcon size={14} /> Copiar link</button>
            {['aguardando', 'preenchendo', 'devolvida'].includes(a.status) && (
              <button type="button" className="btn btn-sm" onClick={() => onAcao('enviar_link', { id: a.id }, 'Link enviado pelo WhatsApp.')}><SendIcon size={14} /> Mandar link no WhatsApp</button>
            )}
            {a.enviado_em && <button type="button" className="btn btn-sm" onClick={() => onAcao('reenviar_resumo', { id: a.id }, 'Resumo reenviado.')}><SendIcon size={14} /> Reenviar resumo</button>}
            <button type="button" className="btn btn-sm" onClick={onPlanilha}><FileSpreadsheetIcon size={14} /> Planilha</button>
            {['enviada', 'concluida'].includes(a.status) && <button type="button" className="btn btn-sm" onClick={devolver}><Undo2Icon size={14} /> Devolver para corrigir</button>}
            {a.status === 'enviada' && (
              <button type="button" className="btn btn-sm btn-ok" onClick={() => onAtualizar(a, { status: 'concluida', concluida_em: new Date().toISOString() }, 'Marcada como cadastrada no OneFlow.')}>
                <CheckIcon size={14} /> Cadastrada no OneFlow
              </button>
            )}
            {a.status !== 'cancelada' && a.status !== 'concluida' && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.confirm(`Cancelar a admissão de ${nome}? O link para de funcionar.`) && onAtualizar(a, { status: 'cancelada' }, 'Admissão cancelada.')}>
                <XIcon size={14} /> Cancelar
              </button>
            )}
            {a.status === 'cancelada' && <button type="button" className="btn btn-sm" onClick={() => onAtualizar(a, { status: a.enviado_em ? 'enviada' : 'preenchendo', expira_em: new Date(Date.now() + 30 * 864e5).toISOString() }, 'Admissão reaberta.')}>Reabrir</button>}
          </div>
          {a.status === 'devolvida' && a.motivo_devolucao && <div className="notice notice-warn" style={{ marginBottom: 10 }}>Devolvida: {a.motivo_devolucao}</div>}
          {a.whatsapp_erro && <div className="notice notice-warn" style={{ marginBottom: 10 }}>WhatsApp: {a.whatsapp_erro}</div>}
          <DetalheFicha a={a} show={show} />
        </div>
      )}
    </div>
  );
}

function DetalheFicha({ a, show }) {
  const d = a.dados || {};
  const abrir = async (doc) => {
    const aba = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('documentos').createSignedUrl(doc.path, 600);
    if (error) { aba?.close(); show('Erro: ' + error.message); return; }
    if (aba) aba.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank');
  };
  const mostrar = (c, v) => (c.tipo === 'data' ? fmtData(v) : ['cpf', 'pis', 'cep', 'telefone'].includes(c.tipo) ? mascarar(c.tipo, v) : v);
  const interno = [
    ['WhatsApp informado', a.telefone ? mascarar('telefone', a.telefone) : ''], ['Salário', fmtMoeda(a.salario)],
    ['Jornada', a.jornada], ['Observação interna', a.observacao_interna],
    ['Link enviado', fmtQuando(a.link_enviado_em)], ['Resumo no WhatsApp', fmtQuando(a.whatsapp_enviado_em)],
  ].filter(([, v]) => v);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {interno.length > 0 && <Bloco titulo="Do escritório">{interno.map(([k, v]) => <Item key={k} k={k} v={v} />)}</Bloco>}
      {CAMPOS.secoes.map((s) => {
        const itens = s.campos.filter((c) => campoAtivo(c, d) && d[c.id]);
        return itens.length ? <Bloco key={s.id} titulo={s.titulo}>{itens.map((c) => <Item key={c.id} k={c.rotulo} v={mostrar(c, d[c.id])} />)}</Bloco> : null;
      })}
      {(d.dependentes || []).length > 0 && (
        <Bloco titulo="Dependentes">
          {d.dependentes.map((dep, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <b>{dep.nome}</b> — {dep.parentesco}, {fmtData(dep.data_nascimento)}{dep.cpf ? `, CPF ${mascarar('cpf', dep.cpf)}` : ''}
              {(dep.irrf || dep.salario_familia) && <span style={{ color: 'var(--text3)' }}> ({[dep.irrf && 'IR', dep.salario_familia && 'sal.-família'].filter(Boolean).join(', ')})</span>}
            </div>
          ))}
        </Bloco>
      )}
      <Bloco titulo="Documentos anexados">
        {(a.documentos || []).length === 0 ? <span style={{ color: 'var(--text3)' }}>Nenhum ainda.</span> : CAMPOS.anexos.map((an) => {
          const docs = (a.documentos || []).filter((x) => x.tipo === an.id);
          return docs.length ? (
            <div key={an.id} style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--text3)' }}>{an.rotulo}:</span>{' '}
              {docs.map((doc, i) => (
                <button key={doc.path} type="button" className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} onClick={() => abrir(doc)}>
                  <FileTextIcon size={13} /> {i + 1}
                </button>
              ))}
            </div>
          ) : null;
        })}
      </Bloco>
    </div>
  );
}

const Bloco = ({ titulo, children }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 10, fontSize: 13 }}>
    <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{titulo}</div>
    {children}
  </div>
);
const Item = ({ k, v }) => <div style={{ marginBottom: 2 }}><span style={{ color: 'var(--text3)' }}>{k}:</span> {v}</div>;

function NovaAdmissao({ clientes, onFechar, onCriada, show }) {
  const [f, setF] = useState({ cliente_id: '', nome: '', telefone: '', cargo: '', salario: '', data_admissao: '', jornada: '', observacao: '', enviar_whatsapp: true });
  const [salvando, setSalvando] = useState(false);
  const [criada, setCriada] = useState(null);
  const muda = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const criar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await chamarAdmissao('criar', f);
      onCriada(r.admissao);
      setCriada(r);
      if (r.whatsapp && !r.whatsapp.ok) show(`Admissão criada, mas o WhatsApp não foi: ${r.whatsapp.erro}`);
    } catch (err) { show('Erro: ' + err.message); } finally { setSalvando(false); }
  };

  if (criada) {
    const link = linkDe(criada.admissao);
    return (
      <Modal onClose={onFechar}>
        <div style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Link criado</h2>
          {criada.whatsapp?.ok && <div className="notice notice-ok" style={{ marginBottom: 12 }}>Enviado no WhatsApp do funcionário.</div>}
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>Se preferir, copie e mande você mesmo. O link vale 30 dias.</p>
          <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); show('Link copiado.'); } catch { /* campo já selecionável */ } }}><CopyIcon size={14} /> Copiar</button>
            <button type="button" className="btn btn-accent" onClick={onFechar}>Pronto</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onFechar}>
      <form onSubmit={criar} style={{ padding: 20, maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Nova admissão</h2>
        <div className="form-field" style={{ marginBottom: 10 }}><span className="form-label">Empresa que vai contratar *</span>
          <EmpresaCombobox empresas={clientes} value={f.cliente_id} onChange={(id) => setF((x) => ({ ...x, cliente_id: id }))} /></div>
        <div className="form-row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 2 }}><span className="form-label">Nome do funcionário *</span><input value={f.nome} onChange={muda('nome')} required /></label>
          <label className="form-field" style={{ flex: 1 }}><span className="form-label">WhatsApp</span>
            <input inputMode="numeric" value={mascarar('telefone', f.telefone)} onChange={(e) => setF((x) => ({ ...x, telefone: e.target.value.replace(/\D/g, '') }))} placeholder="(00) 00000-0000" /></label>
        </div>
        <div className="form-row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 2 }}><span className="form-label">Cargo</span><input value={f.cargo} onChange={muda('cargo')} /></label>
          <label className="form-field" style={{ flex: 1 }}><span className="form-label">Salário</span><input inputMode="decimal" value={f.salario} onChange={muda('salario')} placeholder="0,00" /></label>
        </div>
        <div className="form-row" style={{ gap: 10 }}>
          <label className="form-field" style={{ flex: 1 }}><span className="form-label">Data de admissão</span><input type="date" value={f.data_admissao} onChange={muda('data_admissao')} /></label>
          <label className="form-field" style={{ flex: 2 }}><span className="form-label">Jornada</span><input value={f.jornada} onChange={muda('jornada')} placeholder="Ex.: 44h, seg a sex 8h–18h" /></label>
        </div>
        <label className="form-field"><span className="form-label">Observação interna (o funcionário não vê)</span><textarea rows={2} value={f.observacao} onChange={muda('observacao')} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 14 }}>
          <input type="checkbox" checked={f.enviar_whatsapp} onChange={muda('enviar_whatsapp')} /> Mandar o link no WhatsApp do funcionário agora
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-accent" disabled={salvando || !f.cliente_id}>{salvando ? 'Criando…' : 'Gerar link'}</button>
        </div>
      </form>
    </Modal>
  );
}
