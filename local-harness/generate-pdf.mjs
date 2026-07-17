// Generates a valid single-page sample.pdf with a correct xref table.
import { writeFileSync } from 'node:fs';

const objects = [];
objects.push('<</Type /Catalog /Pages 2 0 R>>');
objects.push('<</Type /Pages /Kids [3 0 R] /Count 1>>');
objects.push('<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>');
objects.push('<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>');
const stream =
  'BT /F1 28 Tf 72 700 Td (Nutrient x ServiceNow) Tj ET\n' +
  'BT /F1 14 Tf 72 662 Td (Local Web SDK harness - test document) Tj ET\n' +
  'BT /F1 12 Tf 72 620 Td (Toolbar: annotate, Save \\(exports PDF\\), Digitally Sign.) Tj ET';
objects.push(`<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream`);

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefStart = Buffer.byteLength(pdf, 'latin1');
pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
offsets.forEach((off) => { pdf += String(off).padStart(10, '0') + ' 00000 n \n'; });
pdf += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

writeFileSync(new URL('./sample.pdf', import.meta.url), Buffer.from(pdf, 'latin1'));
console.log('wrote sample.pdf', Buffer.byteLength(pdf, 'latin1'), 'bytes');
