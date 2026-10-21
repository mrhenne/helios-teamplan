// Vergleicht zwei Snapshot-Ordner und listet abweichende Elemente und Eigenschaften.
// Aufruf: node tools/visual/compare.js <ordnerA> <ordnerB> [maxDetails]
// Mit BOX=0 werden reine Positions-/Größenabweichungen ausgeblendet.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const load = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));

const [A, B, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg || 15);
const WITH_BOX = process.env.BOX !== '0';
const parse = s => Object.fromEntries((s || '').split(';').filter(Boolean).map(x => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }));
const short = p => p.split('>').slice(-3).join('>');

let total = 0, files = 0;
const summary = {};
for (const f of fs.readdirSync(A).filter(f => f.endsWith('.json.gz')).sort()) {
  if (!fs.existsSync(path.join(B, f))) { console.log('FEHLT in B:', f); total++; continue; }
  const a = load(path.join(A, f)), b = load(path.join(B, f));
  const pairCache = new Map();
  const propDiff = (ia, ib) => {
    const k = ia + '|' + ib;
    if (!pairCache.has(k)) {
      const pa = parse(a.styles[ia]), pb = parse(b.styles[ib]);
      pairCache.set(k, [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(p => pa[p] !== pb[p]).map(p => [p, pa[p], pb[p]]));
    }
    return pairCache.get(k);
  };
  const diffs = [];
  if (a.elements.length !== b.elements.length) diffs.push(`Elementanzahl ${a.elements.length} → ${b.elements.length}`);
  const bm = new Map(b.elements.map(e => [e[0], e]));
  for (const ea of a.elements) {
    const eb = bm.get(ea[0]);
    if (!eb) { diffs.push('fehlt: ' + ea[0]); continue; }
    if (WITH_BOX && ea[4] !== eb[4]) diffs.push(`Box ${short(ea[0])}: ${ea[4]} → ${eb[4]}`);
    for (const [i, label] of [[1, ''], [2, '::before'], [3, '::after']]) {
      if (a.styles[ea[i]] === b.styles[eb[i]]) continue;
      for (const [p, va, vb] of propDiff(ea[i], eb[i])) {
        if (!WITH_BOX && /^(width|height|inline-size|block-size|transform-origin|perspective-origin|left|top|right|bottom|inset-.*)$/.test(p)) continue;
        diffs.push(`${short(ea[0])}${label} { ${p}: ${va} → ${vb} }`);
        summary[p] = (summary[p] || 0) + 1;
      }
    }
  }
  if (JSON.stringify(a.errors) !== JSON.stringify(b.errors)) diffs.push('JS-Fehler: ' + JSON.stringify(a.errors) + ' → ' + JSON.stringify(b.errors));
  if (diffs.length) { files++; total += diffs.length; console.log(`\n✗ ${f}: ${diffs.length} Abweichungen`); diffs.slice(0, MAX).forEach(d => console.log('   ' + d)); }
}
console.log(`\n${total ? '✗' : '✓'} ${total} Abweichungen in ${files} Ansichten`);
if (Object.keys(summary).length) console.log('Eigenschaften:', JSON.stringify(summary));
process.exit(total ? 1 : 0);
