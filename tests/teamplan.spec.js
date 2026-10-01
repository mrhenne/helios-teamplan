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

  await assertNoOverflow(page.locator('.topbar-session .sync-pill:visible, .topbar-session .topbar-user:visible, .topbar-session .topbar-online:visible'));
  await assertNoOverflow(page.locator('.topbar-actions .top-tool:visible'));

  await expect(page.locator('#roleSelect')).toBeVisible();
  const roleGeometry = await page.locator('#roleSelect').evaluate(node => {
    const r=node.getBoundingClientRect();
    const topbar=node.closest('.topbar')?.getBoundingClientRect();
    return {
      width:r.width,
      height:r.height,
      inTopbar:!!topbar && r.left>=topbar.left-2 && r.right<=topbar.right+2 && r.top>=topbar.top-2 && r.bottom<=topbar.bottom+2
    };
  });
  expect(roleGeometry.width).toBeGreaterThan(70);
  expect(roleGeometry.height).toBeGreaterThanOrEqual(27);
  expect(roleGeometry.inTopbar).toBeTruthy();
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
  if (await page.locator('#vacationToolsRow').isHidden()) await page.locator('#vacationToolsToggle').click();
  await expect(page.locator('#blackoutsBtn')).toBeVisible();

  await role.selectOption('planner');
  await expect(page.locator('#addEmployeeBtn')).toBeVisible();
  if (await page.locator('#vacationToolsRow').isHidden()) await page.locator('#vacationToolsToggle').click();
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

  if (await page.locator('#vacationToolsRow').isHidden()) await page.locator('#vacationToolsToggle').click();
  await expect(page.locator('#exportBtn')).toBeVisible();
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


test('Projektmanagement Modul funktioniert lokal', async ({ page }) => {
  await bootLocal(page);
  await expect(page.locator('#moduleProjectsBtn')).toBeVisible();
  await page.locator('#moduleProjectsBtn').click();
  await expect(page.locator('#projectsModule')).toBeVisible();
  await expect(page.locator('#vacationToolbar')).toBeHidden();
  await expect(page.locator('#trainingModule')).toBeHidden();

  for (const id of ['projectsOverviewBtn','projectsMyBtn','projectsRoadmapBtn','projectsBoardBtn','projectsCalendarBtn','projectsTeamBtn','projectsNotesBtn']) {
    const btn=page.locator('#'+id);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(btn).toHaveClass(/active/);
  }
});

test('Projekt und Aufgabe können lokal angelegt und gespeichert werden', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addProjectBtn').click();
  await expect(page.locator('#projectDialog')).toBeVisible();
  await page.locator('#projectName').fill('QA Projekt');
  await page.locator('#projectDescription').fill('Testprojekt für die Abnahme');
  await page.locator('#projectStatus').selectOption('active');
  await page.locator('#projectPriority').selectOption('high');
  await page.locator('#projectForm button[type="submit"]').click();

  await expect(page.locator('.project-card strong', { hasText:'QA Projekt' }).first()).toBeVisible();

  await page.locator('#addTaskBtn').click();
  await expect(page.locator('#projectTaskDialog')).toBeVisible();
  await page.locator('#projectTaskTitle').fill('QA Aufgabe');
  await page.locator('#projectTaskProject').selectOption({ label:'QA Projekt' });
  await page.locator('#projectTaskStatus').selectOption('progress');
  await page.locator('#projectTaskPriority').selectOption('high');
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await page.locator('#projectsBoardBtn').click();
  await expect(page.locator('#projectsKanban .project-task-card strong', { hasText:'QA Aufgabe' }).first()).toBeVisible();

  await page.reload();
  await page.locator('#moduleProjectsBtn').click();
  await expect(page.locator('#projectsProjectFilter option', { hasText:'QA Projekt' })).toHaveCount(1);
  await page.locator('#projectsBoardBtn').click();
  await expect(page.locator('#projectsKanban .project-task-card strong', { hasText:'QA Aufgabe' }).first()).toBeVisible();
});

test('Schnellaufgaben Vorlagen und Notizboard funktionieren lokal', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await expect(page.locator('#projectsTemplateSelect option')).toContainText(['Dienstplan schreiben']);
  await page.locator('#projectsTemplateSelect').selectOption({ label:'Dienstplan schreiben' });
  await expect(page.locator('#projectTaskDialog')).toBeVisible();
  await expect(page.locator('#projectTaskTitle')).toHaveValue('Dienstplan schreiben');
  await page.locator('#projectTaskDialog .close-dialog').first().click();

  await page.locator('#addNoteBtn').click();
  await page.locator('#projectNoteTitle').fill('QA Notiz');
  await page.locator('#projectNoteBody').fill('Das Notizboard funktioniert.');
  await page.locator('#projectNoteCategory').selectOption('idea');
  await page.locator('#projectNoteForm button[type="submit"]').click();
  await page.locator('#projectsNotesBtn').click();
  await expect(page.getByText('QA Notiz', { exact:true })).toBeVisible();
  await expect(page.getByText('Das Notizboard funktioniert.', { exact:true })).toBeVisible();
});

test('Projekt Rollenrechte werden in der Oberfläche berücksichtigt', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();
  const role=page.locator('#roleSelect');

  await role.selectOption('admin');
  await expect(page.locator('#addProjectBtn')).toBeVisible();
  await expect(page.locator('#addTaskBtn')).toBeVisible();

  await role.selectOption('planner');
  await expect(page.locator('#addProjectBtn')).toBeVisible();
  await expect(page.locator('#addTaskBtn')).toBeVisible();

  await role.selectOption('employee');
  await expect(page.locator('#addProjectBtn')).toBeHidden();
  await expect(page.locator('#addTaskBtn')).toBeHidden();
  await expect(page.locator('#addNoteBtn')).toBeVisible();

  await role.selectOption('viewer');
  await expect(page.locator('#addProjectBtn')).toBeHidden();
  await expect(page.locator('#addTaskBtn')).toBeHidden();
});

test('Projektkalender kann zwischen Monat und Jahr wechseln', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();
  await page.locator('#projectsCalendarBtn').click();

  await expect(page.locator('#projectsCalendarBody')).toBeVisible();
  await page.locator('#projectsCalendarYearBtn').click();
  await expect(page.locator('.projects-calendar-year')).toBeVisible();
  await page.locator('#projectsCalendarMonthBtn').click();
  await expect(page.locator('.projects-calendar-month')).toBeVisible();
});


test('Projekt Tabs überlappen auf kleinen Ansichten nicht', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();
  const result = await page.locator('.projects-view-switch .segment').evaluateAll(nodes => {
    const boxes = nodes.filter(n => {
      const s=getComputedStyle(n),r=n.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    }).map(n => {
      const r=n.getBoundingClientRect();
      return {id:n.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    });
    const overlaps=[];
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];
      const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left);
      const overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
      if(overlapX>1 && overlapY>1) overlaps.push([a.id,b.id,overlapX,overlapY]);
    }
    return {boxes,overlaps};
  });
  expect(result.overlaps, JSON.stringify(result.boxes)).toEqual([]);
});


test('Urlaubssteuerung ist kompakt und Mitarbeiterinfos sind schaltbar', async ({ page }) => {
  await bootLocal(page);

  await expect(page.locator('#vacationToolsRow')).toBeHidden();
  await page.locator('#vacationToolsToggle').click();
  await expect(page.locator('#vacationToolsRow')).toBeVisible();
  await page.locator('#vacationToolsToggle').click();
  await expect(page.locator('#vacationToolsRow')).toBeHidden();

  await page.locator('#employeeInfoToggle').click();
  await expect(page.locator('#employeeInfoMenu')).toBeVisible();

  await page.locator('#employeeInfoWork').check();
  await expect(page.locator('.employee-meta-part').first()).not.toHaveClass(/hidden-info/);

  await page.locator('#employeeInfoVacation').uncheck();
  const stats = page.locator('.employee-stats').first();
  if (await stats.count()) await expect(stats).toHaveClass(/hidden-info/);

  await page.reload();
  await page.locator('#employeeInfoToggle').click();
  await expect(page.locator('#employeeInfoWork')).toBeChecked();
  await expect(page.locator('#employeeInfoVacation')).not.toBeChecked();
});

test('Desktop Kopfzeile ist eine kompakte Reihe', async ({ page }) => {
  await bootLocal(page);
  const viewport=page.viewportSize();
  if (!viewport || viewport.width < 1101) return;

  const geometry=await page.locator('.topbar').evaluate(node=>{
    const bar=node.getBoundingClientRect();
    const visible=[...node.querySelectorAll('.topbar-brand,.topbar-session,.topbar-actions')]
      .filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&r.width>0&&r.height>0})
      .map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}});
    return {height:bar.height,top:bar.top,bottom:bar.bottom,visible};
  });
  expect(geometry.height).toBeLessThanOrEqual(60);
  for(const r of geometry.visible){
    expect(r.top).toBeGreaterThanOrEqual(geometry.top-1);
    expect(r.bottom).toBeLessThanOrEqual(geometry.bottom+1);
  }
});

test('Projektaufgaben unterstützen Checkliste, Kommentare und Meine Aufgaben', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Zusammenarbeit');
  await page.locator('#projectForm button[type="submit"]').click();

  await page.locator('#addTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA Checklistenaufgabe');
  await page.locator('#projectTaskProject').selectOption({label:'QA Zusammenarbeit'});
  await page.locator('#projectTaskDue').fill('2026-10-10');
  await page.locator('#projectTaskAddChecklist').click();
  await page.locator('#projectTaskChecklist .project-check-text').fill('Medikamente prüfen');
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await page.locator('#projectsBoardBtn').click();
  const card=page.locator('#projectsKanban .project-task-card', {hasText:'QA Checklistenaufgabe'}).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('0/1');

  await card.click();
  await expect(page.locator('#projectTaskChecklist .project-check-text')).toHaveValue('Medikamente prüfen');
  await expect(page.locator('#projectTaskCollaboration')).toBeVisible();
  await page.locator('#projectTaskCommentInput').fill('Bitte bis Freitag abschließen.');
  await page.locator('#projectTaskCommentAdd').click();
  await expect(page.locator('#projectTaskComments')).toContainText('Bitte bis Freitag abschließen.');
  await page.locator('#projectTaskDialog .close-dialog').first().click();

  await page.locator('#projectsMyBtn').click();
  await expect(page.locator('#projectsMyView')).toBeVisible();
});

test('Aufgabenvorlagen lassen sich verwalten', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();
  await page.locator('#projectsTemplatesBtn').click();
  await expect(page.locator('#projectTemplatesDialog')).toBeVisible();

  await page.locator('#projectTemplateName').fill('QA Monatskontrolle');
  await page.locator('#projectTemplateDescription').fill('Wiederkehrende QA Vorlage');
  await page.locator('#projectTemplateRecurrence').selectOption('monthly');
  await page.locator('#projectTemplateForm button[type="submit"]').click();
  await expect(page.locator('#projectTemplatesList')).toContainText('QA Monatskontrolle');

  await page.locator('#projectTemplatesDialog .close-dialog').first().click();
  await expect(page.locator('#projectsTemplateSelect option')).toContainText(['QA Monatskontrolle']);
});

test('Wiederkehrende Aufgaben erzeugen lokal den nächsten Termin', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Wiederholung');
  await page.locator('#projectForm button[type="submit"]').click();

  await page.locator('#addTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA Monatsaufgabe');
  await page.locator('#projectTaskProject').selectOption({label:'QA Wiederholung'});
  await page.locator('#projectTaskDue').fill('2026-10-15');
  await page.locator('#projectTaskRecurrence').selectOption('monthly');
  await page.locator('#projectTaskStatus').selectOption('done');
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await page.locator('#projectsBoardBtn').click();
  const matches=page.locator('#projectsKanban .project-task-card', {hasText:'QA Monatsaufgabe'});
  await expect(matches).toHaveCount(2);
  await expect(page.locator('#projectsKanban .kanban-column[data-task-drop-status="open"]')).toContainText('QA Monatsaufgabe');
});


test('Projektteam und Aufgaben sind direkt miteinander verknüpft', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addEmployeeBtn').click();
  await page.locator('#employeeName').fill('Projekt Person A');
  await page.locator('#employeeForm button[type="submit"]').click();
  await page.locator('#addEmployeeBtn').click();
  await page.locator('#employeeName').fill('Projekt Person B');
  await page.locator('#employeeForm button[type="submit"]').click();

  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Projektteam');
  await page.locator('#projectMemberSearch').fill('Projekt Person A');
  await page.locator('#projectMembersList input[type="checkbox"]').check();
  await page.locator('#projectForm button[type="submit"]').click();

  const projectCard=page.locator('.project-card',{hasText:'QA Projektteam'}).first();
  await projectCard.click();
  await expect(page.locator('#projectTasksBox')).toBeVisible();
  await page.locator('#projectAddTaskBtn').click();

  await page.locator('#projectTaskTitle').fill('Aufgabe für Person B');
  await page.locator('#projectTaskAssignee').selectOption({label:'Projekt Person B'});
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await projectCard.click();
  await expect(page.locator('#projectDialogTasks')).toContainText('Aufgabe für Person B');
  await expect(page.locator('#projectDialogTasks')).toContainText('Projekt Person B');

  await page.locator('#projectDialog .close-dialog').first().click();
  await projectCard.click();
  await page.locator('#projectMemberSearch').fill('Projekt Person B');
  await expect(page.locator('#projectMembersList input[type="checkbox"]')).toBeChecked();
});


test('Kopfzeile überlappt auch mit vollständig sichtbaren Kontodaten nicht', async ({ page }) => {
  await bootLocal(page);

  await page.evaluate(() => {
    const user=document.getElementById('authUserPill');
    const online=document.getElementById('onlinePill');
    const users=document.getElementById('usersBtn');
    const logout=document.getElementById('logoutBtn');
    if(user){user.classList.remove('hidden');user.textContent='Angemeldet: thehenne@gmail.com · admin'}
    if(online){online.classList.remove('hidden');online.textContent='● 1 online'}
    if(users)users.classList.remove('hidden');
    if(logout)logout.classList.remove('hidden');
  });

  const result=await page.locator('.topbar').evaluate(bar=>{
    const barRect=bar.getBoundingClientRect();
    const nodes=[...bar.querySelectorAll('.topbar-brand,.topbar-session,.topbar-actions,.topbar-actions .top-tool,.topbar-session .sync-pill,.topbar-session .topbar-user,.topbar-session .topbar-online,.topbar-session .role-select')]
      .filter(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
      });
    const boxes=nodes.map(el=>{
      const r=el.getBoundingClientRect();
      return {id:el.id||el.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    });
    const leaf=boxes.filter(b=>!String(b.id).includes('topbar-actions')&&!String(b.id).includes('topbar-session'));
    const overlaps=[];
    for(let i=0;i<leaf.length;i++){
      for(let j=i+1;j<leaf.length;j++){
        const a=leaf[i],b=leaf[j];
        const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if(x>1&&y>1)overlaps.push([a.id,b.id,x,y]);
      }
    }
    return {
      inside:boxes.every(b=>b.left>=barRect.left-1&&b.right<=barRect.right+1&&b.top>=barRect.top-1&&b.bottom<=barRect.bottom+1),
      pageFits:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,
      overlaps,
      boxes
    };
  });
  expect(result.inside, JSON.stringify(result.boxes)).toBeTruthy();
  expect(result.pageFits, JSON.stringify(result.boxes)).toBeTruthy();
  expect(result.overlaps, JSON.stringify(result.overlaps)).toEqual([]);
});

test('Lang laufende Weiterbildung erzeugt keinen falschen Aufgaben-Tageskonflikt', async ({ page }) => {
  await bootLocal(page);

  await page.locator('#addEmployeeBtn').click();
  await page.locator('#employeeName').fill('QA Weiterbildung Person');
  await page.locator('#employeeForm button[type="submit"]').click();

  await page.locator('#moduleTrainingBtn').click();
  await page.locator('#addTrainingBtn').click();
  await page.locator('#trainingEmployee').selectOption({label:'QA Weiterbildung Person'});
  await page.locator('#trainingTitle').fill('Notfallpflege QA');
  await page.locator('#trainingCategory').fill('Weiterbildung');
  await page.locator('#trainingStart').fill('2026-04-01');
  await page.locator('#trainingEnd').fill('2028-10-01');
  await page.locator('#trainingStatus').selectOption('in_progress');
  await page.locator('#trainingForm button[type="submit"]').click();

  await page.locator('#moduleProjectsBtn').click();
  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Konfliktprüfung');
  await page.locator('#projectForm button[type="submit"]').click();

  await page.locator('#addTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA Aufgabe ohne Falschwarnung');
  await page.locator('#projectTaskProject').selectOption({label:'QA Konfliktprüfung'});
  await page.locator('#projectTaskAssignee').selectOption({label:'QA Weiterbildung Person'});
  await page.locator('#projectTaskDue').fill('2026-10-15');
  await expect(page.locator('#projectTaskConflictWarning')).toBeHidden();

  await page.locator('#projectTaskDue').fill('2026-10-16');
  await expect(page.locator('#projectTaskConflictWarning')).toBeHidden();
});


test('Projektübersicht zeigt Aufmerksamkeit und Projektfortschritt', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Fokusprojekt');
  await page.locator('#projectForm button[type="submit"]').click();

  await page.locator('#addTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA überfällige Aufgabe');
  await page.locator('#projectTaskProject').selectOption({label:'QA Fokusprojekt'});
  await page.locator('#projectTaskDue').fill('2025-01-15');
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await page.locator('#projectsOverviewBtn').click();
  await expect(page.locator('#projectsAttentionList')).toContainText('Überfällig');
  await expect(page.locator('#projectsAttentionList')).toContainText('QA überfällige Aufgabe');
  await expect(page.locator('#projectsAttentionList')).toContainText('Ohne Verantwortlichen');

  const projectCard=page.locator('.project-card',{hasText:'QA Fokusprojekt'}).first();
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText('1 offen');

  await projectCard.click();
  await expect(page.locator('#projectDialogSummary')).toBeVisible();
  await expect(page.locator('#projectSummaryOpen')).toHaveText('1');
  await expect(page.locator('#projectSummaryOverdue')).toHaveText('1');
});


test('Projekt Jahreskalender ist kompakt und Projektarbeit priorisiert Aufgaben', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Jahresprojekt');
  await page.locator('#projectDue').fill('2026-11-20');
  await page.locator('#projectForm button[type="submit"]').click();

  await page.locator('#addTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA Jahrestermin');
  await page.locator('#projectTaskProject').selectOption({label:'QA Jahresprojekt'});
  await page.locator('#projectTaskDue').fill('2026-11-10');
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await page.locator('#projectsCalendarBtn').click();
  await page.locator('#projectsCalendarYearBtn').click();
  await expect(page.locator('.projects-calendar-year')).toBeVisible();
  await expect(page.locator('.project-year-month')).toHaveCount(12);
  await expect(page.locator('.project-year-month').filter({hasText:'November'})).toContainText('QA Jahresprojekt');
  await expect(page.locator('.project-year-month').filter({hasText:'November'})).toContainText('QA Jahrestermin');

  await page.locator('#projectsOverviewBtn').click();
  const projectCard=page.locator('.project-card',{hasText:'QA Jahresprojekt'}).first();
  await projectCard.click();

  const tasksBox=page.locator('#projectTasksBox');
  const teamBox=page.locator('.project-team-collapsible');
  await expect(tasksBox).toBeVisible();
  await expect(page.locator('#projectTeamBody')).toBeHidden();

  const order=await page.locator('#projectDialog form').evaluate(form=>{
    const tasks=form.querySelector('#projectTasksBox');
    const team=form.querySelector('.project-team-collapsible');
    return !!tasks&&!!team&&tasks.compareDocumentPosition(team)&Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();

  await page.locator('#projectTeamToggle').click();
  await expect(page.locator('#projectTeamBody')).toBeVisible();
  await page.locator('#projectTeamToggle').click();
  await expect(page.locator('#projectTeamBody')).toBeHidden();

  await page.locator('#projectDialogTasks [data-project-task-id]').first().click();
  await expect(page.locator('#projectTaskDialog')).toBeVisible();
  await expect(page.locator('#projectTaskBackBtn')).toBeVisible();
  await page.locator('#projectTaskBackBtn').click();
  await expect(page.locator('#projectDialog')).toBeVisible();

  await page.locator('#projectBackBtn').click();
  await expect(page.locator('#projectDialog')).toBeHidden();
  await expect(page.locator('#projectsOverviewView')).toBeVisible();
});


test('mehrere Projektverantwortliche und gewichteten Fortschritt', async ({ page }) => {
  await bootLocal(page);

  for (const name of ['QA Leitung','QA Verantwortlich','QA Team']) {
    await page.locator('#addEmployeeBtn').click();
    await page.locator('#employeeName').fill(name);
    await page.locator('#employeeForm button[type="submit"]').click();
  }

  await page.locator('#moduleProjectsBtn').click();
  await page.locator('#addProjectBtn').click();
  await page.locator('#projectName').fill('QA Fortschrittsprojekt');
  await page.locator('#projectLead').selectOption({label:'QA Leitung'});
  await page.locator('#projectTeamToggle').click();

  await page.locator('#projectMemberSearch').fill('QA Verantwortlich');
  const responsibleRow=page.locator('.project-member-row',{hasText:'QA Verantwortlich'});
  await responsibleRow.locator('.project-member-responsible').check();
  await expect(responsibleRow.locator('.project-member-active')).toBeChecked();

  await page.locator('#projectMemberSearch').fill('QA Team');
  const teamRow=page.locator('.project-member-row',{hasText:'QA Team'});
  await teamRow.locator('.project-member-active').check();

  await page.locator('#projectMemberSearch').fill('');
  await expect(page.locator('#projectMemberCount')).toContainText('3 im Team');
  await expect(page.locator('#projectMemberCount')).toContainText('1 zusätzlich verantwortlich');
  await page.locator('#projectForm button[type="submit"]').click();

  const card=page.locator('.project-card',{hasText:'QA Fortschrittsprojekt'}).first();
  await expect(card).toContainText('1 weitere verantwortlich');

  await card.click();
  await page.locator('#projectAddTaskBtn').click();
  await page.locator('#projectTaskTitle').fill('QA Aufgabe mit Checkliste');
  await page.locator('#projectTaskAssignee').selectOption({label:'QA Verantwortlich'});
  await page.locator('#projectTaskAddChecklist').click();
  await page.locator('#projectTaskAddChecklist').click();
  const rows=page.locator('#projectTaskChecklist .project-checklist-row');
  await rows.nth(0).locator('.project-check-text').fill('Teil 1');
  await rows.nth(1).locator('.project-check-text').fill('Teil 2');
  await rows.nth(0).locator('.project-check-done').check();
  await page.locator('#projectTaskForm button[type="submit"]').click();

  await card.click();
  await expect(page.locator('#projectSummaryProgress')).toHaveText('50 %');
  const progressStyle=await page.locator('#projectDialogProgress').evaluate(el=>({
    progress:getComputedStyle(el).getPropertyValue('--progress').trim(),
    color:getComputedStyle(el).getPropertyValue('--progress-color').trim()
  }));
  expect(progressStyle.progress).toBe('50%');
  expect(progressStyle.color).toContain('hsl');

  await page.locator('.project-task-quickcheck').click();
  await expect(page.locator('#projectSummaryProgress')).toHaveText('100 %');
  await expect(page.locator('.project-dialog-task')).toHaveClass(/done/);
});

test('Projekt Sicherung und selektiver PDF Export sind verfügbar', async ({ page }) => {
  await bootLocal(page);
  await page.locator('#moduleProjectsBtn').click();

  await expect(page.locator('#projectsSaveBtn')).toBeVisible();
  await expect(page.locator('#projectsPdfBtn')).toBeVisible();

  await page.locator('#projectsPdfBtn').click();
  await expect(page.locator('#projectExportDialog')).toBeVisible();
  await expect(page.locator('#projectExportProjects')).toBeChecked();
  await expect(page.locator('#projectExportTasks')).toBeChecked();
  await expect(page.locator('#projectExportMonth')).not.toBeChecked();
  await expect(page.locator('#projectExportYear')).not.toBeChecked();

  const html=await page.evaluate(() => buildProjectPdfHtml({
    projects:true,tasks:true,month:true,year:true,team:true,notes:true
  }));
  expect(html).toContain('Aktuelle Projekte');
  expect(html).toContain('Aufgaben & Status');
  expect(html).toContain('Monatsübersicht');
  expect(html).toContain('Jahresübersicht');
  expect(html).toContain('Projektteams');
  expect(html).toContain('Notizen');

  await page.locator('#projectExportDialog .close-dialog').first().click();

  const downloadPromise=page.waitForEvent('download');
  await page.locator('#projectsSaveBtn').click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^TeamPlan-Projekte-\d{4}-\d{2}-\d{2}\.json$/);
});
