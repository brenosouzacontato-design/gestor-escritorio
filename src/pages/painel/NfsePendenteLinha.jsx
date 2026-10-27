// Nota ainda não emitida, no painel do cliente: mostra a situação e deixa o cliente preencher o que
// falta (nome, CPF, data, descrição, endereço) ou confirmar a nota complementar (a diferença de uma
// nota já emitida). Usada no painel mensal e no link "todas as notas". Ver painel-nfse.js.
import { useState } from 'react';
import { CalendarIcon, CheckCircleIcon } from 'lucide-react';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// situacao vem do servidor; versões antigas da resposta só tinham `pronta`
const situacaoDa = (n) => n.situacao || (n.pronta ? 'pronta' : n.erros.length ? 'invalida' : 'falta');
const COR = { pronta: 'var(--ok)', ja_emitida: 'var(--text3)', complementar: 'var(--info)', invalida: 'var(--danger)', falta: 'var(--warn)' };

export default function NfsePendenteLinha({ n, onSalvar }) {
  const situacao = situacaoDa(n);
  const falta = (rotulo) => n.pendencias.includes(rotulo);
  const [valores, setValores] = useState({ cpf: n.cpf || '', nome: n.nome || '', data: '', descricao: n.descricao || '', endereco: n.endereco || '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const pede = {
    nome: falta('Nome'),
    cpf: falta('CPF') || n.erros.some((e) => /^CPF/.test(e)),
    data: falta('Data'),
    descricao: falta('Descrição'),
    endereco: falta('Endereço'),
  };
  const temCampos = Object.values(pede).some(Boolean);

  const enviar = async (campos) => {
    setSalvando(true); setErro(null);
    try { await onSalvar(n, campos); } catch (err) { setErro(err.message); } finally { setSalvando(false); }
  };
  const salvar = (e) => {
    e.preventDefault();
    const campos = {};
    for (const [k, pedido] of Object.entries(pede)) if (pedido) campos[k] = valores[k];
    enviar(campos);
  };
  const mudar = (k) => (e) => setValores((v) => ({ ...v, [k]: e.target.value }));

  const campo = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)', fontFamily: 'inherit' };
  const botao = (cor) => ({ fontSize: 12, fontWeight: 700, color: '#fff', background: cor, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' });
  const mensagem = (prefixo) => n.erros.find((e) => e.startsWith(prefixo)) || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${COR[situacao]}`, borderRadius: 'var(--r-md, 10px)', opacity: situacao === 'ja_emitida' ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', flex: '1 1 180px' }}>{n.nome || 'Paciente sem nome'}</span>
        {n.data && <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={10} /> {fmtData(n.data)}</span>}
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)' }}>{n.valor != null ? fmt(n.valor) : '—'}</span>
      </div>
      {n.descricao && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{n.descricao}</span>}

      {situacao === 'pronta' && (
        <span style={{ fontSize: 11.5, color: 'var(--ok)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          <CheckCircleIcon size={12} /> Pronta — o escritório vai emitir
        </span>
      )}

      {situacao === 'ja_emitida' && (
        <span style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 600 }}>
          Já emitida — {mensagem('Já emitida:').replace(/^Já emitida:\s*/, '').replace(/\s*Remova do lote.*$/, '')}. Não será emitida de novo.
        </span>
      )}

      {situacao === 'complementar' && (
        <>
          <span style={{ fontSize: 11.5, color: 'var(--info)', fontWeight: 700 }}>
            Possível nota complementar: {mensagem('Complementar?').replace(/^Complementar\?\s*/, '').replace(/\s*Se faltar só a diferença.*$/, '')}
          </span>
          {/mude o valor para/.test(mensagem('Complementar?')) ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" disabled={salvando} onClick={() => enviar({ complementar: true })} style={botao('var(--info)')}>
                {salvando ? 'Salvando…' : `Emitir só a diferença (${(mensagem('Complementar?').match(/mude o valor para (R\$\s?[\d.,]+)/) || [])[1] || ''})`}
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>Se não for o caso, avise o escritório.</span>
            </div>
          ) : <span style={{ fontSize: 11, color: 'var(--text3)' }}>O escritório vai conferir com você.</span>}
        </>
      )}

      {(situacao === 'falta' || situacao === 'invalida') && (
        <>
          <span style={{ fontSize: 11, color: n.erros.length ? 'var(--danger)' : 'var(--warn)', fontWeight: 600 }}>
            {[...n.erros, ...(n.pendencias.length ? [`Falta: ${n.pendencias.join(', ')}`] : [])].join(' · ')}
          </span>
          {n.avisos.length > 0 && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{n.avisos.join(' · ')}</span>}
          {temCampos && (
            <form onSubmit={salvar} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {pede.nome && <input placeholder="Nome completo do paciente" value={valores.nome} onChange={mudar('nome')} aria-label="Nome" style={{ ...campo, flex: '2 1 200px' }} />}
              {pede.cpf && <input placeholder="CPF do paciente" inputMode="numeric" value={valores.cpf} onChange={mudar('cpf')} aria-label="CPF" style={{ ...campo, flex: '1 1 150px' }} />}
              {pede.data && <input placeholder="Data do atendimento (dd/mm/aaaa)" inputMode="numeric" value={valores.data} onChange={mudar('data')} aria-label="Data do atendimento" style={{ ...campo, flex: '1 1 170px' }} />}
              {pede.descricao && <input placeholder="Descrição do serviço" value={valores.descricao} onChange={mudar('descricao')} aria-label="Descrição" style={{ ...campo, flex: '2 1 200px' }} />}
              {pede.endereco && <input placeholder="Endereço completo (rua, número, bairro, cidade)" value={valores.endereco} onChange={mudar('endereco')} aria-label="Endereço" style={{ ...campo, flex: '3 1 260px' }} />}
              <button type="submit" disabled={salvando} style={botao('var(--accent)')}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </form>
          )}
          {!temCampos && <span style={{ fontSize: 11, color: 'var(--text3)' }}>O escritório vai conferir esta nota.</span>}
        </>
      )}
      {erro && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{erro}</span>}
    </div>
  );
}
