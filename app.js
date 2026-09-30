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
  settings: {baseVacation:30,maxVacation:4,maxAbsence:7,countSchool:true,confirmConflicts:true,state:'NW'},
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
let supabaseClient = null;
let syncTimer = null;
let isApplyingRemote = false;

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
function vacationEntitlement(e){return roundHalf(state.settings.baseVacation*(Number(e.workdays)||5)/5 + Number(e.carry||0) + Number(e.adjustment||0));}
function entryFor(empId,key){return state.entries?.[empId]?.[key] || {codes:[],priority:0,note:''};}
function isWorkday(e,d){return (e.workweek||[]).includes(d.getDay());}
function usedVacation(e){let n=0;Object.entries(state.entries[e.id]||{}).forEach(([k,v])=>{if(v.codes?.includes('U')){const d=new Date(k+'T12:00:00');if(isWorkday(e,d)) n++;}});return n;}
function countCode(e,code){return Object.values(state.entries[e.id]||{}).filter(v=>v.codes?.includes(code)).length;}
function remainingVacation(e){return vacationEntitlement(e)-usedVacation(e);}

function getEaster(year){
  const f=Math.floor,a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,g=Math.floor((8*b+13)/25),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+19*l)/433),month=Math.floor((h+l-7*m+90)/25),day=(h+l-7*m+33*month+19)%32; return new Date(year,month-1,day);
}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function holidaysNRW(year){const e=getEaster(year); const fixed=[[0,1,'Neujahr'],[4,1,'Tag der Arbeit'],[9,3,'Tag der Einheit'],[10,1,'Allerheiligen'],[11,25,'1. Weihnachtstag'],[11,26,'2. Weihnachtstag']]; const map={}; fixed.forEach(([m,d,n])=>map[dateKey(new Date(year,m,d))]=n); [[-2,'Karfreitag'],[1,'Ostermontag'],[39,'Christi Himmelfahrt'],[50,'Pfingstmontag'],[60,'Fronleichnam']].forEach(([o,n])=>map[dateKey(addDays(e,o))]=n); return map;}

function monthDates(){const y=viewDate.getFullYear(),m=viewDate.getMonth(),last=new Date(y,m+1,0).getDate();return Array.from({length:last},(_,i)=>new Date(y,m,i+1));}
function dailyCounts(key){let U=0,XU=0,S=0;state.employees.forEach(e=>{const c=entryFor(e.id,key).codes||[];if(c.includes('U'))U++;if(c.includes('XU'))XU++;if(c.includes('S'))S++});return {U,XU,S,total:U+XU+(state.settings.countSchool?S:0)};}
function conflictLevel(key){const c=dailyCounts(key);return {vacation:c.U>state.settings.maxVacation,total:c.total>state.settings.maxAbsence};}

function render(){
  const dates=monthDates(), holidays=holidaysNRW(viewDate.getFullYear());
  document.getElementById('monthLabel').textContent=MONTHS[viewDate.getMonth()]; document.getElementById('yearLabel').textContent=viewDate.getFullYear();
  const filter=document.getElementById('searchInput').value.trim().toLowerCase();
  const employees=[...state.employees].sort((a,b)=>a.order-b.order).filter(e=>!filter||e.name.toLowerCase().includes(filter));
  let html='<table class="plan-table"><thead><tr><th class="employee-col">Mitarbeiter · Urlaub</th>';
  dates.forEach(d=>{const key=dateKey(d),we=[0,6].includes(d.getDay()),hol=holidays[key];html+=`<th class="date-head ${we?'weekend':''} ${hol?'holiday':''}" title="${hol||''}">${DOW[d.getDay()]}<strong>${d.getDate()}</strong>${hol?`<span class="holiday-label">${escapeHtml(hol)}</span>`:''}</th>`});
  html+='</tr></thead><tbody>';
  employees.forEach(e=>{
    const used=usedVacation(e),total=vacationEntitlement(e),remain=remainingVacation(e),xu=countCode(e,'XU'); const status=remain<0?'status-bad':remain<=3?'status-low':'status-good';
    html+=`<tr class="employee-row" draggable="true" data-id="${e.id}"><td class="employee-col employee-cell"><div class="employee-card"><span class="drag-handle">⠿</span><div class="employee-edit" data-id="${e.id}"><div class="employee-name">${escapeHtml(e.name)}</div><div class="employee-meta">${e.hours} h · ${e.percent}% · ${e.workdays} Tage/Woche · XU ${xu}</div></div><div class="employee-stats ${status}"><strong>${used}/${total}</strong><small>${remain} übrig</small></div></div></td>`;
    dates.forEach(d=>{const key=dateKey(d),v=entryFor(e.id,key),we=[0,6].includes(d.getDay()),nonwork=!isWorkday(e,d),conf=conflictLevel(key);const codes=(v.codes||[]).map(c=>`<span class="cell-code ${CODE_CLASS[c]}">${c}</span>`).join('');const warn=(conf.vacation&&v.codes?.includes('U'))||(conf.total&&v.codes?.some(c=>['U','XU','S'].includes(c)));html+=`<td class="day-cell ${we?'weekend':''} ${nonwork?'nonwork':''}" data-emp="${e.id}" data-date="${key}" title="${v.note?escapeHtml(v.note):''}"><div class="cell-codes">${codes}</div>${v.priority?`<span class="cell-priority p${v.priority}"></span>`:''}${v.note?'<span class="cell-note"></span>':''}${warn?'<span class="cell-warning-mark">!</span>':''}</td>`});
    html+='</tr>';
  });
  html+=summaryRow('Urlaub U','U',dates);html+=summaryRow('Wunschfrei XU','XU',dates);html+=summaryRow('Schule S','S',dates);html+='</tbody></table>';
  document.getElementById('planner').innerHTML=html; bindPlannerEvents(); renderMetrics();
}
function summaryRow(label,code,dates){let s=`<tr class="summary-row ${code==='U'?'alarm':''}"><td class="employee-col">Σ ${label}</td>`;dates.forEach(d=>{const c=dailyCounts(dateKey(d)),n=c[code],hot=code==='U'&&n>state.settings.maxVacation,warn=code==='U'&&n===state.settings.maxVacation;s+=`<td class="${hot?'count-hot':warn?'count-warn':''}">${n||''}</td>`});return s+'</tr>'}
function renderMetrics(){
  document.getElementById('metricEmployees').textContent=state.employees.length; document.getElementById('metricVacation').textContent=state.employees.reduce((a,e)=>a+usedVacation(e),0); document.getElementById('metricXU').textContent=state.employees.reduce((a,e)=>a+countCode(e,'XU'),0); document.getElementById('metricConflicts').textContent=monthDates().filter(d=>{const c=conflictLevel(dateKey(d));return c.vacation||c.total}).length;
}

function bindPlannerEvents(){
  document.querySelectorAll('.day-cell').forEach(el=>el.addEventListener('click',()=>openCell(el.dataset.emp,el.dataset.date)));
  document.querySelectorAll('.employee-edit').forEach(el=>el.addEventListener('click',()=>openEmployee(el.dataset.id)));
  let dragged=null; document.querySelectorAll('.employee-row').forEach(row=>{row.addEventListener('dragstart',()=>{dragged=row.dataset.id;row.style.opacity=.45});row.addEventListener('dragend',()=>{row.style.opacity='';document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drop-target')});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.id;if(dragged&&dragged!==target){reorder(dragged,target)}})});
}
function reorder(sourceId,targetId){const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function openEmployee(id=null){
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e);renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const wd=Number(document.getElementById('employeeWorkdays').value||5),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,total=roundHalf(base*wd/5+carry+adj);document.getElementById('vacationPreview').innerHTML=`Berechnung: <strong>${base} × ${wd}/5 + ${carry} Übertrag ${adj>=0?'+':''}${adj} Korrektur = ${total} Urlaubstage</strong><br><span style="color:var(--muted)">Stellenprozent beeinflussen die Urlaubstage nicht, solange die Zahl der Arbeitstage gleich bleibt.</span>`}

function openCell(empId,key){const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('.code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
function updateCellWarning(empId,key){const e=state.employees.find(x=>x.id===empId),d=new Date(key+'T12:00:00'),w=document.getElementById('cellWarning');let msgs=[];if(selectedCodes.has('U')&&!isWorkday(e,d))msgs.push('U liegt auf einem nicht regulären Arbeitstag und zählt deshalb nicht vom Urlaubsanspruch ab.');const c=dailyCounts(key),current=entryFor(empId,key).codes||[];const uAfter=c.U-(current.includes('U')?1:0)+(selectedCodes.has('U')?1:0);const sAfter=c.S-(current.includes('S')?1:0)+(selectedCodes.has('S')?1:0);const xuAfter=c.XU-(current.includes('XU')?1:0)+(selectedCodes.has('XU')?1:0);const total=uAfter+xuAfter+(state.settings.countSchool?sAfter:0);if(uAfter>state.settings.maxVacation)msgs.push(`Urlaubslimit überschritten: ${uAfter} statt maximal ${state.settings.maxVacation}.`);if(total>state.settings.maxAbsence)msgs.push(`Gesamt-Abwesenheitswarnung: ${total} statt maximal ${state.settings.maxAbsence}.`);w.textContent=msgs.join(' ');w.classList.toggle('hidden',!msgs.length)}

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
document.getElementById('prevMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-1);render()});
document.getElementById('nextMonth').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+1);render()});
document.getElementById('todayBtn').addEventListener('click',()=>{viewDate=new Date();viewDate.setDate(1);render()});
document.getElementById('searchInput').addEventListener('input',render);document.getElementById('addEmployeeBtn').addEventListener('click',()=>openEmployee());document.getElementById('settingsBtn').addEventListener('click',openSettings);document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));

document.querySelectorAll('.code-btn').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));

document.getElementById('employeeWorkdays').addEventListener('input',updateVacationPreview);document.getElementById('employeeCarry').addEventListener('input',updateVacationPreview);document.getElementById('employeeAdjustment').addEventListener('input',updateVacationPreview);
document.getElementById('employeeForm').addEventListener('submit',e=>{e.preventDefault();const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const obj={id,name:document.getElementById('employeeName').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);persist();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn').addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm').addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!state.entries[empId])state.entries[empId]={};const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim()};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;if(candidate.codes.length||candidate.priority||candidate.note)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn').addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(state.entries[emp])delete state.entries[emp][key];persist();render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

document.getElementById('settingsForm').addEventListener('submit',e=>{e.preventDefault();state.settings.baseVacation=Number(document.getElementById('settingBaseVacation').value);state.settings.maxVacation=Number(document.getElementById('settingMaxVacation').value);state.settings.maxAbsence=Number(document.getElementById('settingMaxAbsence').value);state.settings.countSchool=document.getElementById('settingCountSchool').checked;state.settings.confirmConflicts=document.getElementById('settingConfirmConflicts').checked;persist();render();document.getElementById('settingsDialog').close();showToast('Planungsregeln gespeichert')});

document.getElementById('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`teamplan-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)});
document.getElementById('importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const incoming=normalizeState(JSON.parse(await f.text()));if(!confirm('Aktuelle Planung durch diese Sicherung ersetzen?'))return;state=incoming;persist();render();showToast('Sicherung importiert')}catch{alert('Die Datei konnte nicht gelesen werden.')}});

render();initRemote();
