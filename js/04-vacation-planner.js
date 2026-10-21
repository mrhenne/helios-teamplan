// Urlaub: Planer-Ansicht, Zellen, Drag-Auswahl, Dialoge, Import
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function renderVacationCountMenu(){
  const totalBox=document.getElementById('vacationCountCodes'),rowsBox=document.getElementById('vacationCountRows');if(!totalBox||!rowsBox)return;
  const totalSelected=new Set(selectedCountCodes()),rowSelected=new Set(selectedCountRows());
  const defs=allCodeDefs();
  const optionHtml=(def,attr,checked)=>'<label class="vacation-count-option"><input type="checkbox" '+attr+'="'+escapeHtml(def.key)+'" '+(checked?'checked':'')+'><b class="chip '+escapeHtml(def.className||'custom-code')+'" style="--code-color:'+escapeHtml(def.color||'#6f7f8f')+'">'+escapeHtml(def.key)+'</b><span>'+escapeHtml(def.label)+'</span></label>';
  totalBox.innerHTML=defs.map(def=>optionHtml(def,'data-count-code',totalSelected.has(def.key))).join('');
  rowsBox.innerHTML=defs.map(def=>optionHtml(def,'data-count-row',rowSelected.has(def.key))).join('')+
    '<label class="vacation-count-option special"><input type="checkbox" data-count-row="TOTAL" '+(rowSelected.has('TOTAL')?'checked':'')+'><b>Σ</b><span>Gesamtsumme</span></label>'+
    '<label class="vacation-count-option special"><input type="checkbox" data-count-row="PRESENT" '+(rowSelected.has('PRESENT')?'checked':'')+'><b>✓</b><span>Anwesend</span></label>'+
    '<label class="vacation-count-option special"><input type="checkbox" data-count-row="ABSENT_NAMES" '+(rowSelected.has('ABSENT_NAMES')?'checked':'')+'><b>↗</b><span>Abwesende Namen</span></label>';

  totalBox.querySelectorAll('[data-count-code]').forEach(input=>input.addEventListener('change',()=>{
    const set=new Set(selectedCountCodes());
    input.checked?set.add(input.dataset.countCode):set.delete(input.dataset.countCode);
    state.settings.countCodes=[...set];state.settings.countSchool=set.has('S');
    persist();updateVacationCountButton();render();
  }));
  rowsBox.querySelectorAll('[data-count-row]').forEach(input=>input.addEventListener('change',()=>{
    const set=new Set(selectedCountRows());
    input.checked?set.add(input.dataset.countRow):set.delete(input.dataset.countRow);
    state.settings.countRows=[...set];
    persist();updateVacationCountButton();render();
  }));
  const mode=document.getElementById('vacationCountMode');
  if(mode)mode.value=state.settings.countMode||'people';
}
function updateVacationCountButton(){
  const btn=document.getElementById('vacationCountToggle'),label=document.getElementById('vacationCountLabel');
  if(!btn||!label)return;
  const total=selectedCountCodes(),rows=selectedCountRows();
  label.textContent='Summen konfigurieren';
  btn.title=(total.length?'Gesamt: '+total.join(' + '):'Keine Gesamtkürzel')+' · '+rows.length+' Zeilen sichtbar';
}
function setVacationCountCodes(codes){
  state.settings.countCodes=[...new Set(codes)];state.settings.countSchool=state.settings.countCodes.includes('S');
  persist();renderVacationCountMenu();updateVacationCountButton();render();
}
function setVacationCountRows(rows){
  state.settings.countRows=[...new Set(rows)];
  persist();renderVacationCountMenu();updateVacationCountButton();render();
}
function vacationCountSummaryRow(dates){
  const selected=selectedCountCodes(),label=selected.length?'Gesamt '+selected.join(' + '):'Gesamt';
  let s='<tr class="summary-row aggregate-count-row"><td class="employee-col">Σ '+escapeHtml(label)+'</td>';
  dates.forEach(d=>{
    const key=dateKey(d),n=dailyCounts(key).total,hot=n>state.settings.maxAbsence,warn=n===state.settings.maxAbsence;
    s+='<td data-date="'+key+'" class="aggregate-count-value '+(hot?'count-hot':warn?'count-warn':'')+'">'+(n?formatVacationNumber(n):'')+'</td>';
  });
  return s+'</tr>';
}
function configurableCountRows(dates){
  const rows=new Set(selectedCountRows());
  let html='';
  allCodeDefs().forEach(def=>{
    if(!rows.has(def.key))return;
    const label=def.key==='U'?(state.settings.vacationDisplayMode==='full'?'Urlaub U':'Urlaub U anteilig'):(def.label+' '+def.key);
    html+=summaryRow(label,def.key,dates);
  });
  if(rows.has('TOTAL'))html+=vacationCountSummaryRow(dates);
  if(rows.has('PRESENT'))html+=presenceRow(dates);
  if(rows.has('ABSENT_NAMES'))html+=absenceNamesRow(dates);
  return html;
}

function syncVacationUiPrefs(){
  const work=document.getElementById('employeeInfoWork'),vac=document.getElementById('employeeInfoVacation'),xu=document.getElementById('employeeInfoXU');
  if(work)work.checked=!!employeeInfoPrefs.work;
  if(vac)vac.checked=!!employeeInfoPrefs.vacation;
  if(xu)xu.checked=!!employeeInfoPrefs.xu;
  const row=document.getElementById('vacationToolsRow'),btn=document.getElementById('vacationToolsToggle');
  if(row)row.classList.toggle('vacation-tools-collapsed',!vacationToolsOpen);
  if(btn)btn.setAttribute('aria-expanded',String(vacationToolsOpen));
  updateVacationCountButton();
}
function saveEmployeeInfoPrefs(){
  localStorage.setItem('teamplan-employee-info',JSON.stringify(employeeInfoPrefs));
  syncVacationUiPrefs();
  render();
}
function toggleVacationTools(){
  vacationToolsOpen=!vacationToolsOpen;
  localStorage.setItem('teamplan-vacation-tools-open',vacationToolsOpen?'1':'0');
  syncVacationUiPrefs();
}
function clearVacationCrosshair(){
  document.querySelectorAll('.crosshair-row-active,.crosshair-col-active,.crosshair-intersection').forEach(el=>el.classList.remove('crosshair-row-active','crosshair-col-active','crosshair-intersection'));
}
function updateVacationCrosshairButton(){
  const btn=document.getElementById('vacationCrosshairBtn');if(!btn)return;
  btn.classList.toggle('active',vacationCrosshairEnabled);
  btn.setAttribute('aria-pressed',String(vacationCrosshairEnabled));
  btn.title=vacationCrosshairEnabled?'Fadenkreuz ausschalten':'Fadenkreuz einschalten';
}
function setVacationCrosshair(enabled){
  vacationCrosshairEnabled=!!enabled;
  localStorage.setItem('teamplan-vacation-crosshair',vacationCrosshairEnabled?'1':'0');
  document.body.classList.toggle('vacation-crosshair-enabled',vacationCrosshairEnabled);
  updateVacationCrosshairButton();
  if(!vacationCrosshairEnabled)clearVacationCrosshair();
}
function highlightVacationCrosshair(cell){
  if(!vacationCrosshairEnabled||!cell)return;
  clearVacationCrosshair();
  const row=cell.closest('.employee-row'),key=cell.dataset.date;
  if(row)row.classList.add('crosshair-row-active');
  if(key){
    document.querySelectorAll('.day-cell[data-date="'+key+'"],.date-head[data-date="'+key+'"],.summary-row td[data-date="'+key+'"]').forEach(el=>el.classList.add('crosshair-col-active'));
  }
  cell.classList.add('crosshair-intersection');
}

function render(){
  ensureAutoWeekendEntries(viewDate.getFullYear());
  const dates=activePlannerDates(), holidays=holidaysNRW(viewDate.getFullYear());
  document.getElementById('monthLabel').textContent=MONTHS[viewDate.getMonth()];
  document.getElementById('yearLabel').textContent=viewDate.getFullYear();
  const vacationHeadingSub=document.getElementById('vacationHeadingSub');
  if(vacationHeadingSub)vacationHeadingSub.textContent='Teamübersicht · '+viewDate.getFullYear();
  const vg=document.getElementById('vacationGreeting');if(vg&&typeof trainingGreeting==='function')vg.textContent=trainingGreeting();
  const filter=document.getElementById('searchInput').value.trim().toLowerCase();
  const plannerEmployees=showExternalEmployees?state.employees:teamEmployees();
  const employees=[...plannerEmployees].sort((a,b)=>a.order-b.order).filter(e=>!filter||[e.name,e.organization].filter(Boolean).join(' ').toLowerCase().includes(filter));
  let html='<table class="plan-table"><thead><tr class="month-band-row"><th class="employee-col month-band-label">Jahresverlauf</th>';
  if(currentView==='month'){
    for(let m=0;m<12;m++){const days=new Date(viewDate.getFullYear(),m+1,0).getDate();html+='<th class="month-band" colspan="'+days+'" data-month="'+m+'">'+MONTHS[m]+'</th>';}
    html+='</tr><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  } else {
    html+='</tr><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  }
  dates.forEach(d=>{const key=dateKey(d),we=[0,6].includes(d.getDay()),hol=holidays[key],school=schoolBreakForDate(d),monthBoundary=d.getDate()===1,monthTone=d.getMonth()%2===0?'month-even':'month-odd';html+=`<th class="date-head ${we?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${monthTone} ${monthBoundary&&currentView==='month'?'month-boundary':''}" data-date="${key}" title="${escapeHtml([hol,school&&('NRW '+school)].filter(Boolean).join(' · '))}">${currentView==='month'&&monthBoundary?`<span class="month-mini">${MONTHS[d.getMonth()].slice(0,3)}</span>`:''}${DOW[d.getDay()]}<strong>${d.getDate()}</strong>${hol?`<span class="holiday-label">${escapeHtml(hol)}</span>`:school?`<span class="school-label">${escapeHtml(school.replace('ferien',''))}</span>`:''}</th>`});
  html+='</tr></thead><tbody>';
  employees.forEach(e=>{
    const used=usedVacation(e),total=vacationEntitlement(e),remain=remainingVacation(e),xu=countCode(e,'XU'); const status=remain<0?'status-bad':remain<=3?'status-low':'status-good';
    const employeeFocusClass=sessionRole==='employee'?(e.id===sessionEmployeeId?'employee-own-row':'employee-muted-row'):'';
    const externalClass=e.external?' external-employee-row':'';
    html+=`<tr class="employee-row ${employeeFocusClass}${externalClass}" draggable="${e.external?'false':'true'}" data-id="${e.id}"><td class="employee-col employee-cell"><div class="employee-card ${employeeInfoPrefs.vacation?'':'employee-info-minimal'}"><span class="drag-handle">${e.external?'':'⠿'}</span><div class="employee-edit" data-id="${e.id}"><div class="employee-name"><span class="presence-dot" title="Offline"></span>${escapeHtml(e.name)}${e.external?'<span class="external-badge">Extern</span>':''}</div><div class="employee-meta">${e.external?'<span class="employee-meta-part external-org">'+escapeHtml(e.organization||'Externe Person')+'</span>':''}<span class="employee-meta-part ${employeeInfoPrefs.work?'':'hidden-info'}">${e.hours} h · ${e.percent}% · ${e.workdays} Tage/Woche · ${formatVacationNumber(vacationDaysPerWeek(e))} U/Woche</span><span class="employee-meta-part ${employeeInfoPrefs.xu?'':'hidden-info'}">XU ${xu}</span></div></div><div class="employee-stats ${status} ${employeeInfoPrefs.vacation&&!e.external?'':'hidden-info'}"><div class="vacation-stat-line employee-stat-main"><strong>${formatVacationNumber(used)}/${formatVacationNumber(total)}</strong>${state.settings.vacationDisplayMode==='actual'?`<span class="vacation-factor-badge">× ${formatVacationNumber(vacationFactor(e))}</span>`:''}</div><small class="employee-stat-remain">${formatVacationNumber(remain)} übrig</small></div></div></td>`;
    dates.forEach(d=>{const key=dateKey(d),v=entryFor(e.id,key),we=[0,6].includes(d.getDay()),nonwork=!isWorkday(e,d),conf=conflictLevel(key),school=schoolBreakForDate(d),monthTone=d.getMonth()%2===0?'month-even':'month-odd',blackout=blackoutForKey(key),status=v.status||'wish';const codes=(v.codes||[]).map(c=>{const d=codeDef(c),weighted=c==='U'&&state.settings.vacationDisplayMode==='actual';return `<span class="cell-code ${codeClassName(c)} ${weighted?'weighted-u':''}"${d.color?` style="--code-color:${escapeHtml(d.color)}"`:''}>${c}${weighted?`<small class="u-weight">${formatVacationNumber(vacationFactor(e))}</small>`:''}</span>`}).join('');const plannerMarkers=(v.plannerMarkers||[]).map(m=>`<span class="planner-marker marker-${m==='V?'?'v':m==='T?'?'t':'k'}">${escapeHtml(m)}</span>`).join('');const dayTrainings=trainingForEmployeeDate(e.id,key);const trainingMark=dayTrainings.length?`<span class="cell-training-mark" title="${escapeHtml(dayTrainings.map(t=>t.title).join(' · '))}">F</span>`:'';const warn=(conf.vacation&&entryIsActive(v)&&v.codes?.includes('U'))||(conf.total&&entryIsActive(v)&&v.codes?.some(c=>['U','XU','S'].includes(c)));html+=`<td class="day-cell ${e.external?'external-day-cell ':''}${we?'weekend':''} ${nonwork?'nonwork':''} ${school?'school-holiday-cell':''} ${monthTone} status-${status} ${blackout?'blackout-cell':''}" data-emp="${e.id}" data-date="${key}" title="${escapeHtml([v.note,blackout&&('Sperrzeit: '+blackout.name),school&&('NRW '+school),status&&('Status: '+status),(v.plannerMarkers||[]).length&&('Planer: '+v.plannerMarkers.join(', '))].filter(Boolean).join(' · '))}"><div class="cell-codes">${codes}</div><div class="planner-markers">${plannerMarkers}</div>${trainingMark}${(v.codes||[]).length?`<span class="status-mark status-${status}"></span>`:''}${v.priority?`<span class="cell-priority p${v.priority}"></span>`:''}${v.note?`<span class="cell-note-preview" title="${escapeHtml(v.note)}">${escapeHtml(String(v.note).trim().slice(0,14))}</span>`:''}${warn?'<span class="cell-warning-mark">!</span>':''}</td>`});
    html+='</tr>';
  });
  html+=configurableCountRows(dates);html+='</tbody></table>';
  document.getElementById('planner').innerHTML=html; bindPlannerEvents(); renderMetrics(); syncViewControls(); applyAppearance(); applyCodeColors(); renderDynamicCodes(); renderPresenceUI(); renderUnreadMessageBadge(); updateVacationCrosshairButton();
  if(currentView==='month') setupFlowingMonthScroll();
  if(currentView==='year') renderYearOverview();
  fitPlannerViewport();
}
function summaryRow(label,code,dates){const modeClass=code==='U'?(state.settings.vacationDisplayMode==='actual'?' vacation-summary actual':' vacation-summary full'):'';let s=`<tr class="summary-row ${code==='U'?'alarm':''}${modeClass}"><td class="employee-col">Σ ${label}</td>`;dates.forEach(d=>{const key=dateKey(d),c=dailyCounts(key);let n=c[code]||0;if(!Object.prototype.hasOwnProperty.call(c,code)){n=teamEmployees().reduce((sum,e)=>{const v=entryFor(e.id,key);return sum+(entryIsActive(v)&&v.codes?.includes(code)?1:0)},0)}if(code==='U'&&state.settings.vacationDisplayMode==='actual'){n=roundTwo(teamEmployees().reduce((sum,e)=>{const v=entryFor(e.id,key);return sum+(entryIsActive(v)&&v.codes?.includes('U')?vacationFactor(e):0)},0))}const rawU=c.U,hot=code==='U'&&rawU>state.settings.maxVacation,warn=code==='U'&&rawU===state.settings.maxVacation;s+=`<td data-date="${key}" class="summary-count-value ${hot?'count-hot':warn?'count-warn':''}">${n?formatVacationNumber(n):''}</td>`});return s+'</tr>'}
function presenceRow(dates){let s='<tr class="summary-row presence-row"><td class="employee-col">✓ Anwesend</td>';dates.forEach(d=>{const key=dateKey(d),n=presentCount(key);s+=`<td data-date="${key}">${n}</td>`});return s+'</tr>'}
function absenceNamesRow(dates){
  let s='<tr class="summary-row absence-names-row"><td class="employee-col">↗ Abwesend</td>';
  dates.forEach(d=>{
    const list=absentEmployees(dateKey(d));
    const title=list.map(x=>`${x.employee.name} (${x.codes.join('+')})`).join('\n');
    const visible=list.map(x=>`<span class="absent-name" title="${escapeHtml(x.employee.name)}">${escapeHtml(firstName(x.employee.name))}<small>${x.codes.join('+')}</small></span>`).join('');
    s+=`<td data-date="${dateKey(d)}" title="${escapeHtml(title)}"><div class="absent-list">${visible||'<span class="none">–</span>'}</div></td>`;
  });
  return s+'</tr>';
}
function renderMetrics(){
  const employees=document.getElementById('metricEmployees');if(!employees)return;
  const team=teamEmployees();
  employees.textContent=team.length;
  document.getElementById('metricVacation').textContent=team.reduce((a,e)=>a+usedVacation(e),0);
  document.getElementById('metricXU').textContent=team.reduce((a,e)=>a+countCode(e,'XU'),0);
  document.getElementById('metricConflicts').textContent=activePlannerDates().filter(d=>{const c=conflictLevel(dateKey(d));return c.vacation||c.total}).length;
}

function syncViewControls(){
  document.getElementById('monthView').classList.toggle('hidden',currentView==='year');
  document.getElementById('yearView').classList.toggle('hidden',currentView!=='year');
  document.getElementById('monthViewBtn').classList.toggle('active',currentView==='month');
  document.getElementById('yearViewBtn').classList.toggle('active',currentView==='year');
  const full=state.settings.vacationDisplayMode==='full';
  document.getElementById('vacationFullBtn').classList.toggle('active',full);
  document.getElementById('vacationActualBtn').classList.toggle('active',!full);
  document.body.classList.toggle('vacation-mode-full',full);
  document.body.classList.toggle('vacation-mode-actual',!full);
  const ms=document.getElementById('monthSelect');if(ms)ms.value=String(viewDate.getMonth());
  const ys=document.getElementById('yearSelect');if(ys){const year=viewDate.getFullYear();if(!ys.options.length){for(let y=2025;y<=2035;y++){const o=document.createElement('option');o.value=String(y);o.textContent=String(y);ys.appendChild(o)}}ys.value=String(year)}
  updateFocusPeriod();
}

function applyAppearance(){
  const theme=state.settings.theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.body.classList.toggle('dark-mode',theme==='dark');
  const z=Math.max(.10,Math.min(1.40,Number(state.settings.zoom||1)));
  const dayWidth=Math.max(6,Math.round(52*z)),dayHeight=Math.max(8,Math.round(62*z)),employeeWidth=Math.max(72,Math.round(265*Math.max(.27,z)));
  document.documentElement.style.setProperty('--planner-scale',z);
  document.body.classList.toggle('planner-zoom-tiny',z<.45);
  document.body.classList.toggle('planner-zoom-small',z>=.45&&z<.65);
  document.documentElement.style.setProperty('--day-width',dayWidth+'px');
  document.documentElement.style.setProperty('--day-height',dayHeight+'px');
  document.documentElement.style.setProperty('--employee-width',employeeWidth+'px');
  document.documentElement.style.setProperty('--employee-pad-y',Math.max(1,Math.round(8*z))+'px');
  document.documentElement.style.setProperty('--employee-pad-x',Math.max(1,Math.round(10*z))+'px');
  document.documentElement.style.setProperty('--employee-gap',Math.max(1,Math.round(8*z))+'px');
  document.documentElement.style.setProperty('--drag-font',Math.max(5,Math.round(16*z))+'px');
  document.documentElement.style.setProperty('--employee-name-font',Math.max(5,Math.round(12*z))+'px');
  document.documentElement.style.setProperty('--employee-meta-font',Math.max(4,Math.round(9*z))+'px');
  document.documentElement.style.setProperty('--employee-stat-font',Math.max(5,Math.round(12*z))+'px');
  document.documentElement.style.setProperty('--employee-small-font',Math.max(4,Math.round(8*z))+'px');
  document.documentElement.style.setProperty('--date-font',Math.max(4,Math.round(10*z))+'px');
  document.documentElement.style.setProperty('--date-strong-font',Math.max(5,Math.round(15*z))+'px');
  document.documentElement.style.setProperty('--mini-font',Math.max(3,Math.round(7*z))+'px');
  document.documentElement.style.setProperty('--code-font',Math.max(4,Math.round(9*z))+'px');
  const label=document.getElementById('zoomLabel');if(label)label.textContent=Math.round(z*100)+'%';
  const focusLabel=document.getElementById('focusZoomLabel');if(focusLabel)focusLabel.textContent=Math.round(z*100)+'%';
  const range=document.getElementById('zoomRange');if(range)range.value=String(Math.round(z*100));
  const themeLabel=document.getElementById('themeLabel');if(themeLabel)themeLabel.textContent=theme==='dark'?'Dunkel':'Hell';
}
function setZoom(value){
  state.settings.zoom=Math.max(.10,Math.min(1.40,Number(value)));
  persist();applyAppearance();
}
function changeZoom(delta){setZoom(Math.round((Number(state.settings.zoom||1)+delta)*20)/20);}
function toggleTheme(){
  state.settings.theme=state.settings.theme==='dark'?'light':'dark';
  persist();applyAppearance();
}
function updateFocusPeriod(){
  const m=document.getElementById('focusPeriodMonth'),y=document.getElementById('focusPeriodYear'),select=document.getElementById('focusMonthSelect');
  if(m)m.textContent=MONTHS[viewDate.getMonth()];
  if(y)y.textContent=String(viewDate.getFullYear());
  if(select)select.value=String(viewDate.getMonth());
}
function scrollFocusToMonth(month,forceRender=false){
  month=Math.max(0,Math.min(11,Number(month)));
  const targetYear=viewDate.getFullYear();
  viewDate=new Date(targetYear,month,1);saveLastViewDate();updateFocusPeriod();
  const doScroll=()=>{
    const planner=document.getElementById('planner'),band=document.querySelector('.month-band[data-month="'+month+'"]');
    if(planner&&band){
      planner.scrollTo({left:Math.max(0,band.offsetLeft-planner.clientWidth*.16),behavior:'smooth'});
      plannerScrollLeft=planner.scrollLeft;
    }
  };
  if(forceRender){plannerScrollLeft=null;render();requestAnimationFrame(()=>requestAnimationFrame(doScroll))}
  else doScroll();
}
function stepFocusMonth(delta){
  const oldYear=viewDate.getFullYear(),d=new Date(oldYear,viewDate.getMonth()+delta,1);
  const yearChanged=d.getFullYear()!==oldYear;
  viewDate=d;saveLastViewDate();updateFocusPeriod();
  if(yearChanged){plannerScrollLeft=null;render();requestAnimationFrame(()=>requestAnimationFrame(()=>scrollFocusToMonth(viewDate.getMonth(),false)))}
  else scrollFocusToMonth(d.getMonth(),false);
}
function toggleFocusSearch(force){
  const wrap=document.getElementById('focusSearchWrap'),input=document.getElementById('focusSearchInput');
  const open=typeof force==='boolean'?force:!wrap.classList.contains('open');
  wrap.classList.toggle('open',open);
  if(open){input.value=document.getElementById('searchInput').value;setTimeout(()=>input.focus(),20)}
}
function setFocusPanMode(enabled){
  focusPanMode=!!enabled;focusPanning=false;
  const btn=document.getElementById('focusPanBtn'),planner=document.getElementById('planner');
  if(btn){btn.classList.toggle('active',focusPanMode);btn.setAttribute('aria-pressed',String(focusPanMode));btn.title=focusPanMode?'Navigationsmodus aktiv · klicken zum Entsperren':'Navigationsmodus: Kalender frei horizontal und vertikal verschieben'}
  if(planner)planner.classList.toggle('pan-mode',focusPanMode);
}
function enterPlannerFocus(){
  if(currentView!=='month'){currentView='month';plannerScrollLeft=null;render()}
  document.body.classList.add('planner-focus');
  document.getElementById('focusSearchInput').value=document.getElementById('searchInput').value;
  updateFocusPeriod();setFocusPanMode(false);toggleFocusSearch(false);
}
function exitPlannerFocus(){
  setFocusPanMode(false);toggleFocusSearch(false);document.body.classList.remove('planner-focus');
}
function fitPlannerViewport(){
  const planner=document.getElementById('planner');if(!planner)return;
  const inactive=document.body.classList.contains('planner-focus')||window.innerWidth<=900||currentModule!=='vacation'||currentView==='year';
  if(inactive){planner.style.maxHeight='';return}
  const top=planner.getBoundingClientRect().top+window.scrollY;
  planner.style.maxHeight=Math.max(360,Math.floor(window.innerHeight-top-16))+'px';
}
function fitAllEmployees(){
  if(currentView!=='month'){currentView='month';render()}
  requestAnimationFrame(()=>{
    const planner=document.getElementById('planner'),table=planner?.querySelector('.plan-table');if(!planner||!table)return;
    const current=Math.max(.10,Math.min(1.40,Number(state.settings.zoom||1)));
    const top=planner.getBoundingClientRect().top;
    const focusOffset=document.body.classList.contains('planner-focus')?50:20;
    const available=Math.max(180,window.innerHeight-top-focusOffset);
    const measured=Math.max(1,table.scrollHeight);
    let target=current*(available/measured);
    const FIT_MIN=.62;
    target=Math.max(FIT_MIN,Math.min(1.40,Math.floor(target*100)/100));
    setZoom(target);
    requestAnimationFrame(()=>{planner.scrollTop=0});
    if(target===FIT_MIN&&table.scrollHeight>available){
      showToast('Mindestgröße erreicht · vertikales Scrollen bleibt nötig');
    }else{
      showToast('Mitarbeiter auf '+Math.round(target*100)+'% eingepasst');
    }
  });
}
function setupFlowingMonthScroll(){
  const planner=document.getElementById('planner');if(!planner)return;
  requestAnimationFrame(()=>{
    if(plannerScrollLeft!==null){
      planner.scrollLeft=Math.min(plannerScrollLeft,Math.max(0,planner.scrollWidth-planner.clientWidth));
    }else{
      const currentKey=viewDate.getFullYear()+'-'+String(viewDate.getMonth()+1).padStart(2,'0')+'-01';
      const current=document.querySelector('.day-cell[data-date="'+currentKey+'"]');
      if(current)planner.scrollLeft=Math.max(0,current.offsetLeft-planner.clientWidth*.28);
      plannerScrollLeft=planner.scrollLeft;
    }
    document.querySelectorAll('.month-band').forEach(b=>b.classList.toggle('active',Number(b.dataset.month)===viewDate.getMonth()));
    let ticking=false;
    planner.onscroll=()=>{
      plannerScrollLeft=planner.scrollLeft;
      if(ticking)return;ticking=true;
      requestAnimationFrame(()=>{
        ticking=false;
        const center=planner.scrollLeft+planner.clientWidth*.55,headers=[...document.querySelectorAll('.date-head')];
        let nearest=null,best=Infinity;
        headers.forEach((h,idx)=>{const x=h.offsetLeft+h.offsetWidth/2,dist=Math.abs(x-center);if(dist<best){best=dist;nearest={idx}}});
        if(nearest){const d=flowingMonthDates()[nearest.idx];if(d){viewDate=new Date(d.getFullYear(),d.getMonth(),1);saveLastViewDate();document.getElementById('monthLabel').textContent=MONTHS[d.getMonth()];document.getElementById('yearLabel').textContent=d.getFullYear();updateFocusPeriod();const ms=document.getElementById('monthSelect');if(ms)ms.value=String(d.getMonth());const ys=document.getElementById('yearSelect');if(ys)ys.value=String(d.getFullYear());document.querySelectorAll('.month-band').forEach(b=>b.classList.toggle('active',Number(b.dataset.month)===d.getMonth()));}}
      });
    };
  });
}

function parseNamesText(text){
  return String(text||'').split(/\r?\n|;/).map(x=>x.trim()).filter(Boolean).map(line=>line.split(',')[0].trim()).filter(Boolean);
}
function uniqueNames(names){const seen=new Set();return names.filter(n=>{const k=n.toLocaleLowerCase('de-DE');if(seen.has(k))return false;seen.add(k);return true;});}
function updateNamesImportPreview(names){
  const list=uniqueNames(names||[]),el=document.getElementById('namesImportPreview');
  el.innerHTML=list.length?'<strong>'+list.length+' Namen erkannt</strong><span>'+list.slice(0,8).map(escapeHtml).join(' · ')+(list.length>8?' …':'')+'</span>':'Noch keine Namen erkannt.';
  el.dataset.names=JSON.stringify(list);
}
async function readNamesFile(file){
  if(!file)return [];
  const lower=file.name.toLowerCase();
  if(lower.endsWith('.xlsx')||lower.endsWith('.xls')){
    if(!window.XLSX)throw new Error('Excel-Bibliothek nicht geladen');
    const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false});
    return rows.map(r=>String((r||[])[0]||'').trim()).filter(Boolean);
  }
  return parseNamesText(await file.text());
}
function importNames(names,replace){
  const clean=uniqueNames(names);if(!clean.length)return 0;
  if(replace){state.employees=[];state.entries={};}
  const existing=new Set(state.employees.map(e=>e.name.toLocaleLowerCase('de-DE')));
  let added=0;
  clean.forEach(name=>{const k=name.toLocaleLowerCase('de-DE');if(existing.has(k))return;state.employees.push({id:uid(),name,hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',autoWeekend:{enabled:false,intervalWeeks:2,anchorDate:''},order:state.employees.length});existing.add(k);added++;});
  state.employees.forEach((e,i)=>e.order=i);persist();render();return added;
}
function renderYearOverview(){
  const year=viewDate.getFullYear(), holidays=holidaysNRW(year);
  let html=`<div class="year-head glass"><div><span class="eyebrow">JAHRESÜBERSICHT</span><h2>${year}</h2></div><div class="year-legend"><span><b class="mini-dot u"></b> Urlaub</span><span><b class="mini-dot xu"></b> XU</span><span><b class="mini-dot s"></b> Schule</span><span><b class="mini-dot conflict"></b> Konflikt</span></div></div>`;
  html+='<div class="year-month-grid">';
  for(let month=0;month<12;month++){
    const first=new Date(year,month,1), days=new Date(year,month+1,0).getDate(), offset=(first.getDay()+6)%7;
    html+=`<article class="year-month glass" data-month="${month}"><button type="button" class="year-month-title" data-month="${month}">${MONTHS[month]}</button><div class="mini-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="mini-calendar">`;
    for(let i=0;i<offset;i++) html+='<span class="mini-day empty"></span>';
    for(let day=1;day<=days;day++){
      const d=new Date(year,month,day), key=dateKey(d), counts=dailyCounts(key), conf=conflictLevel(key), weekend=[0,6].includes(d.getDay()), hol=holidays[key],school=schoolBreakForDate(d);
      const total=counts.U+counts.XU+counts.S;
      const absent=absentEmployees(key).map(x=>`${x.employee.name} (${x.codes.join('+')})`).join(', ');
      html+=`<button type="button" class="mini-day ${weekend?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${conf.vacation||conf.total?'conflict':''}" data-date="${key}" title="${escapeHtml(([hol,school&&('NRW '+school),absent].filter(Boolean).join(' · ')+(hol||school||absent?' · ':'')+'Klicken: Mitarbeiter für diesen Tag planen'))}"><span class="mini-date">${day}</span><span class="mini-counts">${counts.U?'<b class="u">'+counts.U+'</b>':''}${counts.XU?'<b class="xu">'+counts.XU+'</b>':''}${counts.S?'<b class="s">'+counts.S+'</b>':''}</span>${!total?'<span class="mini-present">'+presentCount(key)+'</span>':''}</button>`;
    }
    html+='</div></article>';
  }
  html+='</div>';
  const employees=[...teamEmployees()].sort((a,b)=>a.order-b.order);
  html+='<section class="year-staff glass"><div class="year-staff-head"><strong>Urlaubskonto '+year+'</strong><small>Anzeige: '+(state.settings.vacationDisplayMode==='full'?'Gesamtplanung':'anteilig fürs Firmenprogramm')+'</small></div><div class="year-staff-table"><table><thead><tr><th>Mitarbeiter</th><th>Gesamt geplant</th><th>Anteilig nötig</th><th>Anspruch anteilig</th><th>Rest anteilig</th><th>XU</th></tr></thead><tbody>';
  employees.forEach(e=>{
    const full=usedVacationFull(e,year), actual=usedVacationActual(e,year), ent=actualVacationEntitlement(e), rest=ent-actual;
    html+=`<tr><td>${escapeHtml(e.name)}</td><td>${full}</td><td><strong>${actual}</strong></td><td>${ent}</td><td class="${rest<0?'status-bad':rest<=3?'status-low':'status-good'}">${rest}</td><td>${countCode(e,'XU',year)}</td></tr>`;
  });
  html+='</tbody></table></div></section>';
  document.getElementById('yearOverview').innerHTML=html;
  document.querySelectorAll('.year-month-title').forEach(b=>b.addEventListener('click',()=>{viewDate.setMonth(Number(b.dataset.month));currentView='month';render()}));
  document.querySelectorAll('.mini-day[data-date]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openVacationForDate(b.dataset.date)}));
}

function clearDragSelection(){
  dragSelectedKeys.clear();dragSelecting=false;dragMoved=false;dragEmployeeId=null;dragStartKey=null;
  document.querySelectorAll('.day-cell.drag-selected').forEach(el=>el.classList.remove('drag-selected'));
  document.getElementById('dragActionBar').classList.add('hidden');
}
function updateDragVisuals(){
  document.querySelectorAll('.day-cell').forEach(el=>el.classList.toggle('drag-selected',el.dataset.emp===dragEmployeeId&&dragSelectedKeys.has(el.dataset.date)));
}
function updateDragActionBar(){
  if(!dragEmployeeId||!dragSelectedKeys.size){document.getElementById('dragActionBar').classList.add('hidden');return}
  const emp=state.employees.find(e=>e.id===dragEmployeeId);
  document.getElementById('dragActionCount').textContent=`${dragSelectedKeys.size} ${dragSelectedKeys.size===1?'Tag':'Tage'}`;
  document.getElementById('dragActionEmployee').textContent=emp?.name||'';
  document.getElementById('dragApprovedVacationBtn').classList.toggle('hidden',!canApprove());
  document.getElementById('dragPlannerMarkers').classList.toggle('hidden',!canManage());
  if(canManage()){
    document.querySelectorAll('[data-drag-marker]').forEach(btn=>{
      const marker=btn.dataset.dragMarker;
      const allHave=[...dragSelectedKeys].every(key=>(entryFor(dragEmployeeId,key).plannerMarkers||[]).includes(marker));
      btn.classList.toggle('active',allHave);
    });
  }
  document.getElementById('dragApproveBtn').classList.toggle('hidden',!canApprove());
  document.getElementById('dragRejectBtn').classList.toggle('hidden',!canApprove());
  document.getElementById('dragActionBar').classList.remove('hidden');
}
function setDragRange(endKey){
  if(!dragStartKey||!dragEmployeeId)return;
  const start=new Date(dragStartKey+'T12:00:00'),end=new Date(endKey+'T12:00:00'),min=start<end?start:end,max=start<end?end:start;
  dragSelectedKeys=new Set();
  for(let d=new Date(min);d<=max;d=addDays(d,1)){
    const key=dateKey(d);
    const cell=document.querySelector(`.day-cell[data-emp="${dragEmployeeId}"][data-date="${key}"]`);
    if(cell)dragSelectedKeys.add(key);
  }
  dragMoved=dragSelectedKeys.size>1;
  updateDragVisuals();
}
function applyDragCode(code){
  if(!dragEmployeeId||!dragSelectedKeys.size||!canPlan(dragEmployeeId)){showToast('Keine Bearbeitungsrechte');return}
  const blocked=[...dragSelectedKeys].filter(key=>['U','XU'].includes(code)&&blackoutBlocks(key));
  if(blocked.length){alert('Dieser Zeitraum enthält eine Urlaubssperre: '+blackoutBlocks(blocked[0]).name);return}
  trackAction('Mehrtageseintrag',code+' · '+dragSelectedKeys.size+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  dragSelectedKeys.forEach(key=>{
    const old=entryFor(dragEmployeeId,key),codes=[...new Set([...(old.codes||[]),code])];
    state.entries[dragEmployeeId][key]={...old,codes,priority:old.priority||0,note:old.note||'',status:sessionRole==='employee'?'wish':(old.status||'wish'),plannerMarkers:old.plannerMarkers||[]};
  });
  const changed=[...dragSelectedKeys];const count=changed.length;persist();changed.forEach(key=>saveRemoteEntry(dragEmployeeId,key,state.entries[dragEmployeeId][key]));clearDragSelection();render();showToast(`${code} für ${count} Tage eingetragen`);
}
function applyDragPlannerMarker(marker){
  if(!canManage()||!dragEmployeeId||!dragSelectedKeys.size)return;
  const keys=[...dragSelectedKeys];
  const remove=keys.every(key=>(entryFor(dragEmployeeId,key).plannerMarkers||[]).includes(marker));
  trackAction(remove?'Planungsstatus entfernt':'Planungsstatus gesetzt',marker+' · '+keys.length+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  keys.forEach(key=>{
    const old=entryFor(dragEmployeeId,key),set=new Set(old.plannerMarkers||[]);
    remove?set.delete(marker):set.add(marker);
    const next={...old,plannerMarkers:[...set]};
    if((next.codes||[]).length||next.priority||next.note||next.plannerMarkers.length)state.entries[dragEmployeeId][key]=next;
    else delete state.entries[dragEmployeeId][key];
  });
  const count=keys.length;persist();clearDragSelection();render();
  showToast(marker+' '+(remove?'entfernt':'gesetzt')+' · '+count+' Tage');
}
function applyApprovedVacation(){
  if(!canApprove()||!dragEmployeeId||!dragSelectedKeys.size)return;
  const blocked=[...dragSelectedKeys].filter(key=>blackoutBlocks(key));if(blocked.length){alert('Dieser Zeitraum enthält eine Urlaubssperre: '+blackoutBlocks(blocked[0]).name);return}
  trackAction('Urlaub direkt genehmigt',dragSelectedKeys.size+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  dragSelectedKeys.forEach(key=>{const old=entryFor(dragEmployeeId,key);state.entries[dragEmployeeId][key]={...old,codes:[...new Set([...(old.codes||[]),'U'])],status:'approved'}});
  const count=dragSelectedKeys.size;persist();clearDragSelection();render();showToast(count+' Urlaubstage genehmigt eingetragen');
}
function applyDragStatus(status){
  if(!canApprove()||!dragEmployeeId||!dragSelectedKeys.size)return;
  const entries=state.entries[dragEmployeeId]||{};
  const keys=[...dragSelectedKeys].filter(key=>entries[key]?.codes?.some(c=>['U','XU'].includes(c)));
  if(!keys.length){showToast('Keine Urlaubswünsche in der Auswahl');return}
  trackAction(status==='approved'?'Urlaub genehmigt':'Urlaub abgelehnt',keys.length+' Tage');
  keys.forEach(key=>{entries[key]={...entries[key],status}});
  const count=keys.length;persist();clearDragSelection();render();showToast((status==='approved'?'Genehmigt: ':'Abgelehnt: ')+count+' Tage');
}
function deleteDragEntries(){
  if(!dragEmployeeId||!dragSelectedKeys.size||!canPlan(dragEmployeeId)){showToast('Keine Bearbeitungsrechte');return}
  if(!state.entries[dragEmployeeId])return clearDragSelection();
  trackAction('Einträge gelöscht',dragSelectedKeys.size+' Tage');
  const changed=[...dragSelectedKeys],count=changed.length;changed.forEach(key=>delete state.entries[dragEmployeeId][key]);
  persist();changed.forEach(key=>saveRemoteEntry(dragEmployeeId,key,null));clearDragSelection();render();showToast(`${count} Tage gelöscht`);
}
function hideCellContextMenu(){
  const menu=document.getElementById('cellContextMenu');if(menu)menu.classList.add('hidden');
}
function quickCellCode(empId,key,code,status=null){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  if(['U','XU'].includes(code)&&blackoutBlocks(key)){showToast('Urlaubssperre: '+blackoutBlocks(key).name);return}
  if(!state.entries[empId])state.entries[empId]={};
  const old=entryFor(empId,key);
  trackAction('Schnelleintrag', (state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+code);
  state.entries[empId][key]={...old,codes:[...new Set([...(old.codes||[]),code])],status:status||(old.status||'wish')};
  persist();saveRemoteEntry(empId,key,state.entries[empId][key]);hideCellContextMenu();render();
  showToast(code+(status==='approved'?' genehmigt':'')+' eingetragen');
}
function quickEditCellNote(empId,key){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  const old=entryFor(empId,key),current=old.note||'';
  const value=prompt(current?'Notiz bearbeiten':'Notiz hinzufügen',current);
  if(value===null)return;
  const note=value.trim();
  if(!state.entries[empId])state.entries[empId]={};
  const next={...old,note,status:sessionRole==='employee'?'wish':(old.status||'wish'),plannerMarkers:old.plannerMarkers||[]};
  trackAction(note?'Notiz geändert':'Notiz entfernt',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key);
  if((next.codes||[]).length||next.priority||note||(next.plannerMarkers||[]).length)state.entries[empId][key]=next;
  else delete state.entries[empId][key];
  persist();saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);hideCellContextMenu();render();
  showToast(note?'Notiz gespeichert':'Notiz entfernt');
}
function quickDeleteCell(empId,key){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  if(!state.entries[empId]?.[key]){hideCellContextMenu();return}
  trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key);
  delete state.entries[empId][key];persist();saveRemoteEntry(empId,key,null);hideCellContextMenu();render();showToast('Eintrag gelöscht');
}
function showCellContextMenu(event,empId,key){
  event.preventDefault();event.stopPropagation();
  if(!canPlan(empId)){
    if(sessionRole==='employee')showToast('Du kannst nur deine eigene Zeile bearbeiten');
    return;
  }
  clearDragSelection();
  const menu=document.getElementById('cellContextMenu'),entry=entryFor(empId,key),emp=state.employees.find(e=>e.id===empId),d=new Date(key+'T12:00:00');
  const codeButtons=allCodeDefs().map(c=>{
    const active=(entry.codes||[]).includes(c.key),style=c.color?' style="--code-color:'+escapeHtml(c.color)+'"':'';
    return '<button type="button" class="context-code '+codeClassName(c.key)+(active?' active':'')+'" data-context-code="'+escapeHtml(c.key)+'"'+style+'><b>'+escapeHtml(c.key)+'</b><span>'+escapeHtml(c.label)+'</span>'+(active?'<i>✓</i>':'')+'</button>';
  }).join('');
  const markerButtons=canManage()?'<div class="context-section planner-context-section"><small>Planer-Hinweis</small>'+
    ['V?','T?','K!'].map(m=>'<button type="button" class="context-code planner-context-marker '+((entry.plannerMarkers||[]).includes(m)?'active':'')+'" data-context-marker="'+m+'"><b>'+m+'</b><span>'+(m==='V?'?'Verschiebung':m==='T?'?'Tausch':'Klärung')+'</span>'+((entry.plannerMarkers||[]).includes(m)?'<i>✓</i>':'')+'</button>').join('')+'</div>':'';
  menu.innerHTML='<div class="context-head"><strong>'+escapeHtml(emp?.name||'')+'</strong><span>'+DOW[d.getDay()]+' · '+d.getDate()+'. '+MONTHS[d.getMonth()]+'</span></div>'+
    '<div class="context-section"><small>Schnell eintragen</small>'+codeButtons+'</div>'+
    (canApprove()?'<button type="button" class="context-action approve-context" data-context-approved="1"><b>U✓</b><span>Urlaub genehmigt</span></button>':'')+
    markerButtons+
    '<div class="context-separator"></div>'+
    (canDiscuss()?'<button type="button" class="context-action discussion-context" data-context-discussion="1"><b>◌</b><span>Team-Chat starten…</span></button>':'')+
    '<button type="button" class="context-action note-context" data-context-note="1"><b>≡</b><span>'+(entry.note?'Notiz bearbeiten…':'Notiz hinzufügen…')+'</span></button>'+
    '<button type="button" class="context-action" data-context-edit="1"><b>✎</b><span>Vollständig bearbeiten…</span></button>'+
    '<button type="button" class="context-action danger-context" data-context-delete="1"><b>⌫</b><span>Eintrag löschen</span></button>';
  menu.querySelectorAll('[data-context-code]').forEach(b=>b.addEventListener('click',()=>quickCellCode(empId,key,b.dataset.contextCode)));
  menu.querySelector('[data-context-approved]')?.addEventListener('click',()=>quickCellCode(empId,key,'U','approved'));
  menu.querySelectorAll('[data-context-marker]').forEach(b=>b.addEventListener('click',()=>{
    if(!canManage())return;
    const marker=b.dataset.contextMarker,old=entryFor(empId,key),set=new Set(old.plannerMarkers||[]);
    set.has(marker)?set.delete(marker):set.add(marker);
    if(!state.entries[empId])state.entries[empId]={};
    const next={...old,plannerMarkers:[...set]};
    if((next.codes||[]).length||next.priority||next.note||next.plannerMarkers.length)state.entries[empId][key]=next;else delete state.entries[empId][key];
    trackAction('Planungsstatus geändert',(emp?.name||'')+' · '+key+' · '+marker);
    persist();hideCellContextMenu();render();showToast(marker+' aktualisiert');
  }));
  menu.querySelector('[data-context-discussion]')?.addEventListener('click',()=>{
    hideCellContextMenu();
    openNewDiscussion({date:key,employeeId:empId,title:'Chat '+(emp?.name||'')+' · '+key});
  });
  menu.querySelector('[data-context-note]').addEventListener('click',()=>quickEditCellNote(empId,key));
  menu.querySelector('[data-context-edit]').addEventListener('click',()=>{hideCellContextMenu();openCell(empId,key)});
  menu.querySelector('[data-context-delete]').addEventListener('click',()=>quickDeleteCell(empId,key));
  menu.classList.remove('hidden');
  const pad=8,w=menu.offsetWidth||230,h=menu.offsetHeight||360;
  const x=Math.min(event.clientX,window.innerWidth-w-pad),y=Math.min(event.clientY,window.innerHeight-h-pad);
  menu.style.left=Math.max(pad,x)+'px';menu.style.top=Math.max(pad,y)+'px';
}
function bindPlannerEvents(){
  const planner=document.getElementById('planner');
  planner?.addEventListener('pointerover',e=>{
    const cell=e.target.closest('.day-cell');
    if(cell)highlightVacationCrosshair(cell);
  });
  planner?.addEventListener('pointerleave',()=>{if(vacationCrosshairEnabled)clearVacationCrosshair()});
  document.querySelectorAll('.day-cell').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(focusPanMode&&document.body.classList.contains('planner-focus'))return;
      if(e.ctrlKey){e.preventDefault();showCellContextMenu(e,el.dataset.emp,el.dataset.date);return}
      if(e.button!==0)return;
      if(!canPlan(el.dataset.emp)){showToast('Nur-Lese-Modus oder keine Rechte für diesen Mitarbeiter');return}
      e.preventDefault();const anchorDate=new Date(el.dataset.date+'T12:00:00');viewDate=new Date(anchorDate.getFullYear(),anchorDate.getMonth(),1);saveLastViewDate();clearDragSelection();dragSelecting=true;dragEmployeeId=el.dataset.emp;dragStartKey=el.dataset.date;dragSelectedKeys=new Set([el.dataset.date]);updateDragVisuals();
      try{el.setPointerCapture(e.pointerId)}catch{}
    });
    el.addEventListener('pointerenter',()=>{
      if(!dragSelecting||el.dataset.emp!==dragEmployeeId)return;
      setDragRange(el.dataset.date);
    });
    el.addEventListener('pointermove',e=>{
      if(!dragSelecting)return;
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('.day-cell');
      if(target&&target.dataset.emp===dragEmployeeId)setDragRange(target.dataset.date);
    });
    el.addEventListener('pointerup',()=>{
      if(!dragSelecting)return;
      dragSelecting=false;
      if(dragMoved||dragSelectedKeys.size>1){suppressNextCellClick=true;updateDragActionBar()}
      else {const emp=dragEmployeeId,key=dragStartKey;clearDragSelection();openCell(emp,key)}
    });
    el.addEventListener('click',e=>{if(suppressNextCellClick){e.preventDefault();suppressNextCellClick=false}});
  });
  document.querySelectorAll('.employee-edit').forEach(el=>el.addEventListener('click',()=>openEmployee(el.dataset.id)));
  let dragged=null; document.querySelectorAll('.employee-row').forEach(row=>{row.addEventListener('dragstart',e=>{if(focusPanMode&&document.body.classList.contains('planner-focus')){e.preventDefault();return}dragged=row.dataset.id;row.style.opacity=.45});row.addEventListener('dragend',()=>{row.style.opacity='';document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drop-target')});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.id;if(dragged&&dragged!==target){reorder(dragged,target)}})});
}
function reorder(sourceId,targetId){if(!canEditEmployees()){showToast('Keine Rechte für Stammdaten');return}trackAction('Reihenfolge geändert');const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function cleanupMatchesDate(key,period){
  if(period==='all')return true;
  const year=String(viewDate.getFullYear());
  if(period==='year')return key.startsWith(year+'-');
  const month=String(viewDate.getMonth()+1).padStart(2,'0');
  return key.startsWith(year+'-'+month+'-');
}
function cleanupAffectedEntries(){
  const empValue=document.getElementById('cleanupEmployee')?.value||'all';
  const period=document.getElementById('cleanupPeriod')?.value||'month';
  const code=document.getElementById('cleanupCode')?.value||'all';
  const employees=empValue==='all'?state.employees:state.employees.filter(e=>e.id===empValue);
  const matches=[];
  employees.forEach(emp=>{
    Object.entries(state.entries[emp.id]||{}).forEach(([key,entry])=>{
      if(!cleanupMatchesDate(key,period))return;
      if(code==='all'){
        if((entry.codes||[]).length||entry.note||entry.priority||entry.status)matches.push({empId:emp.id,key,code:null});
      }else if((entry.codes||[]).includes(code))matches.push({empId:emp.id,key,code});
    });
  });
  return matches;
}
function updateCleanupPreview(){
  const box=document.getElementById('cleanupPreview');if(!box)return;
  const count=cleanupAffectedEntries().length;
  const emp=document.getElementById('cleanupEmployee'),period=document.getElementById('cleanupPeriod'),code=document.getElementById('cleanupCode');
  const empText=emp?.options[emp.selectedIndex]?.text||'',periodText=period?.options[period.selectedIndex]?.text||'',codeText=code?.options[code.selectedIndex]?.text||'';
  box.innerHTML='<strong>'+count+' '+(count===1?'Eintrag':'Einträge')+'</strong><span>'+escapeHtml(empText)+' · '+escapeHtml(periodText)+' · '+escapeHtml(codeText)+'</span>';
  box.classList.toggle('empty',count===0);
}
function openCleanupDialog(selectedEmpId='all'){
  if(!canManage()){showToast('Nur Admin und Planer dürfen Planungsdaten gesammelt löschen');return}
  const emp=document.getElementById('cleanupEmployee'),code=document.getElementById('cleanupCode');
  emp.innerHTML='<option value="all">Alle Mitarbeiter</option>'+[...state.employees].sort((a,b)=>a.order-b.order).map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
  emp.value=selectedEmpId&&state.employees.some(e=>e.id===selectedEmpId)?selectedEmpId:'all';
  code.innerHTML='<option value="all">Alle Einträge</option>'+allCodeDefs().map(c=>'<option value="'+escapeHtml(c.key)+'">'+escapeHtml(c.key+' · '+c.label)+'</option>').join('');
  document.getElementById('cleanupPeriod').value='month';
  updateCleanupPreview();
  safeShowDialog('cleanupDialog');
}
function applyCleanup(){
  if(!canManage())return;
  const matches=cleanupAffectedEntries();if(!matches.length){showToast('Keine passenden Einträge gefunden');return}
  const emp=document.getElementById('cleanupEmployee'),period=document.getElementById('cleanupPeriod'),code=document.getElementById('cleanupCode');
  const summary=[emp.options[emp.selectedIndex]?.text,period.options[period.selectedIndex]?.text,code.options[code.selectedIndex]?.text].filter(Boolean).join(' · ');
  if(!confirm(matches.length+' '+(matches.length===1?'Eintrag':'Einträge')+' wirklich löschen?\n\n'+summary+'\n\nDie Aktion kann über Verlauf → Rückgängig wiederhergestellt werden.'))return;
  trackAction('Planungsdaten gelöscht',summary+' · '+matches.length+' Einträge');
  matches.forEach(({empId,key,code:targetCode})=>{
    const entry=state.entries[empId]?.[key];if(!entry)return;
    if(!targetCode){delete state.entries[empId][key];return}
    const codes=(entry.codes||[]).filter(c=>c!==targetCode);
    if(codes.length||entry.note||entry.priority){state.entries[empId][key]={...entry,codes}}
    else delete state.entries[empId][key];
  });
  persist();render();document.getElementById('cleanupDialog').close();showToast(matches.length+' Einträge gelöscht');
}
function syncEmployeeExternalMode(){
  const external=!!document.getElementById('employeeExternal')?.checked;
  document.getElementById('employeeOrganizationWrap')?.classList.toggle('hidden',!external);
  document.querySelectorAll('#employeeForm [data-team-only]').forEach(el=>el.classList.toggle('hidden',external));
  document.getElementById('employeeExternalHint')?.classList.toggle('hidden',!external);
  if(external){const aw=document.getElementById('employeeAutoWeekend');if(aw)aw.checked=false}
}
function openEmployee(id=null){
  if(!canEditEmployees()){showToast('Keine Rechte für Mitarbeiter-Stammdaten');return}
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeExternal').checked=!!e?.external;document.getElementById('employeeOrganization').value=e?.organization||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('employeeRole').value=e?.role||'employee';document.getElementById('employeeRole').disabled=sessionRole!=='admin';document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e||sessionRole!=='admin');document.getElementById('employeeRangeBtn').classList.toggle('hidden',!e||!!e.external||!canPlan(e.id));document.getElementById('employeeCleanupBtn').classList.toggle('hidden',!e||!!e.external||!canManage());const aw=e?.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''};document.getElementById('employeeAutoWeekend').checked=!!aw.enabled;document.getElementById('employeeWeekendInterval').value=String(aw.intervalWeeks||2);document.getElementById('employeeWeekendAnchor').value=aw.anchorDate||'';document.getElementById('autoWeekendOptions').classList.toggle('disabled-block',!aw.enabled);renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);syncEmployeeExternalMode();updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const percent=Math.max(0,Math.min(100,Number(document.getElementById('employeePercent').value||100))),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,total=roundHalf(base+carry+adj),weekly=roundTwo(5*percent/100);document.getElementById('vacationPreview').innerHTML=`<div class="vacation-preview-main"><strong>${formatVacationNumber(total)} Tage Jahresanspruch</strong><strong>${formatVacationNumber(weekly)} U je voller Urlaubswoche</strong></div><span>Klinikplaner: 5 × ${formatVacationNumber(percent)} % = ${formatVacationNumber(weekly)} U pro voller Urlaubswoche. Der Jahresanspruch bleibt unverändert.</span>`}

function openCell(empId,key){if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte für diesen Mitarbeiter');return}const clickedDate=new Date(key+'T12:00:00');viewDate=new Date(clickedDate.getFullYear(),clickedDate.getMonth(),1);saveLastViewDate();const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);selectedPlannerMarkers=new Set(v.plannerMarkers||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellStatus').value=v.status||'wish';document.getElementById('cellStatus').disabled=!canApprove();document.getElementById('cellDirectApprove').checked=false;document.getElementById('cellDirectApproveLine').classList.toggle('hidden',!canApprove());document.getElementById('plannerMarkerBlock').classList.toggle('hidden',!canManage());document.querySelectorAll('[data-planner-marker]').forEach(b=>b.classList.toggle('selected',selectedPlannerMarkers.has(b.dataset.plannerMarker)));document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
function updateCellWarning(empId,key){const e=state.employees.find(x=>x.id===empId),d=new Date(key+'T12:00:00'),w=document.getElementById('cellWarning');let msgs=[];const blackout=blackoutForKey(key);if(blackout&&[...selectedCodes].some(c=>['U','XU'].includes(c)))msgs.push((blackout.mode==='block'?'URLAUBSSPERRE: ':'Sperrzeit-Hinweis: ')+blackout.name+'.');if(selectedCodes.has('U')&&!isWorkday(e,d))msgs.push('U liegt auf einem nicht regulären Arbeitstag und zählt deshalb nicht vom Urlaubsanspruch ab.');const c=dailyCounts(key),currentEntry=entryFor(empId,key),current=currentEntry.codes||[],currentActive=entryIsActive(currentEntry);const uAfter=c.U-(currentActive&&current.includes('U')?1:0)+(selectedCodes.has('U')?1:0);const sAfter=c.S-(currentActive&&current.includes('S')?1:0)+(selectedCodes.has('S')?1:0);const xuAfter=c.XU-(currentActive&&current.includes('XU')?1:0)+(selectedCodes.has('XU')?1:0);const total=uAfter+xuAfter+(state.settings.countSchool?sAfter:0);if(uAfter>state.settings.maxVacation)msgs.push(`Urlaubslimit überschritten: ${uAfter} statt maximal ${state.settings.maxVacation}.`);if(total>state.settings.maxAbsence)msgs.push(`Gesamt-Abwesenheitswarnung: ${total} statt maximal ${state.settings.maxAbsence}.`);w.textContent=msgs.join(' ');w.classList.toggle('hidden',!msgs.length)}

function bulkDates(){
  const startVal=document.getElementById('bulkStart').value,endVal=document.getElementById('bulkEnd').value;
  if(!startVal||!endVal) return [];
  const start=new Date(startVal+'T12:00:00'),end=new Date(endVal+'T12:00:00');
  if(end<start) return [];
  const emp=state.employees.find(e=>e.id===document.getElementById('bulkEmployee').value);
  const onlyWork=document.getElementById('bulkOnlyWorkdays').checked,skipWeekends=document.getElementById('bulkSkipWeekends').checked;
  const out=[]; for(let d=new Date(start);d<=end;d=addDays(d,1)){
    if(skipWeekends&&[0,6].includes(d.getDay())) continue;
    if(onlyWork&&emp&&!isWorkday(emp,d)) continue;
    out.push(new Date(d));
  }
  return out;
}
function updateBulkPreview(){
  const preview=document.getElementById('bulkPreview'); if(!preview) return;
  const emp=state.employees.find(e=>e.id===document.getElementById('bulkEmployee').value),dates=bulkDates();
  if(!emp||!dates.length){preview.innerHTML='<span>Zeitraum auswählen.</span>';return}
  let existing=0,conflicts=0,actualVacation=0;
  dates.forEach(d=>{
    const key=dateKey(d),entry=entryFor(emp.id,key);
    if((entry.codes||[]).length||entry.note||entry.priority) existing++;
    if(bulkSelectedCodes.has('U')&&isWorkday(emp,d)) actualVacation++;
    const currentU=dailyCounts(key).U-(entry.codes?.includes('U')?1:0)+(bulkSelectedCodes.has('U')?1:0);
    if(currentU>state.settings.maxVacation) conflicts++;
  });
  preview.innerHTML=`<strong>${dates.length} Tage betroffen</strong><span>${existing} mit bestehendem Eintrag</span><span>${conflicts} mögliche Urlaubskonflikte</span>${bulkSelectedCodes.has('U')?`<span>${actualVacation} Urlaubstage fürs Firmenprogramm</span>`:''}`;
}
function openBulkDialog(selectedEmpId=null){
  const employees=[...state.employees].sort((a,b)=>a.order-b.order).filter(e=>sessionRole!=='employee'||e.id===sessionEmployeeId);
  if(!employees.length){showToast('Kein Mitarbeiter für diesen Modus ausgewählt');return}
  document.getElementById('bulkEmployee').innerHTML=employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  if(selectedEmpId&&employees.some(e=>e.id===selectedEmpId))document.getElementById('bulkEmployee').value=selectedEmpId;
  const today=new Date(),start=new Date(viewDate.getFullYear(),viewDate.getMonth(),Math.min(today.getMonth()===viewDate.getMonth()&&today.getFullYear()===viewDate.getFullYear()?today.getDate():1,new Date(viewDate.getFullYear(),viewDate.getMonth()+1,0).getDate()));
  document.getElementById('bulkStart').value=dateKey(start);document.getElementById('bulkEnd').value=dateKey(start);
  document.getElementById('bulkStatus').value='wish';document.getElementById('bulkStatus').disabled=!canApprove();document.getElementById('bulkDirectApprove').checked=false;document.getElementById('bulkDirectApproveLine').classList.toggle('hidden',!canApprove());document.getElementById('bulkPriority').value='0';document.getElementById('bulkMode').value='merge';document.getElementById('bulkNote').value='';
  document.getElementById('bulkOnlyWorkdays').checked=false;document.getElementById('bulkSkipWeekends').checked=false;
  bulkSelectedCodes=new Set();document.querySelectorAll('[data-bulk-code]').forEach(b=>b.classList.remove('selected'));
  updateBulkPreview();document.getElementById('bulkDialog').showModal();
}
function openVacationForDate(date){
  openBulkDialog();
  const start=document.getElementById('bulkStart');
  const end=document.getElementById('bulkEnd');
  if(start)start.value=date;
  if(end)end.value=date;
  updateBulkPreview();
  window.setTimeout(()=>document.getElementById('bulkEmployee')?.focus(),0);
}

function applyBulk(clear=false){
  const empId=document.getElementById('bulkEmployee').value,dates=bulkDates(),mode=document.getElementById('bulkMode').value;
  if(!empId||!dates.length){alert('Bitte einen gültigen Zeitraum auswählen.');return false}
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return false}
  if(!clear&&!bulkSelectedCodes.size){alert('Bitte mindestens ein Kürzel auswählen.');return false}
  const blocked=dates.map(dateKey).filter(key=>[...bulkSelectedCodes].some(c=>['U','XU'].includes(c))&&blackoutBlocks(key));
  if(blocked.length&&!clear){alert('Der Zeitraum enthält eine Urlaubssperre: '+blackoutBlocks(blocked[0]).name);return false}
  trackAction(clear?'Zeitraum gelöscht':'Zeitraum geplant',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+dates.length+' Tage');
  if(!state.entries[empId]) state.entries[empId]={};
  const priority=Number(document.getElementById('bulkPriority').value),note=document.getElementById('bulkNote').value.trim(),status=canApprove()&&document.getElementById('bulkDirectApprove').checked&&bulkSelectedCodes.has('U')?'approved':canApprove()?document.getElementById('bulkStatus').value:'wish';
  let overwritten=0;
  dates.forEach(d=>{
    const key=dateKey(d),old=entryFor(empId,key);
    if(clear){if(state.entries[empId][key]){delete state.entries[empId][key];overwritten++}return}
    if(mode==='replace'){
      if((old.codes||[]).length||old.note||old.priority) overwritten++;
      state.entries[empId][key]={codes:[...bulkSelectedCodes],priority,note,status};
    } else {
      const codes=[...new Set([...(old.codes||[]),...bulkSelectedCodes])];
      state.entries[empId][key]={codes,priority:Math.max(Number(old.priority||0),priority),note:note||old.note||'',status:canApprove()?status:(old.status||'wish')};
    }
  });
  persist();if(sessionRole==='employee')dates.forEach(d=>{const key=dateKey(d);saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null)});render();document.getElementById('bulkDialog').close();
  showToast(clear?`${overwritten} Einträge aus Zeitraum gelöscht`:`${dates.length} Tage eingetragen`);
  return true;
}



function safeShowDialog(id){
  const d=document.getElementById(id);if(!d){console.error('Dialog fehlt:',id);showToast('Werkzeug konnte nicht geöffnet werden');return false}
  try{if(typeof d.showModal==='function'){if(!d.open)d.showModal()}else d.setAttribute('open','');return true}
  catch(err){console.error(err);d.setAttribute('open','');return true}
}
function normalizeImportCode(value){
  const raw=String(value??'').trim().toUpperCase();if(!raw)return [];
  const out=[];
  if(/\bXU\b|WUNSCH.?FREI/.test(raw))out.push('XU');
  if(/URLAUB|\bU\b/.test(raw))out.push('U');
  if(/SCHULE|FORTBILDUNG|\bS\b/.test(raw))out.push('S');
  if(/GEBURTSTAG|\bG\b/.test(raw))out.push('G');
  if((/FREI|\bX\b/.test(raw))&&!out.includes('XU'))out.push('X');
  return [...new Set(out)];
}
function parseImportedDate(value){
  if(value instanceof Date&&!isNaN(value))return dateKey(value);
  if(typeof value==='number'&&value>20000&&window.XLSX?.SSF?.parse_date_code){
    const p=XLSX.SSF.parse_date_code(value);if(p)return dateKey(new Date(p.y,p.m-1,p.d));
  }
  const s=String(value??'').trim();if(!s)return '';
  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if(m){let y=Number(m[3]);if(y<100)y+=2000;return dateKey(new Date(y,Number(m[2])-1,Number(m[1])))}
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return dateKey(new Date(Number(m[1]),Number(m[2])-1,Number(m[3])));
  const d=new Date(s);return isNaN(d)?'':dateKey(d);
}
function cellText(v){return String(v??'').trim()}
function analyzePlanRows(rows){
  const clean=(rows||[]).filter(r=>Array.isArray(r)&&r.some(v=>cellText(v)));
  if(!clean.length)return {format:'',entries:[],names:[],warnings:['Keine Daten gefunden.']};
  const aliases={name:/^(name|mitarbeiter|mitarbeiterin|personal|person|kollege|kollegin)$/i,date:/^(datum|date|tag)$/i,code:/^(code|kürzel|kuerzel|art|abwesenheit|status|eintrag)$/i};
  for(let ri=0;ri<Math.min(clean.length,12);ri++){
    const headers=clean[ri].map(v=>cellText(v).toLowerCase());
    const nameCol=headers.findIndex(h=>aliases.name.test(h)),dateCol=headers.findIndex(h=>aliases.date.test(h)),codeCol=headers.findIndex(h=>aliases.code.test(h));
    if(nameCol>=0&&dateCol>=0&&codeCol>=0){
      const entries=[];for(let r=ri+1;r<clean.length;r++){
        const name=cellText(clean[r][nameCol]),date=parseImportedDate(clean[r][dateCol]),codes=normalizeImportCode(clean[r][codeCol]);
        if(name&&date&&codes.length)entries.push({name,date,codes});
      }
      return {format:'Liste',entries,names:[...new Set(entries.map(x=>x.name))],warnings:[]};
    }
  }
  let best=null;
  for(let ri=0;ri<Math.min(clean.length,20);ri++){
    const parsed=clean[ri].map(parseImportedDate),dateCols=parsed.map((d,ci)=>d?ci:-1).filter(ci=>ci>=0);
    if(dateCols.length>=3&&(!best||dateCols.length>best.dateCols.length))best={ri,dateCols,parsed};
  }
  if(best){
    const firstDateCol=Math.min(...best.dateCols),nameCol=Math.max(0,firstDateCol-1),entries=[];
    for(let r=best.ri+1;r<clean.length;r++){
      const name=cellText(clean[r][nameCol]);if(!name)continue;
      best.dateCols.forEach(ci=>{const date=best.parsed[ci],codes=normalizeImportCode(clean[r][ci]);if(date&&codes.length)entries.push({name,date,codes})});
    }
    return {format:'Kalendermatrix',entries,names:[...new Set(entries.map(x=>x.name))],warnings:entries.length?[]:['Datumsüberschriften erkannt, aber keine Kürzel U/X/XU/S/G gefunden.']};
  }
  return {format:'Unbekannt',entries:[],names:[],warnings:['Format nicht erkannt. Nutze eine Liste mit Name, Datum, Kürzel oder eine Matrix mit echten Datumswerten in der Kopfzeile.']};
}
let pendingPlanImport=null;
async function readPlanImportFile(file){
  if(!file)throw new Error('Keine Datei ausgewählt');
  const lower=file.name.toLowerCase();
  if(lower.endsWith('.xlsx')||lower.endsWith('.xls')){
    if(!window.XLSX)throw new Error('Excel-Bibliothek konnte nicht geladen werden.');
    const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array',cellDates:true});
    let best={entries:[],names:[],format:'',warnings:[]};
    wb.SheetNames.forEach(name=>{
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:''}),result=analyzePlanRows(rows);
      if(result.entries.length>best.entries.length)best={...result,sheet:name};
    });
    return best;
  }
  const text=await file.text(),rows=text.split(/\r?\n/).filter(Boolean).map(line=>line.includes(';')?line.split(';'):line.split(','));
  return analyzePlanRows(rows);
}
function renderPlanImportPreview(result){
  pendingPlanImport=result;
  const el=document.getElementById('planImportPreview'),btn=document.getElementById('planImportApplyBtn');
  if(!result||!result.entries.length){el.innerHTML='<strong>Nichts importierbar</strong><span>'+escapeHtml((result?.warnings||['Keine Daten erkannt.']).join(' '))+'</span>';btn.disabled=true;return}
  el.innerHTML=`<strong>${result.entries.length} Einträge erkannt</strong><span>${result.names.length} Mitarbeiter · Format: ${escapeHtml(result.format)}${result.sheet?' · Blatt: '+escapeHtml(result.sheet):''}</span><span>Beispiele: ${result.entries.slice(0,6).map(x=>escapeHtml(x.name+' · '+x.date+' · '+x.codes.join('+'))).join(' | ')}</span>`;
  btn.disabled=false;
}
function applyPlanImport(){
  if(!pendingPlanImport?.entries?.length)return;
  if(!canManage()){showToast('Keine Rechte für Planimport');return}
  const create=document.getElementById('planImportCreateEmployees').checked,mode=document.getElementById('planImportMode').value,status=document.getElementById('planImportStatus').value;
  const map=new Map(state.employees.map(e=>[e.name.trim().toLocaleLowerCase('de-DE'),e]));
  let created=0,applied=0,skipped=0;
  trackAction('Urlaubsplan importiert',pendingPlanImport.entries.length+' erkannte Einträge');
  pendingPlanImport.entries.forEach(row=>{
    const key=row.name.trim().toLocaleLowerCase('de-DE');let emp=map.get(key);
    if(!emp&&create){emp={id:uid(),name:row.name.trim(),hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',autoWeekend:{enabled:false,intervalWeeks:2,anchorDate:''},order:state.employees.length};state.employees.push(emp);map.set(key,emp);created++}
    if(!emp){skipped++;return}
    if(!state.entries[emp.id])state.entries[emp.id]={};
    const old=entryFor(emp.id,row.date);
    state.entries[emp.id][row.date]=mode==='replace'
      ?{codes:[...row.codes],priority:old.priority||0,note:old.note||'',status}
      :{codes:[...new Set([...(old.codes||[]),...row.codes])],priority:old.priority||0,note:old.note||'',status:old.status&&old.status!=='wish'?old.status:status};
    applied++;
  });
  state.employees.forEach((e,i)=>e.order=i);persist();renderRoleControls();render();document.getElementById('planImportDialog').close();showToast(`${applied} Einträge importiert${created?' · '+created+' Mitarbeiter angelegt':''}${skipped?' · '+skipped+' übersprungen':''}`);
}
function runToolAction(action){
  try{
    if(action==='conflicts'){renderConflicts();safeShowDialog('conflictsDialog');return}
    if(action==='history'){renderHistory();safeShowDialog('historyDialog');return}
    if(action==='blackouts'){if(!canManage()){showToast('Sperrzeiten: nur Admin/Planer');return}renderBlackouts();safeShowDialog('blackoutsDialog');return}
    if(action==='roles'){safeShowDialog('rolesHelpDialog');return}
    if(action==='plan-import'){if(!canManage()){showToast('Planimport: nur Admin/Planer');return}pendingPlanImport=null;document.getElementById('planImportFile').value='';renderPlanImportPreview(null);safeShowDialog('planImportDialog');return}
    if(action==='excel'){exportExcel();return}
    if(action==='pdf'){exportPdf();return}
  }catch(err){console.error('Werkzeugfehler',action,err);alert('Werkzeug konnte nicht ausgeführt werden: '+err.message)}
}
