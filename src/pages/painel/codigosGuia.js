// codigosGuia.js
// Lê o código de barras (linha digitável) e o PIX copia e cola de uma guia
// anexada, direto no navegador: a linha digitável sai do texto do PDF (as
// guias da Receita trazem o texto, não só imagem) e o PIX sai do QR code,
// desenhando a página num canvas. Quem confere e grava é
// netlify/functions/painel-codigos-guia.js — aqui só se coletam candidatos.
// pdfjs e jsQR são carregados sob demanda pra não pesar a abertura do painel.

// 48 dígitos de arrecadação (4 blocos de 11 + DV, começando por 8) ou
// 47 do boleto bancário, com os espaços/pontos que o PDF põe entre os blocos
const RE_ARRECADACAO = /8\d{10}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d/g;
const RE_BOLETO = /\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14}/g;

let pdfjsPronto = null;
async function carregarPdfjs() {
  if (!pdfjsPronto) {
    pdfjsPronto = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      });
  }
  return pdfjsPronto;
}

function lerQr(jsQR, contexto, largura, altura) {
  const img = contexto.getImageData(0, 0, largura, altura);
  const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return qr?.data?.startsWith('000201') ? qr.data : null;
}

// Devolve { linhasDigitaveis: [string], pixCopiaCola: string|null }.
export async function lerCodigosDaGuia(url, tipoMime) {
  const [{ default: jsQR }, resp] = await Promise.all([import('jsqr'), fetch(url)]);
  if (!resp.ok) throw new Error(`Não consegui baixar a guia (${resp.status}).`);
  const bytes = new Uint8Array(await resp.arrayBuffer());

  // foto da guia: só dá pra achar o QR (não há texto pra linha digitável)
  if ((tipoMime || '').startsWith('image/')) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: tipoMime }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { linhasDigitaveis: [], pixCopiaCola: lerQr(jsQR, ctx, canvas.width, canvas.height) };
  }

  const pdfjs = await carregarPdfjs();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const linhas = [];
  let pix = null;
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const pagina = await pdf.getPage(n);
    const texto = (await pagina.getTextContent()).items.map((i) => i.str).join(' ');
    linhas.push(...(texto.match(RE_ARRECADACAO) || []), ...(texto.match(RE_BOLETO) || []));
    if (!pix) {
      // escala 2 já basta pro QR das guias da Receita; 3 é a segunda chance
      for (const escala of [2, 3]) {
        const viewport = pagina.getViewport({ scale: escala });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        await pagina.render({ canvasContext: ctx, viewport }).promise;
        pix = lerQr(jsQR, ctx, canvas.width, canvas.height);
        if (pix) break;
      }
    }
  }
  await pdf.destroy();
  return { linhasDigitaveis: [...new Set(linhas)].slice(0, 5), pixCopiaCola: pix };
}
