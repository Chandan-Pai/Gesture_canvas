/**
 * PDF import via PDF.js (global script from index.html).
 */

function ensurePdfJs() {
  const lib = globalThis.pdfjsLib;
  if (!lib) {
    throw new Error('PDF.js did not load. Refresh the page and try again.');
  }
  if (!ensurePdfJs.ready) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    ensurePdfJs.ready = true;
  }
  return lib;
}

/**
 * @param {File} file
 * @returns {Promise<{ pdf: object, pageCount: number, fileName: string }>}
 */
export async function loadPdfFile(file) {
  if (!file) throw new Error('No file selected');
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Please choose a .pdf file');
  }

  const lib = ensurePdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data }).promise;
  return {
    pdf,
    pageCount: pdf.numPages,
    fileName: file.name,
  };
}

export function getPdfRenderScale() {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(4, Math.max(2.5, dpr * 2));
}

/**
 * Render every page to an offscreen canvas at high resolution for crisp text.
 * @param {object} pdfDoc - pdf.js document from loadPdfFile
 * @param {number} [renderScale]
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function renderAllPdfPages(pdfDoc, renderScale) {
  const scale = renderScale ?? getPdfRenderScale();
  const pages = [];
  for (let i = 1; i <= pdfDoc.pageCount; i++) {
    const page = await pdfDoc.pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  return pages;
}
