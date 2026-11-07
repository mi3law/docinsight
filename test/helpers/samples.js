// A realistic synthetic history for the interface and the long-history tests: two sessions of human-like typing with
// corrections and an edit higher up, a pasted paragraph, a second tab, a teacher's comment-like edit, a move.
import { DocGen, prose } from './gen.js';

export function sampleHistory(seed = 5) {
  const g = new DocGen({ seed });
  g.type('The Causes of the First World War\n', { gapMs: 240 });
  const p1 = prose(120, seed + 1);
  for (let i = 0; i < p1.length; i += 40) {
    g.type(p1.slice(i, i + 40), { gapMs: 230 });
    if (i % 200 === 0) g.type('tyop', { gapMs: 200 }).backspace(4);
  }
  g.type('\n', { gapMs: 300 });
  g.wait(35 * 60000).session('sessB');
  g.paste(prose(140, seed + 2) + '\n');
  g.cur = 40;
  g.type(' (an important point)', { gapMs: 260 });
  g.cur = g.body.length;
  g.type(prose(90, seed + 3), { gapMs: 250 });
  g.as('202').wait(60000).insertRaw(' [check this source]', 20).as('101');
  g.cur = g.body.length;
  g.addTab('t.notes1', 'Notes').type('Ideas: alliances, militarism, the assassination.', { gapMs: 220 });
  g.inTab('t.0');
  g.title = 'Essay: causes of the First World War';
  const raw = g.build();
  raw.title = 'Essay: causes of the First World War';
  raw.userMap = { 101: { name: 'Sam Student', color: '#4285f4' }, 202: { name: 'Ms Teacher', color: '#db4437' } };
  return raw;
}
