const fs = require('fs');

const html = fs.readFileSync('index.html','utf8');
const css = fs.readFileSync('styles.css','utf8');
const js = fs.readFileSync('app.js','utf8');
const sql = fs.readFileSync('supabase.sql','utf8');

function fail(msg){ throw new Error(msg); }

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const counts = ids.reduce((a,id)=>(a[id]=(a[id]||0)+1,a),{});
const dup = Object.entries(counts).filter(([,n])=>n>1);
if(dup.length) fail('Doppelte HTML IDs: '+JSON.stringify(dup));

const refs = [...js.matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g)].map(m=>m[1]);
const dynamicAllowed = new Set(['metricEmployees','metricVacation','metricXU','metricConflicts','copyInviteLink']);
const missing = [...new Set(refs.filter(id=>!counts[id]&&!dynamicAllowed.has(id)))];
if(missing.length) fail('JavaScript referenziert fehlende IDs: '+missing.join(', '));

const symbols = new Set([...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map(m=>m[1]));
const uses = [...html.matchAll(/<use\s+href="#([^"]+)"/g)].map(m=>m[1]);
const missingIcons = [...new Set(uses.filter(id=>!symbols.has(id)))];
if(missingIcons.length) fail('Fehlende SVG Symbole: '+missingIcons.join(', '));

const openCss=(css.match(/\{/g)||[]).length, closeCss=(css.match(/\}/g)||[]).length;
if(openCss!==closeCss) fail('CSS Klammern unausgeglichen: '+openCss+' / '+closeCss);

try { new Function(js); } catch(e) { fail('JavaScript Syntaxfehler: '+e.message); }

const tables=[...new Set([...js.matchAll(/\.from\(['"`]([^'"`]+)['"`]\)/g)].map(m=>m[1]))];
const sqlTables=new Set([...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([A-Za-z0-9_]+)/gi)].map(m=>m[1]));
const missingTables=tables.filter(t=>!sqlTables.has(t));
if(missingTables.length) fail('Im JS verwendete Supabase Tabellen fehlen im SQL: '+missingTables.join(', '));

const rpcs=[...new Set([...js.matchAll(/\.rpc\(['"`]([^'"`]+)['"`]/g)].map(m=>m[1]))];
const sqlFuncs=new Set([...sql.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?([A-Za-z0-9_]+)/gi)].map(m=>m[1]));
const missingRpc=rpcs.filter(x=>!sqlFuncs.has(x));
if(missingRpc.length) fail('Im JS verwendete RPC Funktionen fehlen im SQL: '+missingRpc.join(', '));

for(const table of ['team_plans','team_members','teamplan_discussions','teamplan_messages','teamplan_discussion_reads','teamplan_training_types','teamplan_trainings','teamplan_training_budgets']){
  const re=new RegExp('alter\\s+table\\s+public\\.'+table+'\\s+enable\\s+row\\s+level\\s+security','i');
  if(!re.test(sql)) fail('RLS fehlt für '+table);
}

if(!/\.topbar \.hidden[\s\S]*display:none!important/.test(css)) fail('Header Hidden-State-Garantie fehlt');

console.log('Static QA OK');
console.log('HTML IDs:',ids.length);
console.log('JS ID refs:',new Set(refs).size);
console.log('SVG symbols:',symbols.size);
console.log('Supabase tables:',tables.length);
console.log('RPC functions:',rpcs.length);
