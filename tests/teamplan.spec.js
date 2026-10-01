const { test, expect } = require('@playwright/test');

async function bootLocal(page) {
  await page.route('**/config.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.TEAMPLAN_CONFIG = {};'
  }));

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const fatal = [];
  page.on('pageerror', err => fatal.push(String(err)));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#appTitle')).toContainText('TeamPlan');
  return fatal;
}

async function assertNoOverflow(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (!(await el.isVisible())) continue;
    const info = await el.evaluate(node => {
      const r = node.getBoundingClientRect();
      const parent = node.parentElement?.getBoundingClientRect();
      return {
        id: node.id || node.className || String(node.tagName),
        own: node.tagName === 'SELECT' ? true : (node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1),
        inside: !parent || (r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1)
      };
    });
    expect(info.own && info.inside, 'Element läuft aus seinem Container: ' + info.id).toBeTruthy();
  }
}

test('App startet ohne fatalen JavaScript-Fehler', async ({ page }) => {
  const fatal = await bootLocal(page);
  expect(fatal).toEqual([]);
  await expect(page.locator('#syncPill')).toContainText('Lokal');
  await expect(page.locator('#moduleVacationBtn')).toBeVisible();
  await expect(page.locator('#moduleTrainingBtn')).toBeVisible();
});

test('Kopfzeile bleibt vollständig innerhalb ihrer Felder', async ({ page }) => {
  await bootLocal(page);
  await expect(page.locator('#roleEmployeeSelect')).toBeHidden();
  await expect(page.locator('#authUserPill')).toBeHidden();
  await expect(page.locator('#onlinePill')).toBeHidden();

  await assertNoOverflow(page.locator('.top-status-item .sync-pill:visible'));
  await assertNoOverflow(page.locator('.top-action-section .top-tool:visible, .global-theme-control:visible'));

  await expect(page.locator('#roleSelect')).toBeVisible();
  const roleFits = await page.locator('#roleSelect').evaluate(node => {
    const r=node.getBoundingClientRect();
    const slot=node.closest('.role-slot')?.getBoundingClientRect();
    if(!slot) return false;
    return r.left >= slot.left-3 && r.right <= slot.right+3 && r.top >= slot.top-3 && r.bottom <= slot.bottom+3;
  });
  expect(roleFits).toBeTruthy();
  await expect(page.locator('#roleHelpBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();

  const noPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(noPageOverflow).toBeTruthy();
});

test('Urlaubsplanung und alle Fortbildungsansichten lassen sich umschalten', async ({ page }) => {
  await bootLocal(page);
  await expect(page.locator('#vacationToolbar')).toBeVisible();

  await page.locator('#moduleTrainingBtn').click();
  await expect(page.locator('#trainingModule')).toBeVisible();
  await expect(page.locator('#vacationToolbar')).toBeHidden();

  for (const id of ['trainingOverviewBtn','trainingCalendarBtn','trainingMultiYearBtn','trainingTeamStatusBtn','trainingEmployeesBtn','trainingClassicBtn']) {
    const btn = page.locator('#'+id);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  }

  await page.locator('#moduleVacationBtn').click();
  await expect(page.locator('#vacationToolbar')).toBeVisible();
});

test('Hell/Dunkel Umschaltung funktioniert und bleibt gespeichert', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#themeBtn').click();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect(page.locator('#themeLabel')).toHaveText('Dunkel');

  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect(page.locator('#themeLabel')).toHaveText('Dunkel');
});

test('Einstellungen lassen sich öffnen und schließen', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#settingsBtn').click();
  const dialog = page.locator('#settingsDialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.close-dialog').first().click();
  await expect(dialog).toBeHidden();
});

test('Mitarbeiter kann lokal angelegt und nach Reload wieder geladen werden', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#addEmployeeBtn').click();
  await expect(page.locator('#employeeDialog')).toBeVisible();

  await page.locator('#employeeName').fill('QA Testperson');
  await page.locator('#employeeHours').fill('38.5');
  await page.locator('#employeePercent').fill('100');
  await page.locator('#employeeWorkdays').fill('5');
  await page.locator('#employeeForm button[type="submit"]').click();

  await expect(page.locator('.employee-name', { hasText: 'QA Testperson' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.employee-name', { hasText: 'QA Testperson' })).toBeVisible();
});

test('Rollen schalten die erlaubten Werkzeuge korrekt', async ({ page }) => {
  await bootLocal(page);
  const role = page.locator('#roleSelect');

  await role.selectOption('admin');
  await expect(page.locator('#addEmployeeBtn')).toBeVisible();
  await expect(page.locator('#blackoutsBtn')).toBeVisible();

  await role.selectOption('planner');
  await expect(page.locator('#addEmployeeBtn')).toBeVisible();
  await expect(page.locator('#blackoutsBtn')).toBeVisible();
  await expect(page.locator('#usersBtn')).toBeHidden();

  await role.selectOption('employee');
  await expect(page.locator('#addEmployeeBtn')).toBeHidden();
  await expect(page.locator('#blackoutsBtn')).toBeHidden();
  await expect(page.locator('#roleEmployeeSelect')).toBeVisible();

  await role.selectOption('viewer');
  await expect(page.locator('#addEmployeeBtn')).toBeHidden();
  await expect(page.locator('#blackoutsBtn')).toBeHidden();
  await expect(page.locator('#roleEmployeeSelect')).toBeHidden();

  const firstCell = page.locator('.day-cell').first();
  if (await firstCell.count()) {
    await firstCell.click();
    await expect(page.locator('#cellDialog')).toBeHidden();
  }
});

test('Backup enthält den Zustand und Import stellt ihn wieder her', async ({ page }) => {
  await bootLocal(page);

  await page.locator('#addEmployeeBtn').click();
  await page.locator('#employeeName').fill('Backup Testperson');
  await page.locator('#employeeHours').fill('38.5');
  await page.locator('#employeePercent').fill('100');
  await page.locator('#employeeWorkdays').fill('5');
  await page.locator('#employeeForm button[type="submit"]').click();
  await expect(page.locator('.employee-name', { hasText: 'Backup Testperson' })).toBeVisible();

  await page.evaluate(() => { try { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); } catch {} });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportBtn').click()
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();

  const fs = require('fs');
  const backup = JSON.parse(fs.readFileSync(path,'utf8'));
  expect(backup.employees.some(e => e.name === 'Backup Testperson')).toBeTruthy();

  const mutated = JSON.parse(JSON.stringify(backup));
  mutated.employees = mutated.employees.filter(e => e.name !== 'Backup Testperson');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#importInput').setInputFiles({
    name: 'qa-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(mutated))
  });
  await expect(page.locator('.employee-name', { hasText: 'Backup Testperson' })).toHaveCount(0);
});

test('Alle sichtbaren SVG-Use Icons verweisen auf vorhandene Symbole', async ({ page }) => {
  await bootLocal(page);
  const missing = await page.locator('svg use').evaluateAll(nodes => nodes
    .map(n => n.getAttribute('href'))
    .filter(Boolean)
    .filter(href => href.startsWith('#'))
    .filter(href => !document.querySelector(href))
  );
  expect(missing).toEqual([]);
});

test('Keine sichtbaren Kerncontrols haben unlesbar kleine Schrift', async ({ page }) => {
  await bootLocal(page);
  const tooSmall = await page.evaluate(() => {
    const selectors = [
      '.topbar button','.topbar select','.module-tab','.planner-controls button',
      '.planner-controls select','.planner-controls input','.dialog button','.dialog input',
      '.dialog select','.dialog textarea'
    ];
    return [...document.querySelectorAll(selectors.join(','))]
      .filter(el => {
        const s=getComputedStyle(el);
        const r=el.getBoundingClientRect();
        return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
      })
      .map(el => ({id:el.id||el.className,px:parseFloat(getComputedStyle(el).fontSize)}))
      .filter(x => x.px < 7);
  });
  expect(tooSmall).toEqual([]);
});
