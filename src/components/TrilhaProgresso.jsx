import { CheckIcon } from 'lucide-react'
import { ETAPAS_TRILHA } from '../lib/trilhaFechamento'

// Trilha de 6 etapas do fechamento de uma empresa (src/lib/trilhaFechamento.js).
// Feito = verde; etapa atual = laranja (roxo se aguardando cliente, vermelho
// se tem obrigação vencida); "Aguardando cliente" que a empresa não passou
// aparece tracejada. Usada no Fechamento (Tracker) e no link da carteira.
export const COR_ROXO = '#7C3AED'

export default function TrilhaProgresso({ trilha, compacto = false }) {
  const { etapa, aguardando, vencidas, feitas, total, guiasTotal, guiasEnviadas, guiasAbertas, vazia } = trilha
  return (
    <div role="img" aria-label={vazia ? 'Sem obrigações na competência' : `Etapa atual: ${ETAPAS_TRILHA[etapa].rotulo}`}
      style={{ display: 'grid', gridTemplateColumns: `repeat(${ETAPAS_TRILHA.length}, minmax(0, 1fr))`, alignItems: 'start', opacity: vazia ? 0.45 : 1 }}>
      {ETAPAS_TRILHA.map((e, i) => {
        const ultimaFeita = i === 5 && etapa === 5
        const feito = i < etapa || ultimaFeita
        const atual = i === etapa && !ultimaFeita && !vazia
        const pulado = i === 2 && etapa > 2 && !aguardando
        const corAtual = vencidas > 0 && etapa < 3 ? 'var(--danger)' : aguardando ? COR_ROXO : 'var(--warn)'
        const corLinha = feito || atual ? (atual && aguardando ? COR_ROXO : 'var(--ok)') : 'var(--surface3)'
        let detalhe = null
        if (i === 1 && etapa >= 1 && total > 0) detalhe = `${feitas}/${total}`
        if (i === 4 && guiasTotal > 0) detalhe = `${guiasEnviadas}/${guiasTotal}`
        if (i === 5 && guiasAbertas > 0) detalhe = `${guiasAbertas} guia${guiasAbertas !== 1 ? 's' : ''}`
        const titulo = `${e.rotulo}${detalhe ? ` · ${detalhe}` : ''}${pulado ? ' (não precisou)' : ''}`
        return (
          <div key={e.id} title={titulo} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, position: 'relative', minWidth: 0 }}>
            {i > 0 && (
              <span aria-hidden="true" style={{ position: 'absolute', top: compacto ? 8 : 10, right: '50%', width: '100%', height: 3, background: corLinha, zIndex: 0 }} />
            )}
            <span style={{
              width: compacto ? 18 : 22, height: compacto ? 18 : 22, borderRadius: 99, zIndex: 1, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800,
              border: `2px ${pulado ? 'dashed' : 'solid'} ${feito && !pulado ? 'var(--ok)' : atual ? corAtual : 'var(--surface3)'}`,
              background: feito && !pulado ? 'var(--ok)' : atual ? `color-mix(in srgb, ${corAtual}, transparent 86%)` : 'var(--surface)',
              color: feito && !pulado ? '#fff' : atual ? corAtual : 'var(--text3)',
            }}>
              {feito && !pulado ? <CheckIcon size={compacto ? 10 : 12} strokeWidth={3} /> : pulado ? '–' : i + 1}
            </span>
            {!compacto && (
              <span style={{ fontSize: 9.5, lineHeight: 1.2, textAlign: 'center', color: atual ? 'var(--text1)' : 'var(--text3)', fontWeight: atual ? 700 : 500 }}>
                {e.rotulo}
                {detalhe && <><br /><span style={{ fontVariantNumeric: 'tabular-nums' }}>{detalhe}</span></>}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
