import { useState } from 'react';
import { CheckCircleIcon, AlertTriangleIcon, Loader2Icon } from 'lucide-react';
import { salvarObservacaoCliente } from './contabilApi';

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function sinal(natureza) {
  return natureza === 'entrada' ? '+ ' : natureza === 'saida' ? '− ' : '';
}
function corNatureza(natureza) {
  return natureza === 'saida' ? 'var(--danger)' : natureza === 'entrada' ? 'var(--ok)' : 'var(--text1)';
}

// Lançamentos "a identificar" do extrato bancário — uma tabela só (não mais
// pendentes-em-tabela + identificados-em-cards separados), com a
// identificação como mais uma coluna, editável direto na linha (sem
// popup): digita e sai do campo (ou Enter) já salva. Pendentes primeiro,
// pra ficar óbvio o que ainda falta.
// Reaproveitado pela tela de compartilhamento (IdentificarLancamentosPage,
// link mandado pro cliente) e pela aba Contábil do Painel do cliente —
// mesma UX nos dois lugares onde a identificação aparece.
//
// `onSaved` é chamado depois de um salvamento bem-sucedido — cada chamador
// decide como atualizar sua lista (refetch completo, ou só forçar
// re-render já que o objeto do lançamento é mutado em memória aqui).
export default function LancamentosIdentificar({ lancamentos, onSaved }) {
  const [filtro, setFiltro] = useState('');

  const termo = filtro.trim().toLowerCase();
  const lancamentosFiltrados = termo
    ? lancamentos.filter((l) => `${l.historico || ''} ${l.numeroDocumento || ''} ${l.observacaoCliente || ''}`.toLowerCase().includes(termo))
    : lancamentos;

  const pendentes = lancamentosFiltrados.filter((l) => !l.observacaoCliente);
  const identificados = lancamentosFiltrados.filter((l) => l.observacaoCliente);
  const totalPendente = pendentes.reduce((s, l) => s + (l.valor || 0), 0);
  const totalIdentificado = identificados.reduce((s, l) => s + (l.valor || 0), 0);
  // Pendentes primeiro (é o que precisa de ação), identificados depois —
  // dentro de cada grupo mantém a ordem que já veio (mais recente primeiro).
  const linhas = [...pendentes, ...identificados];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <CardResumo icone={<AlertTriangleIcon size={13} />} label="A identificar" valor={fmt(totalPendente)} qtd={pendentes.length} cor="var(--warn)" />
        <CardResumo icone={<CheckCircleIcon size={13} />} label="Identificados" valor={fmt(totalIdentificado)} qtd={identificados.length} cor="var(--ok)" />
      </div>

      {lancamentos.length > 5 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '6px 10px', marginBottom: 14, maxWidth: 280 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>🔍</span>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por texto do lançamento..."
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11.5, color: 'var(--text2)', width: '100%' }} />
        </div>
      )}

      {termo && linhas.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12.5, padding: '20px 0' }}>Nenhum lançamento com "{filtro}".</div>
      )}

      {linhas.length === 0 && !termo && (
        <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12.5, padding: '20px 0' }}>Nenhum lançamento nesse período.</div>
      )}

      {linhas.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={thStyle}>Data</th>
                <th style={thStyle}>Descrição</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
                <th style={thStyle}>Tipo</th>
                <th style={{ ...thStyle, minWidth: 200 }}>Identificação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtData(l.data)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text1)', fontWeight: 500 }}>{l.historico}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: corNatureza(l.natureza), whiteSpace: 'nowrap' }}>
                    {sinal(l.natureza)}{fmt(l.valor)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: corNatureza(l.natureza),
                      background: l.natureza === 'entrada' ? 'var(--ok-dim)' : l.natureza === 'saida' ? 'var(--danger-dim)' : 'var(--surface2)',
                      borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {l.natureza === 'entrada' ? 'Entrada' : l.natureza === 'saida' ? 'Saída' : '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <CelulaIdentificacao lancamento={l} onSaved={onSaved} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CardResumo({ icone, label, valor, qtd, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: cor, marginTop: 5 }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{qtd} lançamento{qtd !== 1 ? 's' : ''}</div>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' };
const tdStyle = { padding: '8px 12px' };

// Campo de identificação direto na linha da tabela — digita o que foi
// aquele lançamento e sai do campo (ou aperta Enter) pra salvar, sem
// precisar abrir popup. Ícone verde confirma quando já está identificado;
// o texto salvo mutando `lancamento.observacaoCliente` em memória segue o
// mesmo padrão que o resto do arquivo já usava com o popup.
function CelulaIdentificacao({ lancamento, onSaved }) {
  const [valor, setValor] = useState(lancamento.observacaoCliente || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const salvar = async () => {
    const texto = valor.trim();
    if (texto === (lancamento.observacaoCliente || '')) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarObservacaoCliente(lancamento.id, texto);
      lancamento.observacaoCliente = texto;
      onSaved?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input value={valor} onChange={(e) => setValor(e.target.value)} onBlur={salvar}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          disabled={salvando} placeholder="O que foi esse lançamento?"
          style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--surface)', color: 'var(--text1)', outline: 'none' }} />
        {salvando
          ? <Loader2Icon size={14} color="var(--text3)" style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />
          : lancamento.observacaoCliente && <CheckCircleIcon size={14} color="var(--ok)" style={{ flexShrink: 0 }} />}
      </div>
      {erro && <div style={{ fontSize: 10.5, color: 'var(--danger)', marginTop: 3 }}>Erro ao salvar: {erro}</div>}
    </div>
  );
}
