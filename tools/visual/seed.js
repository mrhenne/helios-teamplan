// Erzeugt einen reproduzierbaren lokalen Datenstand für die Optik-Snapshots.
// Aufruf: node tools/visual/seed.js  (Server auf :4173 muss laufen)
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4173);
const FIXED = new Date('2026-10-21T09:00:00+02:00');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.clock.setFixedTime(FIXED);
  await page.route('**/config.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.TEAMPLAN_CONFIG = {};' }));
  await page.goto(BASE + '/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  for (const name of ['Dora Leitung', 'Emil Extern']) {
    await page.locator('#addEmployeeBtn').click();
    await page.locator('#employeeName').fill(name);
    await page.locator('#employeeForm button[type="submit"]').click();
  }

  await page.locator('#moduleTrainingBtn').click();
  for (const [title, start, end, status] of [['Notfallpflege', '2026-04-01', '2028-10-01', 'in_progress'], ['Reanimation', '2026-10-12', '2026-10-13', 'planned']]) {
    await page.locator('#addTrainingBtn').click();
    await page.locator('#trainingEmployee').selectOption({ index: 1 });
    await page.locator('#trainingTitle').fill(title);
    await page.locator('#trainingCategory').fill('Weiterbildung');
    await page.locator('#trainingStart').fill(start);
    await page.locator('#trainingEnd').fill(end);
    await page.locator('#trainingStatus').selectOption(status).catch(() => {});
    await page.locator('#trainingForm button[type="submit"]').click();
    await page.keyboard.press('Escape');
  }

  await page.locator('#moduleProjectsBtn').click();
  for (const [name, due] of [['Schockraum Umbau', '2026-11-20'], ['Ersteinschätzung MTS', '2026-12-05']]) {
    await page.locator('#addProjectBtn').click();
    await page.locator('#projectName').fill(name);
    await page.locator('#projectDescription').fill('Beschreibung für ' + name);
    await page.locator('#projectDue').fill(due);
    await page.locator('#projectForm button[type="submit"]').click();
  }
  const tasks = [['Material bestellen', 'Schockraum Umbau', 'progress', 'high', '2026-10-25'], ['Schulung planen', 'Schockraum Umbau', 'open', 'low', '2026-11-10'], ['Audit vorbereiten', 'Ersteinschätzung MTS', 'waiting', 'medium', '2026-10-19'], ['Abschluss', 'Ersteinschätzung MTS', 'done', 'medium', '2026-10-01']];
  for (const [title, proj, status, prio, due] of tasks) {
    await page.locator('#addTaskBtn').click();
    await page.locator('#projectTaskTitle').fill(title);
    await page.locator('#projectTaskProject').selectOption({ label: proj });
    await page.locator('#projectTaskStatus').selectOption(status);
    await page.locator('#projectTaskPriority').selectOption(prio);
    await page.locator('#projectTaskDue').fill(due);
    await page.locator('#projectTaskForm button[type="submit"]').click();
  }
  await page.locator('#addNoteBtn').click();
  await page.locator('#projectNoteTitle').fill('Idee Wartebereich');
  await page.locator('#projectNoteBody').fill('Mehr Sitzplätze und Infobildschirm.');
  await page.locator('#projectNoteForm button[type="submit"]').click();

  // Urlaubseinträge direkt in den Zustand schreiben.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('helios-teamplan-v1'));
    const ids = s.employees.map(e => e.id);
    const put = (i, day, codes, status) => { (s.entries[ids[i]] ||= {})['2026-10-' + String(day).padStart(2, '0')] = { codes, priority: 0, note: '', status, plannerMarkers: [] }; };
    [5, 6, 7, 8, 9].forEach(d => put(0, d, ['U'], 'approved'));
    [13, 14].forEach(d => put(1, d, ['XU'], 'wish'));
    put(2, 20, ['S'], 'approved');
    put(2, 21, ['U', 'S'], 'wish');
    put(3, 27, ['X'], 'approved');
    localStorage.setItem('helios-teamplan-v1', JSON.stringify(s));
  });

  const dump = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  fs.writeFileSync(path.join(__dirname, 'seed.json'), JSON.stringify(dump, null, 1));
  console.log('Seed gespeichert:', Object.keys(dump).join(', '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
