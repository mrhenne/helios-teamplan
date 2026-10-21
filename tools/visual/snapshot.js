// Hält die Optik der App fest: berechnete Styles aller Elemente + Screenshot je Ansicht.
// Aufruf: node tools/visual/snapshot.js <ausgabeordner> [filter]   (PORT=4173 Standard, statischer Server muss laufen)
// Vergleich: node tools/visual/compare.js <ordnerA> <ordnerB>
// Gedacht für Umbauten, die die Optik nicht verändern sollen: vorher und nachher aufnehmen, dann vergleichen.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4173);
const FIXED = new Date('2026-10-21T09:00:00+02:00');
const OUT = process.argv[2];
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
if (!OUT) { console.error('Ausgabeordner fehlt'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180, hasTouch: true },
  mobile: { width: 390, height: 844, hasTouch: true }
};

const openDialog = id => async page => page.evaluate(id => { const d = document.getElementById(id); d.classList.remove('hidden'); if (!d.open) d.showModal(); }, id);
const click = sel => async page => { await page.locator(sel).first().click(); };

// Jede Ansicht: Modul, lokale Einstellungen, optionale Aktion.
const STATES = [
  { name: 'vacation', module: 'vacation' },
  { name: 'vacation-tools', module: 'vacation', ls: { 'teamplan-vacation-tools-open': '1' } },
  { name: 'vacation-employee', module: 'vacation', ls: { 'teamplan-session-role': 'employee' } },
  { name: 'vacation-viewer', module: 'vacation', ls: { 'teamplan-session-role': 'viewer' } },
  { name: 'vacation-print', module: 'vacation', print: true },
  ...['overview', 'calendar', 'multiyear', 'teamstatus', 'employees', 'classic'].map(v => ({ name: 'training-' + v, module: 'training', ls: { 'teamplan-training-view': v } })),
  ...['overview', 'my', 'roadmap', 'board', 'calendar', 'team', 'notes'].map(v => ({ name: 'projects-' + v, module: 'projects', ls: { 'teamplan-project-view': v } })),
  { name: 'projects-calendar-year', module: 'projects', ls: { 'teamplan-project-view': 'calendar' }, action: click('#projectsCalendarYearBtn') },
  { name: 'projects-external', module: 'projects', ls: { 'teamplan-session-role': 'external' } },
  { name: 'dlg-project-edit', module: 'projects', action: click('.project-card') },
  { name: 'dlg-task-new', module: 'projects', action: click('#addTaskBtn') },
  { name: 'dlg-employee-new', module: 'vacation', action: click('#addEmployeeBtn') },
  { name: 'dlg-training-new', module: 'training', action: click('#addTrainingBtn') },
  ...['vacationExportDialog', 'trainingExportDialog', 'projectExportDialog', 'projectTemplatesDialog', 'projectNoteDialog', 'trainingTypesDialog', 'trainingBudgetDialog', 'namesImportDialog', 'cellDialog', 'bulkDialog', 'cleanupDialog', 'discussionsDialog', 'newDiscussionDialog', 'blackoutsDialog', 'historyDialog', 'conflictsDialog', 'rolesHelpDialog', 'usersDialog', 'planImportDialog', 'settingsDialog', 'invitePasswordDialog', 'loginDialog']
    .map(id => ({ name: 'dlg-' + id, module: id.startsWith('project') ? 'projects' : id.startsWith('training') ? 'training' : 'vacation', action: openDialog(id) }))
];

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch { a.pause(); a.currentTime = 0; } }));
  await page.waitForTimeout(50);
  // Scrollpositionen hängen vom Timing ab (z. B. Planer springt zum Monat) – für den Vergleich neutralisieren.
  await page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && (el.scrollLeft || el.scrollTop)) el.scrollTo({ left: 0, top: 0, behavior: 'instant' }); });
  await page.waitForTimeout(30);
}

async function capture(page) {
  return page.evaluate(() => {
    const table = new Map(), out = [];
    const pathOf = el => { const parts = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; parts.unshift(n.tagName.toLowerCase() + (n.id && !/^[a-z0-9]{8,}$/i.test(n.id) ? '#' + n.id : '') + ':' + i); } return parts.join('>'); };
    const styleKey = (el, pseudo) => { const cs = getComputedStyle(el, pseudo); if (pseudo && (cs.content === 'none' || cs.content === 'normal')) return null; let s = ''; for (let i = 0; i < cs.length; i++) { const p = cs[i]; s += p + ':' + cs.getPropertyValue(p) + ';'; } return s; };
    const id = s => { if (s == null) return -1; if (!table.has(s)) table.set(s, table.size); return table.get(s); };
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName !== 'svg') continue;
      const r = el.getBoundingClientRect();
      out.push([pathOf(el), id(styleKey(el)), id(styleKey(el, '::before')), id(styleKey(el, '::after')), [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',')]);
    }
    return { styles: [...table.keys()], elements: out };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  let n = 0;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    for (const theme of ['light', 'dark']) {
      for (const st of STATES) {
        const key = `${vpName}-${theme}-${st.name}`;
        if (FILTER && !FILTER.test(key)) continue;
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.hasTouch, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.clock.setFixedTime(FIXED);
        await page.route('**/config.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.TEAMPLAN_CONFIG = {};' }));
        const ls = { ...seed, 'teamplan-last-view': '2026-10', 'teamplan-module': st.module, ...(st.ls || {}) };
        const s = JSON.parse(ls['helios-teamplan-v1']); s.settings.theme = theme; ls['helios-teamplan-v1'] = JSON.stringify(s);
        await page.addInitScript(ls => { if (!sessionStorage.getItem('__seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, ls);
        await page.goto(BASE + '/');
        await page.waitForLoadState('networkidle');
        await settle(page);
        try { if (st.action) await st.action(page); } catch (e) { errors.push('Aktion: ' + e.message.split('\n')[0]); }
        if (st.print) await page.emulateMedia({ media: 'print' });
        await settle(page);
        const data = await capture(page);
        data.errors = errors;
        fs.writeFileSync(path.join(OUT, key + '.json.gz'), zlib.gzipSync(JSON.stringify(data)));
        await page.screenshot({ path: path.join(OUT, key + '.png'), fullPage: true });
        await ctx.close();
        n++;
        process.stdout.write('.');
      }
    }
  }
  await browser.close();
  console.log(`\n${n} Ansichten gespeichert in ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
