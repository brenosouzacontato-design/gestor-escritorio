// Cadastros.jsx — formulários de destinatário (cliente do cliente) e produto do app de pedido de NF-e.
import { useState } from 'react';
import { buscarCep, buscarCnpj, fmtMoeda, fmtDocumento, lerNumero, UNIDADES, limparNcm } from './pedidoNfeApi';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const VAZIO_DEST = { documento: '', nome: '', ie: '', email: '', telefone: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '' };

export function Campo({ label, children, flex = 1 }) {
  return (
    <label className="form-field" style={{ flex, minWidth: 0, display: 'block' }}>
      <span className="form-label">{label}</span>
      {children}
    </label>
  );
}

export function FormDestinatario({ inicial, onSalvar, onCancelar, rotuloSalvar = 'Salvar cliente' }) {
  const [d, setD] = useState({ ...VAZIO_DEST, ...(inicial || {}) });
  const [aviso, setAviso] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (e) => setD((x) => ({ ...x, [campo]: e.target.value }));

  const aoSairDocumento = async () => {
    const dig = d.documento.replace(/\D/g, '');
    setD((x) => ({ ...x, documento: fmtDocumento(dig) }));
    if (dig.length !== 14 || d.nome) return;
    setAviso('Buscando o CNPJ...');
    const r = await buscarCnpj(dig);
    setAviso(r ? null : 'Não achei o CNPJ automaticamente; preencha os dados.');
    if (r) setD((x) => ({ ...x, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v && !x[k])) }));
  };

  const aoSairCep = async () => {
    const r = await buscarCep(d.cep);
    // CEP de cidade com logradouro único volta sem rua/bairro: aí mantém o que foi digitado
    if (r) setD((x) => ({ ...x, logradouro: r.logradouro || x.logradouro, bairro: r.bairro || x.bairro, municipio: r.municipio, uf: r.uf }));
  };

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setAviso(null);
    try { await onSalvar(d); } catch (erro) { setAviso(erro.message); } finally { setSalvando(false); }
  };

  return (
    <form onSubmit={salvar} style={{ display: 'grid', gap: 10 }}>
      <div className="form-row">
        <Campo label="CPF ou CNPJ"><input inputMode="numeric" value={d.documento} onChange={muda('documento')} onBlur={aoSairDocumento} required /></Campo>
      </div>
      <Campo label="Nome / razão social"><input value={d.nome} onChange={muda('nome')} required /></Campo>
      <div className="form-row">
        <Campo label="Inscrição estadual"><input value={d.ie} onChange={muda('ie')} placeholder="opcional" /></Campo>
        <Campo label="CEP"><input inputMode="numeric" value={d.cep} onChange={muda('cep')} onBlur={aoSairCep} required /></Campo>
      </div>
      <Campo label="Rua"><input value={d.logradouro} onChange={muda('logradouro')} required /></Campo>
      <div className="form-row">
        <Campo label="Número"><input value={d.numero} onChange={muda('numero')} required /></Campo>
        <Campo label="Complemento" flex={2}><input value={d.complemento} onChange={muda('complemento')} /></Campo>
      </div>
      <Campo label="Bairro"><input value={d.bairro} onChange={muda('bairro')} required /></Campo>
      <div className="form-row">
        <Campo label="Cidade" flex={3}><input value={d.municipio} onChange={muda('municipio')} required /></Campo>
        <Campo label="UF">
          <select value={d.uf} onChange={muda('uf')} required>
            <option value="" />
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
      </div>
      <div className="form-row">
        <Campo label="Telefone"><input inputMode="tel" value={d.telefone || ''} onChange={muda('telefone')} placeholder="opcional" /></Campo>
        <Campo label="E-mail"><input type="email" value={d.email || ''} onChange={muda('email')} placeholder="opcional" /></Campo>
      </div>
      {aviso && <div className="notice notice-warn">{aviso}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancelar && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
        <button type="submit" className="btn btn-accent" disabled={salvando}>{salvando ? 'Salvando...' : rotuloSalvar}</button>
      </div>
    </form>
  );
}

// Unidade em lista (evita digitar a quantidade no lugar da unidade)
export function SelectUnidade({ value, onChange }) {
  const atual = String(value || 'UN').toUpperCase();
  const lista = UNIDADES.some(([u]) => u === atual) ? UNIDADES : [[atual, atual], ...UNIDADES];
  return (
    <select value={atual} onChange={(e) => onChange(e.target.value)}>
      {lista.map(([u, nome]) => <option key={u} value={u}>{u === nome ? u : `${u} – ${nome}`}</option>)}
    </select>
  );
}

export function FormProduto({ inicial, onSalvar, onCancelar }) {
  const [p, setP] = useState({
    descricao: '', codigo: '', ncm: '', unidade: 'UN', ...(inicial || {}),
    valor_unitario: inicial?.valor_unitario != null ? String(inicial.valor_unitario).replace('.', ',') : '',
  });
  const [aviso, setAviso] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (e) => setP((x) => ({ ...x, [campo]: e.target.value }));

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setAviso(null);
    const valor = lerNumero(p.valor_unitario);
    try { await onSalvar({ ...p, valor_unitario: Number.isFinite(valor) ? valor : null }); }
    catch (erro) { setAviso(erro.message); } finally { setSalvando(false); }
  };

  return (
    <form onSubmit={salvar} style={{ display: 'grid', gap: 10 }}>
      <Campo label="Descrição do produto"><input value={p.descricao} onChange={muda('descricao')} required /></Campo>
      <div className="form-row">
        <Campo label="Unidade"><SelectUnidade value={p.unidade} onChange={(v) => setP((x) => ({ ...x, unidade: v }))} /></Campo>
        <Campo label="Valor unitário (R$)"><input inputMode="decimal" value={p.valor_unitario} onChange={muda('valor_unitario')} placeholder="0,00" /></Campo>
      </div>
      <div className="form-row">
        <Campo label="NCM (8 dígitos)"><input inputMode="numeric" value={p.ncm || ''} onChange={(e) => setP((x) => ({ ...x, ncm: limparNcm(e.target.value) }))} placeholder="usado como padrão no pedido" /></Campo>
        <Campo label="Código"><input value={p.codigo || ''} onChange={muda('codigo')} placeholder="opcional" /></Campo>
      </div>
      {aviso && <div className="notice notice-warn">{aviso}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancelar && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
        <button type="submit" className="btn btn-accent" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar produto'}</button>
      </div>
    </form>
  );
}

// Lista de cadastros com editar/excluir
export function ListaCadastros({ destinatarios, produtos, onSalvarDest, onExcluirDest, onSalvarProd, onExcluirProd }) {
  const [aba, setAba] = useState('clientes');
  const [editando, setEditando] = useState(null); // { tipo, item|null }

  if (editando) {
    const fechar = () => setEditando(null);
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="modal-title">{editando.item ? 'Editar' : 'Novo'} {editando.tipo === 'dest' ? 'cliente' : 'produto'}</div>
        {editando.tipo === 'dest'
          ? <FormDestinatario inicial={editando.item} onCancelar={fechar} onSalvar={async (d) => { await onSalvarDest({ ...d, id: editando.item?.id }); fechar(); }} />
          : <FormProduto inicial={editando.item} onCancelar={fechar} onSalvar={async (p) => { await onSalvarProd({ ...p, id: editando.item?.id }); fechar(); }} />}
      </div>
    );
  }

  const excluir = async (fn, item, nome) => {
    if (!window.confirm(`Excluir ${nome}?`)) return;
    try { await fn(item.id); } catch (e) { window.alert(e.message); }
  };

  const linhas = aba === 'clientes'
    ? destinatarios.map((d) => ({ id: d.id, titulo: d.nome, sub: `${fmtDocumento(d.documento)} · ${d.municipio}/${d.uf}`, item: d }))
    : produtos.map((p) => ({ id: p.id, titulo: p.descricao, sub: `${p.unidade}${p.valor_unitario != null ? ` · ${fmtMoeda(p.valor_unitario)}` : ''}${p.ncm ? ` · NCM ${p.ncm}` : ''}`, item: p }));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="tabs">
        <button type="button" className={`tab-btn ${aba === 'clientes' ? 'active' : ''}`} onClick={() => setAba('clientes')}>Meus clientes ({destinatarios.length})</button>
        <button type="button" className={`tab-btn ${aba === 'produtos' ? 'active' : ''}`} onClick={() => setAba('produtos')}>Produtos ({produtos.length})</button>
      </div>
      <button type="button" className="btn btn-accent" onClick={() => setEditando({ tipo: aba === 'clientes' ? 'dest' : 'prod', item: null })}>
        + {aba === 'clientes' ? 'Novo cliente' : 'Novo produto'}
      </button>
      {!linhas.length && <div className="empty" style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Nada cadastrado ainda. O que você usar num pedido fica salvo aqui.</div>}
      {linhas.map((l) => (
        <div key={l.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.titulo}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{l.sub}</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setEditando({ tipo: aba === 'clientes' ? 'dest' : 'prod', item: l.item })}>Editar</button>
          <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
            onClick={() => excluir(aba === 'clientes' ? onExcluirDest : onExcluirProd, l.item, l.titulo)}>Excluir</button>
        </div>
      ))}
    </div>
  );
}
