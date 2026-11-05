// PedidoNfePage.jsx — app do cliente para pedir NF-e de venda (?pedido=<token do painel>).
// Instalável no celular (public/pedido-nfe.webmanifest + painel-sw.js). O cliente escolhe ou cadastra
// quem compra, monta os itens (produtos salvos ficam para a próxima), frete e observação. O pedido vai
// para o escritório (Fiscal → Pedidos de NF-e) e o resumo chega pelo WhatsApp.
// Tudo passa por netlify/functions/nfe-solicitacao.js.
import { useEffect, useMemo, useState } from 'react';
import AcessoPainel from '../painel/AcessoPainel';
import { FormDestinatario, ListaCadastros, Campo } from './Cadastros';
import { chamarPedidoNfe, FRETES, STATUS, fmtMoeda, fmtQuando, fmtDocumento, lerNumero, numeroPedido } from './pedidoNfeApi';

// O Chrome oferece a instalação uma vez, cedo: guarda o convite para o botão "Instalar".
let convite = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    convite = e;
    window.dispatchEvent(new Event('pedido-instalavel'));
  });
}
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ESTILO = `
.pnfe { max-width: 560px; margin: 0 auto; padding: 16px 14px 96px; }
.pnfe input, .pnfe select, .pnfe textarea { font-size: 16px; }
.pnfe .card { border-radius: var(--r-md); }
.pnfe-rodape { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--border);
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); box-shadow: var(--shadow-md); }
.pnfe-rodape > div { max-width: 560px; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
.pnfe h3 { font-size: 13px; font-weight: 700; color: var(--text2); margin: 4px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
`;

const itemVazio = () => ({ chave: Math.random().toString(36).slice(2), produto_id: null, descricao: '', unidade: 'UN', ncm: '', quantidade: '1', valor_unitario: '' });

export default function PedidoNfePage({ token }) {
  return <AcessoPainel valor={token}>{(sessao) => <AppPedido sessao={sessao} />}</AcessoPainel>;
}

function AppPedido({ sessao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState('novo');
  const [podeInstalar, setPodeInstalar] = useState(!!convite);
  const [enviado, setEnviado] = useState(null);

  const carregar = async () => {
    try { setDados(await chamarPedidoNfe('iniciar')); setErro(null); } catch (e) { setErro(e.message); }
  };
  useEffect(() => {
    document.title = 'Pedir nota fiscal';
    navigator.serviceWorker?.register('/painel-sw.js').catch(() => {});
    const quando = () => setPodeInstalar(true);
    window.addEventListener('pedido-instalavel', quando);
    carregar();
    return () => window.removeEventListener('pedido-instalavel', quando);
  }, []);

  const instalar = async () => {
    if (!convite) return;
    convite.prompt();
    await convite.userChoice.catch(() => null);
    convite = null;
    setPodeInstalar(false);
  };

  const salvarDest = async (d) => {
    const { destinatario } = await chamarPedidoNfe('salvar_destinatario', { destinatario: d });
    setDados((x) => ({ ...x, destinatarios: [...x.destinatarios.filter((o) => o.id !== destinatario.id), destinatario].sort((a, b) => a.nome.localeCompare(b.nome)) }));
    return destinatario;
  };
  const salvarProd = async (p) => {
    const { produto } = await chamarPedidoNfe('salvar_produto', { produto: p });
    setDados((x) => ({ ...x, produtos: [...x.produtos.filter((o) => o.id !== produto.id), produto].sort((a, b) => a.descricao.localeCompare(b.descricao)) }));
  };
  const excluirDe = (acao, lista) => async (id) => {
    await chamarPedidoNfe(acao, { id });
    setDados((x) => ({ ...x, [lista]: x[lista].filter((o) => o.id !== id) }));
  };

  const nomeEmpresa = dados?.empresa?.nome || sessao?.nome || '';

  return (
    <div className="pnfe">
      <style>{ESTILO}</style>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text1)' }}>Pedir nota fiscal</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeEmpresa}</div>
        </div>
        {podeInstalar && !instalado() && <button type="button" className="btn btn-sm btn-accent" onClick={instalar}>Instalar app</button>}
      </header>
      {ehIOS() && !instalado() && (
        <div className="notice notice-info" style={{ marginBottom: 12, fontSize: 12 }}>
          Para instalar no iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 14 }}>
        {[['novo', 'Novo pedido'], ['pedidos', 'Meus pedidos'], ['cadastros', 'Cadastros']].map(([id, rotulo]) => (
          <button key={id} type="button" className={`tab-btn ${aba === id ? 'active' : ''}`} onClick={() => { setAba(id); setEnviado(null); if (id === 'pedidos') carregar(); }}>{rotulo}</button>
        ))}
      </div>

      {erro && <div className="notice notice-warn" style={{ marginBottom: 12 }}>{erro} <button type="button" className="btn btn-sm" onClick={carregar}>Tentar de novo</button></div>}
      {!dados && !erro && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>Carregando...</div>}

      {dados && aba === 'novo' && (enviado
        ? <Enviado resultado={enviado} onNovo={() => setEnviado(null)} onVer={() => { setEnviado(null); setAba('pedidos'); carregar(); }} />
        : <NovoPedido dados={dados} salvarDest={salvarDest} onEnviado={(r) => { setEnviado(r); carregar(); }} />)}

      {dados && aba === 'pedidos' && <MeusPedidos pedidos={dados.pedidos} />}

      {dados && aba === 'cadastros' && (
        <ListaCadastros destinatarios={dados.destinatarios} produtos={dados.produtos}
          onSalvarDest={salvarDest} onExcluirDest={excluirDe('excluir_destinatario', 'destinatarios')}
          onSalvarProd={salvarProd} onExcluirProd={excluirDe('excluir_produto', 'produtos')} />
      )}
    </div>
  );
}

function NovoPedido({ dados, salvarDest, onEnviado }) {
  const [destId, setDestId] = useState('');
  const [novoDest, setNovoDest] = useState(false);
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState([itemVazio()]);
  const [frete, setFrete] = useState('sem_frete');
  const [freteValor, setFreteValor] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const dest = dados.destinatarios.find((d) => d.id === destId) || null;
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const soDigitos = t.replace(/\D/g, '');
    return t ? dados.destinatarios.filter((d) => d.nome.toLowerCase().includes(t) || (soDigitos && (d.documento || '').includes(soDigitos)))
      : dados.destinatarios;
  }, [busca, dados.destinatarios]);
  const porDescricao = useMemo(() => new Map(dados.produtos.map((p) => [p.descricao.trim().toLowerCase(), p])), [dados.produtos]);

  const mudaItem = (chave, campo, valor) => setItens((lista) => lista.map((i) => {
    if (i.chave !== chave) return i;
    const novo = { ...i, [campo]: valor };
    if (campo === 'descricao') {
      const salvo = porDescricao.get(valor.trim().toLowerCase());
      if (salvo) Object.assign(novo, {
        produto_id: salvo.id, unidade: salvo.unidade || 'UN', ncm: salvo.ncm || '',
        valor_unitario: salvo.valor_unitario != null ? String(salvo.valor_unitario).replace('.', ',') : i.valor_unitario,
      });
      else novo.produto_id = null;
    }
    return novo;
  }));

  const totalItem = (i) => { const q = lerNumero(i.quantidade); const v = lerNumero(i.valor_unitario); return Number.isFinite(q * v) ? Math.round(q * v * 100) / 100 : 0; };
  const totalProdutos = itens.reduce((s, i) => s + totalItem(i), 0);
  const valorFrete = frete === 'sem_frete' ? 0 : (lerNumero(freteValor) || 0);
  const total = totalProdutos + valorFrete;

  const enviar = async () => {
    setAviso(null);
    if (!dest) { setAviso('Escolha para quem é a nota.'); return; }
    const preenchidos = itens.filter((i) => i.descricao.trim());
    if (!preenchidos.length) { setAviso('Inclua pelo menos um produto.'); return; }
    setEnviando(true);
    try {
      const r = await chamarPedidoNfe('enviar', {
        destinatario: dest,
        itens: preenchidos.map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, unidade: i.unidade, ncm: i.ncm, quantidade: lerNumero(i.quantidade), valor_unitario: lerNumero(i.valor_unitario) })),
        frete_modalidade: frete, frete_valor: valorFrete, observacao: obs,
      });
      onEnviado(r);
    } catch (e) { setAviso(e.message); } finally { setEnviando(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section>
        <h3>1. Para quem é a nota?</h3>
        {novoDest ? (
          <div className="card" style={{ padding: 14 }}>
            <FormDestinatario rotuloSalvar="Usar este cliente" onCancelar={() => setNovoDest(false)}
              onSalvar={async (d) => { const salvo = await salvarDest(d); setDestId(salvo.id); setNovoDest(false); }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {dados.destinatarios.length > 8 && <input placeholder="Buscar cliente por nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />}
            {dados.destinatarios.length > 0 && (
              <select value={destId} onChange={(e) => setDestId(e.target.value)}>
                <option value="">Escolha um cliente salvo...</option>
                {filtrados.map((d) => <option key={d.id} value={d.id}>{d.nome} — {fmtDocumento(d.documento)}</option>)}
              </select>
            )}
            {dest && (
              <div className="card" style={{ padding: 10, fontSize: 12, color: 'var(--text2)' }}>
                {fmtDocumento(dest.documento)}{dest.ie ? ` · IE ${dest.ie}` : ''}<br />
                {[dest.logradouro, dest.numero].filter(Boolean).join(', ')}{dest.complemento ? ` – ${dest.complemento}` : ''} – {dest.bairro} – {dest.municipio}/{dest.uf}
              </div>
            )}
            <button type="button" className="btn" onClick={() => setNovoDest(true)}>+ Novo cliente</button>
          </div>
        )}
      </section>

      <section>
        <h3>2. Produtos</h3>
        <datalist id="pnfe-produtos">{dados.produtos.map((p) => <option key={p.id} value={p.descricao} />)}</datalist>
        <div style={{ display: 'grid', gap: 10 }}>
          {itens.map((i, n) => (
            <div key={i.chave} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>Item {n + 1}</span>
                <span style={{ flex: 1 }} />
                {itens.length > 1 && <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setItens((l) => l.filter((x) => x.chave !== i.chave))}>Remover</button>}
              </div>
              <Campo label="Produto"><input list="pnfe-produtos" value={i.descricao} onChange={(e) => mudaItem(i.chave, 'descricao', e.target.value)} placeholder="Digite ou escolha um produto salvo" /></Campo>
              <div className="form-row">
                <Campo label="Quantidade"><input inputMode="decimal" value={i.quantidade} onChange={(e) => mudaItem(i.chave, 'quantidade', e.target.value)} /></Campo>
                <Campo label="Unidade"><input value={i.unidade} onChange={(e) => mudaItem(i.chave, 'unidade', e.target.value)} /></Campo>
                <Campo label="Valor unit. (R$)" flex={1.4}><input inputMode="decimal" value={i.valor_unitario} onChange={(e) => mudaItem(i.chave, 'valor_unitario', e.target.value)} placeholder="0,00" /></Campo>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text2)' }}>Subtotal: <b>{fmtMoeda(totalItem(i))}</b></div>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setItens((l) => [...l, itemVazio()])}>+ Adicionar produto</button>
        </div>
      </section>

      <section>
        <h3>3. Frete e observação</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="form-row">
            <Campo label="Frete" flex={2}>
              <select value={frete} onChange={(e) => setFrete(e.target.value)}>{FRETES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
            </Campo>
            {frete !== 'sem_frete' && <Campo label="Valor do frete (R$)"><input inputMode="decimal" value={freteValor} onChange={(e) => setFreteValor(e.target.value)} placeholder="0,00" /></Campo>}
          </div>
          <Campo label="Observação"><textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Forma de pagamento, prazo, informação para a nota..." /></Campo>
        </div>
      </section>

      {aviso && <div className="notice notice-warn">{aviso}</div>}

      <div className="pnfe-rodape">
        <div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total da nota</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtMoeda(total)}</div>
          </div>
          <button type="button" className="btn btn-accent" style={{ padding: '12px 22px', fontSize: 15 }} disabled={enviando} onClick={enviar}>
            {enviando ? 'Enviando...' : 'Enviar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Enviado({ resultado, onNovo, onVer }) {
  const { pedido, whatsapp } = resultado;
  return (
    <div className="card" style={{ padding: 20, textAlign: 'center', display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Pedido enviado</div>
      <div style={{ color: 'var(--text2)', fontSize: 14 }}>
        Pedido {numeroPedido(pedido.id)} · {fmtMoeda(pedido.valor_total)}<br />para {pedido.destinatario.nome}
      </div>
      {whatsapp?.ok
        ? <div className="notice notice-ok">O resumo foi enviado pelo WhatsApp. Assim que a nota for emitida, ela chega por lá.</div>
        : <div className="notice notice-warn">O escritório recebeu o pedido, mas o resumo não foi pelo WhatsApp agora. Não precisa mandar de novo.</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button type="button" className="btn" onClick={onVer}>Meus pedidos</button>
        <button type="button" className="btn btn-accent" onClick={onNovo}>Novo pedido</button>
      </div>
    </div>
  );
}

function MeusPedidos({ pedidos }) {
  if (!pedidos.length) return <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 30, fontSize: 13 }}>Nenhum pedido ainda.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {pedidos.map((p) => {
        const s = STATUS[p.status] || STATUS.recebida;
        return (
          <div key={p.id} className="card" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.destinatario?.nome}</b>
              <span className="badge" style={{ color: s.cor, background: s.fundo }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              Pedido {numeroPedido(p.id)} · {fmtQuando(p.criado_em)} · <b style={{ color: 'var(--text1)' }}>{fmtMoeda(p.valor_total)}</b>
              {p.nfe_numero ? ` · NF ${p.nfe_numero}` : ''}
            </div>
            {p.status_mensagem && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{p.status_mensagem}</div>}
          </div>
        );
      })}
    </div>
  );
}
