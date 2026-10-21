// Urlaub: Kürzel, Anspruch, Feiertage, Ferien, Tageszählung
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function entryIsActive(v){return (v?.status||'wish')!=='rejected'}
function blackoutForKey(key){return (state.blackouts||[]).find(b=>key>=b.start&&key<=b.end)||null}
function blackoutBlocks(key){const b=blackoutForKey(key);return b?.mode==='block'?b:null}
function codeForeground(hex){
  const raw=String(hex||'').replace('#','');
  if(!/^[0-9a-fA-F]{6}$/.test(raw))return '#173f36';
  const r=parseInt(raw.slice(0,2),16),g=parseInt(raw.slice(2,4),16),b=parseInt(raw.slice(4,6),16);
  const luminance=(0.2126*r+0.7152*g+0.0722*b)/255;
  return luminance>.62?'#173f36':'#ffffff';
}
function applyCodeColors(){
  const root=document.documentElement,colors={...DEFAULT_CODE_COLORS,...(state.settings.codeColors||{})};
  Object.entries(colors).forEach(([key,color])=>{
    const token=key.toLowerCase().replace(/[^a-z0-9]/g,'');
    root.style.setProperty('--code-'+token+'-bg',color);
    root.style.setProperty('--code-'+token+'-fg',codeForeground(color));
  });
}
function allCodeDefs(){
  const colors={...DEFAULT_CODE_COLORS,...(state.settings.codeColors||{})};
  const base=[
    {key:'U',label:'Urlaub',className:'u',absence:true,color:colors.U},
    {key:'X',label:'Frei-WE',className:'x',absence:true,color:colors.X},
    {key:'XU',label:'Wunsch-WE',className:'xu',absence:true,color:colors.XU},
    {key:'S',label:'Schule',className:'s',absence:true,color:colors.S},
    {key:'G',label:'Geburtstag',className:'g',absence:false,color:colors.G}
  ];
  return [...base,...(state.settings.customCodes||[])];
}
function codeDef(key){return allCodeDefs().find(c=>c.key===key)||{key,label:key,className:'custom-code',absence:false,color:'#6f7f8f'}}
function codeClassName(key){return codeDef(key).className||'custom-code'}
function isAbsenceCode(key){return !!codeDef(key).absence}
function renderBaseCodeColorsSettings(){
  const colors={...DEFAULT_CODE_COLORS,...(state.settings.codeColors||{})};
  Object.entries(colors).forEach(([key,color])=>{
    const input=document.getElementById('baseCodeColor'+key);
    if(input)input.value=color;
  });
}
function saveBaseCodeColors(){
  if(!canManage())return;
  const next={...DEFAULT_CODE_COLORS};
  Object.keys(next).forEach(key=>{
    const value=document.getElementById('baseCodeColor'+key)?.value;
    if(value)next[key]=value;
  });
  trackAction('Kürzelfarben geändert');
  state.settings.codeColors=next;
  persist();applyCodeColors();render();renderBaseCodeColorsSettings();showToast('Kürzelfarben gespeichert');
}
function resetBaseCodeColors(){
  if(!canManage())return;
  state.settings.codeColors={...DEFAULT_CODE_COLORS};
  persist();applyCodeColors();render();renderBaseCodeColorsSettings();showToast('Standardfarben wiederhergestellt');
}
function renderCustomCodesSettings(){
  const list=document.getElementById('customCodesList');if(!list)return;
  const custom=state.settings.customCodes||[];
  list.innerHTML=custom.length?custom.map(c=>'<div class="custom-code-row" data-key="'+escapeHtml(c.key)+'"><span class="custom-code-swatch" style="--code-color:'+escapeHtml(c.color||'#6f7f8f')+'">'+escapeHtml(c.key)+'</span><div><strong>'+escapeHtml(c.label)+'</strong><small>'+(c.absence?'zählt als Abwesenheit':'nur Kennzeichnung')+'</small></div><button type="button" class="btn danger custom-code-delete">Löschen</button></div>').join(''):'<div class="empty-state">Keine zusätzlichen Kürzel angelegt.</div>';
  list.querySelectorAll('.custom-code-delete').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.closest('.custom-code-row').dataset.key;if(!confirm('Kürzel '+key+' wirklich löschen? Bereits eingetragene Werte bleiben im Plan sichtbar.'))return;trackAction('Kürzel gelöscht',key);state.settings.customCodes=state.settings.customCodes.filter(c=>c.key!==key);state.settings.countCodes=(state.settings.countCodes||[]).filter(c=>c!==key);state.settings.countRows=(state.settings.countRows||[]).filter(c=>c!==key);persist();renderCustomCodesSettings();renderVacationCountMenu();render()}));
}
function renderDynamicCodes(){
  const custom=state.settings.customCodes||[];
  document.querySelectorAll('[data-custom-code]').forEach(n=>n.remove());
  const cell=document.getElementById('cellCodeSelector'),bulk=document.getElementById('bulkCodeSelector'),drag=document.getElementById('customDragCodes'),legend=document.getElementById('customLegend');
  custom.forEach(c=>{
    if(cell){const b=document.createElement('button');b.type='button';b.dataset.code=c.key;b.dataset.customCode='1';b.className='code-btn custom-code';b.style.setProperty('--code-color',c.color);b.innerHTML=escapeHtml(c.key)+' <small>'+escapeHtml(c.label)+'</small>';cell.appendChild(b)}
    if(bulk){const b=document.createElement('button');b.type='button';b.dataset.bulkCode=c.key;b.dataset.customCode='1';b.className='code-btn custom-code';b.style.setProperty('--code-color',c.color);b.innerHTML=escapeHtml(c.key)+' <small>'+escapeHtml(c.label)+'</small>';bulk.appendChild(b)}
  });
  if(drag)drag.innerHTML=custom.map(c=>'<button type="button" data-custom-drag-code="'+escapeHtml(c.key)+'" class="drag-action custom-code" style="--code-color:'+escapeHtml(c.color)+'">'+escapeHtml(c.key)+'</button>').join('');
  if(legend)legend.innerHTML=custom.map(c=>'<span class="custom-legend-item"><b class="chip custom-code" style="--code-color:'+escapeHtml(c.color)+'">'+escapeHtml(c.key)+'</b> '+escapeHtml(c.label)+'</span>').join('');
  document.querySelectorAll('#cellCodeSelector [data-custom-code]').forEach(b=>b.addEventListener('click',()=>{selectedCodes.has(b.dataset.code)?selectedCodes.delete(b.dataset.code):selectedCodes.add(b.dataset.code);b.classList.toggle('selected');updateCellWarning(document.getElementById('cellEmployeeId').value,document.getElementById('cellDateValue').value)}));
  document.querySelectorAll('#bulkCodeSelector [data-custom-code]').forEach(b=>b.addEventListener('click',()=>{bulkSelectedCodes.has(b.dataset.bulkCode)?bulkSelectedCodes.delete(b.dataset.bulkCode):bulkSelectedCodes.add(b.dataset.bulkCode);b.classList.toggle('selected');updateBulkPreview()}));
  document.querySelectorAll('[data-custom-drag-code]').forEach(b=>b.addEventListener('click',()=>applyDragCode(b.dataset.customDragCode)));
}

function clearAutoWeekendX(empId){
  const entries=state.entries[empId]||{};
  Object.entries(entries).forEach(([key,v])=>{
    if(!v?.autoX)return;
    const codes=(v.codes||[]).filter(c=>c!=='X');
    if(codes.length||v.note||v.priority||(v.plannerMarkers||[]).length){entries[key]={...v,codes,autoX:false}}
    else delete entries[key];
  });
}
function ensureAutoWeekendEntries(year){
  let changed=false;
  state.employees.forEach(emp=>{
    if(emp.external)return;
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
function fullVacationEntitlement(e){return roundHalf(state.settings.baseVacation + Number(e.carry||0) + Number(e.adjustment||0));}
function actualVacationEntitlement(e){return fullVacationEntitlement(e);}
function vacationEntitlement(e){return fullVacationEntitlement(e);}
function vacationFactor(e){return Math.max(0,Math.min(1,Number(e.percent||100)/100));}
function vacationDaysPerWeek(e){return roundTwo(5*vacationFactor(e));}
function entryFor(empId,key){return state.entries?.[empId]?.[key] || {codes:[],priority:0,note:'',status:'wish',plannerMarkers:[]};}
function isWorkday(e,d){return (e.workweek||[]).includes(d.getDay());}
function usedVacationFull(e,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&entryIsActive(v)&&v.codes?.includes('U')).length;}
function usedVacationActual(e,year=viewDate.getFullYear()){return roundTwo(usedVacationFull(e,year)*vacationFactor(e));}
function usedVacation(e,year=viewDate.getFullYear()){return state.settings.vacationDisplayMode==='full' ? usedVacationFull(e,year) : usedVacationActual(e,year);}
function countCode(e,code,year=viewDate.getFullYear()){return Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(year+'-')&&entryIsActive(v)&&v.codes?.includes(code)).length;}
function remainingVacation(e,year=viewDate.getFullYear()){return vacationEntitlement(e)-usedVacation(e,year);}
function absentCount(key){return teamEmployees().filter(e=>{const v=entryFor(e.id,key),c=v.codes||[];return entryIsActive(v)&&c.some(isAbsenceCode);}).length;}
function presentCount(key){return Math.max(0,teamEmployees().length-absentCount(key));}
function absentEmployees(key){
  return [...teamEmployees()].sort((a,b)=>a.order-b.order).filter(e=>{
    const v=entryFor(e.id,key),c=v.codes||[];
    return entryIsActive(v)&&c.some(isAbsenceCode);
  }).map(e=>({employee:e,codes:(entryFor(e.id,key).codes||[]).filter(isAbsenceCode)}));
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
function selectedCountCodes(){
  const valid=new Set(allCodeDefs().map(c=>c.key));
  return (state.settings.countCodes||[]).filter(code=>valid.has(code));
}
function selectedCountRows(){
  const valid=new Set([...allCodeDefs().map(c=>c.key),'TOTAL','PRESENT','ABSENT_NAMES']);
  return (state.settings.countRows||[]).filter(row=>valid.has(row));
}
function countCodeForDate(code,key){
  return teamEmployees().reduce((sum,e)=>{
    const v=entryFor(e.id,key);
    return sum+(entryIsActive(v)&&v.codes?.includes(code)?1:0);
  },0);
}
function dailyCounts(key){
  let U=0,X=0,XU=0,S=0,G=0,total=0;
  const selected=new Set(selectedCountCodes());
  teamEmployees().forEach(e=>{
    const v=entryFor(e.id,key);if(!entryIsActive(v))return;
    const c=v.codes||[];
    if(c.includes('U'))U++;if(c.includes('X'))X++;if(c.includes('XU'))XU++;if(c.includes('S'))S++;if(c.includes('G'))G++;
    if(state.settings.countMode==='entries')total+=c.filter(code=>selected.has(code)).length;
    else if(c.some(code=>selected.has(code)))total++;
  });
  return {U,X,XU,S,G,total};
}
function conflictLevel(key){const c=dailyCounts(key);return {vacation:c.U>state.settings.maxVacation,total:c.total>state.settings.maxAbsence};}
