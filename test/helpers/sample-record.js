// Writes a synthetic DocInsight record (made-up text and names) for looking at the interface:
//   node test/helpers/sample-record.js <out.html>
import { writeFileSync } from 'node:fs';
import { analyse } from '../../src/engine/analyse.js';
import { buildRecordHtml } from '../../src/engine/record.js';
import { sampleHistory } from './samples.js';

const raw = sampleHistory();
const A = analyse(raw, {}, { title: raw.title, teacherUid: '202' });
writeFileSync(process.argv[2] || 'sample-record.html', buildRecordHtml(A, { raw, context: { title: raw.title, href: 'https://docs.google.com/document/d/SYNTHETIC/edit', teacherUid: '202' }, notes: 'Synthetic example.' }));
