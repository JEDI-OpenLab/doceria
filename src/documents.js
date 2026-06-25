// Lecture de documents de contexte, robuste aux gros fichiers et aux erreurs.
// Formats : txt, md, markdown, csv, tsv, json, log (texte brut) ; pdf (pdf.js) ; docx (mammoth).
// pdf.js et mammoth sont chargés dynamiquement (seulement à l'ouverture d'un PDF / DOCX),
// pour garder le bundle d'entrée léger.

const MAX_DOC_CHARS = 120000; // limite de contexte injecté
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 Mo : garde-fou pour ne pas figer le navigateur
const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'text'];

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

// Lit un fichier et renvoie { name, text, charCount, truncated }.
// onProgress(page, total) est appelé pendant la lecture d'un PDF.
export async function readDocument(file, onProgress) {
  if (!file) throw new Error('Aucun fichier.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Fichier trop volumineux (${(file.size / 1048576).toFixed(1)} Mo, max 25 Mo).`);
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let text;

  try {
    if (ext === 'pdf') text = await readPdf(file, onProgress);
    else if (ext === 'docx') text = await readDocx(file);
    else if (TEXT_EXTS.includes(ext)) text = await file.text();
    else text = await file.text(); // tentative en texte brut pour les extensions inconnues
  } catch (err) {
    throw new Error(formatReadError(ext, err));
  }

  text = (text || '').trim();
  if (!text) throw new Error('Aucun texte extractible (document vide, image scannée ou format non pris en charge).');

  let truncated = false;
  if (text.length > MAX_DOC_CHARS) {
    text = text.slice(0, MAX_DOC_CHARS);
    truncated = true;
  }

  return { name: file.name, text, charCount: text.length, truncated };
}

async function readPdf(file, onProgress) {
  const pdfjsLib = await getPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
    if (onProgress) onProgress(i, pdf.numPages);
  }
  return out;
}

async function readDocx(file) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

function formatReadError(ext, err) {
  const base = (err && err.message) || String(err);
  if (ext === 'pdf') {
    if (err && err.name === 'PasswordException') return 'PDF protégé par mot de passe : impossible à lire.';
    return `Lecture du PDF impossible (${base}). Le fichier est peut-être scanné (sans couche texte).`;
  }
  if (ext === 'docx') return `Lecture du DOCX impossible (${base}).`;
  return `Lecture du fichier impossible (${base}).`;
}
