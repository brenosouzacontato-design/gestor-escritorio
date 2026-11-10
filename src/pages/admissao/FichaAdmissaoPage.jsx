// FichaAdmissaoPage.jsx — ficha de admissão que o candidato preenche pelo link
// ?admissao=<token> (gerado no gestor em Clientes → Admissões). Em etapas, feita
// para o celular: dados, documentos, endereço, banco/VT, dependentes, fotos dos
// documentos e revisão. Salva sozinha (dá para parar e voltar pelo mesmo link).
// Ao enviar, o resumo chega no WhatsApp do candidato. Tudo passa por
// netlify/functions/admissao.js; campos em netlify/functions/lib/admissaoCampos.json.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraIcon, FileUpIcon, Trash2Icon, CheckCircle2Icon, PlusIcon, Loader2Icon, FileTextIcon } from 'lucide-react';
import {
  CAMPOS, UFS, chamarFicha, campoAtivo, faltandoNaSecao, anexosFaltando, mascarar, buscarCep, enviarAnexo,
} from './admissaoApi';

const ESTILO = `
.fadm { max-width: 560px; margin: 0 auto; padding: 16px 14px 110px; }
.fadm input, .fadm select, .fadm textarea { font-size: 16px; width: 100%; }
.fadm h2 { font-size: 18px; font-weight: 800; margin: 6px 0 12px; color: var(--text1); }
.fadm .dica { font-size: 12px; color: var(--text3); margin-top: 3px; }
.fadm .falta input, .fadm .falta select, .fadm .falta textarea { border-color: var(--danger); }
.fadm-barra { height: 6px; border-radius: 3px; background: var(--surface2); overflow: hidden; margin: 6px 0 4px; }
.fadm-barra > div { height: 100%; background: var(--accent); transition: width .25s; }
.fadm-opcoes { display: flex; flex-wrap: wrap; gap: 6px; }
.fadm-opcoes button { border: 1px solid var(--border); background: var(--surface); color: var(--text1); border-radius: 999px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
.fadm-opcoes button.sel { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.fadm-anexo { border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px; margin-bottom: 10px; background: var(--surface); }
.fadm-anexo.ok { border-color: var(--ok); }
.fadm-miniaturas { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.fadm-mini { position: relative; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; background: var(--surface2); display: grid; place-items: center; font-size: 10px; color: var(--text3); text-align: center; }
.fadm-mini img { width: 100%; height: 100%; object-fit: cover; }
.fadm-mini button { position: absolute; top: 2px; right: 2px; border: 0; border-radius: 50%; width: 24px; height: 24px; background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; cursor: pointer; }
.fadm-rodape { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--border);
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); box-shadow: var(--shadow-md); }
.fadm-rodape > div { max-width: 560px; margin: 0 auto; display: flex; align-items: center; gap: 10px; }
.fadm-dep { border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px; margin-bottom: 10px; }
.fadm-check { display: flex; gap: 8px; align-items: center; font-size: 14px; margin-top: 6px; }
.fadm-check input { width: auto; }
@keyframes fadm-gira { to { transform: rotate(360deg); } }
.fadm-gira { animation: fadm-gira .8s linear infinite; }
`;

// etapas: as seções do JSON + dependentes + fotos + revisão
const ETAPAS = [
  ...CAMPOS.secoes.map((s) => ({ id: s.id, titulo: s.titulo, secao: s })),
  { id: 'dependentes', titulo: 'Dependentes' },
  { id: 'anexos', titulo: 'Fotos dos documentos' },
  { id: 'revisar', titulo: 'Revisar e enviar' },
];

const valoresPadrao = () => {
  const d = {};
  for (const s of CAMPOS.secoes) for (const c of s.campos) if (c.padrao) d[c.id] = c.padrao;
  return d;
};

export default function FichaAdmissaoPage({ token }) {
  const [estado, setEstado] = useState({ carregando: true });
  const [dados, setDados] = useState({});
  const [documentos, setDocumentos] = useState([]);
  const [etapa, setEtapa] = useState(0);
  const [mostrarFaltas, setMostrarFaltas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pendencias, setPendencias] = useState(null);
  const [erro, setErro] = useState(null);
  const [concluido, setConcluido] = useState(null);
  const sujo = useRef(false);
  const topo = useRef(null);

  useEffect(() => {
    document.title = 'Ficha de admissão';
    document.querySelector('meta[name="robots"]') || document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex">');
    chamarFicha(token, 'abrir')
      .then((r) => {
        setDados({ ...valoresPadrao(), ...r.admissao.dados, dependentes: r.admissao.dados?.dependentes || [] });
        setDocumentos(r.admissao.documentos || []);
        setEstado({ admissao: r.admissao, empresa: r.empresa });
      })
      .catch((e) => setEstado({ erro: e.message }));
  }, [token]);

  const editavel = ['aguardando', 'preenchendo', 'devolvida'].includes(estado.admissao?.status);

  // salva sozinha 2 s depois da última mudança
  const salvar = async () => {
    if (!sujo.current || !editavel) return;
    sujo.current = false;
    setSalvando(true);
    try { await chamarFicha(token, 'salvar', { dados }); } catch (e) { sujo.current = true; setErro(e.message); } finally { setSalvando(false); }
  };
  useEffect(() => {
    if (!sujo.current) return undefined;
    const t = setTimeout(salvar, 2000);
    return () => clearTimeout(t);
  }, [dados]);

  const mudar = (id, valor) => { sujo.current = true; setDados((d) => ({ ...d, [id]: valor })); };

  const irPara = (i) => {
    salvar();
    setMostrarFaltas(false);
    setPendencias(null);
    setEtapa(i);
    topo.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const atual = ETAPAS[etapa];
  const faltas = useMemo(() => {
    if (atual.secao) return faltandoNaSecao(atual.secao, dados);
    if (atual.id === 'anexos') return anexosFaltando(dados, documentos);
    if (atual.id === 'dependentes') return (dados.dependentes || []).filter((d) => !d.nome || !d.data_nascimento || !d.parentesco);
    return [];
  }, [atual, dados, documentos]);

  const avancar = () => {
    if (faltas.length) { setMostrarFaltas(true); return; }
    irPara(etapa + 1);
  };

  const enviar = async () => {
    setEnviando(true); setErro(null); setPendencias(null);
    try {
      sujo.current = false;
      const r = await chamarFicha(token, 'enviar', { dados });
      setConcluido(r);
      setEstado((s) => ({ ...s, admissao: r.admissao }));
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.pendencias) setPendencias(e.pendencias); else setErro(e.message);
    } finally { setEnviando(false); }
  };

  if (estado.carregando) return <Centro><Loader2Icon className="fadm-gira" size={28} /></Centro>;
  if (estado.erro) return <Centro><div className="notice notice-warn">{estado.erro}</div></Centro>;

  const { admissao, empresa } = estado;
  const cabecalho = (
    <header ref={topo} style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text1)' }}>Ficha de admissão</div>
      <div style={{ fontSize: 13, color: 'var(--text3)' }}>{empresa?.nome}{admissao.cargo ? ` · ${admissao.cargo}` : ''}</div>
    </header>
  );

  if (!editavel || concluido) {
    return (
      <div className="fadm"><style>{ESTILO}</style>{cabecalho}
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <CheckCircle2Icon size={48} color="var(--ok)" />
          <h2>Ficha enviada!</h2>
          <p style={{ color: 'var(--text2)' }}>
            Recebemos seus dados e documentos.
            {concluido?.whatsapp?.ok !== false
              ? ' O resumo foi enviado para o seu WhatsApp.'
              : ' Não conseguimos mandar o resumo no seu WhatsApp agora, mas a ficha chegou ao RH.'}
          </p>
          <p style={{ color: 'var(--text3)', fontSize: 13 }}>Se precisar corrigir algo, fale com o RH.</p>
        </div>
      </div>
    );
  }

  const progresso = Math.round(((etapa + 1) / ETAPAS.length) * 100);

  return (
    <div className="fadm">
      <style>{ESTILO}</style>
      {cabecalho}
      {admissao.status === 'devolvida' && admissao.motivo_devolucao && etapa === 0 && (
        <div className="notice notice-warn" style={{ marginBottom: 12 }}><b>O RH pediu para corrigir:</b> {admissao.motivo_devolucao}</div>
      )}
      {etapa === 0 && admissao.status === 'aguardando' && (
        <div className="notice notice-info" style={{ marginBottom: 12, fontSize: 13 }}>
          Leva uns 10 minutos. Tudo é salvo sozinho: se parar, é só abrir o mesmo link depois.
          Seus dados vão só para o RH da empresa, para a sua admissão.
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>Passo {etapa + 1} de {ETAPAS.length}</span>
        <span>{salvando ? 'Salvando…' : ''}</span>
      </div>
      <div className="fadm-barra"><div style={{ width: `${progresso}%` }} /></div>
      <h2>{atual.titulo}</h2>

      {atual.secao && atual.secao.campos.filter((c) => campoAtivo(c, dados)).map((c) => (
        <CampoFicha key={c.id} campo={c} valor={dados[c.id] || ''} falta={mostrarFaltas && faltas.includes(c)}
          onChange={(v) => mudar(c.id, v)}
          onCep={async (cep) => {
            const end = await buscarCep(cep);
            if (end) { sujo.current = true; setDados((d) => ({ ...d, ...Object.fromEntries(Object.entries(end).filter(([, v]) => v)) })); }
          }} />
      ))}

      {atual.id === 'dependentes' && (
        <Dependentes lista={dados.dependentes || []} mostrarFaltas={mostrarFaltas}
          onChange={(lista) => mudar('dependentes', lista)} />
      )}

      {atual.id === 'anexos' && (
        <Anexos token={token} dados={dados} documentos={documentos} setDocumentos={setDocumentos} mostrarFaltas={mostrarFaltas} faltas={faltas} />
      )}

      {atual.id === 'revisar' && (
        <Revisao dados={dados} documentos={documentos} pendencias={pendencias} irPara={irPara} />
      )}

      {mostrarFaltas && faltas.length > 0 && (
        <div className="notice notice-warn" style={{ marginTop: 12 }}>
          {atual.id === 'dependentes' ? 'Complete nome, nascimento e parentesco de cada dependente.' : `Falta preencher: ${faltas.map((f) => f.rotulo).join(', ')}.`}
        </div>
      )}
      {erro && <div className="notice notice-warn" style={{ marginTop: 12 }}>{erro}</div>}

      <div className="fadm-rodape"><div>
        {etapa > 0 && <button type="button" className="btn" onClick={() => irPara(etapa - 1)}>Voltar</button>}
        <div style={{ flex: 1 }} />
        {atual.id !== 'revisar'
          ? <button type="button" className="btn btn-accent" onClick={avancar}>Continuar</button>
          : <button type="button" className="btn btn-accent" onClick={enviar} disabled={enviando}>
              {enviando ? <><Loader2Icon size={16} className="fadm-gira" /> Enviando…</> : 'Enviar ficha'}
            </button>}
      </div></div>
    </div>
  );
}

function Centro({ children }) {
  return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 20 }}><style>{ESTILO}</style>{children}</div>;
}

function CampoFicha({ campo, valor, falta, onChange, onCep }) {
  const comum = { id: `c-${campo.id}`, value: valor };
  let entrada;
  if (campo.tipo === 'opcao' && campo.opcoes.length <= 3) {
    entrada = (
      <div className="fadm-opcoes">
        {campo.opcoes.map((o) => <button key={o} type="button" className={valor === o ? 'sel' : ''} onClick={() => onChange(o)}>{o}</button>)}
      </div>
    );
  } else if (campo.tipo === 'opcao' || campo.tipo === 'uf') {
    const opcoes = campo.tipo === 'uf' ? UFS : campo.opcoes;
    entrada = (
      <select {...comum} onChange={(e) => onChange(e.target.value)}>
        <option value="">Escolha…</option>
        {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (campo.tipo === 'textarea') {
    entrada = <textarea {...comum} rows={3} onChange={(e) => onChange(e.target.value)} />;
  } else if (campo.tipo === 'data') {
    entrada = <input {...comum} type="date" onChange={(e) => onChange(e.target.value)} />;
  } else if (['cpf', 'pis', 'cep', 'telefone'].includes(campo.tipo)) {
    entrada = (
      <input {...comum} value={mascarar(campo.tipo, valor)} inputMode="numeric" autoComplete={campo.tipo === 'telefone' ? 'tel' : 'off'}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        onBlur={campo.tipo === 'cep' ? () => onCep(valor) : undefined} />
    );
  } else {
    entrada = <input {...comum} type={campo.tipo === 'email' ? 'email' : 'text'} onChange={(e) => onChange(e.target.value)}
      autoCapitalize={campo.tipo === 'email' ? 'none' : 'words'} />;
  }
  return (
    <div className={`form-field ${falta ? 'falta' : ''}`} style={{ marginBottom: 12 }}>
      <label className="form-label" htmlFor={comum.id}>{campo.rotulo}{campo.obrigatorio ? ' *' : ''}</label>
      {entrada}
      {campo.dica && <div className="dica">{campo.dica}</div>}
    </div>
  );
}

function Dependentes({ lista, onChange, mostrarFaltas }) {
  const muda = (i, campo, v) => onChange(lista.map((d, j) => (j === i ? { ...d, [campo]: v } : d)));
  return (
    <>
      <p style={{ color: 'var(--text2)', fontSize: 14, marginTop: 0 }}>
        Filhos, cônjuge ou outras pessoas que dependem de você (para imposto de renda e salário-família). Se não tiver, só continue.
      </p>
      {lista.map((d, i) => {
        const falta = mostrarFaltas && (!d.nome || !d.data_nascimento || !d.parentesco);
        return (
          <div key={i} className={`fadm-dep ${falta ? 'falta' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <b style={{ flex: 1 }}>Dependente {i + 1}</b>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(lista.filter((_, j) => j !== i))}><Trash2Icon size={14} /> Remover</button>
            </div>
            <div className="form-field" style={{ marginBottom: 8 }}><label className="form-label">Nome completo *</label>
              <input value={d.nome || ''} onChange={(e) => muda(i, 'nome', e.target.value)} /></div>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-field" style={{ flex: 1 }}><label className="form-label">Nascimento *</label>
                <input type="date" value={d.data_nascimento || ''} onChange={(e) => muda(i, 'data_nascimento', e.target.value)} /></div>
              <div className="form-field" style={{ flex: 1 }}><label className="form-label">Parentesco *</label>
                <select value={d.parentesco || ''} onChange={(e) => muda(i, 'parentesco', e.target.value)}>
                  <option value="">Escolha…</option>{CAMPOS.parentescos.map((p) => <option key={p}>{p}</option>)}
                </select></div>
            </div>
            <div className="form-field" style={{ marginTop: 8 }}><label className="form-label">CPF</label>
              <input inputMode="numeric" value={mascarar('cpf', d.cpf || '')} onChange={(e) => muda(i, 'cpf', e.target.value.replace(/\D/g, ''))} /></div>
            <label className="fadm-check"><input type="checkbox" checked={!!d.irrf} onChange={(e) => muda(i, 'irrf', e.target.checked)} /> Dependente no imposto de renda</label>
            <label className="fadm-check"><input type="checkbox" checked={!!d.salario_familia} onChange={(e) => muda(i, 'salario_familia', e.target.checked)} /> Salário-família (filho até 14 anos)</label>
          </div>
        );
      })}
      {lista.length < 15 && (
        <button type="button" className="btn" onClick={() => onChange([...lista, { nome: '', cpf: '', data_nascimento: '', parentesco: '', irrf: false, salario_familia: false }])}>
          <PlusIcon size={16} /> Adicionar dependente
        </button>
      )}
    </>
  );
}

function Anexos({ token, dados, documentos, setDocumentos, mostrarFaltas, faltas }) {
  const [enviando, setEnviando] = useState({}); // { [tipo]: n }
  const [erro, setErro] = useState(null);
  const previas = useRef({}); // path → objectURL das fotos tiradas agora

  const escolher = async (anexo, arquivos) => {
    setErro(null);
    const lista = [...arquivos].slice(0, anexo.max - documentos.filter((d) => d.tipo === anexo.id).length);
    for (const arq of lista) {
      setEnviando((e) => ({ ...e, [anexo.id]: (e[anexo.id] || 0) + 1 }));
      try {
        const r = await enviarAnexo(token, anexo.id, arq);
        const novo = r.documentos.find((d) => !documentos.some((x) => x.path === d.path) && !previas.current[d.path]);
        if (novo && arq.type.startsWith('image/')) previas.current[novo.path] = URL.createObjectURL(arq);
        setDocumentos(r.documentos);
        documentos = r.documentos;
      } catch (e) {
        setErro(e.message);
      } finally {
        setEnviando((e) => ({ ...e, [anexo.id]: e[anexo.id] - 1 }));
      }
    }
  };

  const remover = async (doc) => {
    if (!window.confirm('Remover este arquivo?')) return;
    try {
      const r = await chamarFicha(token, 'remover_documento', { path: doc.path });
      setDocumentos(r.documentos);
    } catch (e) { setErro(e.message); }
  };

  return (
    <>
      <p style={{ color: 'var(--text2)', fontSize: 14, marginTop: 0 }}>
        Toque em <b>Fotografar</b> para usar a câmera ou em <b>Arquivo</b> para escolher uma foto ou PDF. Foto bem iluminada, sem cortar as bordas.
      </p>
      {CAMPOS.anexos.filter((a) => campoAtivo(a, dados)).map((anexo) => {
        const docs = documentos.filter((d) => d.tipo === anexo.id);
        const ocupado = enviando[anexo.id] > 0;
        const falta = mostrarFaltas && faltas.includes(anexo);
        return (
          <div key={anexo.id} className={`fadm-anexo ${docs.length ? 'ok' : ''}`} style={falta ? { borderColor: 'var(--danger)' } : undefined}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{anexo.rotulo}{anexo.obrigatorio ? ' *' : ''}</div>
                {anexo.dica && <div className="dica" style={{ fontSize: 12, color: 'var(--text3)' }}>{anexo.dica}</div>}
              </div>
              {docs.length > 0 && <CheckCircle2Icon size={20} color="var(--ok)" />}
            </div>
            {(docs.length > 0 || ocupado) && (
              <div className="fadm-miniaturas">
                {docs.map((d) => (
                  <div key={d.path} className="fadm-mini">
                    {previas.current[d.path] ? <img src={previas.current[d.path]} alt="" /> : <span><FileTextIcon size={20} /><br />{d.mime === 'application/pdf' ? 'PDF' : 'Foto'}</span>}
                    <button type="button" onClick={() => remover(d)} aria-label="Remover"><Trash2Icon size={13} /></button>
                  </div>
                ))}
                {ocupado && <div className="fadm-mini"><Loader2Icon className="fadm-gira" size={22} /></div>}
              </div>
            )}
            {docs.length < anexo.max && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <label className="btn btn-sm btn-accent" style={{ cursor: 'pointer' }}>
                  <CameraIcon size={15} /> Fotografar
                  <input type="file" accept="image/*" capture={anexo.camera} hidden onChange={(e) => { escolher(anexo, e.target.files); e.target.value = ''; }} />
                </label>
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  <FileUpIcon size={15} /> Arquivo
                  <input type="file" accept="image/*,application/pdf" multiple={anexo.max > 1} hidden onChange={(e) => { escolher(anexo, e.target.files); e.target.value = ''; }} />
                </label>
              </div>
            )}
          </div>
        );
      })}
      {erro && <div className="notice notice-warn">{erro}</div>}
    </>
  );
}

function Revisao({ dados, documentos, pendencias, irPara }) {
  const mostrar = (c, v) => (c.tipo === 'data' && v ? v.split('-').reverse().join('/') : ['cpf', 'pis', 'cep', 'telefone'].includes(c.tipo) ? mascarar(c.tipo, v) : v);
  return (
    <>
      {pendencias?.length > 0 && (
        <div className="notice notice-warn" style={{ marginBottom: 12 }}>
          <b>Antes de enviar, corrija:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <p style={{ color: 'var(--text2)', fontSize: 14, marginTop: 0 }}>Confira tudo. Toque em <b>Corrigir</b> para mudar uma parte.</p>
      {ETAPAS.slice(0, -1).map((et, i) => (
        <div key={et.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <b style={{ flex: 1 }}>{et.titulo}</b>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => irPara(i)}>Corrigir</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            {et.secao && et.secao.campos.filter((c) => campoAtivo(c, dados) && dados[c.id]).map((c) => (
              <div key={c.id}><span style={{ color: 'var(--text3)' }}>{c.rotulo}:</span> {mostrar(c, dados[c.id])}</div>
            ))}
            {et.id === 'dependentes' && ((dados.dependentes || []).length
              ? dados.dependentes.map((d, j) => <div key={j}>{d.nome} — {d.parentesco}</div>)
              : <div>Nenhum</div>)}
            {et.id === 'anexos' && CAMPOS.anexos.filter((a) => campoAtivo(a, dados)).map((a) => {
              const n = documentos.filter((d) => d.tipo === a.id).length;
              return n ? <div key={a.id}>✓ {a.rotulo}{n > 1 ? ` (${n})` : ''}</div> : null;
            })}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--text3)' }}>
        Ao enviar, você confirma que as informações são verdadeiras e autoriza o uso delas pela empresa e pelo escritório de contabilidade para a sua admissão e o eSocial (LGPD).
      </p>
    </>
  );
}
