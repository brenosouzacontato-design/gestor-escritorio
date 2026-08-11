import { useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, LayersIcon, ListIcon } from 'lucide-react'

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

// Lista de "Lançamentos a identificar" com opção de agrupar por dia (cada
// grupo recolhe/expande) ou ver tudo numa lista só — reaproveitado por
// IdentificarLancamentosPage.jsx e a seção equivalente de
// PainelClientePage.jsx (mesma UX nos dois lugares onde a identificação
// aparece). `LinhaComponent` é o componente de linha de cada página (elas
// têm um `LinhaIdentificar` quase idêntico, mas com estilos levemente
// diferentes — não vale a pena unificar só por isso).
export default function LancamentosAgrupados({ lancamentos, LinhaComponent, onSaved }) {
  const [agrupado, setAgrupado] = useState(true)
  // dias abertos (expandidos) — por padrão nenhum, os grupos nascem
  // recolhidos (com muitos lançamentos por dia, tudo aberto de cara não
  // reduz a poluição visual, que é o ponto de agrupar por dia).
  const [abertos, setAbertos] = useState(() => new Set())

  const grupos = useMemo(() => {
    if (!agrupado) return null
    const porData = {}
    lancamentos.forEach((l) => { (porData[l.data] ||= []).push(l) })
    return Object.entries(porData).sort((a, b) => b[0].localeCompare(a[0]))
  }, [lancamentos, agrupado])

  const toggleGrupo = (data) => setAbertos((prev) => {
    const next = new Set(prev)
    if (next.has(data)) next.delete(data); else next.add(data)
    return next
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={() => setAgrupado((a) => !a)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 99, padding: '4px 10px', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontWeight: 500 }}>
          {agrupado ? <ListIcon size={12} /> : <LayersIcon size={12} />}
          {agrupado ? 'Desagrupar' : 'Agrupar por dia'}
        </button>
      </div>

      {!agrupado && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lancamentos.map((l) => <LinhaComponent key={l.id} lancamento={l} onSaved={onSaved} />)}
        </div>
      )}

      {agrupado && grupos.map(([data, itens]) => {
        const colapsado = !abertos.has(data)
        return (
          <div key={data} style={{ marginBottom: 10 }}>
            <button onClick={() => toggleGrupo(data)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                marginBottom: colapsado ? 0 : 8 }}>
              {colapsado ? <ChevronRightIcon size={13} color="var(--text3)" /> : <ChevronDownIcon size={13} color="var(--text3)" />}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text1)' }}>{fmtData(data)}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>({itens.length})</span>
            </button>
            {!colapsado && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
                {itens.map((l) => <LinhaComponent key={l.id} lancamento={l} onSaved={onSaved} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
