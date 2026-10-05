/*
 * Generate minimal valid PDF test files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'tests', 'input');

await fs.mkdir(OUT_DIR, { recursive: true });

function buildPdf(contentStream) {
  const objects = [];

  function addObject(data) {
    const index = objects.length + 1;
    objects.push({ index, data });
    return `${index} 0 R`;
  }

  const catalog = addObject('<< /Type /Catalog /Pages ' + addObject('<< /Type /Pages /Kids [' + addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`) + ' /Resources << /Font << /F1 ' + addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') + ' >> >> >>') + '] /Count 1 >>') + ' >>');

  let body = '%PDF-1.4\n';
  const offsets = [];

  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj.index} 0 obj\n${obj.data}\nendobj\n`;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';

  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} >>\n`;
  body += `startxref\n${xrefOffset}\n`;
  body += '%%EOF\n';

  return Buffer.from(body);
}

const files = {
  'simple.pdf': buildPdf(
    'BT\n/F1 12 Tf\n100 700 Td\n(Hello, Ghostscript WASM!) Tj\nET\n'
  ),
  'images.pdf': buildPdf(
    'BT\n/F1 14 Tf\n100 750 Td\n(Document with placeholder image data) Tj\nET\n'
  ),
  'large.pdf': buildPdf(
    'BT\n/F1 10 Tf\n72 720 Td\n(' +
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50) +
    ') Tj\nET\n'
  )
};

for (const [name, buffer] of Object.entries(files)) {
  const outPath = path.join(OUT_DIR, name);
  await fs.writeFile(outPath, buffer);
  console.log(`Created ${outPath} (${buffer.length} bytes)`);
}
