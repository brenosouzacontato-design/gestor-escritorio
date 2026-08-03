import { useEffect, useState } from 'react';
import { obterDocumentoPublico, itemResolvido } from './documentosApi';

function fmtData(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Página pública (sem login) pra compartilhar um documento anexado com o
// cliente via link — só leitura, sem sidebar. Acessada via ?doc=<id> (ver
// main.jsx, que renderiza essa página no lugar do app inteiro quando
// detecta o param). Mesmo padrão de RelatorioCompartilhadoPage.jsx.
export default function DocumentoCompartilhadoPage({ documentoId }) {
  const [doc, setDoc] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    obterDocumentoPublico(documentoId)
      .then(setDoc)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [documentoId]);

  const ehImagem = doc?.tipo_mime?.startsWith('image/');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Documento
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>
            {carregando ? '...' : doc?.tipo_documento_sugerido || doc?.nome_arquivo}
          </div>
          {doc?.clientes?.nome && (
            <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>{doc.clientes.nome}</div>
          )}
        </div>

        <div style={{ padding: 24 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && doc && (
            <>
              {itemResolvido(doc) && (
                <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
                  Referente a: <strong style={{ color: 'var(--text1)' }}>{itemResolvido(doc)}</strong>
                </div>
              )}

              {ehImagem ? (
                <img src={doc.urlArquivo} alt={doc.nome_arquivo} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : (
                <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border2)', borderRadius: 8, padding: 24, textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{doc.nome_arquivo}</p>
                  <a href={doc.urlArquivo} target="_blank" rel="noreferrer" className="btn btn-accent" style={{ textDecoration: 'none' }}>
                    Abrir documento
                  </a>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 16 }}>
                Enviado em {fmtData(doc.created_at)}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Compartilhado pelo Gestor — Escritório Contábil.
        </div>
      </div>
    </div>
  );
}
