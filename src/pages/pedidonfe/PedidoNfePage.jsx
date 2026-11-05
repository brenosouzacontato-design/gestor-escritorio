// PedidoNfePage.jsx — app do cliente para pedir NF-e de venda (?pedido=<token do painel>).
// Instalável no celular (public/pedido-nfe.webmanifest + painel-sw.js). O cliente escolhe ou cadastra
// quem compra, monta os itens (produtos salvos ficam para a próxima), desconto, frete e observação.
// No celular o pedido vai em etapas, como no Emissor Nacional (Cliente → Produtos → Valores → Emitir,
// com o resumo no fim); no computador, tudo numa página. O pedido vai para o escritório
// (Fiscal → Pedidos de NF-e) e o resumo chega pelo WhatsApp.
// Tudo passa por netlify/functions/nfe-solicitacao.js.
import { useEffect, useMemo, useState } from 'react';
import AcessoPainel from '../painel/AcessoPainel';
import { FormDestinatario, ListaCadastros, Campo, SelectUnidade } from './Cadastros';
import {
  chamarPedidoNfe, FRETES, STATUS, fmtMoeda, fmtQuando, fmtDocumento, lerNumero, numeroPedido, calcularPedido, descontoParaEnvio, limparNcm,
} from './pedidoNfeApi';

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
.pnfe-passos { display: flex; }
.pnfe-passo { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; padding: 0; cursor: pointer; position: relative; }
.pnfe-passo:disabled { cursor: default; }
.pnfe-passo + .pnfe-passo::before { content: ''; position: absolute; top: 14px; right: 50%; left: -50%; height: 2px; background: var(--border); }
.pnfe-passo.feito::before, .pnfe-passo.atual::before { background: var(--accent); }
.pnfe-passo .bola { position: relative; z-index: 1; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  font-size: 13px; font-weight: 800; background: var(--surface2); color: var(--text3); border: 2px solid var(--border); }
.pnfe-passo.atual .bola { background: var(--accent); color: #fff; border-color: var(--accent); }
.pnfe-passo.feito .bola { background: var(--surface); color: var(--accent); border-color: var(--accent); }
.pnfe-passo .nome { font-size: 11px; color: var(--text3); font-weight: 600; }
.pnfe-passo.atual .nome { color: var(--text1); }
.pnfe h3 { font-size: 13px; font-weight: 700; color: var(--text2); margin: 4px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
`;

const itemVazio = () => ({ chave: Math.random().toString(36).slice(2), produto_id: null, descricao: '', unidade: 'UN', ncm: '', quantidade: '1', valor_unitario: '', desconto: '', desconto_tipo: 'R$' });

export default function PedidoNfePage({ token }) {
  return <AcessoPainel valor={token}>{(sessao) => <AppPedido sessao={sessao} />}</AcessoPainel>;
}

function AppPedido({ sessao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState('novo');
  const [podeInstalar, setPodeInstalar] = useState(!!convite);
  const [enviado, setEnviado] = useState(null);
  const [corrigindo, setCorrigindo] = useState(null); // pedido com pendência sendo corrigido

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
          <button key={id} type="button" className={`tab-btn ${aba === id ? 'active' : ''}`} onClick={() => { setAba(id); setEnviado(null); setCorrigindo(null); if (id === 'pedidos') carregar(); }}>{rotulo}</button>
        ))}
      </div>

      {erro && <div className="notice notice-warn" style={{ marginBottom: 12 }}>{erro} <button type="button" className="btn btn-sm" onClick={carregar}>Tentar de novo</button></div>}
      {!dados && !erro && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>Carregando...</div>}

      {dados && aba === 'novo' && (enviado
        ? <Enviado resultado={enviado} onNovo={() => setEnviado(null)} onVer={() => { setEnviado(null); setAba('pedidos'); carregar(); }} />
        : <NovoPedido key={corrigindo?.id || 'novo'} dados={dados} salvarDest={salvarDest} inicial={corrigindo}
            onCancelar={corrigindo ? () => { setCorrigindo(null); setAba('pedidos'); } : null}
            onEnviado={(r) => { setEnviado(r); setCorrigindo(null); carregar(); }} />)}

      {dados && aba === 'pedidos' && <MeusPedidos pedidos={dados.pedidos} onCorrigir={(p) => { setCorrigindo(p); setEnviado(null); setAba('novo'); window.scrollTo({ top: 0 }); }} />}

      {dados && aba === 'cadastros' && (
        <ListaCadastros destinatarios={dados.destinatarios} produtos={dados.produtos}
          onSalvarDest={salvarDest} onExcluirDest={excluirDe('excluir_destinatario', 'destinatarios')}
          onSalvarProd={salvarProd} onExcluirProd={excluirDe('excluir_produto', 'produtos')} />
      )}
    </div>
  );
}

// Etapas do pedido (no celular, uma tela por etapa; no computador, tudo numa página)
const ETAPAS = [
  { id: 'cliente', curto: 'Cliente', titulo: 'Para quem é a nota?' },
  { id: 'produtos', curto: 'Produtos', titulo: 'O que foi vendido?' },
  { id: 'valores', curto: 'Valores', titulo: 'Desconto, frete e observação' },
  { id: 'revisar', curto: 'Emitir', titulo: 'Confira e peça a emissão' },
];

const CONSULTA_CELULAR = '(max-width: 720px)';
function useCelular() {
  const [celular, setCelular] = useState(() => window.matchMedia?.(CONSULTA_CELULAR).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_CELULAR);
    if (!mq) return undefined;
    const muda = () => setCelular(mq.matches);
    mq.addEventListener?.('change', muda);
    return () => mq.removeEventListener?.('change', muda);
  }, []);
  return celular;
}

// Valor + escolha R$ / % (o teclado numérico do celular não tem %)
function CampoDesconto({ valor, tipo, onValor, onTipo }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input inputMode="decimal" value={valor} onChange={(e) => onValor(e.target.value)} placeholder={tipo === '%' ? '0' : '0,00'} style={{ flex: 1, minWidth: 0 }} />
      <div className="tabs" style={{ flexShrink: 0, margin: 0 }}>
        {['R$', '%'].map((t) => (
          <button key={t} type="button" className={`tab-btn ${tipo === t ? 'active' : ''}`} style={{ padding: '6px 12px' }} onClick={() => onTipo(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}

function Passos({ atual, maximo, onIr }) {
  return (
    <div className="pnfe-passos">
      {ETAPAS.map((e, n) => {
        const estado = n === atual ? 'atual' : n < atual ? 'feito' : '';
        return (
          <button key={e.id} type="button" className={`pnfe-passo ${estado}`} disabled={n > maximo || n === atual} onClick={() => onIr(n)}
            aria-label={`Etapa ${n + 1}: ${e.curto}`} aria-current={n === atual ? "step" : undefined}>
            <span className="bola">{n < atual ? '✓' : n + 1}</span>
            <span className="nome">{e.curto}</span>
          </button>
        );
      })}
    </div>
  );
}

// Pedido gravado → itens do formulário (correção). O desconto gravado já inclui a parte do desconto da nota.
const paraTexto = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
const itensDoPedido = (p) => (p?.itens?.length ? p.itens.map((i) => ({
  ...itemVazio(), produto_id: i.produto_id || null, descricao: i.descricao || '', unidade: i.unidade || 'UN', ncm: i.ncm || '',
  quantidade: paraTexto(i.quantidade), valor_unitario: paraTexto(i.valor_unitario), desconto: Number(i.desconto) > 0 ? paraTexto(i.desconto) : '',
})) : [itemVazio()]);

function NovoPedido({ dados, salvarDest, onEnviado, inicial = null, onCancelar = null }) {
  const celular = useCelular();
  const [etapa, setEtapa] = useState(0);
  const [maxEtapa, setMaxEtapa] = useState(inicial ? ETAPAS.length - 1 : 0);
  const [destId, setDestId] = useState(() => {
    const doc = inicial?.destinatario?.documento;
    return (doc && dados.destinatarios.find((d) => d.documento === doc)?.id) || '';
  });
  const [novoDest, setNovoDest] = useState(false);
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState(() => itensDoPedido(inicial));
  const [geral, setGeral] = useState({ valor: '', tipo: 'R$' });
  const [frete, setFrete] = useState(inicial?.frete_modalidade || 'sem_frete');
  const [freteValor, setFreteValor] = useState(Number(inicial?.frete_valor) > 0 ? paraTexto(inicial.frete_valor) : '');
  const [obs, setObs] = useState(inicial?.observacao || '');
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

  const valorFrete = frete === 'sem_frete' ? 0 : (lerNumero(freteValor) || 0);
  const preenchidos = itens.filter((i) => i.descricao.trim());
  const conta = calcularPedido(preenchidos, geral, valorFrete);
  const contaItens = calcularPedido(itens);
  const invalido = (v) => String(v ?? '').trim() !== '' && !Number.isFinite(lerNumero(v));

  // O que impede de seguir em cada etapa (null = pode seguir)
  const problema = (n) => {
    if (n === 0) {
      if (novoDest) return 'Salve o cliente novo (ou cancele) antes de seguir.';
      if (!dest) return 'Escolha para quem é a nota.';
    }
    if (n === 1) {
      if (!preenchidos.length) return 'Inclua pelo menos um produto.';
      for (const [k, i] of itens.entries()) {
        if (!i.descricao.trim()) continue;
        const nome = `item ${k + 1} (${i.descricao.trim()})`;
        if (!(lerNumero(i.quantidade) > 0)) return `Informe a quantidade do ${nome}.`;
        if (!(lerNumero(i.valor_unitario) > 0)) return `Informe o valor do ${nome}.`;
        if (limparNcm(i.ncm).length !== 8) return `Informe o NCM (8 dígitos) do ${nome}. Se não souber, peça ao escritório.`;
        if (invalido(i.desconto)) return `Desconto do ${nome} inválido.`;
        const c = contaItens.porItem[i.chave];
        if (c.descontoItem > 0 && c.descontoItem >= c.bruto) return `O desconto do ${nome} é maior que o valor dele.`;
      }
    }
    if (n === 2) {
      if (invalido(geral.valor)) return 'Desconto da nota inválido.';
      if (conta.descontoGeral > 0 && conta.descontoGeral >= conta.liquidoAntesGeral) return 'O desconto é maior que o valor dos produtos.';
      if (frete !== 'sem_frete' && invalido(freteValor)) return 'Valor do frete inválido.';
    }
    return null;
  };

  const topo = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const irPara = (n) => { setAviso(null); setEtapa(n); topo(); };
  const avancar = () => {
    const p = problema(etapa);
    if (p) { setAviso(p); return; }
    const prox = etapa + 1;
    setMaxEtapa((m) => Math.max(m, prox));
    irPara(prox);
  };

  const enviar = async () => {
    setAviso(null);
    for (const n of [0, 1, 2]) {
      const p = problema(n);
      if (p) { setAviso(p); if (celular) setEtapa(n); return; }
    }
    setEnviando(true);
    try {
      const r = await chamarPedidoNfe('enviar', {
        ...(inicial ? { id: inicial.id } : {}),
        destinatario: dest,
        itens: preenchidos.map((i) => ({
          produto_id: i.produto_id, descricao: i.descricao, unidade: i.unidade, ncm: i.ncm,
          quantidade: lerNumero(i.quantidade), valor_unitario: lerNumero(i.valor_unitario),
          desconto: descontoParaEnvio(i.desconto, i.desconto_tipo),
        })),
        desconto_geral: descontoParaEnvio(geral.valor, geral.tipo),
        frete_modalidade: frete, frete_valor: valorFrete, observacao: obs,
      });
      onEnviado(r);
    } catch (e) { setAviso(e.message); } finally { setEnviando(false); }
  };

  const secCliente = (
    <div style={{ display: 'grid', gap: 8 }}>
      {novoDest ? (
        <div className="card" style={{ padding: 14 }}>
          <FormDestinatario rotuloSalvar="Usar este cliente" onCancelar={() => setNovoDest(false)}
            onSalvar={async (d) => { const salvo = await salvarDest(d); setDestId(salvo.id); setNovoDest(false); setAviso(null); }} />
        </div>
      ) : (
        <>
          {dados.destinatarios.length > 8 && <input placeholder="Buscar cliente por nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />}
          {dados.destinatarios.length > 0 && (
            <select value={destId} onChange={(e) => { setDestId(e.target.value); setAviso(null); }}>
              <option value="">Escolha um cliente salvo...</option>
              {filtrados.map((d) => <option key={d.id} value={d.id}>{d.nome} — {fmtDocumento(d.documento)}</option>)}
            </select>
          )}
          {dest && <CartaoDest dest={dest} />}
          <button type="button" className="btn" onClick={() => setNovoDest(true)}>+ Novo cliente</button>
        </>
      )}
    </div>
  );

  const secProdutos = (
    <div style={{ display: 'grid', gap: 10 }}>
      <datalist id="pnfe-produtos">{dados.produtos.map((p) => <option key={p.id} value={p.descricao} />)}</datalist>
      {itens.map((i, n) => {
        const c = contaItens.porItem[i.chave];
        return (
          <div key={i.chave} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>Item {n + 1}</span>
              <span style={{ flex: 1 }} />
              {itens.length > 1 && <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setItens((l) => l.filter((x) => x.chave !== i.chave))}>Remover</button>}
            </div>
            <Campo label="Produto"><input list="pnfe-produtos" value={i.descricao} onChange={(e) => mudaItem(i.chave, 'descricao', e.target.value)} placeholder="Digite ou escolha um produto salvo" /></Campo>
            <div className="form-row">
              <Campo label="Quantidade"><input inputMode="decimal" value={i.quantidade} onChange={(e) => mudaItem(i.chave, 'quantidade', e.target.value)} /></Campo>
              <Campo label="Unidade" flex={1.4}><SelectUnidade value={i.unidade} onChange={(v) => mudaItem(i.chave, 'unidade', v)} /></Campo>
            </div>
            <div className="form-row">
              <Campo label="Valor unit. (R$)"><input inputMode="decimal" value={i.valor_unitario} onChange={(e) => mudaItem(i.chave, 'valor_unitario', e.target.value)} placeholder="0,00" /></Campo>
              <Campo label="NCM"><input inputMode="numeric" value={i.ncm} onChange={(e) => mudaItem(i.chave, 'ncm', limparNcm(e.target.value))} placeholder="8 dígitos" /></Campo>
            </div>
            {i.produto_id && i.ncm && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: -4 }}>NCM e unidade vêm do cadastro do produto.</div>}
            <Campo label="Desconto no item (opcional)">
              <CampoDesconto valor={i.desconto} tipo={i.desconto_tipo} onValor={(v) => mudaItem(i.chave, 'desconto', v)} onTipo={(t) => mudaItem(i.chave, 'desconto_tipo', t)} />
            </Campo>
            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text2)' }}>
              {c.descontoItem > 0 && <span style={{ marginRight: 6 }}>{fmtMoeda(c.bruto)} − {fmtMoeda(c.descontoItem)} ·</span>}
              Subtotal: <b>{fmtMoeda(c.bruto - c.descontoItem)}</b>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn" onClick={() => setItens((l) => [...l, itemVazio()])}>+ Adicionar produto</button>
    </div>
  );

  const secValores = (
    <div style={{ display: 'grid', gap: 10 }}>
      <Campo label="Desconto na nota toda (opcional)">
        <CampoDesconto valor={geral.valor} tipo={geral.tipo} onValor={(v) => setGeral((g) => ({ ...g, valor: v }))} onTipo={(t) => setGeral((g) => ({ ...g, tipo: t }))} />
      </Campo>
      {conta.descontoGeral > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: -4 }}>
          {fmtMoeda(conta.descontoGeral)} de desconto, repartido entre os produtos na nota.
        </div>
      )}
      <div className="form-row">
        <Campo label="Frete" flex={2}>
          <select value={frete} onChange={(e) => setFrete(e.target.value)}>{FRETES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </Campo>
        {frete !== 'sem_frete' && <Campo label="Valor do frete (R$)"><input inputMode="decimal" value={freteValor} onChange={(e) => setFreteValor(e.target.value)} placeholder="0,00" /></Campo>}
      </div>
      <Campo label="Observação"><textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Forma de pagamento, prazo, informação para a nota..." /></Campo>
    </div>
  );

  const secRevisar = <Resumo dest={dest} itens={preenchidos} conta={conta} frete={frete} obs={obs} onEditar={celular ? irPara : null} />;

  const secoes = [secCliente, secProdutos, secValores, secRevisar];
  const ultima = etapa === ETAPAS.length - 1;
  const botaoEnviar = (
    <button type="button" className="btn btn-accent" style={{ padding: '12px 20px', fontSize: 15 }} disabled={enviando} onClick={enviar}>
      {enviando ? 'Enviando...' : inicial ? 'Enviar correção' : 'Pedir emissão'}
    </button>
  );
  // faixa no topo quando está corrigindo um pedido devolvido
  const faixaCorrecao = inicial && (
    <div className={`notice ${inicial.status === 'erro' ? 'notice-warn' : 'notice-info'}`} style={{ display: 'grid', gap: 6 }}>
      <div><b>Corrigindo o pedido {numeroPedido(inicial.id)}</b></div>
      {inicial.status_mensagem && <div>O que o escritório pediu: <b>{inicial.status_mensagem}</b></div>}
      {onCancelar && <div><button type="button" className="btn btn-sm" onClick={onCancelar}>Cancelar correção</button></div>}
    </div>
  );
  const totalRodape = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total da nota</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtMoeda(conta.total)}</div>
    </div>
  );

  if (!celular) {
    return (
      <div style={{ display: 'grid', gap: 18 }}>
        {faixaCorrecao}
        {ETAPAS.map((e, n) => (
          <section key={e.id}>
            <h3>{n + 1}. {e.titulo}</h3>
            {secoes[n]}
          </section>
        ))}
        {aviso && <div className="notice notice-warn">{aviso}</div>}
        <div className="pnfe-rodape"><div>{totalRodape}{botaoEnviar}</div></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {faixaCorrecao}
      <Passos atual={etapa} maximo={maxEtapa} onIr={irPara} />
      <section>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Etapa {etapa + 1} de {ETAPAS.length}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text1)', marginBottom: 12 }}>{ETAPAS[etapa].titulo}</div>
        {secoes[etapa]}
      </section>
      {aviso && <div className="notice notice-warn">{aviso}</div>}
      <div className="pnfe-rodape">
        <div>
          {etapa > 0 && <button type="button" className="btn" style={{ padding: '12px 14px' }} onClick={() => irPara(etapa - 1)}>‹ Voltar</button>}
          {totalRodape}
          {ultima ? botaoEnviar : (
            <button type="button" className="btn btn-accent" style={{ padding: '12px 20px', fontSize: 15 }} onClick={avancar}>Avançar ›</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CartaoDest({ dest }) {
  return (
    <div className="card" style={{ padding: 10, fontSize: 12, color: 'var(--text2)' }}>
      <b style={{ color: 'var(--text1)', fontSize: 13 }}>{dest.nome}</b><br />
      {fmtDocumento(dest.documento)}{dest.ie ? ` · IE ${dest.ie}` : ''}<br />
      {[dest.logradouro, dest.numero].filter(Boolean).join(', ')}{dest.complemento ? ` – ${dest.complemento}` : ''} – {dest.bairro} – {dest.municipio}/{dest.uf}
    </div>
  );
}

function BlocoResumo({ titulo, etapa, onEditar, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{titulo}</span>
        {onEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEditar(etapa)}>Alterar</button>}
      </div>
      {children}
    </div>
  );
}

function LinhaValor({ rotulo, valor, forte }) {
  return (
    <div style={{ display: 'flex', fontSize: forte ? 16 : 13, fontWeight: forte ? 800 : 400 }}>
      <span style={{ flex: 1, color: forte ? 'var(--text1)' : 'var(--text2)' }}>{rotulo}</span><span>{valor}</span>
    </div>
  );
}

// Última etapa: a nota inteira, com "Alterar" para voltar a cada etapa (no celular)
function Resumo({ dest, itens, conta, frete, obs, onEditar }) {
  const nomeFrete = (FRETES.find((f) => f.id === frete)?.label || '').toLowerCase();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <BlocoResumo titulo="Cliente" etapa={0} onEditar={onEditar}>
        {dest ? <CartaoDest dest={dest} /> : <span style={{ color: 'var(--danger)', fontSize: 13 }}>Nenhum cliente escolhido.</span>}
      </BlocoResumo>
      <BlocoResumo titulo={`Produtos (${itens.length})`} etapa={1} onEditar={onEditar}>
        {itens.length ? itens.map((i) => {
          const c = conta.porItem[i.chave];
          return (
            <div key={i.chave} style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{i.descricao}</div>
              <div style={{ display: 'flex', gap: 8, color: 'var(--text2)' }}>
                <span style={{ flex: 1 }}>{i.quantidade} {i.unidade} × {fmtMoeda(lerNumero(i.valor_unitario))}{c.desconto > 0 ? ` − desc. ${fmtMoeda(c.desconto)}` : ''}</span>
                <b style={{ color: 'var(--text1)' }}>{fmtMoeda(c.bruto - c.desconto)}</b>
              </div>
            </div>
          );
        }) : <span style={{ color: 'var(--danger)', fontSize: 13 }}>Nenhum produto.</span>}
      </BlocoResumo>
      <BlocoResumo titulo="Valores" etapa={2} onEditar={onEditar}>
        <LinhaValor rotulo="Produtos" valor={fmtMoeda(conta.produtos)} />
        {conta.descontos > 0 && <LinhaValor rotulo="Descontos" valor={`− ${fmtMoeda(conta.descontos)}`} />}
        <LinhaValor rotulo={`Frete (${nomeFrete})`} valor={frete === 'sem_frete' ? '—' : fmtMoeda(conta.frete)} />
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}><LinhaValor rotulo="Total da nota" valor={fmtMoeda(conta.total)} forte /></div>
        {obs.trim() && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>📝 {obs.trim()}</div>}
      </BlocoResumo>
      <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
        Ao pedir a emissão, o escritório recebe o pedido e o resumo chega pelo WhatsApp. A nota (PDF e XML) vem por lá depois de emitida.
      </div>
    </div>
  );
}

function Enviado({ resultado, onNovo, onVer }) {
  const { pedido, whatsapp, corrigido } = resultado;
  return (
    <div className="card" style={{ padding: 20, textAlign: 'center', display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{corrigido ? 'Correção enviada' : 'Pedido enviado'}</div>
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

function MeusPedidos({ pedidos, onCorrigir }) {
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
            {p.status === 'erro' ? (
              <div className="notice notice-warn" style={{ fontSize: 12, marginTop: 4, display: 'grid', gap: 8 }}>
                <span>{p.status_mensagem ? <>O escritório pediu uma correção: <b>{p.status_mensagem}</b></> : 'Este pedido precisa de correção.'}</span>
                <button type="button" className="btn btn-accent btn-sm" style={{ justifySelf: 'start' }} onClick={() => onCorrigir(p)}>Corrigir pedido</button>
              </div>
            ) : (
              <>
                {p.status_mensagem && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{p.status_mensagem}</div>}
                {p.status === 'recebida' && (
                  <button type="button" className="btn btn-sm" style={{ justifySelf: 'start', marginTop: 4 }} onClick={() => onCorrigir(p)}>Alterar pedido</button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
