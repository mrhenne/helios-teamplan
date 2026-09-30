const CODES = ['U','X','XU','S','G'];
const CODE_CLASS = {U:'u',X:'x',XU:'xu',S:'s',G:'g'};
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DOW = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const DOW_LONG = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const WORKDAY_LABELS = [{d:1,l:'Mo'},{d:2,l:'Di'},{d:3,l:'Mi'},{d:4,l:'Do'},{d:5,l:'Fr'}];

const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const roundHalf = n => Math.round(n*2)/2;

const defaultState = {
  version: 1,
  settings: {baseVacation:30,maxVacation:4,maxAbsence:7,countSchool:true,confirmConflicts:true,state:'NW',vacationDisplayMode:'actual'},
  employees: [
    {id:uid(),name:'Anna Beispiel',hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,order:0},
    {id:uid(),name:'Ben Beispiel',hours:30,percent:78,workdays:4,workweek:[1,2,3,4],carry:2,adjustment:0,order:1},
    {id:uid(),name:'Clara Beispiel',hours:19.25,percent:50,workdays:3,workweek:[1,3,5],carry:0,adjustment:0,order:2}
  ],
  entries: {},
  updatedAt: new Date().toISOString()
};

let state = loadLocal();
let viewDate = new Date(); viewDate.setDate(1);
let selectedCodes = new Set();
let bulkSelectedCodes = new Set();
let supabaseClient = null;
let syncTimer = null;
let isApplyingRemote = false;
let currentView = 'month';
let dragSelecting = false;
let dragMoved = false;
let dragEmployeeId = null;
let dragStartKey = null;
let dragSelectedKeys = new Set();
let suppressNextCellClick = false;

function loadLocal(){
  try { const raw=localStorage.getItem('helios-teamplan-v1'); return raw ? normalizeState(JSON.parse(raw)) : structuredClone(defaultState); }
  catch { return structuredClone(defaultState); }
}
function normalizeState(s){
  s.settings={...defaultState.settings,...(s.settings||{})}; s.employees=s.employees||[]; s.entries=s.entries||{};
  s.employees.forEach((e,i)=>{e.order=e.order??i;e.workweek=e.workweek||[1,2,3,4,5];e.carry=Number(e.carry||0);e.adjustment=Number(e.adjustment||0)}); return s;
}
function persist(){
  state.updatedAt=new Date().toISOString(); localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));
  if(!isApplyingRemote && supabaseClient){clearTimeout(syncTimer);syncTimer=setTimeout(pushRemote,350)}
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function actualVacationEntitlement(e){return roundHalf(state.settings.baseVacation*(Number(e.workdays)||5)/5 + Number(e.carry||0) + Number(e.adjustment||0));}
function fullVacationEntitlement(e){return roundHalf(state.settings.baseVacation + Number(e.carry||0) + Number(e.adjustment||0));}
function vacationEntitlement(e){return state.settings.vacationDisplayMode==='full' ? fullVacationEntitlement(e) : actualVacationEntitlement(e);}
function entryFor(empId,key){return state.entries?.[empId]?.[key] || {codes:[],priority:0,note:''};}
function isWorkday(e,d){return (e.workweek||[]).includes(d.getDay());}
function usedVacationActual(e,year=viewDate.getFullYear()){let n=0;Object.entries(state.entries[e.id]||{}).forEach(([k,v])=>{if(k.startsWith(year+'-')&&v.codes?.includes('U')){const d=new Date(k+'T12:00:00');if(isWorkday(e,d)) n++;}});return n;}
function usedVacationFull(e,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&v.codes?.includes('U')).length;}
function usedVacation(e,year=viewDate.getFullYear()){return state.settings.vacationDisplayMode==='full' ? usedVacationFull(e,year) : usedVacationActual(e,year);}
function countCode(e,code,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&v.codes?.includes(code)).length;}
function remainingVacation(e,year=viewDate.getFullYear()){return vacationEntitlement(e)-usedVacation(e,year);}
function absentCount(key){return state.employees.filter(e=>{const c=entryFor(e.id,key).codes||[];return c.some(code=>['U','X','XU','S'].includes(code));}).length;}
function presentCount(key){return Math.max(0,state.employees.length-absentCount(key));}
function absentEmployees(key){
  return [...state.employees].sort((a,b)=>a.order-b.order).filter(e=>{
    const c=entryFor(e.id,key).codes||[];
    return c.some(code=>['U','X','XU','S'].includes(code));
  }).map(e=>({employee:e,codes:(entryFor(e.id,key).codes||[]).filter(code=>['U','X','XU','S'].includes(code))}));
}
function firstName(name){return String(name||'').trim().split(/\s+/)[0]||name;}

function getEaster(year){
  const f=Math.floor,a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,g=Math.floor((8*b+13)/25),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+19*l)/433),month=Math.floor((h+l-7*m+90)/25),day=(h+l-7*m+33*month+19)%32; return new Date(year,month-1,day);
}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function holidaysNRW(year){const e=getEaster(year); const fixed=[[0,1,'Neujahr'],[4,1,'Tag der Arbeit'],[9,3,'Tag der Einheit'],[10,1,'Allerheiligen'],[11,25,'1. Weihnachtstag'],[11,26,'2. Weihnachtstag']]; const map={}; fixed.forEach(([m,d,n])=>map[dateKey(new Date(year,m,d))]=n); [[-2,'Karfreitag'],[1,'Ostermontag'],[39,'Christi Himmelfahrt'],[50,'Pfingstmontag'],[60,'Fronleichnam']].forEach(([o,n])=>map[dateKey(addDays(e,o))]=n); return map;}

const NRW_SCHOOL_BREAKS = [
  ['2025-12-22','2026-01-06','Weihnachtsferien'],
  ['2026-03-30','2026-04-11','Osterferien'],
  ['2026-05-26','2026-05-26','Pfingstferien'],
  ['2026-07-20','2026-09-01','Sommerferien'],
  ['2026-10-17','2026-10-31','Herbstferien'],
  ['2026-12-23','2027-01-06','Weihnachtsferien'],
  ['2027-03-22','2027-04-03','Osterferien'],
  ['2027-05-18','2027-05-18','Pfingstferien'],
  ['2027-07-19','2027-08-31','Sommerferien'],
  ['2027-10-23','2027-11-06','Herbstferien'],
  ['2027-12-24','2028-01-08','Weihnachtsferien'],
  ['2028-04-10','2028-04-22','Osterferien'],
  ['2028-07-10','2028-08-22','Sommerferien'],
  ['2028-10-23','2028-11-04','Herbstferien'],
  ['2028-12-21','2029-01-05','Weihnachtsferien'],
  ['2029-03-26','2029-04-07','Osterferien'],
  ['2029-05-22','2029-05-22','Pfingstferien'],
  ['2029-07-02','2029-08-14','Sommerferien'],
  ['2029-10-15','2029-10-27','Herbstferien'],
  ['2029-12-20','2030-01-04','Weihnachtsferien'],
  ['2030-04-15','2030-04-27','Osterferien']
];
function schoolBreakForDate(d){
  const k=dateKey(d);
  const found=NRW_SCHOOL_BREAKS.find(([start,end])=>k>=start&&k<=end);
  return found?found[2]:'';
}

function monthDates(){const y=viewDate.getFullYear(),m=viewDate.getMonth(),last=new Date(y,m+1,0).getDate();return Array.from({length:last},(_,i)=>new Date(y,m,i+1));}
function quarterDates(){
  const y=viewDate.getFullYear(),qStart=Math.floor(viewDate.getMonth()/3)*3,out=[];
  for(let m=qStart;m<qStart+3;m++){const last=new Date(y,m+1,0).getDate();for(let i=1;i<=last;i++)out.push(new Date(y,m,i));}
  return out;
}
function activePlannerDates(){return currentView==='quarter'?quarterDates():monthDates();}
function dailyCounts(key){let U=0,XU=0,S=0;state.employees.forEach(e=>{const c=entryFor(e.id,key).codes||[];if(c.includes('U'))U++;if(c.includes('XU'))XU++;if(c.includes('S'))S++});return {U,XU,S,total:U+XU+(state.settings.countSchool?S:0)};}
function conflictLevel(key){const c=dailyCounts(key);return {vacation:c.U>state.settings.maxVacation,total:c.total>state.settings.maxAbsence};}

function render(){
  const dates=activePlannerDates(), holidays=holidaysNRW(viewDate.getFullYear());
  if(currentView==='quarter'){
    const q=Math.floor(viewDate.getMonth()/3)+1,start=(q-1)*3;
    document.getElementById('monthLabel').textContent=`Q${q} · ${MONTHS[start].slice(0,3)}–${MONTHS[start+2].slice(0,3)}`;
  } else document.getElementById('monthLabel').textContent=MONTHS[viewDate.getMonth()];
  document.getElementById('yearLabel').textContent=viewDate.getFullYear();
  const filter=document.getElementById('searchInput').value.trim().toLowerCase();
  const employees=[...state.employees].sort((a,b)=>a.order-b.order).filter(e=>!filter||e.name.toLowerCase().includes(filter));
  let html='<table class="plan-table"><thead><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  dates.forEach(d=>{const key=dateKey(d),we=[0,6].includes(d.getDay()),hol=holidays[key],school=schoolBreakForDate(d),monthBoundary=d.getDate()===1;html+=`<th class="date-head ${we?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${monthBoundary&&currentView==='quarter'?'month-boundary':''}" title="${escapeHtml([hol,school&&('NRW '+school)].filter(Boolean).join(' · '))}">${currentView==='quarter'&&monthBoundary?`<span class="month-mini">${MONTHS[d.getMonth()].slice(0,3)}</span>`:''}${DOW[d.getDay()]}<strong>${d.getDate()}</strong>${hol?`<span class="holiday-label">${escapeHtml(hol)}</span>`:school?`<span class="school-label">${escapeHtml(school.replace('ferien',''))}</span>`:''}</th>`});
  html+='</tr></thead><tbody>';
  employees.forEach(e=>{
    const used=usedVacation(e),total=vacationEntitlement(e),remain=remainingVacation(e),xu=countCode(e,'XU'); const status=remain<0?'status-bad':remain<=3?'status-low':'status-good';
    html+=`<tr class="employee-row" draggable="true" data-id="${e.id}"><td class="employee-col employee-cell"><div class="employee-card"><span class="drag-handle">⠿</span><div class="employee-edit" data-id="${e.id}"><div class="employee-name">${escapeHtml(e.name)}</div><div class="employee-meta">${e.hours} h · ${e.percent}% · ${e.workdays} Tage/Woche · XU ${xu}</div></div><div class="employee-stats ${status}"><strong>${used}/${total}</strong><small>${remain} übrig</small></div></div></td>`;
    dates.forEach(d=>{const key=dateKey(d),v=entryFor(e.id,key),we=[0,6].includes(d.getDay()),nonwork=!isWorkday(e,d),conf=conflictLevel(key),school=schoolBreakForDate(d);const codes=(v.codes||[]).map(c=>`<span class="cell-code ${CODE_CLASS[c]}">${c}</span>`).join('');const warn=(conf.vacation&&v.codes?.includes('U'))||(conf.total&&v.codes?.some(c=>['U','XU','S'].includes(c)));html+=`<td class="day-cell ${we?'weekend':''} ${nonwork?'nonwork':''} ${school?'school-holiday-cell':''}" data-emp="${e.id}" data-date="${key}" title="${escapeHtml([v.note,school&&('NRW '+school)].filter(Boolean).join(' · '))}"><div class="cell-codes">${codes}</div>${v.priority?`<span class="cell-priority p${v.priority}"></span>`:''}${v.note?'<span class="cell-note"></span>':''}${warn?'<span class="cell-warning-mark">!</span>':''}</td>`});
    html+='</tr>';
  });
  html+=summaryRow('Urlaub U','U',dates);html+=summaryRow('Wunschfrei XU','XU',dates);html+=summaryRow('Schule S','S',dates);html+=presenceRow(dates);html+=absenceNamesRow(dates);html+='</tbody></table>';
  document.getElementById('planner').innerHTML=html; bindPlannerEvents(); renderMetrics(); syncViewControls();
  if(currentView==='year') renderYearOverview();
}
function summaryRow(label,code,dates){let s=`<tr class="summary-row ${code==='U'?'alarm':''}"><td class="employee-col">Σ ${label}</td>`;dates.forEach(d=>{const c=dailyCounts(dateKey(d)),n=c[code],hot=code==='U'&&n>state.settings.maxVacation,warn=code==='U'&&n===state.settings.maxVacation;s+=`<td class="${hot?'count-hot':warn?'count-warn':''}">${n||''}</td>`});return s+'</tr>'}
function presenceRow(dates){let s='<tr class="summary-row presence-row"><td class="employee-col">✓ Anwesend</td>';dates.forEach(d=>{const n=presentCount(dateKey(d));s+=`<td>${n}</td>`});return s+'</tr>'}
function absenceNamesRow(dates){
  let s='<tr class="summary-row absence-names-row"><td class="employee-col">↗ Abwesend</td>';
  dates.forEach(d=>{
    const list=absentEmployees(dateKey(d));
    const title=list.map(x=>`${x.employee.name} (${x.codes.join('+')})`).join('\n');
    const visible=list.map(x=>`<span class="absent-name" title="${escapeHtml(x.employee.name)}">${escapeHtml(firstName(x.employee.name))}<small>${x.codes.join('+')}</small></span>`).join('');
    s+=`<td title="${escapeHtml(title)}"><div class="absent-list">${visible||'<span class="none">–</span>'}</div></td>`;
  });
  return s+'</tr>';
}
function renderMetrics(){
  document.getElementById('metricEmployees').textContent=state.employees.length; document.getElementById('metricVacation').textContent=state.employees.reduce((a,e)=>a+usedVacation(e),0); document.getElementById('metricXU').textContent=state.employees.reduce((a,e)=>a+countCode(e,'XU'),0); document.getElementById('metricConflicts').textContent=activePlannerDates().filter(d=>{const c=conflictLevel(dateKey(d));return c.vacation||c.total}).length;
}

function syncViewControls(){
  document.getElementById('monthView').classList.toggle('hidden',currentView==='year');
  document.getElementById('yearView').classList.toggle('hidden',currentView!=='year');
  document.getElementById('monthViewBtn').classList.toggle('active',currentView==='month');
  document.getElementById('quarterViewBtn').classList.toggle('active',currentView==='quarter');
  document.getElementById('yearViewBtn').classList.toggle('active',currentView==='year');
  const full=state.settings.vacationDisplayMode==='full';
  document.getElementById('vacationFullBtn').classList.toggle('active',full);
  document.getElementById('vacationActualBtn').classList.toggle('active',!full);
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
      html+=`<button type="button" class="mini-day ${weekend?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${conf.vacation||conf.total?'conflict':''}" data-date="${key}" title="${escapeHtml([hol,school&&('NRW '+school),absent].filter(Boolean).join(' · '))}"><span class="mini-date">${day}</span><span class="mini-counts">${counts.U?'<b class="u">'+counts.U+'</b>':''}${counts.XU?'<b class="xu">'+counts.XU+'</b>':''}${counts.S?'<b class="s">'+counts.S+'</b>':''}</span>${!total?'<span class="mini-present">'+presentCount(key)+'</span>':''}</button>`;
    }
    html+='</div></article>';
  }
  html+='</div>';
  const employees=[...state.employees].sort((a,b)=>a.order-b.order);
  html+='<section class="year-staff glass"><div class="year-staff-head"><strong>Urlaubskonto '+year+'</strong><small>Anzeige: '+(state.settings.vacationDisplayMode==='full'?'Gesamtplanung':'anteilig fürs Firmenprogramm')+'</small></div><div class="year-staff-table"><table><thead><tr><th>Mitarbeiter</th><th>Gesamt geplant</th><th>Anteilig nötig</th><th>Anspruch anteilig</th><th>Rest anteilig</th><th>XU</th></tr></thead><tbody>';
  employees.forEach(e=>{
    const full=usedVacationFull(e,year), actual=usedVacationActual(e,year), ent=actualVacationEntitlement(e), rest=ent-actual;
    html+=`<tr><td>${escapeHtml(e.name)}</td><td>${full}</td><td><strong>${actual}</strong></td><td>${ent}</td><td class="${rest<0?'status-bad':rest<=3?'status-low':'status-good'}">${rest}</td><td>${countCode(e,'XU',year)}</td></tr>`;
  });
  html+='</tbody></table></div></section>';
  document.getElementById('yearOverview').innerHTML=html;
  document.querySelectorAll('.year-month-title').forEach(b=>b.addEventListener('click',()=>{viewDate.setMonth(Number(b.dataset.month));currentView='month';render()}));
  document.querySelectorAll('.mini-day[data-date]').forEach(b=>b.addEventListener('click',()=>{const d=new Date(b.dataset.date+'T12:00:00');viewDate=new Date(d.getFullYear(),d.getMonth(),1);currentView='month';render()}));
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
  if(!dragEmployeeId||!dragSelectedKeys.size)return;
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  dragSelectedKeys.forEach(key=>{
    const old=entryFor(dragEmployeeId,key),codes=[...new Set([...(old.codes||[]),code])];
    state.entries[dragEmployeeId][key]={codes,priority:old.priority||0,note:old.note||''};
  });
  const count=dragSelectedKeys.size;persist();clearDragSelection();render();showToast(`${code} für ${count} Tage eingetragen`);
}
function deleteDragEntries(){
  if(!dragEmployeeId||!dragSelectedKeys.size)return;
  if(!state.entries[dragEmployeeId])return clearDragSelection();
  const count=dragSelectedKeys.size;dragSelectedKeys.forEach(key=>delete state.entries[dragEmployeeId][key]);
  persist();clearDragSelection();render();showToast(`${count} Tage gelöscht`);
}
function bindPlannerEvents(){
  document.querySelectorAll('.day-cell').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      e.preventDefault();clearDragSelection();dragSelecting=true;dragEmployeeId=el.dataset.emp;dragStartKey=el.dataset.date;dragSelectedKeys=new Set([el.dataset.date]);updateDragVisuals();
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
  let dragged=null; document.querySelectorAll('.employee-row').forEach(row=>{row.addEventListener('dragstart',()=>{dragged=row.dataset.id;row.style.opacity=.45});row.addEventListener('dragend',()=>{row.style.opacity='';document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drop-target')});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.id;if(dragged&&dragged!==target){reorder(dragged,target)}})});
}
function reorder(sourceId,targetId){const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function openEmployee(id=null){
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e);renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const wd=Number(document.getElementById('employeeWorkdays').value||5),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,actual=roundHalf(base*wd/5+carry+adj),full=roundHalf(base+carry+adj);document.getElementById('vacationPreview').innerHTML=`<strong>Gesamtplanung: ${full} Tage</strong> · <strong>Anteilig fürs Firmenprogramm: ${actual} Tage</strong><br><span style="color:var(--muted)">Anteilig = ${base} × ${wd}/5 + ${carry} Übertrag ${adj>=0?'+':''}${adj} Korrektur. Der Stellenanteil in % allein reduziert die Urlaubstage nicht.</span>`}

function openCell(empId,key){const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('.code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
function updateCellWarning(empId,key){const e=state.employees.find(x=>x.id===empId),d=new Date(key+'T12:00:00'),w=document.getElementById('cellWarning');let msgs=[];if(selectedCodes.has('U')&&!isWorkday(e,d))msgs.push('U liegt auf einem nicht regulären Arbeitstag und zählt deshalb nicht vom Urlaubsanspruch ab.');const c=dailyCounts(key),current=entryFor(empId,key).codes||[];const uAfter=c.U-(current.includes('U')?1:0)+(selectedCodes.has('U')?1:0);const sAfter=c.S-(current.includes('S')?1:0)+(selectedCodes.has('S')?1:0);const xuAfter=c.XU-(current.includes('XU')?1:0)+(selectedCodes.has('XU')?1:0);const total=uAfter+xuAfter+(state.settings.countSchool?sAfter:0);if(uAfter>state.settings.maxVacation)msgs.push(`Urlaubslimit überschritten: ${uAfter} statt maximal ${state.settings.maxVacation}.`);if(total>state.settings.maxAbsence)msgs.push(`Gesamt-Abwesenheitswarnung: ${total} statt maximal ${state.settings.maxAbsence}.`);w.textContent=msgs.join(' ');w.classList.toggle('hidden',!msgs.length)}

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
function openBulkDialog(){
  const employees=[...state.employees].sort((a,b)=>a.order-b.order);
  document.getElementById('bulkEmployee').innerHTML=employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  const today=new Date(),start=new Date(viewDate.getFullYear(),viewDate.getMonth(),Math.min(today.getMonth()===viewDate.getMonth()&&today.getFullYear()===viewDate.getFullYear()?today.getDate():1,new Date(viewDate.getFullYear(),viewDate.getMonth()+1,0).getDate()));
  document.getElementById('bulkStart').value=dateKey(start);document.getElementById('bulkEnd').value=dateKey(start);
  document.getElementById('bulkPriority').value='0';document.getElementById('bulkMode').value='merge';document.getElementById('bulkNote').value='';
  document.getElementById('bulkOnlyWorkdays').checked=false;document.getElementById('bulkSkipWeekends').checked=false;
  bulkSelectedCodes=new Set();document.querySelectorAll('[data-bulk-code]').forEach(b=>b.classList.remove('selected'));
  updateBulkPreview();document.getElementById('bulkDialog').showModal();
}
function applyBulk(clear=false){
  const empId=document.getElementById('bulkEmployee').value,dates=bulkDates(),mode=document.getElementById('bulkMode').value;
  if(!empId||!dates.length){alert('Bitte einen gültigen Zeitraum auswählen.');return false}
  if(!clear&&!bulkSelectedCodes.size){alert('Bitte mindestens ein Kürzel auswählen.');return false}
  if(!state.entries[empId]) state.entries[empId]={};
  const priority=Number(document.getElementById('bulkPriority').value),note=document.getElementById('bulkNote').value.trim();
  let overwritten=0;
  dates.forEach(d=>{
    const key=dateKey(d),old=entryFor(empId,key);
    if(clear){if(state.entries[empId][key]){delete state.entries[empId][key];overwritten++}return}
    if(mode==='replace'){
      if((old.codes||[]).length||old.note||old.priority) overwritten++;
      state.entries[empId][key]={codes:[...bulkSelectedCodes],priority,note};
    } else {
      const codes=[...new Set([...(old.codes||[]),...bulkSelectedCodes])];
      state.entries[empId][key]={codes,priority:Math.max(Number(old.priority||0),priority),note:note||old.note||''};
    }
  });
  persist();render();document.getElementById('bulkDialog').close();
  showToast(clear?`${overwritten} Einträge aus Zeitraum gelöscht`:`${dates.length} Tage eingetragen`);
  return true;
}

function openSettings(){const s=state.settings;document.getElementById('settingBaseVacation').value=s.baseVacation;document.getElementById('settingMaxVacation').value=s.maxVacation;document.getElementById('settingMaxAbsence').value=s.maxAbsence;document.getElementById('settingCountSchool').checked=s.countSchool;document.getElementById('settingConfirmConflicts').checked=s.confirmConflicts;document.getElementById('settingsDialog').showModal()}

async function initRemote(){
  const cfg=window.TEAMPLAN_CONFIG||{}; if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase){setSync('local','● Lokal');return}
  try{
    supabaseClient=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey); const {data,error}=await supabaseClient.from('team_plans').select('data,updated_at').eq('team_id',cfg.teamId).maybeSingle(); if(error)throw error;
    if(data?.data){isApplyingRemote=true;state=normalizeState(data.data);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;render()} else await pushRemote();
    supabaseClient.channel('teamplan-live').on('postgres_changes',{event:'*',schema:'public',table:'team_plans',filter:`team_id=eq.${cfg.teamId}`},payload=>{const remote=payload.new?.data;if(remote&&remote.updatedAt!==state.updatedAt){isApplyingRemote=true;state=normalizeState(remote);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;render();showToast('Plan wurde aktualisiert')}}).subscribe(); setSync('live','● Live synchron');
  }catch(err){console.error(err);setSync('error','● Sync-Fehler');showToast('Supabase nicht erreichbar, lokaler Modus aktiv')}
}
async function pushRemote(){if(!supabaseClient)return;const cfg=window.TEAMPLAN_CONFIG;try{const {error}=await supabaseClient.from('team_plans').upsert({team_id:cfg.teamId,data:state,updated_at:new Date().toISOString()},{onConflict:'team_id'});if(error)throw error;setSync('live','● Live synchron')}catch(e){console.error(e);setSync('error','● Sync-Fehler')}}
function setSync(cls,text){const p=document.getElementById('syncPill');p.className='sync-pill '+cls;p.textContent=text}

// top controls
document.getElementById('prevMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-(currentView==='quarter'?3:1));render()});
document.getElementById('nextMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+(currentView==='quarter'?3:1));render()});
document.getElementById('todayBtn').addEventListener('click',()=>{viewDate=new Date();viewDate.setDate(1);render()});
document.getElementById('monthViewBtn').addEventListener('click',()=>{currentView='month';clearDragSelection();render()});
document.getElementById('quarterViewBtn').addEventListener('click',()=>{currentView='quarter';viewDate.setMonth(Math.floor(viewDate.getMonth()/3)*3);clearDragSelection();render()});
document.getElementById('yearViewBtn').addEventListener('click',()=>{currentView='year';clearDragSelection();render()});
document.getElementById('vacationFullBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='full';persist();render();showToast('Urlaubsanzeige: Gesamtplanung')});
document.getElementById('vacationActualBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='actual';persist();render();showToast('Urlaubsanzeige: anteilig fürs Firmenprogramm')});
document.getElementById('searchInput').addEventListener('input',render);document.getElementById('addEmployeeBtn').addEventListener('click',()=>openEmployee());document.getElementById('bulkEntryBtn').addEventListener('click',openBulkDialog);document.getElementById('settingsBtn').addEventListener('click',openSettings);document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('[data-bulk-code]').forEach(b=>b.addEventListener('click',()=>{bulkSelectedCodes.has(b.dataset.bulkCode)?bulkSelectedCodes.delete(b.dataset.bulkCode):bulkSelectedCodes.add(b.dataset.bulkCode);b.classList.toggle('selected');updateBulkPreview()}));
['bulkEmployee','bulkStart','bulkEnd','bulkOnlyWorkdays','bulkSkipWeekends','bulkMode','bulkPriority'].forEach(id=>document.getElementById(id).addEventListener('change',updateBulkPreview));
document.getElementById('bulkForm').addEventListener('submit',e=>{e.preventDefault();applyBulk(false)});
document.getElementById('bulkClearBtn').addEventListener('click',()=>{const dates=bulkDates();if(!dates.length)return;if(confirm(`Alle Einträge dieses Mitarbeiters an ${dates.length} betroffenen Tagen löschen?`))applyBulk(true)});

document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));

document.getElementById('employeeWorkdays').addEventListener('input',updateVacationPreview);document.getElementById('employeeCarry').addEventListener('input',updateVacationPreview);document.getElementById('employeeAdjustment').addEventListener('input',updateVacationPreview);
document.getElementById('employeeForm').addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const obj={id,name:document.getElementById('employeeName').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);persist();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn').addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm').addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!state.entries[empId])state.entries[empId]={};const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim()};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;if(candidate.codes.length||candidate.priority||candidate.note)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn').addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(state.entries[emp])delete state.entries[emp][key];persist();render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

document.getElementById('settingsForm').addEventListener('submit',e=>{e.preventDefault();state.settings.baseVacation=Number(document.getElementById('settingBaseVacation').value);state.settings.maxVacation=Number(document.getElementById('settingMaxVacation').value);state.settings.maxAbsence=Number(document.getElementById('settingMaxAbsence').value);state.settings.countSchool=document.getElementById('settingCountSchool').checked;state.settings.confirmConflicts=document.getElementById('settingConfirmConflicts').checked;persist();render();document.getElementById('settingsDialog').close();showToast('Planungsregeln gespeichert')});

document.getElementById('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`teamplan-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)});
document.getElementById('importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const incoming=normalizeState(JSON.parse(await f.text()));if(!confirm('Aktuelle Planung durch diese Sicherung ersetzen?'))return;state=incoming;persist();render();showToast('Sicherung importiert')}catch{alert('Die Datei konnte nicht gelesen werden.')}});

document.querySelectorAll('[data-drag-code]').forEach(b=>b.addEventListener('click',()=>applyDragCode(b.dataset.dragCode)));
document.getElementById('dragDeleteBtn').addEventListener('click',deleteDragEntries);
document.getElementById('dragCancelBtn').addEventListener('click',clearDragSelection);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dragSelectedKeys.size)clearDragSelection()});

render();initRemote();
