import { useEffect, useState } from 'react'
import { BellRingIcon, BellOffIcon, SmartphoneIcon } from 'lucide-react'
import { useToast } from './shared'
import { situacaoAvisos, ativarAvisos, desativarAvisos } from '../lib/gestorPush'

const DICA = {
  ios_instalar: 'No iPhone/iPad: toque em Compartilhar → "Adicionar à Tela de Início", abra o Gestor pelo ícone e ative aqui.',
  bloqueado: 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador e tente de novo.',
  sem_suporte: 'Este navegador não recebe notificações. Use o Chrome, Edge ou o app instalado.',
}

// Botão "Avisos neste aparelho" — liga/desliga a notificação dos lembretes
// com hora marcada neste celular/computador.
export default function AvisosAparelho() {
  const [situacao, setSituacao] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const { show } = useToast()

  useEffect(() => { situacaoAvisos().then(setSituacao).catch(() => setSituacao('sem_suporte')) }, [])
  if (!situacao) return null

  const alternar = async () => {
    if (DICA[situacao]) { show?.(DICA[situacao]); return }
    setOcupado(true)
    try {
      if (situacao === 'ativo') {
        await desativarAvisos()
        show?.('Avisos desligados neste aparelho.')
      } else {
        await ativarAvisos()
        show?.('Pronto: os lembretes vão chegar como notificação neste aparelho.')
      }
      setSituacao(await situacaoAvisos())
    } catch (e) {
      show?.(e.message)
    }
    setOcupado(false)
  }

  const ativo = situacao === 'ativo'
  return (
    <button className={`btn btn-sm ${ativo ? '' : 'btn-ghost'}`} onClick={alternar} disabled={ocupado}
      title={ativo ? 'Lembretes chegam como notificação neste aparelho. Toque para desligar.' : (DICA[situacao] || 'Receber os lembretes das tarefas como notificação neste aparelho, na hora marcada')}
      style={ativo ? { color: 'var(--ok)', borderColor: 'var(--ok)' } : undefined}>
      {ativo ? <BellRingIcon size={12} /> : situacao === 'disponivel' ? <SmartphoneIcon size={12} /> : <BellOffIcon size={12} />}
      {ocupado ? 'Aguarde…' : ativo ? 'Avisos ativos aqui' : 'Ativar avisos neste aparelho'}
    </button>
  )
}
