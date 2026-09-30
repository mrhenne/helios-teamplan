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
    {id:uid(),name:'Anna Beispiel',hours:38.5,percent:100,workdays:5,workweek:[1,2,3,4,5],carry:0,adjustment:0,role:'employee',autoWeekend:{enabled:false,intervalWeeks:2,anchorDate:''},order:0},
    {id:uid(),name:'Ben Beispiel',hours:30,percent:78,workdays:4,workweek:[1,2,3,4],carry:2,adjustment:0,role:'employee',autoWeekend:{enabled:false,intervalWeeks:2,anchorDate:''},order:1},
    {id:uid(),name:'Clara Beispiel',hours:19.25,percent:50,workdays:3,workweek:[1,3,5],carry:0,adjustment:0,role:'employee',autoWeekend:{enabled:false,intervalWeeks:2,anchorDate:''},order:2}
  ],
  entries: {},
  blackouts: [],
  audit: [],
  updatedAt: new Date().toISOString()
};

let state = loadLocal();
function loadLastViewDate(){
  try{const raw=localStorage.getItem('teamplan-last-view');if(raw){const d=new Date(raw+'-01T12:00:00');if(!isNaN(d))return new Date(d.getFullYear(),d.getMonth(),1)}}catch{}
  const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);
}
function saveLastViewDate(){localStorage.setItem('teamplan-last-view',viewDate.getFullYear()+'-'+String(viewDate.getMonth()+1).padStart(2,'0'))}
let viewDate = loadLastViewDate();
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
let authUser = null;
let authMembership = null;
let loginMode = 'login';
let plannerScrollLeft = null;
function toggleLoginMode(){
  loginMode=loginMode==='login'?'bootstrap':'login';
  const fields=document.getElementById('bootstrapFields');
  const modeBtn=document.getElementById('loginModeBtn');
  const submitBtn=document.getElementById('loginSubmitBtn');
  if(fields)fields.classList.toggle('hidden',loginMode!=='bootstrap');
  if(modeBtn)modeBtn.textContent=loginMode==='bootstrap'?'Zurück zur Anmeldung':'Ersten Admin einrichten';
  if(submitBtn)submitBtn.textContent=loginMode==='bootstrap'?'Admin-Konto erstellen':'Anmelden';
}

function loadLocal(){
  try { const raw=localStorage.getItem('helios-teamplan-v1'); return raw ? normalizeState(JSON.parse(raw)) : structuredClone(defaultState); }
  catch { return structuredClone(defaultState); }
}
function normalizeState(s){
  s.settings={...defaultState.settings,...(s.settings||{})}; s.employees=s.employees||[]; s.entries=s.entries||{}; s.blackouts=s.blackouts||[]; s.audit=s.audit||[];
  s.employees.forEach((e,i)=>{e.order=e.order??i;e.workweek=e.workweek||[1,2,3,4,5];e.carry=Number(e.carry||0);e.adjustment=Number(e.adjustment||0);e.role=e.role||'employee';e.autoWeekend=e.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''}});
  Object.values(s.entries).forEach(empEntries=>Object.values(empEntries||{}).forEach(v=>{v.status=v.status||'wish'}));
  return s;
}
function authConfigured(){const c=window.TEAMPLAN_CONFIG||{};return !!(c.supabaseUrl&&c.supabaseAnonKey&&window.supabase)}
function persist(){
  state.updatedAt=new Date().toISOString(); localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));
  if(!isApplyingRemote && supabaseClient && sessionRole!=='employee' && sessionRole!=='viewer'){clearTimeout(syncTimer);syncTimer=setTimeout(pushRemote,350)}
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
function clearAutoWeekendX(empId){
  const entries=state.entries[empId]||{};
  Object.entries(entries).forEach(([key,v])=>{
    if(!v?.autoX)return;
    const codes=(v.codes||[]).filter(c=>c!=='X');
    if(codes.length||v.note||v.priority){entries[key]={...v,codes,autoX:false}}
    else delete entries[key];
  });
}
function ensureAutoWeekendEntries(year){
  let changed=false;
  state.employees.forEach(emp=>{
    const cfg=emp.autoWeekend||{};
    if(!cfg.enabled||!cfg.anchorDate)return;
    const anchor=new Date(cfg.anchorDate+'T12:00:00');if(isNaN(anchor))return;
    const interval=Math.max(1,Number(cfg.intervalWeeks||2));
    if(!state.entries[emp.id])state.entries[emp.id]={};
    for(let d=new Date(year,0,1);d<=new Date(year,11,31);d=addDays(d,1)){
      if(d.getDay()!==6)continue;
      const weeks=Math.round((d-anchor)/(7*86400000));
      if(((weeks%interval)+interval)%interval!==0)continue;
      [d,addDays(d,1)].forEach(day=>{
        if(day.getFullYear()!==year)return;
        const key=dateKey(day),old=entryFor(emp.id,key);
        if((old.codes||[]).includes('X'))return;
        state.entries[emp.id][key]={...old,codes:[...(old.codes||[]),'X'],status:old.status||'wish',autoX:true};
        changed=true;
      });
    }
  });
  if(changed){state.updatedAt=new Date().toISOString();localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));if(supabaseClient&&canManage()){clearTimeout(syncTimer);syncTimer=setTimeout(pushRemote,350)}}
}
async function saveRemoteEntry(empId,key,entry){
  if(!supabaseClient||!authUser)return;
  if(sessionRole==='employee'){
    try{
      const {error}=await supabaseClient.rpc('set_my_plan_entry',{p_team_id:(window.TEAMPLAN_CONFIG||{}).teamId,p_date_key:key,p_entry:entry??null});
      if(error)throw error;
    }catch(err){console.error(err);showToast('Speichern fehlgeschlagen');}
  }
}
function actualVacationEntitlement(e){return roundHalf(state.settings.baseVacation*(Number(e.workdays)||5)/5 + Number(e.carry||0) + Number(e.adjustment||0));}
function fullVacationEntitlement(e){return roundHalf(state.settings.baseVacation + Number(e.carry||0) + Number(e.adjustment||0));}
function vacationEntitlement(e){return state.settings.vacationDisplayMode==='full' ? fullVacationEntitlement(e) : actualVacationEntitlement(e);}
function entryFor(empId,key){return state.entries?.[empId]?.[key] || {codes:[],priority:0,note:'',status:'wish'};}
function isWorkday(e,d){return (e.workweek||[]).includes(d.getDay());}
function usedVacationActual(e,year=viewDate.getFullYear()){let n=0;Object.entries(state.entries[e.id]||{}).forEach(([k,v])=>{if(k.startsWith(year+'-')&&entryIsActive(v)&&v.codes?.includes('U')){const d=new Date(k+'T12:00:00');if(isWorkday(e,d)) n++;}});return n;}
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
function activePlannerDates(){return currentView==='month'?flowingMonthDates():monthDates();}
function dailyCounts(key){let U=0,XU=0,S=0;state.employees.forEach(e=>{const v=entryFor(e.id,key);if(!entryIsActive(v))return;const c=v.codes||[];if(c.includes('U'))U++;if(c.includes('XU'))XU++;if(c.includes('S'))S++});return {U,XU,S,total:U+XU+(state.settings.countSchool?S:0)};}
function conflictLevel(key){const c=dailyCounts(key);return {vacation:c.U>state.settings.maxVacation,total:c.total>state.settings.maxAbsence};}

function render(){
  ensureAutoWeekendEntries(viewDate.getFullYear());
  const dates=activePlannerDates(), holidays=holidaysNRW(viewDate.getFullYear());
  document.getElementById('monthLabel').textContent=MONTHS[viewDate.getMonth()];
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
  dates.forEach(d=>{const key=dateKey(d),we=[0,6].includes(d.getDay()),hol=holidays[key],school=schoolBreakForDate(d),monthBoundary=d.getDate()===1,monthTone=d.getMonth()%2===0?'month-even':'month-odd';html+=`<th class="date-head ${we?'weekend':''} ${hol?'holiday':''} ${school?'school-holiday':''} ${monthTone} ${monthBoundary&&currentView==='month'?'month-boundary':''}" title="${escapeHtml([hol,school&&('NRW '+school)].filter(Boolean).join(' · '))}">${currentView==='month'&&monthBoundary?`<span class="month-mini">${MONTHS[d.getMonth()].slice(0,3)}</span>`:''}${DOW[d.getDay()]}<strong>${d.getDate()}</strong>${hol?`<span class="holiday-label">${escapeHtml(hol)}</span>`:school?`<span class="school-label">${escapeHtml(school.replace('ferien',''))}</span>`:''}</th>`});
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
  document.getElementById('yearViewBtn').classList.toggle('active',currentView==='year');
  const full=state.settings.vacationDisplayMode==='full';
  document.getElementById('vacationFullBtn').classList.toggle('active',full);
  document.getElementById('vacationActualBtn').classList.toggle('active',!full);
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
  const m=document.getElementById('focusPeriodMonth'),y=document.getElementById('focusPeriodYear');
  if(m)m.textContent=MONTHS[viewDate.getMonth()];
  if(y)y.textContent=String(viewDate.getFullYear());
}
function enterPlannerFocus(){
  if(currentView!=='month'){currentView='month';plannerScrollLeft=null;render()}
  document.body.classList.add('planner-focus');
  updateFocusPeriod();
}
function exitPlannerFocus(){
  document.body.classList.remove('planner-focus');
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
    state.entries[dragEmployeeId][key]={codes,priority:old.priority||0,note:old.note||'',status:sessionRole==='employee'?'wish':(old.status||'wish')};
  });
  const changed=[...dragSelectedKeys];const count=changed.length;persist();changed.forEach(key=>saveRemoteEntry(dragEmployeeId,key,state.entries[dragEmployeeId][key]));clearDragSelection();render();showToast(`${code} für ${count} Tage eingetragen`);
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
function bindPlannerEvents(){
  document.querySelectorAll('.day-cell').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
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
  let dragged=null; document.querySelectorAll('.employee-row').forEach(row=>{row.addEventListener('dragstart',()=>{dragged=row.dataset.id;row.style.opacity=.45});row.addEventListener('dragend',()=>{row.style.opacity='';document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drop-target')});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.id;if(dragged&&dragged!==target){reorder(dragged,target)}})});
}
function reorder(sourceId,targetId){if(!canEditEmployees()){showToast('Keine Rechte für Stammdaten');return}trackAction('Reihenfolge geändert');const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function openEmployee(id=null){
  if(!canEditEmployees()){showToast('Keine Rechte für Mitarbeiter-Stammdaten');return}
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('employeeRole').value=e?.role||'employee';document.getElementById('employeeRole').disabled=sessionRole!=='admin';document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e||sessionRole!=='admin');document.getElementById('employeeRangeBtn').classList.toggle('hidden',!e||!canPlan(e.id));const aw=e?.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''};document.getElementById('employeeAutoWeekend').checked=!!aw.enabled;document.getElementById('employeeWeekendInterval').value=String(aw.intervalWeeks||2);document.getElementById('employeeWeekendAnchor').value=aw.anchorDate||'';document.getElementById('autoWeekendOptions').classList.toggle('disabled-block',!aw.enabled);renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const wd=Number(document.getElementById('employeeWorkdays').value||5),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,actual=roundHalf(base*wd/5+carry+adj),full=roundHalf(base+carry+adj);document.getElementById('vacationPreview').innerHTML=`<strong>Gesamtplanung: ${full} Tage</strong> · <strong>Anteilig fürs Firmenprogramm: ${actual} Tage</strong><br><span style="color:var(--muted)">Anteilig = ${base} × ${wd}/5 + ${carry} Übertrag ${adj>=0?'+':''}${adj} Korrektur. Der Stellenanteil in % allein reduziert die Urlaubstage nicht.</span>`}

function openCell(empId,key){if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte für diesen Mitarbeiter');return}const clickedDate=new Date(key+'T12:00:00');viewDate=new Date(clickedDate.getFullYear(),clickedDate.getMonth(),1);saveLastViewDate();const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellStatus').value=v.status||'wish';document.getElementById('cellStatus').disabled=!canApprove();document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
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
function renderRoleControls(){
  const role=document.getElementById('roleSelect'),emp=document.getElementById('roleEmployeeSelect'),authMode=!!authUser;
  role.value=sessionRole;
  emp.innerHTML=[...state.employees].sort((a,b)=>a.order-b.order).map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  if(!sessionEmployeeId&&state.employees.length)sessionEmployeeId=state.employees[0].id;
  emp.value=sessionEmployeeId;
  role.classList.toggle('hidden',authMode);
  emp.classList.toggle('hidden',authMode||sessionRole!=='employee');
  const pill=document.getElementById('authUserPill'),logout=document.getElementById('logoutBtn');
  pill.classList.toggle('hidden',!authMode);logout.classList.toggle('hidden',!authMode);
  if(authMode)pill.textContent=(authUser.email||'Angemeldet')+' · '+sessionRole;
  ['blackoutsBtn','addEmployeeBtn','importNamesBtn','planImportBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!canManage()});
  document.getElementById('settingsBtn').disabled=false;
  document.getElementById('usersBtn').classList.toggle('hidden',sessionRole!=='admin'||!authUser);
}

async function invokeUserAdmin(body){
  if(!supabaseClient||sessionRole!=='admin')throw new Error('Nur Admins dürfen Benutzer verwalten.');
  const {data,error}=await supabaseClient.functions.invoke('teamplan-users',{body:{teamId:(window.TEAMPLAN_CONFIG||{}).teamId,...body}});
  if(error)throw error;if(data?.error)throw new Error(data.error);return data;
}
function employeeOptions(selected=''){
  return '<option value="">Keine Verknüpfung</option>'+[...state.employees].sort((a,b)=>a.order-b.order).map(e=>`<option value="${e.id}" ${e.id===selected?'selected':''}>${escapeHtml(e.name)}</option>`).join('');
}
async function openUsersDialog(){
  if(sessionRole!=='admin'){showToast('Nur Admins dürfen Benutzer verwalten');return}
  document.getElementById('inviteEmployee').innerHTML=employeeOptions('');
  safeShowDialog('usersDialog');await renderUsersList();
}
async function renderUsersList(){
  const list=document.getElementById('usersList');list.innerHTML='<div class="empty-state">Benutzer werden geladen…</div>';
  try{
    const data=await invokeUserAdmin({action:'list'}),members=data.members||[];
    list.innerHTML=members.length?members.map(m=>`
      <div class="user-row" data-user="${m.user_id}">
        <div class="user-main"><strong>${escapeHtml(m.display_name||m.email||'Benutzer')}</strong><span>${escapeHtml(m.email||'')}</span></div>
        <select class="user-role">
          <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
          <option value="planner" ${m.role==='planner'?'selected':''}>Planer</option>
          <option value="employee" ${m.role==='employee'?'selected':''}>Mitarbeiter</option>
          <option value="viewer" ${m.role==='viewer'?'selected':''}>Nur Lesen</option>
        </select>
        <select class="user-employee">${employeeOptions(m.employee_id||'')}</select>
        <button type="button" class="btn ghost user-save">Speichern</button>
        <button type="button" class="btn ${m.active?'danger':'ghost'} user-toggle">${m.active?'Deaktivieren':'Reaktivieren'}</button>
        <button type="button" class="btn danger user-delete">Löschen</button>
      </div>`).join(''):'<div class="empty-state">Noch keine Benutzer gefunden.</div>';
    list.querySelectorAll('.user-row').forEach(row=>{
      row.querySelector('.user-save').addEventListener('click',async()=>{
        try{await invokeUserAdmin({action:'update',userId:row.dataset.user,role:row.querySelector('.user-role').value,employeeId:row.querySelector('.user-employee').value||null,displayName:row.querySelector('.user-main strong').textContent,active:!row.querySelector('.user-toggle').textContent.includes('Reaktivieren')});showToast('Benutzer aktualisiert');await renderUsersList()}catch(err){alert(err.message)}
      });
      row.querySelector('.user-toggle').addEventListener('click',async()=>{
        const active=row.querySelector('.user-toggle').textContent.includes('Reaktivieren');
        try{await invokeUserAdmin({action:'update',userId:row.dataset.user,role:row.querySelector('.user-role').value,employeeId:row.querySelector('.user-employee').value||null,displayName:row.querySelector('.user-main strong').textContent,active});showToast(active?'Benutzer reaktiviert':'Benutzer deaktiviert');await renderUsersList()}catch(err){alert(err.message)}
      });
      row.querySelector('.user-delete').addEventListener('click',async()=>{
        const label=row.querySelector('.user-main strong').textContent||row.querySelector('.user-main span').textContent||'diesen Benutzer';
        if(!confirm(label+' wirklich vollständig als Login-Benutzer löschen? Der Mitarbeiter im Urlaubsplan bleibt bestehen.'))return;
        try{await invokeUserAdmin({action:'delete',userId:row.dataset.user});showToast('Benutzer gelöscht');await renderUsersList()}catch(err){alert(err.message)}
      });
    });
  }catch(err){console.error(err);list.innerHTML='<div class="empty-state">Fehler: '+escapeHtml(err.message)+'</div>'}
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
function openSettings(){
  const s=state.settings;
  document.getElementById('settingBaseVacation').value=s.baseVacation;document.getElementById('settingMaxVacation').value=s.maxVacation;document.getElementById('settingMaxAbsence').value=s.maxAbsence;document.getElementById('settingCountSchool').checked=s.countSchool;document.getElementById('settingConfirmConflicts').checked=s.confirmConflicts;
  document.getElementById('accountName').value=authMembership?.display_name||'';
  document.getElementById('accountEmail').value=authUser?.email||'';
  document.getElementById('accountPassword').value='';
  document.getElementById('accountInfo').textContent='E-Mail-Änderungen können eine Bestätigung an die neue Adresse auslösen.';
  const planning=document.getElementById('planningSettingsSection'),save=document.getElementById('planningSettingsSaveBtn');
  planning.classList.toggle('settings-disabled',!canManage());save.classList.toggle('hidden',!canManage());
  planning.querySelectorAll('input,select').forEach(el=>el.disabled=!canManage());
  document.getElementById('settingsDialog').showModal();
}


async function saveMyAccount(){
  if(!supabaseClient||!authUser){showToast('Nicht angemeldet');return}
  const name=document.getElementById('accountName').value.trim(),email=document.getElementById('accountEmail').value.trim(),password=document.getElementById('accountPassword').value;
  const info=document.getElementById('accountInfo');
  try{
    if(name&&name!==(authMembership?.display_name||'')){
      const {error}=await supabaseClient.rpc('update_my_display_name',{p_team_id:(window.TEAMPLAN_CONFIG||{}).teamId,p_display_name:name});if(error)throw error;
      authMembership={...(authMembership||{}),display_name:name};
    }
    const changes={};if(email&&email!==authUser.email)changes.email=email;if(password)changes.password=password;
    if(Object.keys(changes).length){const {data,error}=await supabaseClient.auth.updateUser(changes);if(error)throw error;if(data?.user)authUser=data.user}
    renderRoleControls();document.getElementById('accountPassword').value='';
    info.textContent=email!==authUser?.email?'Änderung gespeichert. Prüfe ggf. die Bestätigungsmail.':'Kontodaten gespeichert.';
    showToast('Kontodaten gespeichert');
  }catch(err){console.error(err);info.textContent='Fehler: '+err.message}
}
async function tryBootstrapAdmin(){
  const code=localStorage.getItem('teamplan-bootstrap-code')||document.getElementById('bootstrapCode')?.value.trim();
  if(!code||!supabaseClient||!authUser)return false;
  const name=localStorage.getItem('teamplan-bootstrap-name')||document.getElementById('bootstrapName')?.value.trim()||'Admin';
  const {error}=await supabaseClient.rpc('bootstrap_first_admin',{p_team_id:(window.TEAMPLAN_CONFIG||{}).teamId,p_code:code,p_display_name:name});
  if(error)throw error;
  localStorage.removeItem('teamplan-bootstrap-code');localStorage.removeItem('teamplan-bootstrap-name');
  return true;
}

function requireInvitePasswordSetup(){
  return new Promise(resolve=>{
    const dialog=document.getElementById('invitePasswordDialog');
    const form=document.getElementById('invitePasswordForm');
    const err=document.getElementById('invitePasswordError');
    const pass=document.getElementById('invitePassword');
    const confirm=document.getElementById('invitePasswordConfirm');
    pass.value='';confirm.value='';err.classList.add('hidden');err.textContent='';
    const handler=async e=>{
      e.preventDefault();
      err.classList.add('hidden');
      if(pass.value.length<8){err.textContent='Das Passwort muss mindestens 8 Zeichen lang sein.';err.classList.remove('hidden');return}
      if(pass.value!==confirm.value){err.textContent='Die Passwörter stimmen nicht überein.';err.classList.remove('hidden');return}
      const {error}=await supabaseClient.auth.updateUser({password:pass.value});
      if(error){err.textContent=error.message;err.classList.remove('hidden');return}
      form.removeEventListener('submit',handler);
      if(dialog.open)dialog.close();
      resolve();
    };
    form.addEventListener('submit',handler);
    if(!dialog.open)dialog.showModal();
  });
}
async function loadAuthMembership(){
  if(!supabaseClient||!authUser)return false;
  const cfg=window.TEAMPLAN_CONFIG||{};
  let {data,error}=await supabaseClient.from('team_members').select('role,employee_id,display_name,active').eq('team_id',cfg.teamId).eq('user_id',authUser.id).maybeSingle();
  if(error)throw error;
  if(!data){
    try{if(await tryBootstrapAdmin()){({data,error}=await supabaseClient.from('team_members').select('role,employee_id,display_name,active').eq('team_id',cfg.teamId).eq('user_id',authUser.id).maybeSingle());if(error)throw error}}catch(err){console.error(err);throw err}
  }
  if(!data||data.active===false){throw new Error('Dein Konto ist diesem Team nicht aktiv zugeordnet.')}
  authMembership=data;sessionRole=data.role||'viewer';sessionEmployeeId=data.employee_id||'';
  localStorage.setItem('teamplan-session-role',sessionRole);localStorage.setItem('teamplan-session-employee',sessionEmployeeId);
  renderRoleControls();return true;
}
async function loadRemotePlan(){
  const cfg=window.TEAMPLAN_CONFIG||{};
  const {data,error}=await supabaseClient.from('team_plans').select('data,updated_at').eq('team_id',cfg.teamId).maybeSingle();
  if(error)throw error;
  if(data?.data){isApplyingRemote=true;state=normalizeState(data.data);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;renderRoleControls();render()}
  else if(canManage())await pushRemote();
}
function showLogin(){
  const d=document.getElementById('loginDialog');if(d&&!d.open)d.showModal();
}
function hideLogin(){const d=document.getElementById('loginDialog');if(d?.open)d.close()}
async function initRemote(){
  const cfg=window.TEAMPLAN_CONFIG||{};
  if(!authConfigured()){setSync('local','● Lokal');return}
  try{
    supabaseClient=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    const inviteParams=new URLSearchParams(window.location.search);
    const inviteToken=inviteParams.get('token_hash'),inviteType=inviteParams.get('type');
    if(inviteToken&&inviteType){
      const {error:verifyError}=await supabaseClient.auth.verifyOtp({token_hash:inviteToken,type:inviteType});
      if(verifyError)throw verifyError;
      history.replaceState({},document.title,window.location.pathname);
      await requireInvitePasswordSetup();
      showToast('Einladung abgeschlossen');
    }
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(!session){setSync('local','● Login erforderlich');showLogin()}
    else{
      const {data:{user},error:userError}=await supabaseClient.auth.getUser();if(userError)throw userError;
      authUser=user;await loadAuthMembership();await loadRemotePlan();hideLogin();setSync('live','● Live synchron');
    }
    supabaseClient.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_OUT'||!session){authUser=null;authMembership=null;renderRoleControls();setSync('local','● Abgemeldet');showLogin();return}
      if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){
        const {data:{user}}=await supabaseClient.auth.getUser();authUser=user;
        try{await loadAuthMembership();await loadRemotePlan();hideLogin();setSync('live','● Live synchron')}catch(err){console.error(err);document.getElementById('loginError').textContent=err.message;document.getElementById('loginError').classList.remove('hidden');showLogin()}
      }
    });
    supabaseClient.channel('teamplan-live').on('postgres_changes',{event:'*',schema:'public',table:'team_plans',filter:`team_id=eq.${cfg.teamId}`},payload=>{const remote=payload.new?.data;if(remote&&remote.updatedAt!==state.updatedAt){isApplyingRemote=true;state=normalizeState(remote);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;render();showToast('Plan wurde aktualisiert')}}).subscribe();
  }catch(err){console.error(err);setSync('error','● Login/Sync-Fehler');showLogin()}
}
async function pushRemote(){
  if(!supabaseClient||!authUser||!canManage())return;
  const cfg=window.TEAMPLAN_CONFIG;
  try{const {error}=await supabaseClient.from('team_plans').upsert({team_id:cfg.teamId,data:state,updated_at:new Date().toISOString()},{onConflict:'team_id'});if(error)throw error;setSync('live','● Live synchron')}
  catch(e){console.error(e);setSync('error','● Sync-Fehler')}
}
function setSync(cls,text){const p=document.getElementById('syncPill');p.className='sync-pill '+cls;p.textContent=text}

// top controls
document.getElementById('prevMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('nextMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('prevYear').addEventListener('click',()=>{viewDate.setFullYear(viewDate.getFullYear()-1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('nextYear').addEventListener('click',()=>{viewDate.setFullYear(viewDate.getFullYear()+1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('monthSelect').addEventListener('change',e=>{viewDate.setMonth(Number(e.target.value));saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('yearSelect').addEventListener('change',e=>{viewDate.setFullYear(Number(e.target.value));saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('todayBtn').addEventListener('click',()=>{viewDate=new Date();viewDate.setDate(1);saveLastViewDate();plannerScrollLeft=null;render()});
document.getElementById('zoomOutBtn').addEventListener('click',()=>changeZoom(-.05));
document.getElementById('zoomInBtn').addEventListener('click',()=>changeZoom(.05));
document.getElementById('zoomRange').addEventListener('input',e=>setZoom(Number(e.target.value)/100));
document.getElementById('themeBtn').addEventListener('click',toggleTheme);
document.getElementById('roleSelect').addEventListener('change',e=>{sessionRole=e.target.value;localStorage.setItem('teamplan-session-role',sessionRole);renderRoleControls();render();showToast('Modus: '+e.target.options[e.target.selectedIndex].text)});
document.getElementById('roleEmployeeSelect').addEventListener('change',e=>{sessionEmployeeId=e.target.value;localStorage.setItem('teamplan-session-employee',sessionEmployeeId);render();});
document.getElementById('monthViewBtn').addEventListener('click',()=>{currentView='month';plannerScrollLeft=null;clearDragSelection();render()});
document.getElementById('yearViewBtn').addEventListener('click',()=>{currentView='year';clearDragSelection();render()});
document.getElementById('vacationFullBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='full';persist();render();showToast('Urlaubsanzeige: Gesamtplanung')});
document.getElementById('vacationActualBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='actual';persist();render();showToast('Urlaubsanzeige: anteilig fürs Firmenprogramm')});
document.getElementById('searchInput').addEventListener('input',render);
document.getElementById('addEmployeeBtn').addEventListener('click',()=>openEmployee());
document.getElementById('importNamesBtn').addEventListener('click',()=>{if(!canManage())return;document.getElementById('namesPasteInput').value='';document.getElementById('namesFileInput').value='';updateNamesImportPreview([]);document.getElementById('namesImportDialog').showModal()});
document.getElementById('settingsBtn').addEventListener('click',openSettings);
document.getElementById('usersBtn').addEventListener('click',openUsersDialog);
document.getElementById('accountSaveBtn').addEventListener('click',saveMyAccount);
document.getElementById('undoBtn').addEventListener('click',undoLastAction);
document.addEventListener('click',e=>{const btn=e.target.closest('[data-tool-action]');if(btn){e.preventDefault();runToolAction(btn.dataset.toolAction)}});
document.getElementById('userInviteForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const resultBox=document.getElementById('inviteResult');resultBox.classList.add('hidden');resultBox.innerHTML='';
  try{
    const data=await invokeUserAdmin({action:'invite',email:document.getElementById('inviteEmail').value.trim(),displayName:document.getElementById('inviteName').value.trim(),role:document.getElementById('inviteRole').value,employeeId:document.getElementById('inviteEmployee').value||null});
    e.target.reset();document.getElementById('inviteEmployee').innerHTML=employeeOptions('');
    if(data.delivery==='link'&&data.inviteLink){
      resultBox.innerHTML='<strong>Einladungslink erstellt</strong><span>Schicke diesen einmaligen TeamPlan-Link an den Kollegen. Beim Öffnen wird der Account bestätigt und direkt bei TeamPlan angemeldet.</span><div class="invite-link-row"><input id="generatedInviteLink" readonly value="'+escapeHtml(data.inviteLink)+'"><button type="button" id="copyInviteLink" class="btn primary">Link kopieren</button></div>';
      resultBox.classList.remove('hidden');
      document.getElementById('copyInviteLink').addEventListener('click',async()=>{await navigator.clipboard.writeText(data.inviteLink);showToast('Einladungslink kopiert')});
      showToast('Einladungslink erstellt');
    }else if(data.delivery==='existing'){
      resultBox.innerHTML='<strong>Benutzer bereits vorhanden</strong><span>Der bestehende Account wurde dem Team zugeordnet bzw. aktualisiert.</span>';
      resultBox.classList.remove('hidden');showToast('Benutzer zugeordnet');
    }else showToast('Einladung per E-Mail gesendet');
    await renderUsersList();
  }catch(err){console.error(err);resultBox.innerHTML='<strong>Einladung fehlgeschlagen</strong><span>'+escapeHtml(err.message||String(err))+'</span>';resultBox.classList.remove('hidden')}
});
document.getElementById('planImportFile').addEventListener('change',async e=>{try{renderPlanImportPreview(await readPlanImportFile(e.target.files[0]))}catch(err){console.error(err);renderPlanImportPreview({entries:[],names:[],warnings:[err.message]})}});
document.getElementById('planImportForm').addEventListener('submit',e=>{e.preventDefault();applyPlanImport()});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('[data-bulk-code]').forEach(b=>b.addEventListener('click',()=>{bulkSelectedCodes.has(b.dataset.bulkCode)?bulkSelectedCodes.delete(b.dataset.bulkCode):bulkSelectedCodes.add(b.dataset.bulkCode);b.classList.toggle('selected');updateBulkPreview()}));
['bulkEmployee','bulkStart','bulkEnd','bulkOnlyWorkdays','bulkSkipWeekends','bulkMode','bulkPriority'].forEach(id=>document.getElementById(id).addEventListener('change',updateBulkPreview));
document.getElementById('bulkForm').addEventListener('submit',e=>{e.preventDefault();applyBulk(false)});
document.getElementById('bulkClearBtn').addEventListener('click',()=>{const dates=bulkDates();if(!dates.length)return;if(confirm(`Alle Einträge dieses Mitarbeiters an ${dates.length} betroffenen Tagen löschen?`))applyBulk(true)});

document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));

document.getElementById('employeeWorkdays').addEventListener('input',updateVacationPreview);document.getElementById('employeeCarry').addEventListener('input',updateVacationPreview);document.getElementById('employeeAdjustment').addEventListener('input',updateVacationPreview);
document.getElementById('employeeAutoWeekend').addEventListener('change',e=>document.getElementById('autoWeekendOptions').classList.toggle('disabled-block',!e.target.checked));
document.getElementById('employeeRangeBtn').addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;document.getElementById('employeeDialog').close();openBulkDialog(id)});
document.getElementById('fitEmployeesBtn').addEventListener('click',fitAllEmployees);
document.getElementById('focusFitBtn').addEventListener('click',fitAllEmployees);
document.getElementById('focusModeBtn').addEventListener('click',enterPlannerFocus);
document.getElementById('exitFocusBtn').addEventListener('click',exitPlannerFocus);
document.getElementById('employeeForm').addEventListener('submit',e=>{e.preventDefault();if(!canEditEmployees())return;const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);trackAction(current?'Mitarbeiter geändert':'Mitarbeiter angelegt',document.getElementById('employeeName').value.trim());const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const autoWeekend={enabled:document.getElementById('employeeAutoWeekend').checked,intervalWeeks:Number(document.getElementById('employeeWeekendInterval').value||2),anchorDate:document.getElementById('employeeWeekendAnchor').value};if(autoWeekend.enabled&&!autoWeekend.anchorDate){alert('Bitte einen Referenz-Samstag für die freien Wochenenden auswählen.');return}if(current)clearAutoWeekendX(id);const obj={id,name:document.getElementById('employeeName').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),autoWeekend,role:sessionRole==='admin'?document.getElementById('employeeRole').value:(current?.role||'employee'),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);ensureAutoWeekendEntries(viewDate.getFullYear());persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn').addEventListener('click',()=>{if(sessionRole!=='admin')return;const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){const name=state.employees.find(e=>e.id===id)?.name||'';trackAction('Mitarbeiter gelöscht',name);state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm').addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(empId))return;const blocked=blackoutBlocks(key);if(blocked&&[...selectedCodes].some(c=>['U','XU'].includes(c))){alert('Urlaub ist in dieser Sperrzeit blockiert: '+blocked.name);return}if(!state.entries[empId])state.entries[empId]={};const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim(),status:canApprove()?document.getElementById('cellStatus').value:'wish'};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;trackAction('Planung geändert',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+candidate.codes.join('+'));if(candidate.codes.length||candidate.priority||candidate.note)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn').addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(emp))return;if(state.entries[emp]){trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===emp)?.name||'')+' · '+key);delete state.entries[emp][key]}persist();saveRemoteEntry(emp,key,null);render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

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
document.getElementById('dragApproveBtn').addEventListener('click',()=>applyDragStatus('approved'));
document.getElementById('dragRejectBtn').addEventListener('click',()=>applyDragStatus('rejected'));
document.getElementById('dragDeleteBtn').addEventListener('click',deleteDragEntries);
document.getElementById('dragCancelBtn').addEventListener('click',clearDragSelection);
document.getElementById('loginModeBtn').addEventListener('click',()=>{});
document.getElementById('loginForm').addEventListener('submit',async e=>{
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
      try{await loadAuthMembership();await loadRemotePlan();hideLogin();setSync('live','● Live synchron')}catch(err){errEl.textContent=err.message;errEl.classList.remove('hidden')}
    }else{
      errEl.textContent='Konto angelegt. Bitte bestätige gegebenenfalls die E-Mail und melde dich danach an. Der Setup-Code bleibt lokal gespeichert.';errEl.classList.remove('hidden');
    }
    return;
  }
  const {error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){errEl.textContent=error.message;errEl.classList.remove('hidden')}
});
document.getElementById('logoutBtn').addEventListener('click',async()=>{if(supabaseClient)await supabaseClient.auth.signOut()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dragSelectedKeys.size)clearDragSelection()});

renderRoleControls();render();initRemote();
