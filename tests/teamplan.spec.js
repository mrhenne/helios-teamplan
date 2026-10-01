const { test, expect } = require('@playwright/test');

async function bootLocal(page) {
  await page.route('**/config.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.TEAMPLAN_CONFIG = {};'
  }));

  const fatal = [];
  page.on('pageerror', err => fatal.push(String(err)));
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#appTitle')).toContainText('TeamPlan');
  return fatal;
}

async function assertNoOverflow(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (!(await el.isVisible())) continue;
    const ok = await el.evaluate(node => {
      const r = node.getBoundingClientRect();
      const parent = node.parentElement?.getBoundingClientRect();
      const own = node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
      if (!parent) return own;
      const inside = r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1;
      return own && inside;
    });
    expect(ok, 'Element läuft aus seinem Container: ' + (await el.getAttribute('id') || await el.getAttribute('class') || i)).toBeTruthy();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('App startet ohne fatalen JavaScript-Fehler', async ({ page }) => {
  const fatal = await bootLocal(page);
  expect(fatal).toEqual([]);
  await expect(page.locator('#syncPill')).toContainText('Lokal');
  await expect(page.locator('#moduleVacationBtn')).toBeVisible();
  await expect(page.locator('#moduleTrainingBtn')).toBeVisible();
});

test('Kopfzeile bleibt vollständig innerhalb ihrer Felder', async ({ page }) => {
  await bootLocal(page);
  await assertNoOverflow(page.locator('.top-status-item .sync-pill:visible, .top-status-item .role-select:visible'));
  await assertNoOverflow(page.locator('.top-action-section .top-tool:visible, .global-theme-control:visible'));
  await expect(page.locator('#roleSelect')).toBeVisible();
  await expect(page.locator('#roleHelpBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();
});

test('Urlaubsplanung und Fortbildungen lassen sich umschalten', async ({ page }) => {
  await bootLocal(page);
  await expect(page.locator('#vacationToolbar')).toBeVisible();
  await page.locator('#moduleTrainingBtn').click();
  await expect(page.locator('#trainingModule')).toBeVisible();
  await expect(page.locator('#vacationToolbar')).toBeHidden();
  await page.locator('#moduleVacationBtn').click();
  await expect(page.locator('#vacationToolbar')).toBeVisible();
});

test('Hell/Dunkel Umschaltung funktioniert und bleibt gespeichert', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#themeBtn').click();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
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
  await expect(page.getByText('QA Testperson', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('QA Testperson', { exact: true }).first()).toBeVisible();
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
