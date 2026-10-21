// Start der App und Verdrahtung der Bedienelemente
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
// Authentication must start before the optional UI listener wiring below.
// That keeps login/session restoration working even if a later UI module throws.
initRemote();
initProjectModuleUI();

// top controls
document.getElementById('prevMonth')?.addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('nextMonth')?.addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('prevYear')?.addEventListener('click',()=>{viewDate.setFullYear(viewDate.getFullYear()-1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('nextYear')?.addEventListener('click',()=>{viewDate.setFullYear(viewDate.getFullYear()+1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('monthSelect')?.addEventListener('change',e=>{viewDate.setMonth(Number(e.target.value));saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('yearSelect')?.addEventListener('change',e=>{viewDate.setFullYear(Number(e.target.value));saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('todayBtn')?.addEventListener('click',()=>{viewDate=new Date();viewDate.setDate(1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('zoomOutBtn')?.addEventListener('click',()=>changeZoom(-.05));
document.getElementById('zoomInBtn')?.addEventListener('click',()=>changeZoom(.05));
document.getElementById('zoomRange')?.addEventListener('input',e=>setZoom(Number(e.target.value)/100));
document.getElementById('themeBtn')?.addEventListener('click',toggleTheme);
document.getElementById('roleSelect')?.addEventListener('change',e=>{sessionRole=e.target.value;vacationToolsOpen=false;localStorage.setItem('teamplan-vacation-tools-open','0');localStorage.setItem('teamplan-session-role',sessionRole);syncVacationUiPrefs();renderRoleControls();render();showToast('Modus: '+e.target.options[e.target.selectedIndex].text)});
document.getElementById('roleEmployeeSelect')?.addEventListener('change',e=>{sessionEmployeeId=e.target.value;localStorage.setItem('teamplan-session-employee',sessionEmployeeId);render();});
document.getElementById('monthViewBtn')?.addEventListener('click',()=>{currentView='month';plannerScrollLeft=null;clearDragSelection();render()});
document.getElementById('yearViewBtn')?.addEventListener('click',()=>{currentView='year';clearDragSelection();render()});
document.getElementById('vacationFullBtn')?.addEventListener('click',()=>{state.settings.vacationDisplayMode='full';persist();render();showToast('Urlaub: Gesamt – jedes U zählt 1,0')});
document.getElementById('vacationActualBtn')?.addEventListener('click',()=>{state.settings.vacationDisplayMode='actual';persist();render();showToast('Urlaub: Anteilig nach Stellenprozent')});
['employeePercent','employeeCarry','employeeAdjustment'].forEach(id=>document.getElementById(id)?.addEventListener('input',updateVacationPreview));
document.getElementById('searchInput')?.addEventListener('input',render);
document.getElementById('addEmployeeBtn')?.addEventListener('click',()=>openEmployee());
document.getElementById('importNamesBtn')?.addEventListener('click',()=>{if(!canManage())return;document.getElementById('namesPasteInput').value='';document.getElementById('namesFileInput').value='';updateNamesImportPreview([]);document.getElementById('namesImportDialog').showModal()});
document.getElementById('settingsBtn')?.addEventListener('click',openSettings);
document.getElementById('vacationExportForm')?.addEventListener('submit',e=>{e.preventDefault();exportVacationPdf()});
document.getElementById('discussionsBtn')?.addEventListener('click',openDiscussionsDialog);
document.getElementById('newDiscussionBtn')?.addEventListener('click',()=>openNewDiscussion());
document.getElementById('discussionOpenFilter')?.addEventListener('click',()=>{discussionFilter='open';renderDiscussionList()});
document.getElementById('discussionAllFilter')?.addEventListener('click',()=>{discussionFilter='all';renderDiscussionList()});
document.getElementById('discussionResolveBtn')?.addEventListener('click',toggleDiscussionResolved);
document.getElementById('newDiscussionForm')?.addEventListener('submit',e=>{e.preventDefault();createDiscussionFromForm()});
document.getElementById('discussionMessageForm')?.addEventListener('submit',e=>{e.preventDefault();sendDiscussionMessage()});
document.getElementById('usersBtn')?.addEventListener('click',openUsersDialog);
document.getElementById('accountSaveBtn')?.addEventListener('click',saveMyAccount);
document.getElementById('undoBtn')?.addEventListener('click',undoLastAction);
document.querySelectorAll('[data-conflict-filter]').forEach(btn=>btn.addEventListener('click',()=>{conflictFilter=btn.dataset.conflictFilter;selectedConflictIds.clear();renderConflicts()}));
document.getElementById('conflictSort')?.addEventListener('change',e=>{conflictSort=e.target.value;renderConflicts()});
document.getElementById('conflictSelectVisible')?.addEventListener('change',e=>{
  const items=conflictItems().filter(x=>conflictFilter==='all'||x.type===conflictFilter);
  items.forEach(x=>e.target.checked?selectedConflictIds.add(x.id):selectedConflictIds.delete(x.id));
  renderConflicts();
});
document.getElementById('conflictSelectionClear')?.addEventListener('click',()=>{selectedConflictIds.clear();renderConflicts()});
document.getElementById('conflictBulkApply')?.addEventListener('click',applyConflictBulkStatus);
document.addEventListener('click',e=>{const btn=e.target.closest('[data-tool-action]');if(btn){e.preventDefault();runToolAction(btn.dataset.toolAction)}});
document.getElementById('inviteRole')?.addEventListener('change',syncInviteEmployeeOptions);
document.getElementById('userInviteForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const resultBox=document.getElementById('inviteResult');resultBox.classList.add('hidden');resultBox.innerHTML='';
  try{
    const data=await invokeUserAdmin({action:'invite',email:document.getElementById('inviteEmail').value.trim(),displayName:document.getElementById('inviteName').value.trim(),role:document.getElementById('inviteRole').value,employeeId:document.getElementById('inviteEmployee').value||null});
    e.target.reset();syncInviteEmployeeOptions();
    if(data.delivery==='link'&&data.inviteLink){
      resultBox.innerHTML='<strong>Einladungslink erstellt</strong><span>Schicke diesen einmaligen TeamPlan-Link an den Kollegen. Beim Öffnen wird der Account bestätigt und direkt bei TeamPlan angemeldet.</span><div class="invite-link-row"><input id="generatedInviteLink" readonly value="'+escapeHtml(data.inviteLink)+'"><button type="button" id="copyInviteLink" class="btn primary">Link kopieren</button></div>';
      resultBox.classList.remove('hidden');
      document.getElementById('copyInviteLink')?.addEventListener('click',async()=>{await navigator.clipboard.writeText(data.inviteLink);showToast('Einladungslink kopiert')});
      showToast('Einladungslink erstellt');
    }else if(data.delivery==='existing'){
      resultBox.innerHTML='<strong>Benutzer bereits vorhanden</strong><span>Der bestehende Account wurde dem Team zugeordnet bzw. aktualisiert.</span>';
      resultBox.classList.remove('hidden');showToast('Benutzer zugeordnet');
    }else showToast('Einladung per E-Mail gesendet');
    await renderUsersList();
  }catch(err){console.error(err);resultBox.innerHTML='<strong>Einladung fehlgeschlagen</strong><span>'+escapeHtml(err.message||String(err))+'</span>';resultBox.classList.remove('hidden')}
});
document.getElementById('planImportFile')?.addEventListener('change',async e=>{try{renderPlanImportPreview(await readPlanImportFile(e.target.files[0]))}catch(err){console.error(err);renderPlanImportPreview({entries:[],names:[],warnings:[err.message]})}});
document.getElementById('planImportForm')?.addEventListener('submit',e=>{e.preventDefault();applyPlanImport()});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('[data-bulk-code]').forEach(b=>b.addEventListener('click',()=>{bulkSelectedCodes.has(b.dataset.bulkCode)?bulkSelectedCodes.delete(b.dataset.bulkCode):bulkSelectedCodes.add(b.dataset.bulkCode);b.classList.toggle('selected');updateBulkPreview()}));
['bulkEmployee','bulkStart','bulkEnd','bulkOnlyWorkdays','bulkSkipWeekends','bulkMode','bulkPriority'].forEach(id=>document.getElementById(id).addEventListener('change',updateBulkPreview));
document.getElementById('bulkForm')?.addEventListener('submit',e=>{e.preventDefault();applyBulk(false)});
document.getElementById('bulkClearBtn')?.addEventListener('click',()=>{const dates=bulkDates();if(!dates.length)return;if(confirm(`Alle Einträge dieses Mitarbeiters an ${dates.length} betroffenen Tagen löschen?`))applyBulk(true)});

document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));

document.getElementById('employeeWorkdays')?.addEventListener('input',updateVacationPreview);document.getElementById('employeeCarry')?.addEventListener('input',updateVacationPreview);document.getElementById('employeeAdjustment')?.addEventListener('input',updateVacationPreview);
document.getElementById('employeeAutoWeekend')?.addEventListener('change',e=>document.getElementById('autoWeekendOptions').classList.toggle('disabled-block',!e.target.checked));
document.getElementById('employeeExternal')?.addEventListener('change',syncEmployeeExternalMode);
document.getElementById('showExternalEmployees')?.addEventListener('change',e=>{showExternalEmployees=e.target.checked;localStorage.setItem('teamplan-show-external-employees',showExternalEmployees?'1':'0');render()});
document.getElementById('employeeRangeBtn')?.addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;document.getElementById('employeeDialog').close();openBulkDialog(id)});
document.getElementById('employeeCleanupBtn')?.addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;document.getElementById('employeeDialog').close();openCleanupDialog(id)});
document.getElementById('openCleanupBtn')?.addEventListener('click',()=>openCleanupDialog('all'));
['cleanupEmployee','cleanupPeriod','cleanupCode'].forEach(id=>document.getElementById(id).addEventListener('change',updateCleanupPreview));
document.getElementById('cleanupForm')?.addEventListener('submit',e=>{e.preventDefault();applyCleanup()});
document.getElementById('vacationCountToggle')?.addEventListener('click',e=>{
  e.stopPropagation();
  const menu=document.getElementById('vacationCountMenu');
  const open=menu.classList.contains('hidden');
  if(open)renderVacationCountMenu();
  menu.classList.toggle('hidden',!open);
  document.getElementById('vacationCountToggle').setAttribute('aria-expanded',String(open));
});
document.getElementById('vacationCountAllBtn')?.addEventListener('click',()=>setVacationCountCodes(allCodeDefs().map(c=>c.key)));
document.getElementById('vacationCountNoneBtn')?.addEventListener('click',()=>setVacationCountCodes([]));
document.getElementById('vacationCountRowsAllBtn')?.addEventListener('click',()=>setVacationCountRows([...allCodeDefs().map(c=>c.key),'TOTAL','PRESENT','ABSENT_NAMES']));
document.getElementById('vacationCountRowsStandardBtn')?.addEventListener('click',()=>setVacationCountRows(['U','XU','S','TOTAL','PRESENT','ABSENT_NAMES']));
document.getElementById('vacationCountMode')?.addEventListener('change',e=>{state.settings.countMode=e.target.value;persist();render();showToast(e.target.value==='entries'?'Gesamtsumme zählt einzelne Kürzel':'Gesamtsumme zählt Mitarbeiter einmal')});
document.getElementById('employeeInfoToggle')?.addEventListener('click',e=>{
  e.stopPropagation();
  const menu=document.getElementById('employeeInfoMenu');
  const open=menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!open);
  document.getElementById('employeeInfoToggle').setAttribute('aria-expanded',String(open));
});
document.getElementById('employeeInfoWork')?.addEventListener('change',e=>{employeeInfoPrefs.work=e.target.checked;saveEmployeeInfoPrefs()});
document.getElementById('employeeInfoVacation')?.addEventListener('change',e=>{employeeInfoPrefs.vacation=e.target.checked;saveEmployeeInfoPrefs()});
document.getElementById('employeeInfoXU')?.addEventListener('change',e=>{employeeInfoPrefs.xu=e.target.checked;saveEmployeeInfoPrefs()});
document.getElementById('vacationToolsToggle')?.addEventListener('click',toggleVacationTools);
document.getElementById('vacationViewToggle')?.addEventListener('click',e=>{
  e.stopPropagation();
  const menu=document.getElementById('vacationViewMenu');
  const open=menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!open);
  e.currentTarget.setAttribute('aria-expanded',String(open));
});
document.addEventListener('click',e=>{
  const viewMenu=document.getElementById('vacationViewMenu');
  if(viewMenu&&!viewMenu.classList.contains('hidden')&&!e.target.closest('.vt-menu-wrap')){
    viewMenu.classList.add('hidden');
    document.getElementById('vacationViewToggle')?.setAttribute('aria-expanded','false');
  }
  if(vacationToolsOpen&&(!e.target.closest('.vt-menu-wrap')||(e.target.closest('#vacationToolsRow .module-tool-btn')&&!e.target.closest('.file-btn')))){
    vacationToolsOpen=false;localStorage.setItem('teamplan-vacation-tools-open','0');syncVacationUiPrefs();
  }
});
window.addEventListener('resize',fitPlannerViewport);
if(window.ResizeObserver){const ro=new ResizeObserver(()=>fitPlannerViewport());['vacationToolbar','topbar'].forEach(id=>{const el=document.getElementById(id)||document.querySelector('.'+id);if(el)ro.observe(el)})}
fitPlannerViewport();
document.addEventListener('click',e=>{
  const menu=document.getElementById('employeeInfoMenu');
  if(menu&&!menu.classList.contains('hidden')&&!e.target.closest('.employee-info-control')){
    menu.classList.add('hidden');
    document.getElementById('employeeInfoToggle')?.setAttribute('aria-expanded','false');
  }
  const countMenu=document.getElementById('vacationCountMenu');
  if(countMenu&&!countMenu.classList.contains('hidden')&&!e.target.closest('.vacation-count-control')){
    countMenu.classList.add('hidden');
    document.getElementById('vacationCountToggle')?.setAttribute('aria-expanded','false');
  }
});
syncVacationUiPrefs();
const externalToggle=document.getElementById('showExternalEmployees');if(externalToggle)externalToggle.checked=showExternalEmployees;
applyCodeColors();
setVacationCrosshair(vacationCrosshairEnabled);
document.getElementById('fitEmployeesBtn')?.addEventListener('click',fitAllEmployees);
document.getElementById('focusFitBtn')?.addEventListener('click',fitAllEmployees);
document.getElementById('focusModeBtn')?.addEventListener('click',enterPlannerFocus);
document.getElementById('vacationCrosshairBtn')?.addEventListener('click',()=>{setVacationCrosshair(!vacationCrosshairEnabled);showToast(vacationCrosshairEnabled?'Fadenkreuz aktiviert':'Fadenkreuz deaktiviert')});
document.getElementById('exitFocusBtn')?.addEventListener('click',exitPlannerFocus);
document.getElementById('focusSearchBtn')?.addEventListener('click',()=>toggleFocusSearch());
document.getElementById('focusPanBtn')?.addEventListener('click',()=>setFocusPanMode(!focusPanMode));
document.getElementById('focusZoomOutBtn')?.addEventListener('click',()=>changeZoom(-.05));
document.getElementById('focusZoomInBtn')?.addEventListener('click',()=>changeZoom(.05));
document.getElementById('focusMonthSelect')?.addEventListener('change',e=>scrollFocusToMonth(Number(e.target.value)));
document.getElementById('focusPrevMonthBtn')?.addEventListener('click',()=>stepFocusMonth(-1));
document.getElementById('focusNextMonthBtn')?.addEventListener('click',()=>stepFocusMonth(1));
document.getElementById('focusSearchInput')?.addEventListener('input',e=>{
  document.getElementById('searchInput').value=e.target.value;
  render();
});
document.getElementById('focusSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toggleFocusSearch(false)}});
const focusPlanner=document.getElementById('planner');
focusPlanner.addEventListener('pointerdown',e=>{
  if(!focusPanMode||!document.body.classList.contains('planner-focus')||e.button!==0)return;
  e.preventDefault();hideCellContextMenu();clearDragSelection();focusPanning=true;
  focusPanStartX=e.clientX;focusPanStartY=e.clientY;focusPanScrollLeft=focusPlanner.scrollLeft;focusPanScrollTop=focusPlanner.scrollTop;
  focusPlanner.classList.add('panning');focusPlanner.style.scrollBehavior='auto';
  try{focusPlanner.setPointerCapture(e.pointerId)}catch{}
});
focusPlanner.addEventListener('pointermove',e=>{
  if(!focusPanning)return;
  e.preventDefault();
  const dx=e.clientX-focusPanStartX,dy=e.clientY-focusPanStartY;
  focusPlanner.scrollLeft=focusPanScrollLeft-dx;
  focusPlanner.scrollTop=focusPanScrollTop-dy;
  plannerScrollLeft=focusPlanner.scrollLeft;
});
const stopFocusPan=e=>{
  if(!focusPanning)return;focusPanning=false;focusPlanner.classList.remove('panning');focusPlanner.style.scrollBehavior='';
  plannerScrollLeft=focusPlanner.scrollLeft;
  try{focusPlanner.releasePointerCapture(e.pointerId)}catch{}
};
focusPlanner.addEventListener('pointerup',stopFocusPan);
focusPlanner.addEventListener('pointercancel',stopFocusPan);
focusPlanner.addEventListener('pointerleave',e=>{if(focusPanning&&!(e.buttons&1))stopFocusPan(e)});
document.getElementById('employeeForm')?.addEventListener('submit',e=>{e.preventDefault();if(!canEditEmployees())return;const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);trackAction(current?'Mitarbeiter geändert':'Mitarbeiter angelegt',document.getElementById('employeeName').value.trim());const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const external=document.getElementById('employeeExternal').checked;const autoWeekend={enabled:external?false:document.getElementById('employeeAutoWeekend').checked,intervalWeeks:Number(document.getElementById('employeeWeekendInterval').value||2),anchorDate:document.getElementById('employeeWeekendAnchor').value};if(autoWeekend.enabled&&!autoWeekend.anchorDate){alert('Bitte einen Referenz-Samstag für die freien Wochenenden auswählen.');return}if(current)clearAutoWeekendX(id);const obj={id,name:document.getElementById('employeeName').value.trim(),external,organization:document.getElementById('employeeOrganization').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),autoWeekend,role:external?'viewer':(sessionRole==='admin'?document.getElementById('employeeRole').value:(current?.role||'employee')),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);ensureAutoWeekendEntries(viewDate.getFullYear());persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn')?.addEventListener('click',()=>{if(sessionRole!=='admin')return;const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){const name=state.employees.find(e=>e.id===id)?.name||'';trackAction('Mitarbeiter gelöscht',name);state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm')?.addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(empId))return;const blocked=blackoutBlocks(key);if(blocked&&[...selectedCodes].some(c=>['U','XU'].includes(c))){alert('Urlaub ist in dieser Sperrzeit blockiert: '+blocked.name);return}if(!state.entries[empId])state.entries[empId]={};const existing=entryFor(empId,key);const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim(),status:canApprove()&&document.getElementById('cellDirectApprove').checked&&selectedCodes.has('U')?'approved':canApprove()?document.getElementById('cellStatus').value:'wish',plannerMarkers:canManage()?[...selectedPlannerMarkers]:(existing.plannerMarkers||[])};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;trackAction('Planung geändert',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+candidate.codes.join('+'));if(candidate.codes.length||candidate.priority||candidate.note||candidate.plannerMarkers.length)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn')?.addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(emp))return;if(state.entries[emp]){trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===emp)?.name||'')+' · '+key);delete state.entries[emp][key]}persist();saveRemoteEntry(emp,key,null);render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

document.querySelectorAll('[data-planner-marker]').forEach(b=>b.addEventListener('click',()=>{
  if(!canManage())return;
  const marker=b.dataset.plannerMarker;
  selectedPlannerMarkers.has(marker)?selectedPlannerMarkers.delete(marker):selectedPlannerMarkers.add(marker);
  b.classList.toggle('selected',selectedPlannerMarkers.has(marker));
}));
document.getElementById('saveBaseCodeColorsBtn')?.addEventListener('click',saveBaseCodeColors);
document.getElementById('resetBaseCodeColorsBtn')?.addEventListener('click',resetBaseCodeColors);
document.getElementById('addCustomCodeBtn')?.addEventListener('click',()=>{
  if(!canManage())return;
  const key=document.getElementById('customCodeKey').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  const label=document.getElementById('customCodeLabel').value.trim();
  const color=document.getElementById('customCodeColor').value||'#6f7f8f';
  const absence=document.getElementById('customCodeAbsence').checked;
  if(!key||!label){alert('Bitte Kürzel und Bezeichnung angeben.');return}
  if(allCodeDefs().some(c=>c.key===key)){alert('Dieses Kürzel existiert bereits.');return}
  trackAction('Kürzel angelegt',key+' · '+label);
  state.settings.customCodes.push({key,label,color,absence,className:'custom-code'});
  persist();
  document.getElementById('customCodeKey').value='';
  document.getElementById('customCodeLabel').value='';
  document.getElementById('customCodeAbsence').checked=false;
  renderCustomCodesSettings();render();showToast('Kürzel '+key+' angelegt');
});
document.getElementById('settingsForm')?.addEventListener('submit',e=>{e.preventDefault();if(!canManage())return;trackAction('Planungsregeln geändert');state.settings.baseVacation=Number(document.getElementById('settingBaseVacation').value);state.settings.maxVacation=Number(document.getElementById('settingMaxVacation').value);state.settings.maxAbsence=Number(document.getElementById('settingMaxAbsence').value);state.settings.countSchool=document.getElementById('settingCountSchool').checked;const countSet=new Set(selectedCountCodes());state.settings.countSchool?countSet.add('S'):countSet.delete('S');state.settings.countCodes=[...countSet];state.settings.confirmConflicts=document.getElementById('settingConfirmConflicts').checked;persist();render();document.getElementById('settingsDialog').close();showToast('Planungsregeln gespeichert')});

document.getElementById('exportBtn')?.addEventListener('click',async()=>{
  const filename='teamplan-backup-'+new Date().toISOString().slice(0,10)+'.json';
  const content=JSON.stringify(state,null,2);
  try{
    if(window.showSaveFilePicker){
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'TeamPlan JSON',accept:{'application/json':['.json']}}]});
      const writable=await handle.createWritable();await writable.write(content);await writable.close();showToast('Sicherung gespeichert');return;
    }
  }catch(err){if(err?.name==='AbortError')return;console.warn(err)}
  const blob=new Blob([content],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);showToast('Download gestartet');
});
document.getElementById('importInput')?.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const incoming=normalizeState(JSON.parse(await f.text()));if(!confirm('Aktuelle Planung durch diese Sicherung ersetzen?'))return;state=incoming;persist();render();showToast('Sicherung importiert')}catch{alert('Die Datei konnte nicht gelesen werden.')}});

document.getElementById('namesPasteInput')?.addEventListener('input',e=>updateNamesImportPreview(parseNamesText(e.target.value)));
document.getElementById('namesFileInput')?.addEventListener('change',async e=>{
  try{const names=await readNamesFile(e.target.files[0]);document.getElementById('namesPasteInput').value=names.join('\n');updateNamesImportPreview(names)}
  catch(err){alert('Die Namensliste konnte nicht gelesen werden: '+err.message)}
});
document.getElementById('namesImportForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  const names=JSON.parse(document.getElementById('namesImportPreview').dataset.names||'[]');
  if(!names.length){alert('Keine Namen erkannt.');return}
  const replace=document.getElementById('replaceExistingNames').checked;
  if(replace&&!confirm('Vorhandene Mitarbeiter und deren Planeinträge wirklich ersetzen?'))return;
  trackAction('Namensliste importiert',names.length+' Namen');const added=importNames(names,replace);renderRoleControls();document.getElementById('namesImportDialog').close();showToast(added+' Mitarbeiter übernommen');
});

document.getElementById('blackoutsForm')?.addEventListener('submit',e=>{
  e.preventDefault();if(!canManage())return;
  const name=document.getElementById('blackoutName').value.trim(),start=document.getElementById('blackoutStart').value,end=document.getElementById('blackoutEnd').value,mode=document.getElementById('blackoutMode').value;
  if(!name||!start||!end||end<start){alert('Bitte eine gültige Sperrzeit angeben.');return}
  trackAction('Sperrzeit angelegt',name+' · '+start+' bis '+end);
  state.blackouts.push({id:uid(),name,start,end,mode});persist();renderBlackouts();render();e.target.reset();showToast('Sperrzeit gespeichert');
});
document.querySelectorAll('[data-drag-code]').forEach(b=>b.addEventListener('click',()=>applyDragCode(b.dataset.dragCode)));
document.querySelectorAll('[data-drag-marker]').forEach(b=>b.addEventListener('click',()=>applyDragPlannerMarker(b.dataset.dragMarker)));
document.getElementById('dragApprovedVacationBtn')?.addEventListener('click',applyApprovedVacation);
document.getElementById('dragApproveBtn')?.addEventListener('click',()=>applyDragStatus('approved'));
document.getElementById('dragRejectBtn')?.addEventListener('click',()=>applyDragStatus('rejected'));
document.getElementById('dragDeleteBtn')?.addEventListener('click',deleteDragEntries);
document.getElementById('dragCancelBtn')?.addEventListener('click',clearDragSelection);
document.getElementById('loginModeBtn')?.addEventListener('click',()=>{});
document.getElementById('loginForm')?.addEventListener('submit',async e=>{
  if(loginMode!=='bootstrap'&&window.TEAMPLAN_LOGIN_FALLBACK_ACTIVE)return;
  e.preventDefault();if(!supabaseClient)return;
  const errEl=document.getElementById('loginError');errEl.classList.add('hidden');
  const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;
  if(loginMode==='bootstrap'){
    const code=document.getElementById('bootstrapCode').value.trim(),name=document.getElementById('bootstrapName').value.trim()||'Admin';
    if(!code){errEl.textContent='Bitte den Setup-Code eingeben.';errEl.classList.remove('hidden');return}
    localStorage.setItem('teamplan-bootstrap-code',code);localStorage.setItem('teamplan-bootstrap-name',name);
    const {data,error}=await supabaseClient.auth.signUp({email,password});
    if(error){errEl.textContent=error.message;errEl.classList.remove('hidden');return}
    if(data?.session){
      authUser=data.user;
      try{await loadAuthMembership();await loadRemotePlan();await startPresence();await startDiscussionRealtime();hideLogin();setSync('live','● Live synchron')}catch(err){errEl.textContent=err.message;errEl.classList.remove('hidden')}
    }else{
      errEl.textContent='Konto angelegt. Bitte bestätige gegebenenfalls die E-Mail und melde dich danach an. Der Setup-Code bleibt lokal gespeichert.';errEl.classList.remove('hidden');
    }
    return;
  }
  const submitBtn=document.getElementById('loginSubmitBtn');
  const originalText=submitBtn?.textContent||'Anmelden';
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Anmeldung läuft…'}
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(!data?.user)throw new Error('Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    await completeSignedIn(data.user);
  }catch(err){
    console.error(err);
    errEl.textContent=err.message||String(err);
    errEl.classList.remove('hidden');
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=originalText}
  }
});
document.getElementById('logoutBtn')?.addEventListener('click',async()=>{if(supabaseClient)await supabaseClient.auth.signOut()});
document.getElementById('planner')?.addEventListener('contextmenu',e=>{
  const cell=e.target.closest('.day-cell');
  if(!cell)return;
  e.preventDefault();
  showCellContextMenu(e,cell.dataset.emp,cell.dataset.date);
});
document.getElementById('planner')?.addEventListener('click',e=>{
  if(!e.ctrlKey)return;
  const cell=e.target.closest('.day-cell');if(!cell)return;
  e.preventDefault();e.stopPropagation();
  showCellContextMenu(e,cell.dataset.emp,cell.dataset.date);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(dragSelectedKeys.size)clearDragSelection();hideCellContextMenu()}
  if(e.shiftKey&&e.key==='F10'){
    const cell=document.querySelector('.day-cell:hover');if(!cell)return;
    e.preventDefault();
    const r=cell.getBoundingClientRect();
    showCellContextMenu({preventDefault(){},stopPropagation(){},clientX:r.left+12,clientY:r.top+12},cell.dataset.emp,cell.dataset.date);
  }
});
document.addEventListener('click',e=>{if(!e.target.closest('#cellContextMenu'))hideCellContextMenu()});
window.addEventListener('resize',hideCellContextMenu);
document.getElementById('planner')?.addEventListener('scroll',hideCellContextMenu,{passive:true});

document.addEventListener('pointerdown',e=>{if(!e.target.closest('#trainingContextMenu'))hideTrainingContextMenu()});
initTrainingModuleUI();initProjectModuleUI();renderRoleControls();render();switchModule(currentModule,true);
