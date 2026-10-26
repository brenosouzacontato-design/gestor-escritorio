// Opções do "Dar baixa em" dos documentos (DocumentosPage.jsx e modal da
// empresa em Empresas.jsx), separadas em grupos: obrigações (mais recentes
// primeiro), tarefas e, quando houver, guias que o documento pode pagar.
// candidatos: saída de listarCandidatos (documentosApi.js), já filtrada pela
// empresa. guias: [{ id, rotulo }] de listarGuiasEmAberto, valor "guia:<id>".

// competência "MM/AAAA" (ou "AAAA-MM") vira "AAAAMM" pra ordenar
function chaveCompetencia(c) {
  const m = /^(\d{2})\/(\d{4})$/.exec(c || '')
  return m ? m[2] + m[1] : String(c || '').replace(/\D/g, '')
}

export default function OpcoesCandidatos({ candidatos = [], guias = [] }) {
  const obrigacoes = candidatos
    .filter((c) => c.tipo === 'etapa')
    .sort((a, b) => chaveCompetencia(b.competencia).localeCompare(chaveCompetencia(a.competencia)) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  const tarefas = candidatos
    .filter((c) => c.tipo === 'tarefa')
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  const rotuloTarefa = (c) => c.rotulo.replace(/^Tarefa: /, '')

  return (
    <>
      <optgroup label={obrigacoes.length ? `Obrigações (${obrigacoes.length})` : 'Obrigações — nenhuma em aberto'}>
        {obrigacoes.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
      </optgroup>
      <optgroup label={tarefas.length ? `Tarefas (${tarefas.length})` : 'Tarefas — nenhuma pendente'}>
        {tarefas.map((c) => <option key={c.id} value={c.id}>{rotuloTarefa(c)}</option>)}
      </optgroup>
      {guias.length > 0 && (
        <optgroup label="É comprovante de pagamento da guia">
          {guias.map((g) => <option key={g.id} value={`guia:${g.id}`}>{g.rotulo}</option>)}
        </optgroup>
      )}
    </>
  )
}
