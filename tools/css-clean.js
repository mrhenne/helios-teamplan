// Entfernt nachweislich wirkungsloses CSS, ohne die Kaskade zu verändern:
//  1. Selektoren mit Klassen/IDs, die weder in index.html noch in JS vorkommen
//  2. Deklarationen, die später vom identischen Selektor im identischen Kontext überschrieben werden
//  3. leere Regeln und leere @-Blöcke
// Aufruf: node tools/css-clean.js <datei.css> [...]   (überschreibt die Dateien)
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');

const root = path.join(__dirname, '..');
const sources = [fs.readFileSync(path.join(root, 'index.html'), 'utf8')];
for (const f of fs.readdirSync(root)) if (f.endsWith('.js') && !f.includes('config')) sources.push(fs.readFileSync(path.join(root, f), 'utf8'));
const jsDir = path.join(root, 'js');
if (fs.existsSync(jsDir)) for (const f of fs.readdirSync(jsDir)) sources.push(fs.readFileSync(path.join(jsDir, f), 'utf8'));
const src = sources.join('\n');

// Name gilt als lebendig, wenn er im Quelltext vorkommt oder ein Präfix wie "status-" dynamisch zusammengesetzt wird.
const aliveCache = new Map();
function alive(name) {
  if (aliveCache.has(name)) return aliveCache.get(name);
  let ok = src.includes(name);
  if (!ok) {
    const parts = name.split('-');
    for (let i = parts.length - 1; i >= 1 && !ok; i--) {
      const prefix = parts.slice(0, i).join('-') + '-';
      if (prefix.length >= 3 && new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `(['"\`]\\s*\\+|\\$\\{)`).test(src)) ok = true;
    }
  }
  aliveCache.set(name, ok);
  return ok;
}

function selectorIsDead(sel) {
  let dead = false;
  selectorParser(s => {
    s.walk(node => {
      if (dead) return false;
      if (node.type === 'pseudo' && /^:(not|where|is|has)$/.test(node.value)) return false; // Inhalt nicht auswerten
      if ((node.type === 'class' || node.type === 'id') && !alive(node.value)) dead = true;
    });
  }).processSync(sel);
  return dead;
}

const SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
};
// Werte, die ein älterer Browser evtl. verwirft – dann muss die frühere Deklaration als Fallback bleiben.
const RISKY_VALUE = /(dvh|svh|lvh|dvw|svw|lvw|env\(|constant\(|color-mix|-webkit-|-moz-|:has|light-dark|round\(|calc-size|anchor)/i;
const RISKY_PROP = /^(text-wrap|field-sizing|interpolate-size|anchor|position-|view-transition|scrollbar-|overscroll|content-visibility|container|text-box|zoom)/;

function contextOf(node) {
  const parts = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) parts.unshift(p.type === 'atrule' ? '@' + p.name + ' ' + p.params.replace(/\s+/g, ' ').trim() : p.selector);
  return parts.join(' / ');
}
const norm = s => selectorParser().processSync(s, { lossless: false }).replace(/\s+/g, ' ').trim();

function clean(css) {
  const ast = postcss.parse(css);
  const stats = { deadSelectors: 0, deadRules: 0, overridden: 0, emptyRules: 0 };

  ast.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    const list = rule.selectors;
    const keep = list.filter(s => !selectorIsDead(s));
    if (keep.length === list.length) return;
    stats.deadSelectors += list.length - keep.length;
    if (!keep.length) { rule.remove(); stats.deadRules++; } else rule.selectors = keep;
  });

  // Überschriebene Deklarationen: von hinten nach vorn, je Kontext+Selektor die "später gesetzten" Eigenschaften merken.
  const rules = [];
  ast.walkRules(r => { if (!(r.parent.type === 'atrule' && /keyframes/i.test(r.parent.name))) rules.push(r); });
  // Je Selektor und Kontext: gibt es für eine Eigenschaft eine spätere, sicher unterstützte Deklaration (normal / !important)?
  // Eine spätere Regel überschreibt auch dann sicher, wenn ihr Kontext weniger einschränkt: z. B. später ohne @media,
  // früher in @media (…) – die spätere gilt überall dort, wo die frühere gilt.
  const later = new Map(); // selektor -> Map(kontext -> Map(prop -> {safe, safeImportant}))
  const coveringContexts = (bySel, ctx) => {
    const out = [];
    for (const [c, seen] of bySel) {
      if (c === ctx) { out.push(seen); continue; }
      if (c !== '' && !ctx.startsWith(c + ' / ')) continue;
      const rest = (c === '' ? ctx : ctx.slice(c.length + 3)).split(' / ');
      if (rest.every(part => /^@(media|supports) /.test(part))) out.push(seen);
    }
    return out;
  };
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    const sel = r.selectors.map(norm).join(', ');
    const ctx = contextOf(r);
    if (/@layer|@scope/.test(ctx)) continue;
    const bySel = later.get(sel) || new Map();
    const covering = coveringContexts(bySel, ctx);
    const seen = bySel.get(ctx) || new Map();
    const decls = r.nodes.filter(n => n.type === 'decl' && !n.prop.startsWith('--'));
    for (const d of decls) {
      const p = d.prop.toLowerCase();
      const covers = [p, ...Object.entries(SHORTHANDS).filter(([, l]) => l.includes(p)).map(([s]) => s)];
      if (covering.some(s => covers.some(c => { const w = s.get(c); return w && (d.important ? w.safeImportant : w.safe); }))) { d.remove(); stats.overridden++; }
    }
    for (const d of r.nodes.filter(n => n.type === 'decl' && !n.prop.startsWith('--'))) {
      const p = d.prop.toLowerCase();
      if (RISKY_VALUE.test(d.value) || RISKY_PROP.test(p) || p.startsWith('-')) continue;
      const w = seen.get(p) || { safe: false, safeImportant: false };
      w.safe = true;
      if (d.important) w.safeImportant = true;
      seen.set(p, w);
    }
    bySel.set(ctx, seen);
    later.set(sel, bySel);
  }

  let changed = true;
  while (changed) {
    changed = false;
    ast.walk(n => {
      if ((n.type === 'rule' || (n.type === 'atrule' && n.nodes && !/font-face|page/i.test(n.name))) && n.nodes.filter(c => c.type !== 'comment').length === 0) {
        n.remove(); stats.emptyRules++; changed = true;
      }
    });
  }
  return { css: ast.toString(), stats };
}

for (const f of process.argv.slice(2)) {
  const before = fs.readFileSync(f, 'utf8');
  const { css, stats } = clean(before);
  fs.writeFileSync(f, css);
  console.log(path.basename(f), stats, `${before.split('\n').length} → ${css.split('\n').length} Zeilen`);
}
