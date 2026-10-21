import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckIcon, CalendarIcon, PlusIcon, ClipboardListIcon, CheckSquareIcon, AlertTriangleIcon, ClockIcon, CheckCircleIcon,
  SearchIcon, Building2Icon, XIcon, Loader2Icon, MessageSquareIcon, FlagIcon, CircleDashedIcon, MinusCircleIcon,
  ListIcon, ColumnsIcon, ChevronDownIcon, ChevronRightIcon, HourglassIcon,
} from 'lucide-react';
import { BotaoAnexos, AnexosItemModal } from '../../components/AnexosItem';
import {
  listarItensCarteira, mudarStatusObrigacaoCarteira, concluirTarefaCarteira, criarTarefaCarteira,
  anexarArquivoCarteira, abrirAnexoCarteira, salvarObservacaoCarteira,
} from './carteiraApi';

// Tarefas e obrigações das empresas da carteira, no link da carteira
// (PainelCarteiraPage.jsx), sem login — tudo pela function carteira-acao, que
// confere o token e a empresa. Dois jeitos de ver:
//   - <TrabalhoEmpresaCarteira>: uma empresa, igual ao modal de Empresas.jsx
//     (obrigações e tarefas em "A entregar" x "Entregue"), com baixa, anexos,
//     observação e nova tarefa;
//   - <QuadroCarteira>: todas as empresas, em listas por prazo (Vencidas /
//     Vencem em até 7 dias / Mais adiante / Concluídas) ou em colunas, embaixo
//     dos cards da carteira.

const STATUS_OBS = ['pendente', 'concluido', 'nao_aplica', 'vencido'];
const STATUS_LABEL = { pendente: 'Pendente', concluido: 'Concluída', nao_aplica: 'Não se aplica', vencido: 'Vencida' };
const STATUS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'], concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'], vencido: ['var(--danger)', 'var(--danger-dim)'],
};
const DEPARTAMENTOS = ['fiscal', 'folha', 'societario', 'contabil', 'escritorio', 'geral', 'pessoal'];
// identidade visual de cada tipo — a mesma em todas as listas
const TIPO = {
  obrigacao: { label: 'Obrigação', Icone: ClipboardListIcon, cor: 'var(--info)', dim: 'var(--info-dim)' },
  tarefa: { label: 'Tarefa', Icone: CheckSquareIcon, cor: 'var(--accent)', dim: 'var(--accent-dim)' },
};
const COR_PERTO = '#C2410C'; // vence nos próximos dias (mesmo laranja de Empresas.jsx)

const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '');
const normalizar = (t) => (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtData = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '');
function diasAte(iso) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T12:00:00`) - new Date(`${hojeIso()}T12:00:00`)) / 86400000);
}

// Situação de prazo de um item: cor, ícone e texto ("vence em 2 dias")
function situacaoPrazo(item) {
  if (item.tipo === 'obrigacao' && item.status === 'nao_aplica') return { cor: 'var(--info)', dim: 'var(--info-dim)', Icone: MinusCircleIcon, texto: 'Não se aplica' };
  if (item.concluido) return { cor: 'var(--ok)', dim: 'var(--ok-dim)', Icone: CheckCircleIcon, texto: 'Concluída' };
  const d = diasAte(item.vencimento);
  if (item.vencido) return { cor: 'var(--danger)', dim: 'var(--danger-dim)', Icone: AlertTriangleIcon, texto: d == null ? 'Vencida' : d === -1 ? 'Venceu ontem' : `Venceu há ${-d} dias` };
  if (d == null) return { cor: 'var(--text3)', dim: 'var(--surface2)', Icone: CircleDashedIcon, texto: 'Sem prazo' };
  if (d === 0) return { cor: COR_PERTO, dim: 'rgba(194,65,12,.12)', Icone: HourglassIcon, texto: 'Vence hoje' };
  if (d <= 7) return { cor: COR_PERTO, dim: 'rgba(194,65,12,.12)', Icone: HourglassIcon, texto: d === 1 ? 'Vence amanhã' : `Vence em ${d} dias` };
  return { cor: 'var(--warn)', dim: 'var(--warn-dim)', Icone: ClockIcon, texto: `Vence em ${d} dias` };
}

// Obrigação e tarefa no mesmo formato, pra listar juntas. `anterior` marca
// obrigação em aberto de competência passada — ficam escondidas até pedir
// (na prática muitas nunca foram baixadas no sistema e soterrariam o quadro).
function normalizarItens(dados, competencia) {
  const hoje = hojeIso();
  const anexosPor = (tipo, id) => dados.anexos.filter((a) => (tipo === 'obrigacao' ? a.obrigacao_id : a.tarefa_id) === id);
  const obrigacoes = dados.obrigacoes.map((o) => {
    const concluido = o.status === 'concluido' || o.status === 'nao_aplica';
    return {
      tipo: 'obrigacao', id: o.id, clienteId: o.cliente_id, titulo: o.titulo || o.tipo || 'Obrigação', vencimento: o.vencimento,
      concluido, vencido: !concluido && (o.status === 'vencido' || (!!o.vencimento && o.vencimento < hoje)),
      status: o.status || 'pendente', modulo: o.departamentos ? `${o.departamentos.icone || ''} ${o.departamentos.nome}`.trim() : null,
      competencia: o.competencia, quando: o.updated_at, anexos: anexosPor('obrigacao', o.id), observacao: o.observacao || '',
      anterior: !!competencia && o.competencia !== competencia,
    };
  });
  const tarefas = dados.tarefas.map((t) => ({
    tipo: 'tarefa', id: t.id, clienteId: t.cliente_id, titulo: t.titulo, vencimento: t.vencimento,
    concluido: !!t.concluida, vencido: !t.concluida && !!t.vencimento && t.vencimento < hoje,
    modulo: t.departamento ? t.departamento.charAt(0).toUpperCase() + t.departamento.slice(1) : null,
    prioridade: t.prioridade, quando: t.concluida_em, anexos: anexosPor('tarefa', t.id), observacao: t.observacao || '',
  }));
  return [...obrigacoes, ...tarefas];
}

// Carrega os itens da carteira e expõe as ações (cada uma recarrega a lista)
export function useTrabalhoCarteira(token, competencia) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null); // id do item sendo salvo

  const recarregar = useCallback(() => listarItensCarteira(token, competencia)
    .then((d) => { setDados(d); setErro(null); })
    .catch((e) => setErro(e.message)), [token, competencia]);
  useEffect(() => { setDados(null); recarregar(); }, [recarregar]);

  const executar = async (id, fn) => {
    setOcupado(id);
    try { await fn(); await recarregar(); } catch (e) { window.alert(e.message); }
    setOcupado(null);
  };
  const acoes = {
    mudarStatus: (item, status) => executar(item.id, () => mudarStatusObrigacaoCarteira(token, item.id, status)),
    alternarConcluido: (item) => executar(item.id, () => (item.tipo === 'obrigacao'
      ? mudarStatusObrigacaoCarteira(token, item.id, item.concluido ? 'pendente' : 'concluido')
      : concluirTarefaCarteira(token, item.id, !item.concluido))),
    criarTarefa: async (tarefa) => { await criarTarefaCarteira(token, tarefa); await recarregar(); },
    anexar: async (item, arquivo, opcoes) => { await anexarArquivoCarteira(token, { tipo: item.tipo, id: item.id }, arquivo, opcoes); await recarregar(); },
    abrirAnexo: (anexo) => abrirAnexoCarteira(token, anexo.id).catch((e) => window.alert(e.message)),
    salvarObservacao: async (item, texto) => { await salvarObservacaoCarteira(token, { tipo: item.tipo, id: item.id }, texto); await recarregar(); },
  };
  const [verAnteriores, setVerAnteriores] = useState(false);
  const todos = useMemo(() => (dados ? normalizarItens(dados, competencia) : []), [dados, competencia]);
  const itens = useMemo(() => (verAnteriores ? todos : todos.filter((i) => !i.anterior)), [todos, verAnteriores]);
  const qtdAnteriores = todos.filter((i) => i.anterior).length;
  return { dados, todos, itens, erro, ocupado, acoes, recarregar, verAnteriores, setVerAnteriores, qtdAnteriores };
}

// Botão que mostra/esconde as obrigações em aberto de meses anteriores
// (da carteira toda, ou só de uma empresa)
function BotaoAnteriores({ trabalho, clienteId }) {
  const qtd = clienteId
    ? trabalho.todos.filter((i) => i.anterior && i.clienteId === clienteId).length
    : trabalho.qtdAnteriores;
  if (!qtd) return null;
  return (
    <button type="button" onClick={() => trabalho.setVerAnteriores(!trabalho.verAnteriores)}
      title="Obrigações de competências passadas que ainda estão como pendentes no sistema"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: '4px 10px', cursor: 'pointer',
        border: `1px solid ${trabalho.verAnteriores ? 'var(--danger)' : 'var(--border)'}`,
        background: trabalho.verAnteriores ? 'var(--danger-dim)' : 'var(--surface)', color: trabalho.verAnteriores ? 'var(--danger)' : 'var(--text2)' }}>
      <AlertTriangleIcon size={12} />
      {trabalho.verAnteriores ? 'Esconder meses anteriores' : `+ ${qtd} de meses anteriores em aberto`}
    </button>
  );
}

// Modais abertos a partir de qualquer item (anexos e observação), num lugar só
function useModaisItem(trabalho, empresasPorId) {
  const [anexoItem, setAnexoItem] = useState(null);
  const [obsItem, setObsItem] = useState(null);
  const atual = (ref) => ref && trabalho.itens.find((i) => i.id === ref.id && i.tipo === ref.tipo);
  const itemAnexo = atual(anexoItem);
  const itemObs = atual(obsItem);
  const modais = (
    <>
      {itemAnexo && (
        <ModalAnexos item={itemAnexo} empresa={empresasPorId.get(itemAnexo.clienteId)} acoes={trabalho.acoes} onClose={() => setAnexoItem(null)} />
      )}
      {itemObs && (
        <ObservacaoModal item={itemObs} empresa={empresasPorId.get(itemObs.clienteId)} onClose={() => setObsItem(null)}
          onSalvar={async (texto) => { await trabalho.acoes.salvarObservacao(itemObs, texto); setObsItem(null); }} />
      )}
    </>
  );
  return { abrirAnexos: setAnexoItem, abrirObservacao: setObsItem, modais };
}

// ---------- uma empresa ----------

export function TrabalhoEmpresaCarteira({ trabalho, empresa }) {
  const { itens, erro, dados, ocupado, acoes } = trabalho;
  const [novaTarefa, setNovaTarefa] = useState(false);
  const empresasPorId = useMemo(() => new Map([[empresa.id, empresa]]), [empresa]);
  const { abrirAnexos, abrirObservacao, modais } = useModaisItem(trabalho, empresasPorId);
  if (erro) return <Aviso>{erro}</Aviso>;
  if (!dados) return <Aviso>Carregando tarefas e obrigações...</Aviso>;

  const daEmpresa = itens.filter((i) => i.clienteId === empresa.id);
  const secao = (tipo) => {
    const lista = daEmpresa.filter((i) => i.tipo === tipo)
      .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
    return { aEntregar: lista.filter((i) => !i.concluido), entregues: lista.filter((i) => i.concluido) };
  };
  const card = (i) => (
    <CardItem key={i.id} item={i} ocupado={ocupado === i.id} acoes={acoes}
      onAnexos={() => abrirAnexos(i)} onObservacao={() => abrirObservacao(i)} />
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '14px 16px 40px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))', gap: 22, alignItems: 'start' }}>
      <SecaoItens icone={<ClipboardListIcon size={14} />} titulo="Obrigações" {...secao('obrigacao')}
        extra={<BotaoAnteriores trabalho={trabalho} clienteId={empresa.id} />} render={card} />
      <SecaoItens icone={<CheckSquareIcon size={14} />} titulo="Tarefas" {...secao('tarefa')}
        extra={<button type="button" className="btn btn-accent" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setNovaTarefa(true)}><PlusIcon size={13} /> Nova tarefa</button>}
        render={card} />
      {modais}
      {novaTarefa && (
        <NovaTarefaModal empresa={empresa} onClose={() => setNovaTarefa(false)}
          onSalvar={async (t) => { await acoes.criarTarefa({ ...t, clienteId: empresa.id }); setNovaTarefa(false); }} />
      )}
    </div>
  );
}

function SecaoItens({ icone, titulo, aEntregar, entregues, render, extra }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {icone} {titulo} <span style={{ color: 'var(--text2)' }}>({aEntregar.length + entregues.length})</span>
        </div>
        {extra}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <Coluna titulo="A entregar" qtd={aEntregar.length} cor="var(--warn)" vazio="Nada pendente">{aEntregar.map(render)}</Coluna>
        <Coluna titulo="Entregue" qtd={entregues.length} cor="var(--ok)" vazio="Nada entregue ainda">{entregues.map(render)}</Coluna>
      </div>
    </section>
  );
}

// ---------- todas as empresas ----------

const CHAVE_MODO = 'carteira-quadro-modo';

export function QuadroCarteira({ trabalho, competencia, onAbrirEmpresa }) {
  const { itens, erro, dados, ocupado, acoes } = trabalho;
  const [tipo, setTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState(() => { try { return localStorage.getItem(CHAVE_MODO) || 'lista'; } catch { return 'lista'; } });
  const escolherModo = (m) => { setModo(m); try { localStorage.setItem(CHAVE_MODO, m); } catch { /* sem localStorage */ } };
  const [fechados, setFechados] = useState(() => new Set(['concluidas'])); // grupos recolhidos na lista

  const empresasPorId = useMemo(() => new Map((dados?.empresas || []).map((e) => [e.id, e])), [dados]);
  const { abrirAnexos, abrirObservacao, modais } = useModaisItem(trabalho, empresasPorId);
  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return itens
      .filter((i) => tipo === 'todos' || i.tipo === tipo)
      .filter((i) => !termo || normalizar(`${i.titulo} ${i.observacao} ${empresasPorId.get(i.clienteId)?.nome || ''}`).includes(termo));
  }, [itens, tipo, busca, empresasPorId]);

  if (erro) return <Aviso>{erro}</Aviso>;
  if (!dados) return <Aviso>Carregando tarefas e obrigações da carteira...</Aviso>;

  const porVencimento = (a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999');
  const abertos = filtrados.filter((i) => !i.concluido && !i.vencido);
  const concluidas = filtrados.filter((i) => i.concluido).sort((a, b) => (b.quando || '').localeCompare(a.quando || ''));
  const grupos = modo === 'lista'
    ? [
      { id: 'vencidas', titulo: 'Vencidas', cor: 'var(--danger)', Icone: AlertTriangleIcon, vazio: 'Nada vencido 🎉', itens: filtrados.filter((i) => i.vencido).sort(porVencimento) },
      { id: 'semana', titulo: 'Vencem em até 7 dias', cor: COR_PERTO, Icone: HourglassIcon, vazio: 'Nada vencendo nos próximos dias', itens: abertos.filter((i) => { const d = diasAte(i.vencimento); return d != null && d <= 7; }).sort(porVencimento) },
      { id: 'adiante', titulo: 'Mais adiante ou sem prazo', cor: 'var(--warn)', Icone: ClockIcon, vazio: 'Nada', itens: abertos.filter((i) => { const d = diasAte(i.vencimento); return d == null || d > 7; }).sort(porVencimento) },
      { id: 'concluidas', titulo: 'Concluídas', cor: 'var(--ok)', Icone: CheckCircleIcon, vazio: 'Nada concluído ainda', itens: concluidas },
    ]
    : [
      { id: 'vencidas', titulo: 'Vencidas', cor: 'var(--danger)', Icone: AlertTriangleIcon, vazio: 'Nada vencido 🎉', itens: filtrados.filter((i) => i.vencido).sort(porVencimento) },
      { id: 'a_vencer', titulo: 'A vencer', cor: 'var(--warn)', Icone: ClockIcon, vazio: 'Nada pendente', itens: abertos.sort(porVencimento) },
      { id: 'concluidas', titulo: 'Concluídas', cor: 'var(--ok)', Icone: CheckCircleIcon, vazio: 'Nada concluído ainda', itens: concluidas },
    ];
  const alternarGrupo = (id) => setFechados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const propsItem = (i) => ({
    item: i, empresa: empresasPorId.get(i.clienteId), ocupado: ocupado === i.id, acoes,
    onAnexos: () => abrirAnexos(i), onObservacao: () => abrirObservacao(i), onAbrirEmpresa,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text1)' }}>Tarefas e obrigações da carteira</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Obrigações de {competencia} · tarefas em aberto e concluídas nos últimos 45 dias</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Alternador valor={tipo} onChange={setTipo} opcoes={[['todos', 'Todos'], ['obrigacao', 'Obrigações', ClipboardListIcon], ['tarefa', 'Tarefas', CheckSquareIcon]]} />
          <Alternador valor={modo} onChange={escolherModo} opcoes={[['lista', 'Lista', ListIcon], ['colunas', 'Colunas', ColumnsIcon]]} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
          <SearchIcon size={14} color="var(--text3)" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por empresa, tarefa/obrigação ou observação..."
            style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13.5, padding: 0, width: '100%', color: 'var(--text1)' }} />
        </div>
        <BotaoAnteriores trabalho={trabalho} />
      </div>
      <Legenda />

      {modo === 'lista' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grupos.map((g) => {
            const fechado = fechados.has(g.id);
            return (
              <section key={g.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${g.cor}`, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <button type="button" onClick={() => alternarGrupo(g.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', cursor: 'pointer',
                    background: `color-mix(in srgb, ${g.cor}, transparent 92%)`, color: g.cor, fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  {fechado ? <ChevronRightIcon size={15} /> : <ChevronDownIcon size={15} />}
                  <g.Icone size={15} /> {g.titulo}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, borderRadius: 99, padding: '1px 10px', background: 'var(--surface)', color: g.cor }}>{g.itens.length}</span>
                </button>
                {!fechado && (
                  g.itens.length === 0
                    ? <div style={{ padding: '14px', fontSize: 12.5, color: 'var(--text3)', textAlign: 'center' }}>{g.vazio}</div>
                    : g.itens.map((i) => <LinhaItem key={`${i.tipo}-${i.id}`} {...propsItem(i)} />)
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, alignItems: 'start' }}>
          {grupos.map((g) => (
            <Coluna key={g.id} titulo={g.titulo} qtd={g.itens.length} cor={g.cor} Icone={g.Icone} destaque vazio={g.vazio}>
              {g.itens.map((i) => <CardItem key={`${i.tipo}-${i.id}`} compacto {...propsItem(i)} />)}
            </Coluna>
          ))}
        </div>
      )}
      {modais}
    </div>
  );
}

function Alternador({ valor, onChange, opcoes }) {
  return (
    <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
      {opcoes.map(([v, label, Icone]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: valor === v ? 'var(--navy)' : 'transparent', color: valor === v ? '#fff' : 'var(--text2)' }}>
          {Icone && <Icone size={12} />} {label}
        </button>
      ))}
    </div>
  );
}

// O que cada ícone/cor quer dizer, uma linha só
function Legenda() {
  const itens = [
    [ClipboardListIcon, TIPO.obrigacao.cor, 'Obrigação'], [CheckSquareIcon, TIPO.tarefa.cor, 'Tarefa'],
    [AlertTriangleIcon, 'var(--danger)', 'Vencida'], [HourglassIcon, COR_PERTO, 'Vence em até 7 dias'], [ClockIcon, 'var(--warn)', 'A vencer'],
    [CheckCircleIcon, 'var(--ok)', 'Concluída'], [FlagIcon, 'var(--danger)', 'Prioridade alta'], [MessageSquareIcon, 'var(--text2)', 'Tem observação'],
  ];
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text3)' }}>
      {itens.map(([Icone, cor, texto]) => <span key={texto} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icone size={12} color={cor} /> {texto}</span>)}
    </div>
  );
}

// ---------- peças ----------

function Coluna({ titulo, qtd, cor, Icone, vazio, destaque, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0,
      ...(destaque ? { background: 'var(--surface2)', border: '1px solid var(--border)', borderTop: `3px solid ${cor}`, borderRadius: 'var(--r-md)', padding: 8 } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {Icone && <Icone size={13} />} {titulo}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, borderRadius: 99, padding: '1px 8px', background: 'var(--surface)', color: cor }}>{qtd}</span>
      </div>
      {qtd === 0 && <div style={{ fontSize: 11.5, color: 'var(--text3)', textAlign: 'center', padding: '12px 0', border: '1px dashed var(--border)', borderRadius: 8 }}>{vazio}</div>}
      <div style={destaque ? { display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 640, overflowY: 'auto' } : { display: 'flex', flexDirection: 'column', gap: 7 }}>
        {children}
      </div>
    </div>
  );
}

// Quadradinho de dar baixa / reabrir
function BotaoBaixa({ item, ocupado, acoes, tamanho = 20 }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); acoes.alternarConcluido(item); }} disabled={ocupado}
      title={item.concluido ? 'Reabrir (desfazer a baixa)' : 'Dar baixa'}
      style={{ width: tamanho, height: tamanho, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
        border: `1.5px solid ${item.concluido ? 'var(--ok)' : 'var(--border2)'}`, background: item.concluido ? 'var(--ok)' : 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {ocupado ? <Loader2Icon size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : item.concluido && <CheckIcon size={12} color="#fff" strokeWidth={3} />}
    </button>
  );
}

function IconeTipo({ tipo, tamanho = 30 }) {
  const t = TIPO[tipo];
  return (
    <span title={t.label} style={{ width: tamanho, height: tamanho, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: t.dim, color: t.cor }}>
      <t.Icone size={Math.round(tamanho * 0.5)} />
    </span>
  );
}

function SeloPrazo({ item }) {
  const s = situacaoPrazo(item);
  return (
    <span title={item.vencimento ? `Vencimento ${fmtData(item.vencimento)}` : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '3px 9px',
        background: s.dim, color: s.cor, whiteSpace: 'nowrap' }}>
      <s.Icone size={12} /> {s.texto}
    </span>
  );
}

function BotaoObservacao({ item, onClick, tamanho = 13 }) {
  const tem = !!item.observacao;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={tem ? `Observação: ${item.observacao}` : 'Escrever observação'}
      style={{ background: tem ? 'var(--surface2)' : 'none', border: 'none', cursor: 'pointer', padding: tem ? '1px 6px' : 2, borderRadius: 99, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', color: tem ? 'var(--text1)' : 'var(--text3)' }}>
      <MessageSquareIcon size={tamanho} fill={tem ? 'currentColor' : 'none'} fillOpacity={tem ? 0.15 : 0} />
    </button>
  );
}

// Uma linha da lista geral: tudo que identifica o item numa olhada
function LinhaItem({ item, empresa, ocupado, acoes, onAnexos, onObservacao, onAbrirEmpresa }) {
  const s = situacaoPrazo(item);
  return (
    // flexWrap: no celular o prazo e os botões descem pra baixo do texto em vez de espremê-lo
    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)',
      opacity: ocupado ? 0.55 : 1, transition: 'opacity .15s', background: 'var(--surface)' }}>
      <div style={{ paddingTop: 5 }}><BotaoBaixa item={item} ocupado={ocupado} acoes={acoes} /></div>
      <IconeTipo tipo={item.tipo} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: item.concluido ? 'var(--text3)' : 'var(--text1)', textDecoration: item.concluido ? 'line-through' : 'none' }}>
            {item.titulo}
          </span>
          {item.prioridade === 'alta' && !item.concluido && (
            <span title="Prioridade alta" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: 'var(--danger)' }}><FlagIcon size={12} fill="currentColor" /> alta</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: 11.5, color: 'var(--text3)' }}>
          {empresa && (
            <button type="button" onClick={() => onAbrirEmpresa?.(empresa)} title="Abrir a empresa"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>
              <Building2Icon size={12} /> {nomeCurto(empresa.nome)}
            </button>
          )}
          <span style={{ color: TIPO[item.tipo].cor, fontWeight: 600 }}>{TIPO[item.tipo].label}</span>
          {item.modulo && <span>{item.modulo}</span>}
          {item.tipo === 'obrigacao' && item.competencia && <span>Comp. {item.competencia}</span>}
          {item.vencimento && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={11} /> {fmtData(item.vencimento)}</span>}
        </div>
        {item.observacao && (
          <button type="button" onClick={onObservacao} title="Editar observação"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginTop: 6, width: '100%', textAlign: 'left', cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', borderLeft: `3px solid ${s.cor}`, borderRadius: 6, padding: '5px 8px',
              fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>
            <MessageSquareIcon size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {item.observacao}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto', paddingTop: 3 }}>
        <SeloPrazo item={item} />
        {!item.observacao && <BotaoObservacao item={item} onClick={onObservacao} />}
        <BotaoAnexos qtd={item.anexos.length} onClick={onAnexos} tamanho={14} />
      </div>
    </div>
  );
}

// Card (colunas e visão de uma empresa)
function CardItem({ item, empresa, compacto, ocupado, acoes, onAnexos, onObservacao, onAbrirEmpresa }) {
  const s = situacaoPrazo(item);
  const [cor, corDim] = STATUS_COR[item.status] || STATUS_COR.pendente;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${s.cor}`, borderRadius: 8,
      padding: '9px 10px', opacity: ocupado ? 0.55 : 1, transition: 'opacity .15s' }}>
      {compacto && empresa && (
        <button type="button" onClick={() => onAbrirEmpresa?.(empresa)} title="Abrir a empresa"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, marginBottom: 4, cursor: 'pointer',
            fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', maxWidth: '100%' }}>
          <Building2Icon size={11} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(empresa.nome)}</span>
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <BotaoBaixa item={item} ocupado={ocupado} acoes={acoes} />
        <IconeTipo tipo={item.tipo} tamanho={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: item.concluido ? 'var(--text3)' : 'var(--text1)',
            textDecoration: item.concluido ? 'line-through' : 'none' }}>
            {item.titulo}
            {item.prioridade === 'alta' && !item.concluido && <FlagIcon size={11} color="var(--danger)" fill="var(--danger)" style={{ marginLeft: 5, verticalAlign: -1 }} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <SeloPrazo item={item} />
            {item.modulo && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{item.modulo}</span>}
            {item.tipo === 'obrigacao' && item.competencia && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{item.competencia}</span>}
          </div>
        </div>
        <BotaoObservacao item={item} onClick={onObservacao} />
        <BotaoAnexos qtd={item.anexos.length} onClick={onAnexos} tamanho={13} />
      </div>
      {item.observacao && (
        <div onClick={onObservacao} title="Editar observação"
          style={{ display: 'flex', gap: 5, marginTop: 7, cursor: 'pointer', background: 'var(--surface2)', borderRadius: 6, padding: '5px 8px',
            fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>
          <MessageSquareIcon size={11} style={{ flexShrink: 0, marginTop: 2 }} /> {item.observacao}
        </div>
      )}
      {item.tipo === 'obrigacao' && !compacto && (
        <select value={item.status} disabled={ocupado} onChange={(e) => acoes.mudarStatus(item, e.target.value)}
          style={{ marginTop: 8, width: '100%', fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
            background: corDim, color: cor, border: `1px solid ${cor}` }}>
          {STATUS_OBS.map((st) => <option key={st} value={st} style={{ color: 'var(--text1)', background: 'var(--surface)' }}>{STATUS_LABEL[st]}</option>)}
        </select>
      )}
    </div>
  );
}

function ModalAnexos({ item, empresa, acoes, onClose }) {
  return (
    <AnexosItemModal
      titulo={item.titulo}
      subtitulo={`${TIPO[item.tipo].label}${empresa ? ` · ${nomeCurto(empresa.nome)}` : ''}`}
      anexos={item.anexos}
      concluido={item.concluido}
      onEnviar={(arquivo, opcoes) => acoes.anexar(item, arquivo, opcoes)}
      onAbrir={acoes.abrirAnexo}
      onClose={onClose}
    />
  );
}

function ObservacaoModal({ item, empresa, onSalvar, onClose }) {
  const [texto, setTexto] = useState(item.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try { await onSalvar(texto); } catch (e) { setErro(e.message); setSalvando(false); }
  };
  return (
    <Janela onClose={onClose} titulo="Observação" subtitulo={`${TIPO[item.tipo].label} · ${item.titulo}${empresa ? ` · ${nomeCurto(empresa.nome)}` : ''}`} Icone={MessageSquareIcon}>
      <textarea autoFocus rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000}
        placeholder="Ex.: cliente pediu pra pagar dia 25; aguardando extrato do banco..."
        style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: 14, color: 'var(--text1)', resize: 'vertical' }} />
      <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>{texto.length}/2000 · deixe vazio pra apagar</div>
      {erro && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-accent" style={{ flex: 2, justifyContent: 'center' }} onClick={salvar}
          disabled={salvando || texto.trim() === (item.observacao || '').trim()}>
          {salvando ? 'Salvando...' : 'Salvar observação'}
        </button>
      </div>
    </Janela>
  );
}

function NovaTarefaModal({ empresa, onSalvar, onClose }) {
  const [titulo, setTitulo] = useState('');
  const [departamento, setDepartamento] = useState('geral');
  const [prioridade, setPrioridade] = useState('normal');
  const [vencimento, setVencimento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const salvar = async () => {
    if (!titulo.trim()) return;
    setSalvando(true);
    setErro(null);
    try { await onSalvar({ titulo: titulo.trim(), departamento, prioridade, vencimento: vencimento || null, observacao }); }
    catch (e) { setErro(e.message); setSalvando(false); }
  };
  const campo = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14, color: 'var(--text1)' };
  const rotulo = { fontSize: 11.5, color: 'var(--text2)', display: 'block', marginBottom: 4, fontWeight: 600 };
  return (
    <Janela onClose={onClose} titulo="Nova tarefa" subtitulo={nomeCurto(empresa.nome)} Icone={CheckSquareIcon}>
      <div><label style={rotulo}>Título *</label><input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Descreva a tarefa..." style={campo} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><label style={rotulo}>Departamento</label>
          <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} style={campo}>
            {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
          </select></div>
        <div><label style={rotulo}>Prioridade</label>
          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} style={campo}>
            <option value="normal">Normal</option><option value="alta">Alta</option>
          </select></div>
      </div>
      <div><label style={rotulo}>Vencimento</label><input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={campo} /></div>
      <div><label style={rotulo}>Observação</label><textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...campo, resize: 'vertical' }} /></div>
      {erro && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-accent" style={{ flex: 2, justifyContent: 'center' }} onClick={salvar} disabled={!titulo.trim() || salvando}>
          {salvando ? 'Salvando...' : 'Criar tarefa'}
        </button>
      </div>
    </Janela>
  );
}

function Janela({ titulo, subtitulo, Icone, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icone size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)' }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{subtitulo}</div>}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)' }}><XIcon size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Aviso({ children }) {
  return <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '24px 12px' }}>{children}</div>;
}
