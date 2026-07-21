import React from 'react';

const LABEL_TIPO = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receitas', custo: 'Custos', despesa: 'Despesas',
};

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Balancete em lista vertical — cada conta é um card empilhado (não uma
// tabela larga de 5 colunas), pra caber bem tanto no desktop quanto no
// celular. Reaproveitado pelo Balancete dentro do app e pelo link
// compartilhado via WhatsApp (esse é aberto majoritariamente no celular).
// onClickConta opcional: sem ele os cards não são clicáveis (página
// pública, só leitura). porTipo: [{ tipo, contas, total }], onde cada
// conta já veio de comSomasDeFilhas (nivelExibicao, temFilhas) e total já
// veio de somarRaizes.
export default function BalanceteLista({ porTipo, onClickConta }) {
  return (
    <div>
      {porTipo.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {porTipo.map((grupo) => (
            <div key={grupo.tipo} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '8px 14px', flex: '1 1 150px', minWidth: 140 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>
                Total {LABEL_TIPO[grupo.tipo]}
              </div>
              <div className="num" style={{ fontSize: 15, fontWeight: 800, marginTop: 2,
                color: grupo.total.saldoAtual < 0 ? 'var(--danger)' : 'var(--text1)' }}>
                {fmt(grupo.total.saldoAtual)}
              </div>
            </div>
          ))}
        </div>
      )}

      {porTipo.length === 0 && <p style={{ color: 'var(--text2)' }}>Nenhuma movimentação no período.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {porTipo.map((grupo) => (
          <div key={grupo.tipo}>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '.04em',
              color: 'var(--text2)', fontWeight: 700, marginBottom: 8, paddingLeft: 2 }}>
              {LABEL_TIPO[grupo.tipo]}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {grupo.contas.map((l) => (
                <div key={l.conta.id}
                  onClick={onClickConta ? () => onClickConta(l.conta, l.saldoAnterior) : undefined}
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                    padding: '10px 14px', paddingLeft: 14 + l.nivelExibicao * 16,
                    cursor: onClickConta ? 'pointer' : 'default', transition: 'background .1s',
                  }}
                  onMouseEnter={onClickConta ? (e) => { e.currentTarget.style.background = 'var(--surface2)'; } : undefined}
                  onMouseLeave={onClickConta ? (e) => { e.currentTarget.style.background = 'var(--surface)'; } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: l.temFilhas ? 700 : 500, color: 'var(--text1)' }}>
                      {l.nivelExibicao > 0 ? '↳ ' : ''}{l.conta.codigo} - {l.conta.nome}
                    </span>
                    <span className="num" style={{ fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap',
                      color: l.saldoAtual < 0 ? 'var(--danger)' : 'var(--text1)' }}>
                      {fmt(l.saldoAtual)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4, fontSize: '0.72rem', color: 'var(--text3)' }}>
                    <span>Anterior: {fmt(l.saldoAnterior)}</span>
                    <span>Débito: {fmt(l.debito)}</span>
                    <span>Crédito: {fmt(l.credito)}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                background: '#1B2B4B', color: '#fff', borderRadius: 10, padding: '10px 14px', marginTop: 2 }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Total {LABEL_TIPO[grupo.tipo]}</span>
                <span className="num" style={{ fontWeight: 800, fontSize: '1rem' }}>{fmt(grupo.total.saldoAtual)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
