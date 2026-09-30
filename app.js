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
  settings: {baseVacation:30,maxVacation:4,maxAbsence:7,countSchool:true,confirmConflicts:true,state:'NW',vacationDisplayMode:'actual',theme:'light',zoom:1},
  employees: [
    {id:uid(),name:'Anna Beispiel',hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',order:0},
    {id:uid(),name:'Ben Beispiel',hours:30,percent:78,workdays:4,workweek:[1,2,3,4],carry:2,adjustment:0,role:'employee',order:1},
    {id:uid(),name:'Clara Beispiel',hours:19.25,percent:50,workdays:3,workweek:[1,3,5],carry:0,adjustment:0,role:'employee',order:2}
  ],
  entries: {},
  blackouts: [],
  audit: [],
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
let undoStack = [];
let sessionRole = localStorage.getItem('teamplan-session-role') || 'admin';
let sessionEmployeeId = localStorage.getItem('teamplan-session-employee') || '';

function loadLocal(){
  try { const raw=localStorage.getItem('helios-teamplan-v1'); return raw ? normalizeState(JSON.parse(raw)) : structuredClone(defaultState); }
  catch { return structuredClone(defaultState); }
}
function normalizeState(s){
  s.settings={...defaultState.settings,...(s.settings||{})}; s.employees=s.employees||[]; s.entries=s.entries||{}; s.blackouts=s.blackouts||[]; s.audit=s.audit||[];
  s.employees.forEach((e,i)=>{e.order=e.order??i;e.workweek=e.workweek||[1,2,3,4,5];e.carry=Number(e.carry||0);e.adjustment=Number(e.adjustment||0);e.role=e.role||'employee'});
  Object.values(s.entries).forEach(empEntries=>Object.values(empEntries||{}).forEach(v=>{v.status=v.status||'wish'}));
  return s;
}
function persist(){
  state.updatedAt=new Date().toISOString(); localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));
  if(!isApplyingRemote && supabaseClient){clearTimeout(syncTimer);syncTimer=setTimeout(pushRemote,350)}
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function actorName(){
  if(sessionRole==='employee') return state.employees.find(e=>e.id===sessionEmployeeId)?.name || 'Mitarbeiter';
  return sessionRole==='admin'?'Admin':sessionRole==='planner'?'Planer':'Nur Lesen';
}
function canPlan(empId){return sessionRole==='admin'||sessionRole==='planner'||(sessionRole==='employee'&&empId===sessionEmployeeId)}
function canApprove(){return sessionRole==='admin'||sessionRole==='planner'}
function canManage(){return sessionRole==='admin'||sessionRole==='planner'}
function canEditEmployees(){return sessionRole==='admin'||sessionRole==='planner'}
function trackAction(label,detail=''){
  undoStack.push(structuredClone(state)); if(undoStack.length>20)undoStack.shift();
  state.audit.unshift({id:uid(),time:new Date().toISOString(),label,detail,actor:actorName()});
  state.audit=state.audit.slice(0,200);
}
function undoLastAction(){
  const prev=undoStack.pop();if(!prev){showToast('Nichts zum Rückgängig machen');return}
  state=normalizeState(prev);state.audit.unshift({id:uid(),time:new Date().toISOString(),label:'Rückgängig',detail:'Letzte lokale Aktion zurückgesetzt',actor:actorName()});
  persist();render();renderHistory();showToast('Letzte Aktion rückgängig gemacht');
}
function entryIsActive(v){return (v?.status||'wish')!=='rejected'}
function blackoutForKey(key){return (state.blackouts||[]).find(b=>key>=b.start&&key<=b.end)||null}
function blackoutBlocks(key){const b=blackoutForKey(key);return b?.mode==='block'?b:null}
function actualVacationEntitlement(e){return roundHalf(state.settings.baseVacation*(Number(e.workdays)||5)/5 + Number(e.carry||0) + Number(e.adjustment||0));}
function fullVacationEntitlement(e){return roundHalf(state.settings.baseVacation + Number(e.carry||0) + Number(e.adjustment||0));}
function vacationEntitlement(e){return state.settings.vacationDisplayMode==='full' ? fullVacationEntitlement(e) : actualVacationEntitlement(e);}
function entryFor(empId,key){return state.entries?.[empId]?.[key] || {codes:[],priority:0,note:'',status:'wish'};}
function isWorkday(e,d){return (e.workweek||[]).includes(d.getDay());}
function usedVacationActual(e,year=viewDate.getFullYear()){let n=0;Object.entries(state.entries[e.id]||{}).forEach(([k,v])=>{if(k.startsWith(year+'-')&&v.codes?.includes('U')){const d=new Date(k+'T12:00:00');if(isWorkday(e,d)) n++;}});return n;}
function usedVacationFull(e,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&entryIsActive(v)&&v.codes?.includes('U')).length;}
function usedVacation(e,year=viewDate.getFullYear()){return state.settings.vacationDisplayMode==='full' ? usedVacationFull(e,year) : usedVacationActual(e,year);}
function countCode(e,code,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&entryIsActive(v)&&v.codes?.includes(code)).length;}
function remainingVacation(e,year=viewDate.getFullYear()){return vacationEntitlement(e)-usedVacation(e,year);}
function absentCount(key){return state.employees.filter(e=>{const v=entryFor(e.id,key),c=v.codes||[];return entryIsActive(v)&&c.some(code=>['U','X','XU','S'].includes(code));}).length;}
function presentCount(key){return Math.max(0,state.employees.length-absentCount(key));}
function absentEmployees(key){
  return [...state.employees].sort((a,b)=>a.order-b.order).filter(e=>{
    const v=entryFor(e.id,key),c=v.codes||[];
    return entryIsActive(v)&&c.some(code=>['U','X','XU','S'].includes(code));
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
function flowingMonthDates(){
  const year=viewDate.getFullYear(),start=new Date(year,0,1),end=new Date(year,11,31),out=[];
  for(let d=new Date(start);d<=end;d=addDays(d,1))out.push(new Date(d));
  return out;
}
function quarterDates(){
  const y=viewDate.getFullYear(),qStart=Math.floor(viewDate.getMonth()/3)*3,out=[];
  for(let m=qStart;m<qStart+3;m++){const last=new Date(y,m+1,0).getDate();for(let i=1;i<=last;i++)out.push(new Date(y,m,i));}
  return out;
}
function activePlannerDates(){return currentView==='quarter'?quarterDates():currentView==='month'?flowingMonthDates():monthDates();}
function dailyCounts(key){let U=0,XU=0,S=0;state.employees.forEach(e=>{const v=entryFor(e.id,key);if(!entryIsActive(v))return;const c=v.codes||[];if(c.includes('U'))U++;if(c.includes('XU'))XU++;if(c.includes('S'))S++});return {U,XU,S,total:U+XU+(state.settings.countSchool?S:0)};}
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
  let html='<table class="plan-table"><thead><tr class="month-band-row"><th class="employee-col month-band-label">Jahresverlauf</th>';
  if(currentView==='month'){
    for(let m=0;m<12;m++){const days=new Date(viewDate.getFullYear(),m+1,0).getDate();html+='<th class="month-band" colspan="'+days+'" data-month="'+m+'">'+MONTHS[m]+'</th>';}
    html+='</tr><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  } else {
    html+='</tr><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  }
  dates.forEach(d=>{const key=dateKey(d),we=[0,6].includes(d.getDay()),hol=holidays[key],school=schoolBreakForDate(d),monthBoundary=d.getDate()===1,monthTone=d.getMonth()%2===0?'month-even':'month-odd';html+=`<th class="date-head ${we?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${monthTone} ${monthBoundary&&(currentView==='quarter'||currentView==='month')?'month-boundary':''}" title="${escapeHtml([hol,school&&('NRW '+school)].filter(Boolean).join(' · '))}">${(currentView==='quarter'||currentView==='month')&&monthBoundary?`<span class="month-mini">${MONTHS[d.getMonth()].slice(0,3)}</span>`:''}${DOW[d.getDay()]}<strong>${d.getDate()}</strong>${hol?`<span class="holiday-label">${escapeHtml(hol)}</span>`:school?`<span class="school-label">${escapeHtml(school.replace('ferien',''))}</span>`:''}</th>`});
  html+='</tr></thead><tbody>';
  employees.forEach(e=>{
    const used=usedVacation(e),total=vacationEntitlement(e),remain=remainingVacation(e),xu=countCode(e,'XU'); const status=remain<0?'status-bad':remain<=3?'status-low':'status-good';
    html+=`<tr class="employee-row" draggable="true" data-id="${e.id}"><td class="employee-col employee-cell"><div class="employee-card"><span class="drag-handle">⠿</span><div class="employee-edit" data-id="${e.id}"><div class="employee-name">${escapeHtml(e.name)}</div><div class="employee-meta">${e.hours} h · ${e.percent}% · ${e.workdays} Tage/Woche · XU ${xu}</div></div><div class="employee-stats ${status}"><strong>${used}/${total}</strong><small>${remain} übrig</small></div></div></td>`;
    dates.forEach(d=>{const key=dateKey(d),v=entryFor(e.id,key),we=[0,6].includes(d.getDay()),nonwork=!isWorkday(e,d),conf=conflictLevel(key),school=schoolBreakForDate(d),monthTone=d.getMonth()%2===0?'month-even':'month-odd',blackout=blackoutForKey(key),status=v.status||'wish';const codes=(v.codes||[]).map(c=>`<span class="cell-code ${CODE_CLASS[c]}">${c}</span>`).join('');const warn=(conf.vacation&&entryIsActive(v)&&v.codes?.includes('U'))||(conf.total&&entryIsActive(v)&&v.codes?.some(c=>['U','XU','S'].includes(c)));html+=`<td class="day-cell ${we?'weekend':''} ${nonwork?'nonwork':''} ${school?'school-holiday-cell':''} ${monthTone} status-${status} ${blackout?'blackout-cell':''}" data-emp="${e.id}" data-date="${key}" title="${escapeHtml([v.note,blackout&&('Sperrzeit: '+blackout.name),school&&('NRW '+school),status&&('Status: '+status)].filter(Boolean).join(' · '))}"><div class="cell-codes">${codes}</div>${(v.codes||[]).length?`<span class="status-mark status-${status}"></span>`:''}${v.priority?`<span class="cell-priority p${v.priority}"></span>`:''}${v.note?'<span class="cell-note"></span>':''}${warn?'<span class="cell-warning-mark">!</span>':''}</td>`});
    html+='</tr>';
  });
  html+=summaryRow('Urlaub U','U',dates);html+=summaryRow('Wunschfrei XU','XU',dates);html+=summaryRow('Schule S','S',dates);html+=presenceRow(dates);html+=absenceNamesRow(dates);html+='</tbody></table>';
  document.getElementById('planner').innerHTML=html; bindPlannerEvents(); renderMetrics(); syncViewControls(); applyAppearance();
  if(currentView==='month') setupFlowingMonthScroll();
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

function applyAppearance(){
  const theme=state.settings.theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.body.classList.toggle('dark-mode',theme==='dark');
  const z=Math.max(.70,Math.min(1.40,Number(state.settings.zoom||1)));
  const dayWidth=Math.round(52*z),dayHeight=Math.round(62*z),employeeWidth=Math.round(265*Math.max(.82,z));
  document.documentElement.style.setProperty('--day-width',dayWidth+'px');
  document.documentElement.style.setProperty('--day-height',dayHeight+'px');
  document.documentElement.style.setProperty('--employee-width',employeeWidth+'px');
  const label=document.getElementById('zoomLabel');if(label)label.textContent=Math.round(z*100)+'%';
  const range=document.getElementById('zoomRange');if(range)range.value=String(Math.round(z*100));
  const themeLabel=document.getElementById('themeLabel');if(themeLabel)themeLabel.textContent=theme==='dark'?'Dunkel':'Hell';
}
function setZoom(value){
  state.settings.zoom=Math.max(.70,Math.min(1.40,Number(value)));
  persist();applyAppearance();
}
function changeZoom(delta){setZoom(Math.round((Number(state.settings.zoom||1)+delta)*20)/20);}
function toggleTheme(){
  state.settings.theme=state.settings.theme==='dark'?'light':'dark';
  persist();applyAppearance();
}
function setupFlowingMonthScroll(){
  const planner=document.getElementById('planner');if(!planner)return;
  requestAnimationFrame(()=>{
    const currentKey=viewDate.getFullYear()+'-'+String(viewDate.getMonth()+1).padStart(2,'0')+'-01';
    const current=document.querySelector('.day-cell[data-date="'+currentKey+'"]');
    if(current)planner.scrollLeft=Math.max(0,current.offsetLeft-planner.clientWidth*.28);
    document.querySelectorAll('.month-band').forEach(b=>b.classList.toggle('active',Number(b.dataset.month)===viewDate.getMonth()));
    let ticking=false;
    planner.onscroll=()=>{
      if(ticking)return;ticking=true;
      requestAnimationFrame(()=>{
        ticking=false;
        const center=planner.scrollLeft+planner.clientWidth*.55,headers=[...document.querySelectorAll('.date-head')];
        let nearest=null,best=Infinity;
        headers.forEach((h,idx)=>{const x=h.offsetLeft+h.offsetWidth/2,dist=Math.abs(x-center);if(dist<best){best=dist;nearest={idx}}});
        if(nearest){const d=flowingMonthDates()[nearest.idx];if(d){document.getElementById('monthLabel').textContent=MONTHS[d.getMonth()];document.getElementById('yearLabel').textContent=d.getFullYear();document.querySelectorAll('.month-band').forEach(b=>b.classList.toggle('active',Number(b.dataset.month)===d.getMonth()));}}
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
  clean.forEach(name=>{const k=name.toLocaleLowerCase('de-DE');if(existing.has(k))return;state.employees.push({id:uid(),name,hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',order:state.employees.length});existing.add(k);added++;});
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
  if(!dragEmployeeId||!dragSelectedKeys.size||!canPlan(dragEmployeeId)){showToast('Keine Bearbeitungsrechte');return}
  const blocked=[...dragSelectedKeys].filter(key=>['U','XU'].includes(code)&&blackoutBlocks(key));
  if(blocked.length){alert('Dieser Zeitraum enthält eine Urlaubssperre: '+blackoutBlocks(blocked[0]).name);return}
  trackAction('Mehrtageseintrag',code+' · '+dragSelectedKeys.size+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  dragSelectedKeys.forEach(key=>{
    const old=entryFor(dragEmployeeId,key),codes=[...new Set([...(old.codes||[]),code])];
    state.entries[dragEmployeeId][key]={codes,priority:old.priority||0,note:old.note||'',status:sessionRole==='employee'?'wish':(old.status||'wish')};
  });
  const count=dragSelectedKeys.size;persist();clearDragSelection();render();showToast(`${code} für ${count} Tage eingetragen`);
}
function deleteDragEntries(){
  if(!dragEmployeeId||!dragSelectedKeys.size||!canPlan(dragEmployeeId)){showToast('Keine Bearbeitungsrechte');return}
  if(!state.entries[dragEmployeeId])return clearDragSelection();
  trackAction('Einträge gelöscht',dragSelectedKeys.size+' Tage');
  const count=dragSelectedKeys.size;dragSelectedKeys.forEach(key=>delete state.entries[dragEmployeeId][key]);
  persist();clearDragSelection();render();showToast(`${count} Tage gelöscht`);
}
function bindPlannerEvents(){
  document.querySelectorAll('.day-cell').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      if(!canPlan(el.dataset.emp)){showToast('Nur-Lese-Modus oder keine Rechte für diesen Mitarbeiter');return}
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
function reorder(sourceId,targetId){if(!canEditEmployees()){showToast('Keine Rechte für Stammdaten');return}trackAction('Reihenfolge geändert');const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function openEmployee(id=null){
  if(!canEditEmployees()){showToast('Keine Rechte für Mitarbeiter-Stammdaten');return}
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('employeeRole').value=e?.role||'employee';document.getElementById('employeeRole').disabled=sessionRole!=='admin';document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e||sessionRole!=='admin');renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const wd=Number(document.getElementById('employeeWorkdays').value||5),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,actual=roundHalf(base*wd/5+carry+adj),full=roundHalf(base+carry+adj);document.getElementById('vacationPreview').innerHTML=`<strong>Gesamtplanung: ${full} Tage</strong> · <strong>Anteilig fürs Firmenprogramm: ${actual} Tage</strong><br><span style="color:var(--muted)">Anteilig = ${base} × ${wd}/5 + ${carry} Übertrag ${adj>=0?'+':''}${adj} Korrektur. Der Stellenanteil in % allein reduziert die Urlaubstage nicht.</span>`}

function openCell(empId,key){if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte für diesen Mitarbeiter');return}const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellStatus').value=v.status||'wish';document.getElementById('cellStatus').disabled=!canApprove();document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
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
function openBulkDialog(){
  const employees=[...state.employees].sort((a,b)=>a.order-b.order).filter(e=>sessionRole!=='employee'||e.id===sessionEmployeeId);
  if(!employees.length){showToast('Kein Mitarbeiter für diesen Modus ausgewählt');return}
  document.getElementById('bulkEmployee').innerHTML=employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  const today=new Date(),start=new Date(viewDate.getFullYear(),viewDate.getMonth(),Math.min(today.getMonth()===viewDate.getMonth()&&today.getFullYear()===viewDate.getFullYear()?today.getDate():1,new Date(viewDate.getFullYear(),viewDate.getMonth()+1,0).getDate()));
  document.getElementById('bulkStart').value=dateKey(start);document.getElementById('bulkEnd').value=dateKey(start);
  document.getElementById('bulkStatus').value='wish';document.getElementById('bulkStatus').disabled=!canApprove();document.getElementById('bulkPriority').value='0';document.getElementById('bulkMode').value='merge';document.getElementById('bulkNote').value='';
  document.getElementById('bulkOnlyWorkdays').checked=false;document.getElementById('bulkSkipWeekends').checked=false;
  bulkSelectedCodes=new Set();document.querySelectorAll('[data-bulk-code]').forEach(b=>b.classList.remove('selected'));
  updateBulkPreview();document.getElementById('bulkDialog').showModal();
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
  const priority=Number(document.getElementById('bulkPriority').value),note=document.getElementById('bulkNote').value.trim(),status=canApprove()?document.getElementById('bulkStatus').value:'wish';
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
  persist();render();document.getElementById('bulkDialog').close();
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
    if(!emp&&create){emp={id:uid(),name:row.name.trim(),hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',order:state.employees.length};state.employees.push(emp);map.set(key,emp);created++}
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
function renderRoleControls(){
  const role=document.getElementById('roleSelect'),emp=document.getElementById('roleEmployeeSelect');
  role.value=sessionRole;
  emp.innerHTML=[...state.employees].sort((a,b)=>a.order-b.order).map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  if(!sessionEmployeeId&&state.employees.length)sessionEmployeeId=state.employees[0].id;
  emp.value=sessionEmployeeId;
  emp.classList.toggle('hidden',sessionRole!=='employee');
  ['blackoutsBtn','settingsBtn','addEmployeeBtn','importNamesBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!canManage()});
  document.getElementById('bulkEntryBtn').disabled=sessionRole==='viewer';
}
function renderBlackouts(){
  const list=document.getElementById('blackoutsList');
  const items=[...(state.blackouts||[])].sort((a,b)=>a.start.localeCompare(b.start));
  list.innerHTML=items.length?items.map(b=>`<div class="management-item"><div><strong>${escapeHtml(b.name)}</strong><span>${b.start} – ${b.end} · ${b.mode==='block'?'blockiert':'Warnung'}</span></div><button type="button" class="btn danger blackout-delete" data-id="${b.id}">Löschen</button></div>`).join(''):'<div class="empty-state">Keine Sperrzeiten angelegt.</div>';
  list.querySelectorAll('.blackout-delete').forEach(btn=>btn.addEventListener('click',()=>{if(!canManage())return;trackAction('Sperrzeit gelöscht');state.blackouts=state.blackouts.filter(x=>x.id!==btn.dataset.id);persist();renderBlackouts();render()}));
}
function renderHistory(){
  const list=document.getElementById('historyList');
  const items=state.audit||[];
  list.innerHTML=items.length?items.map(a=>`<div class="management-item history-item"><div><strong>${escapeHtml(a.label)}</strong><span>${escapeHtml(a.detail||'')} · ${escapeHtml(a.actor||'')} · ${new Date(a.time).toLocaleString('de-DE')}</span></div></div>`).join(''):'<div class="empty-state">Noch keine protokollierten Änderungen.</div>';
  document.getElementById('undoBtn').disabled=!undoStack.length;
}
function conflictItems(year=viewDate.getFullYear()){
  const out=[];
  for(let d=new Date(year,0,1);d<=new Date(year,11,31);d=addDays(d,1)){
    const key=dateKey(d),c=dailyCounts(key),b=blackoutForKey(key),conf=conflictLevel(key);
    if(conf.vacation||conf.total)out.push({key,type:'Besetzung',text:`${c.U} Urlaub · ${c.total} relevante Abwesenheiten`});
    if(b){
      const names=state.employees.filter(e=>{const v=entryFor(e.id,key);return entryIsActive(v)&&v.codes?.some(x=>['U','XU'].includes(x))}).map(e=>e.name);
      if(names.length)out.push({key,type:'Sperrzeit',text:`${b.name}: ${names.join(', ')}`});
    }
    state.employees.forEach(e=>{const v=entryFor(e.id,key);if((v.status||'wish')==='wish'&&v.codes?.some(x=>['U','XU'].includes(x)))out.push({key,type:'Offener Wunsch',text:e.name+' · '+v.codes.join('+')})});
  }
  return out;
}
function renderConflicts(){
  const items=conflictItems(),summary=document.getElementById('conflictsSummary'),list=document.getElementById('conflictsList');
  const counts=items.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{});
  summary.innerHTML=`<div><strong>${items.length}</strong><span>gesamt</span></div><div><strong>${counts['Besetzung']||0}</strong><span>Besetzung</span></div><div><strong>${counts['Sperrzeit']||0}</strong><span>Sperrzeiten</span></div><div><strong>${counts['Offener Wunsch']||0}</strong><span>offene Wünsche</span></div>`;
  list.innerHTML=items.length?items.slice(0,500).map(x=>`<button type="button" class="management-item conflict-item" data-date="${x.key}"><div><strong>${x.key} · ${escapeHtml(x.type)}</strong><span>${escapeHtml(x.text)}</span></div></button>`).join(''):'<div class="empty-state success-state">Keine Konflikte gefunden.</div>';
  list.querySelectorAll('.conflict-item').forEach(btn=>btn.addEventListener('click',()=>{const d=new Date(btn.dataset.date+'T12:00:00');viewDate=new Date(d.getFullYear(),d.getMonth(),1);currentView='month';document.getElementById('conflictsDialog').close();render()}));
}
async function exportExcel(){
  if(!window.XLSX){alert('Excel-Export ist nicht verfügbar.');return}
  const year=viewDate.getFullYear(),rows=[['Mitarbeiter','Anspruch anteilig','Geplant anteilig','Rest','XU']];
  [...state.employees].sort((a,b)=>a.order-b.order).forEach(e=>rows.push([e.name,actualVacationEntitlement(e),usedVacationActual(e,year),actualVacationEntitlement(e)-usedVacationActual(e,year),countCode(e,'XU',year)]));
  const detail=[['Datum','Mitarbeiter','Codes','Status','Priorität','Notiz']];
  state.employees.forEach(e=>Object.entries(state.entries[e.id]||{}).filter(([k])=>k.startsWith(year+'-')).forEach(([k,v])=>detail.push([k,e.name,(v.codes||[]).join('+'),v.status||'wish',v.priority||0,v.note||''])));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Urlaubskonten');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(detail),'Planung');
  const filename=`TeamPlan-${year}.xlsx`,data=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  try{
    if(window.showSaveFilePicker){
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Excel-Arbeitsmappe',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
      const writable=await handle.createWritable();await writable.write(data);await writable.close();showToast('Excel gespeichert');return;
    }
  }catch(err){if(err?.name==='AbortError')return;console.warn(err)}
  XLSX.writeFile(wb,filename);showToast('Excel erstellt');
}
function exportPdf(){showToast('Druckansicht wird geöffnet');setTimeout(()=>window.print(),80)}
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
document.getElementById('prevMonth').addEventListener('click',()=>{if(currentView==='month')viewDate.setFullYear(viewDate.getFullYear()-1);else viewDate.setMonth(viewDate.getMonth()-(currentView==='quarter'?3:1));render()});
document.getElementById('nextMonth').addEventListener('click',()=>{if(currentView==='month')viewDate.setFullYear(viewDate.getFullYear()+1);else viewDate.setMonth(viewDate.getMonth()+(currentView==='quarter'?3:1));render()});
document.getElementById('todayBtn').addEventListener('click',()=>{viewDate=new Date();viewDate.setDate(1);render()});
document.getElementById('zoomOutBtn').addEventListener('click',()=>changeZoom(-.05));
document.getElementById('zoomInBtn').addEventListener('click',()=>changeZoom(.05));
document.getElementById('zoomRange').addEventListener('input',e=>setZoom(Number(e.target.value)/100));
document.getElementById('themeBtn').addEventListener('click',toggleTheme);
document.getElementById('roleSelect').addEventListener('change',e=>{sessionRole=e.target.value;localStorage.setItem('teamplan-session-role',sessionRole);renderRoleControls();render();showToast('Modus: '+e.target.options[e.target.selectedIndex].text)});
document.getElementById('roleEmployeeSelect').addEventListener('change',e=>{sessionEmployeeId=e.target.value;localStorage.setItem('teamplan-session-employee',sessionEmployeeId);render();});
document.getElementById('monthViewBtn').addEventListener('click',()=>{currentView='month';clearDragSelection();render()});
document.getElementById('quarterViewBtn').addEventListener('click',()=>{currentView='quarter';viewDate.setMonth(Math.floor(viewDate.getMonth()/3)*3);clearDragSelection();render()});
document.getElementById('yearViewBtn').addEventListener('click',()=>{currentView='year';clearDragSelection();render()});
document.getElementById('vacationFullBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='full';persist();render();showToast('Urlaubsanzeige: Gesamtplanung')});
document.getElementById('vacationActualBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='actual';persist();render();showToast('Urlaubsanzeige: anteilig fürs Firmenprogramm')});
document.getElementById('searchInput').addEventListener('input',render);
document.getElementById('addEmployeeBtn').addEventListener('click',()=>openEmployee());
document.getElementById('bulkEntryBtn').addEventListener('click',openBulkDialog);
document.getElementById('importNamesBtn').addEventListener('click',()=>{if(!canManage())return;document.getElementById('namesPasteInput').value='';document.getElementById('namesFileInput').value='';updateNamesImportPreview([]);document.getElementById('namesImportDialog').showModal()});
document.getElementById('settingsBtn').addEventListener('click',()=>{if(canManage())openSettings()});
document.getElementById('undoBtn').addEventListener('click',undoLastAction);
document.addEventListener('click',e=>{const btn=e.target.closest('[data-tool-action]');if(btn){e.preventDefault();runToolAction(btn.dataset.toolAction)}});
document.getElementById('planImportFile').addEventListener('change',async e=>{try{renderPlanImportPreview(await readPlanImportFile(e.target.files[0]))}catch(err){console.error(err);renderPlanImportPreview({entries:[],names:[],warnings:[err.message]})}});
document.getElementById('planImportForm').addEventListener('submit',e=>{e.preventDefault();applyPlanImport()});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('[data-bulk-code]').forEach(b=>b.addEventListener('click',()=>{bulkSelectedCodes.has(b.dataset.bulkCode)?bulkSelectedCodes.delete(b.dataset.bulkCode):bulkSelectedCodes.add(b.dataset.bulkCode);b.classList.toggle('selected');updateBulkPreview()}));
['bulkEmployee','bulkStart','bulkEnd','bulkOnlyWorkdays','bulkSkipWeekends','bulkMode','bulkPriority'].forEach(id=>document.getElementById(id).addEventListener('change',updateBulkPreview));
document.getElementById('bulkForm').addEventListener('submit',e=>{e.preventDefault();applyBulk(false)});
document.getElementById('bulkClearBtn').addEventListener('click',()=>{const dates=bulkDates();if(!dates.length)return;if(confirm(`Alle Einträge dieses Mitarbeiters an ${dates.length} betroffenen Tagen löschen?`))applyBulk(true)});

document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));

document.getElementById('employeeWorkdays').addEventListener('input',updateVacationPreview);document.getElementById('employeeCarry').addEventListener('input',updateVacationPreview);document.getElementById('employeeAdjustment').addEventListener('input',updateVacationPreview);
document.getElementById('employeeForm').addEventListener('submit',e=>{e.preventDefault();if(!canEditEmployees())return;const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);trackAction(current?'Mitarbeiter geändert':'Mitarbeiter angelegt',document.getElementById('employeeName').value.trim());const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const obj={id,name:document.getElementById('employeeName').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),role:sessionRole==='admin'?document.getElementById('employeeRole').value:(current?.role||'employee'),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn').addEventListener('click',()=>{if(sessionRole!=='admin')return;const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){const name=state.employees.find(e=>e.id===id)?.name||'';trackAction('Mitarbeiter gelöscht',name);state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm').addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(empId))return;const blocked=blackoutBlocks(key);if(blocked&&[...selectedCodes].some(c=>['U','XU'].includes(c))){alert('Urlaub ist in dieser Sperrzeit blockiert: '+blocked.name);return}if(!state.entries[empId])state.entries[empId]={};const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim(),status:canApprove()?document.getElementById('cellStatus').value:'wish'};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;trackAction('Planung geändert',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+candidate.codes.join('+'));if(candidate.codes.length||candidate.priority||candidate.note)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn').addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(emp))return;if(state.entries[emp]){trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===emp)?.name||'')+' · '+key);delete state.entries[emp][key]}persist();render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

document.getElementById('settingsForm').addEventListener('submit',e=>{e.preventDefault();if(!canManage())return;trackAction('Planungsregeln geändert');state.settings.baseVacation=Number(document.getElementById('settingBaseVacation').value);state.settings.maxVacation=Number(document.getElementById('settingMaxVacation').value);state.settings.maxAbsence=Number(document.getElementById('settingMaxAbsence').value);state.settings.countSchool=document.getElementById('settingCountSchool').checked;state.settings.confirmConflicts=document.getElementById('settingConfirmConflicts').checked;persist();render();document.getElementById('settingsDialog').close();showToast('Planungsregeln gespeichert')});

document.getElementById('exportBtn').addEventListener('click',async()=>{
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
document.getElementById('importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const incoming=normalizeState(JSON.parse(await f.text()));if(!confirm('Aktuelle Planung durch diese Sicherung ersetzen?'))return;state=incoming;persist();render();showToast('Sicherung importiert')}catch{alert('Die Datei konnte nicht gelesen werden.')}});

document.getElementById('namesPasteInput').addEventListener('input',e=>updateNamesImportPreview(parseNamesText(e.target.value)));
document.getElementById('namesFileInput').addEventListener('change',async e=>{
  try{const names=await readNamesFile(e.target.files[0]);document.getElementById('namesPasteInput').value=names.join('\n');updateNamesImportPreview(names)}
  catch(err){alert('Die Namensliste konnte nicht gelesen werden: '+err.message)}
});
document.getElementById('namesImportForm').addEventListener('submit',e=>{
  e.preventDefault();
  const names=JSON.parse(document.getElementById('namesImportPreview').dataset.names||'[]');
  if(!names.length){alert('Keine Namen erkannt.');return}
  const replace=document.getElementById('replaceExistingNames').checked;
  if(replace&&!confirm('Vorhandene Mitarbeiter und deren Planeinträge wirklich ersetzen?'))return;
  trackAction('Namensliste importiert',names.length+' Namen');const added=importNames(names,replace);renderRoleControls();document.getElementById('namesImportDialog').close();showToast(added+' Mitarbeiter übernommen');
});

document.getElementById('blackoutsForm').addEventListener('submit',e=>{
  e.preventDefault();if(!canManage())return;
  const name=document.getElementById('blackoutName').value.trim(),start=document.getElementById('blackoutStart').value,end=document.getElementById('blackoutEnd').value,mode=document.getElementById('blackoutMode').value;
  if(!name||!start||!end||end<start){alert('Bitte eine gültige Sperrzeit angeben.');return}
  trackAction('Sperrzeit angelegt',name+' · '+start+' bis '+end);
  state.blackouts.push({id:uid(),name,start,end,mode});persist();renderBlackouts();render();e.target.reset();showToast('Sperrzeit gespeichert');
});
document.querySelectorAll('[data-drag-code]').forEach(b=>b.addEventListener('click',()=>applyDragCode(b.dataset.dragCode)));
document.getElementById('dragDeleteBtn').addEventListener('click',deleteDragEntries);
document.getElementById('dragCancelBtn').addEventListener('click',clearDragSelection);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dragSelectedKeys.size)clearDragSelection()});

renderRoleControls();render();initRemote();
