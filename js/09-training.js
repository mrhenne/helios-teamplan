// Modul Fortbildungen
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function trainingCanManage(){return canManage()}
function trainingEmployeeName(id){return state.employees.find(e=>e.id===id)?.name||'Unbekannter Mitarbeiter'}
function trainingTypeById(id){return trainingTypes.find(t=>t.id===id)||null}
function trainingCategoryFallbackColor(category=''){const c=String(category).toLowerCase();if(c.includes('weiterbildung'))return '#8b5cf6';if(c.includes('pflicht'))return '#e59f23';if(c.includes('training'))return '#d8891c';return '#5b8def'}
function trainingColor(t){const type=trainingTypeById(t?.type_id);return type?.color||trainingCategoryFallbackColor(t?.category)}
function trainingBudgetFor(empId,year=trainingYear){return Number(trainingBudgets.find(b=>b.employee_id===empId&&Number(b.year)===Number(year))?.amount||0)}
function trainingDate(d){return d?new Date(d+'T12:00:00'):null}
function addMonthsISO(date,months){
  if(!date||!months)return null;
  const d=trainingDate(date);if(!d)return null;
  const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+Number(months));
  const max=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,max));
  return dateKey(d);
}
function trainingRecurrenceUnit(t){
  return t?.recurring?(t.recurrence_unit||'months'):'months';
}
function trainingRecurrenceInterval(t){
  if(!t?.recurring)return 0;
  if(trainingRecurrenceUnit(t)==='weeks')return Number(t.recurrence_interval||0);
  return Number(t.recurrence_interval||t.recurrence_months||trainingTypeById(t.type_id)?.interval_months||0);
}
function trainingRecurrenceMonths(t){
  return trainingRecurrenceUnit(t)==='months'?trainingRecurrenceInterval(t):0;
}
function trainingWeekdayLabel(n){
  return ['','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'][Number(n)]||'';
}
function trainingTimeLabel(t){
  const a=String(t?.start_time||'').slice(0,5),b=String(t?.end_time||'').slice(0,5);
  return a&&b?a+'–'+b+(a||b?' Uhr':''):a?(a+' Uhr'):b?('bis '+b+' Uhr'):'';
}
function trainingRecurrenceLabel(t){
  const interval=trainingRecurrenceInterval(t);if(!interval)return '';
  if(trainingRecurrenceUnit(t)==='weeks'){
    const weekday=trainingWeekdayLabel(t.recurrence_weekday);
    return '↻ alle '+interval+(interval===1?' Woche':' Wochen')+(weekday?' · '+weekday:'')+(t.recurrence_until?' · bis '+new Date(t.recurrence_until+'T12:00:00').toLocaleDateString('de-DE'):'');
  }
  if(interval%12===0)return '↻ alle '+(interval/12)+(interval===12?' Jahr':' Jahre');
  return '↻ alle '+interval+' Monate';
}
function trainingDueDate(t){
  if(t.valid_until)return t.valid_until;
  const months=trainingRecurrenceMonths(t)||Number(trainingTypeById(t.type_id)?.interval_months||0);
  return t.status==='completed'&&months&&t.end_date?addMonthsISO(t.end_date,months):null;
}
function trainingDueState(t){
  const due=trainingDueDate(t);if(!due||t.status==='cancelled')return '';
  const today=dateKey(new Date()),soon=dateKey(addDays(new Date(),90));
  if(due<today)return 'overdue';
  if(due<=soon)return 'due';
  return 'valid';
}
function trainingStatusLabel(t){
  if(t.status==='in_progress')return 'In Durchführung';
  const due=trainingDueState(t);
  if(due==='overdue')return 'Überfällig';
  if(due==='due')return 'Bald fällig';
  return t.status==='completed'?'Absolviert':t.status==='cancelled'?'Abgesagt':'Geplant';
}
function trainingVisibleEmployees(){
  if(sessionRole==='employee')return teamEmployees().filter(e=>e.id===sessionEmployeeId);
  return [...teamEmployees()].sort((a,b)=>a.order-b.order);
}
function trainingProjectionForYear(t,year){
  if(!t?.recurring)return [];
  const unit=trainingRecurrenceUnit(t),interval=trainingRecurrenceInterval(t);
  if(!interval)return [];
  const out=[];
  if(unit==='weeks'){
    if(t.date_precision==='year'||!t.start_date)return out;
    const weekday=Number(t.recurrence_weekday||0);
    if(weekday<1||weekday>7)return out;
    const base=trainingDate(t.start_date);if(!base)return out;
    const targetJs=weekday===7?0:weekday;
    const first=new Date(base);
    first.setDate(first.getDate()+((targetJs-first.getDay()+7)%7));
    const until=trainingDate(t.recurrence_until||String(year)+'-12-31');
    const yearStart=new Date(year,0,1,12),yearEnd=new Date(year,11,31,12);
    const durationDays=t.end_date&&t.start_date?Math.max(0,Math.round((trainingDate(t.end_date)-trainingDate(t.start_date))/86400000)):0;
    for(let d=new Date(first),i=0;i<1200&&d<=until&&d<=yearEnd;i++,d=addDays(d,interval*7)){
      if(d<yearStart)continue;
      const start=dateKey(d),end=dateKey(addDays(d,durationDays));
      if(start===t.start_date)continue;
      out.push({...t,id:'virtual:'+t.id+':'+start,_virtual:true,_sourceId:t.id,start_date:start,end_date:end,training_year:Number(start.slice(0,4)),status:'planned'});
    }
    return out;
  }
  const months=interval;
  const baseYear=Number(t.training_year||(t.start_date||'').slice(0,4));
  if(!baseYear||year<=baseYear)return [];
  if(t.date_precision==='year'){
    let cursor=new Date(baseYear,0,1,12);
    for(let i=0;i<240;i++){
      cursor.setMonth(cursor.getMonth()+months);
      const y=cursor.getFullYear();
      if(y>year)break;
      if(y===year){out.push({...t,id:'virtual:'+t.id+':'+y,_virtual:true,_sourceId:t.id,training_year:y,start_date:null,end_date:null,status:'planned'});break}
    }
  }else if(t.start_date&&t.end_date){
    let start=t.start_date,end=t.end_date;
    for(let i=0;i<240;i++){
      start=addMonthsISO(start,months);end=addMonthsISO(end,months);
      if(!start||!end)break;
      const sy=Number(start.slice(0,4)),ey=Number(end.slice(0,4));
      if(sy>year&&ey>year)break;
      if(sy<=year&&ey>=year){out.push({...t,id:'virtual:'+t.id+':'+start,_virtual:true,_sourceId:t.id,start_date:start,end_date:end,training_year:Number(start.slice(0,4)),status:'planned'});break}
    }
  }
  return out;
}
function trainingItemsWithProjections(year=trainingYear){
  const real=[...trainings];
  const projections=trainings.flatMap(t=>trainingProjectionForYear(t,year)).filter(v=>{
    return !trainings.some(r=>r.employee_id===v.employee_id&&r.id!==v._sourceId&&(
      (v.date_precision==='year'&&r.date_precision==='year'&&Number(r.training_year)===Number(v.training_year)&&r.title===v.title)
      ||(v.date_precision!=='year'&&r.start_date===v.start_date&&r.title===v.title)
    ));
  });
  return real.concat(projections);
}
function trainingIntersectsYear(t,year=trainingYear){
  const due=trainingDueDate(t);
  if(t.date_precision==='year')return Number(t.training_year)===Number(year)||(due&&due.startsWith(String(year)+'-'));
  const start=year+'-01-01',end=year+'-12-31';
  return (t.start_date&&t.end_date&&t.start_date<=end&&t.end_date>=start)||(due&&due>=start&&due<=end);
}
function trainingEmployeeMatchesSearch(employee,query=''){
  const q=String(query||'').trim().toLowerCase();
  if(!q)return true;
  return [employee?.name,employee?.role].filter(Boolean).join(' ').toLowerCase().includes(q);
}
function trainingViewEmployeeSearch(){
  return (document.getElementById('trainingSearchInput')?.value||'').trim().toLowerCase();
}
function trainingTeamStatusEmployeeSearch(){
  return (document.getElementById('trainingTeamStatusSearch')?.value||'').trim().toLowerCase();
}
function trainingIsLongProgram(t){
  if(!t||t.date_precision==='year'||!t.start_date||!t.end_date)return false;
  const start=trainingDate(t.start_date),end=trainingDate(t.end_date);
  if(!start||!end)return false;
  return Math.round((end-start)/86400000)+1>31;
}
function filteredTrainings(){
  const search=(document.getElementById('trainingSearchInput')?.value||'').trim().toLowerCase();
  const empFilter=sessionRole==='employee'?sessionEmployeeId:(document.getElementById('trainingEmployeeFilter')?.value||'');
  const status=document.getElementById('trainingStatusFilter')?.value||'';
  const typeFilter=document.getElementById('trainingTypeFilter')?.value||'';
  const categoryFilter=document.getElementById('trainingCategoryFilter')?.value||'';
  return trainingItemsWithProjections(trainingYear).filter(t=>{
    if(!trainingIntersectsYear(t))return false;
    if(empFilter&&t.employee_id!==empFilter)return false;
    if(typeFilter&&t.type_id!==typeFilter)return false;
    if(categoryFilter&&t.category!==categoryFilter)return false;
    if(search&&!([t.title,t.category,t.provider,trainingEmployeeName(t.employee_id)].join(' ').toLowerCase().includes(search)))return false;
    if(status==='due'&&trainingDueState(t)!=='due')return false;
    if(status==='overdue'&&trainingDueState(t)!=='overdue')return false;
    if(status&& !['due','overdue'].includes(status) && t.status!==status)return false;
    return true;
  }).sort((a,b)=>{
    const ad=a.date_precision==='year'?String(a.training_year)+'-99-99':(a.start_date||'9999-99-99');
    const bd=b.date_precision==='year'?String(b.training_year)+'-99-99':(b.start_date||'9999-99-99');
    return ad.localeCompare(bd)||a.title.localeCompare(b.title);
  });
}
function trainingForEmployeeDate(empId,key){
  return trainings.filter(t=>{
    if(t.employee_id!==empId||t.status==='cancelled'||t.date_precision==='year'||!t.start_date||!t.end_date)return false;
    if(trainingIsLongProgram(t))return false;
    const start=trainingDate(t.start_date),end=trainingDate(t.end_date);
    if(!start||!end)return false;
    return t.start_date<=key&&t.end_date>=key;
  });
}
function trainingHasVacationConflict(empId,start,end){
  if(!empId||!start||!end)return [];
  const out=[];
  const d=trainingDate(start),last=trainingDate(end);if(!d||!last)return out;
  for(let x=new Date(d);x<=last;x.setDate(x.getDate()+1)){
    const key=dateKey(x),v=entryFor(empId,key);
    if(entryIsActive(v)&&(v.codes||[]).some(c=>['U','XU','S'].includes(c)))out.push({key,codes:(v.codes||[]).filter(c=>['U','XU','S'].includes(c))});
  }
  return out;
}
function formatTrainingDateRange(t){
  if(t.date_precision==='year')return 'Termin '+t.training_year+' noch offen';
  const a=trainingDate(t.start_date),b=trainingDate(t.end_date);
  if(!a||!b)return '';
  const fmt=d=>d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const dateText=t.start_date===t.end_date?fmt(a):fmt(a)+' – '+fmt(b);
  const timeText=trainingTimeLabel(t);
  return dateText+(timeText?' · '+timeText:'');
}
function euro(n){return Number(n||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'})}

function switchModule(module,silent=false){
  if(sessionRole==='external')module='projects';
  currentModule=['training','projects'].includes(module)?module:'vacation';
  localStorage.setItem('teamplan-module',currentModule);
  if(currentModule!=='vacation'&&document.body.classList.contains('planner-focus'))exitPlannerFocus();
  if(currentModule!=='training'&&document.body.classList.contains('training-focus'))exitTrainingFocus();
  const vacation=currentModule==='vacation',training=currentModule==='training',projects=currentModule==='projects';
  ['vacationToolbar','monthView','plannerFocusControls','yearView','vacationHint'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(id==='monthView')el.classList.toggle('hidden',!vacation||currentView==='year');
    else if(id==='yearView')el.classList.toggle('hidden',!vacation||currentView!=='year');
    else if(id==='plannerFocusControls')el.classList.toggle('module-hidden',!vacation);
    else el.classList.toggle('hidden',!vacation);
  });
  document.getElementById('trainingModule')?.classList.toggle('hidden',!training);
  document.getElementById('projectsModule')?.classList.toggle('hidden',!projects);
  document.getElementById('moduleVacationBtn')?.classList.toggle('active',vacation);
  document.getElementById('moduleTrainingBtn')?.classList.toggle('active',training);
  document.getElementById('moduleProjectsBtn')?.classList.toggle('active',projects);
  document.body.classList.toggle('training-module-active',training);
  document.body.classList.toggle('vacation-module-active',vacation);
  document.body.classList.toggle('projects-module-active',projects);
  if(training)renderTrainingModule();
  if(projects)renderProjectModule();
  if(!silent)showToast(vacation?'Urlaubsplanung':training?'Fortbildungsplaner':'Projektmanagement');
}
function applyTrainingRoleUI(){
  document.querySelectorAll('.training-manager-action').forEach(el=>el.classList.toggle('hidden',!trainingCanManage()));
  const filter=document.getElementById('trainingEmployeeFilter');
  const own=document.getElementById('trainingOwnScope');
  if(filter)filter.classList.toggle('hidden',sessionRole==='employee');
  if(own)own.classList.toggle('hidden',sessionRole!=='employee');
}
function populateTrainingControls(){
  const yearSelect=document.getElementById('trainingYearSelect');
  if(yearSelect){
    if(!yearSelect.options.length){for(let y=2025;y<=2035;y++){const o=document.createElement('option');o.value=String(y);o.textContent=String(y);yearSelect.appendChild(o)}}
    yearSelect.value=String(trainingYear);
  }
  const employees=trainingVisibleEmployees();
  const filter=document.getElementById('trainingEmployeeFilter');
  if(filter){
    const old=filter.value;
    filter.innerHTML='<option value="">Alle Mitarbeiter</option>'+employees.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
    if([...filter.options].some(o=>o.value===old))filter.value=old;
  }
  const employee=document.getElementById('trainingEmployee');
  if(employee)employee.innerHTML=employees.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
  const activeTypes=trainingTypes.filter(t=>t.active!==false);
  const type=document.getElementById('trainingType');
  if(type){
    const old=type.value;
    type.innerHTML='<option value="">Freier Eintrag</option>'+activeTypes.map(t=>'<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>').join('');
    if([...type.options].some(o=>o.value===old))type.value=old;
  }
  const typeFilter=document.getElementById('trainingTypeFilter');
  if(typeFilter){
    const old=typeFilter.value;
    typeFilter.innerHTML='<option value="">Alle Fortbildungen</option>'+activeTypes.map(t=>'<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>').join('');
    if([...typeFilter.options].some(o=>o.value===old))typeFilter.value=old;
  }
  const categories=[...new Set(activeTypes.map(t=>t.category).filter(Boolean).concat(trainings.map(t=>t.category).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'de'));
  const categoryFilter=document.getElementById('trainingCategoryFilter');
  if(categoryFilter){
    const old=categoryFilter.value;
    categoryFilter.innerHTML='<option value="">Alle Arten</option>'+categories.map(c=>'<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>').join('');
    if([...categoryFilter.options].some(o=>o.value===old))categoryFilter.value=old;
  }
  const teamType=document.getElementById('trainingTeamStatusType');
  if(teamType){
    teamType.innerHTML='<option value="__all__">Alle Fortbildungen</option>'+activeTypes.map(t=>'<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>').join('');
    if(!trainingTeamStatusTypeId||(!activeTypes.some(t=>t.id===trainingTeamStatusTypeId)&&trainingTeamStatusTypeId!=='__all__'))trainingTeamStatusTypeId='__all__';
    teamType.value=trainingTeamStatusTypeId;
  }
  const teamYear=document.getElementById('trainingTeamStatusYear');
  if(teamYear){
    if(!teamYear.options.length){for(let y=2025;y<=2035;y++){const o=document.createElement('option');o.value=String(y);o.textContent=String(y);teamYear.appendChild(o)}}
    teamYear.value=String(trainingTeamStatusYear);
  }
  const teamSort=document.getElementById('trainingTeamStatusSort');if(teamSort)teamSort.value=trainingTeamStatusSort;
  const mf=document.getElementById('trainingMultiYearFrom'),mt=document.getElementById('trainingMultiYearTo');
  if(mf)mf.value=String(trainingMultiYearFrom);if(mt)mt.value=String(trainingMultiYearTo);
}
async function loadTrainingData(){
  if(!supabaseClient||!authUser)return;
  const cfg=window.TEAMPLAN_CONFIG||{};
  const [typesRes,trainingRes,budgetRes]=await Promise.all([
    supabaseClient.from('teamplan_training_types').select('*').eq('team_id',cfg.teamId).order('name'),
    supabaseClient.from('teamplan_trainings').select('*').eq('team_id',cfg.teamId).order('start_date'),
    supabaseClient.from('teamplan_training_budgets').select('*').eq('team_id',cfg.teamId).order('year')
  ]);
  if(typesRes.error)throw typesRes.error;if(trainingRes.error)throw trainingRes.error;if(budgetRes.error)throw budgetRes.error;
  trainingTypes=typesRes.data||[];trainings=trainingRes.data||[];trainingBudgets=budgetRes.data||[];
  populateTrainingControls();applyTrainingRoleUI();renderTrainingModule();render();switchModule(currentModule,true);
}
async function startTrainingRealtime(){
  if(!supabaseClient||!authUser)return;
  if(trainingChannel){try{await supabaseClient.removeChannel(trainingChannel)}catch{}}
  const cfg=window.TEAMPLAN_CONFIG||{};
  trainingChannel=supabaseClient.channel('teamplan-training-live-'+cfg.teamId)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_trainings'},loadTrainingData)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_training_types'},loadTrainingData)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_training_budgets'},loadTrainingData)
    .subscribe();
}
async function stopTrainingRealtime(){
  if(trainingChannel){try{await supabaseClient.removeChannel(trainingChannel)}catch{}}
  trainingChannel=null;trainingTypes=[];trainings=[];trainingBudgets=[];renderTrainingModule();
}
function trainingEntryHtml(t){
  const emp=trainingEmployeeName(t.employee_id),due=trainingDueDate(t),dueState=trainingDueState(t),conf=t._virtual?[]:trainingHasVacationConflict(t.employee_id,t.start_date,t.end_date);
  const yearOnly=t.date_precision==='year',recurrence=trainingRecurrenceLabel(t);
  const dateMain=yearOnly?'?':new Date(t.start_date+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  const dateSub=yearOnly?String(t.training_year):String(new Date(t.start_date+'T12:00:00').getFullYear());
  const sourceId=t._sourceId||t.id;
  return '<article class="training-entry '+(trainingCanManage()&&!t._virtual?'editable':'')+(yearOnly?' year-only':'')+(t._virtual?' virtual':'')+'" style="--training-color:'+escapeHtml(trainingColor(t))+'" data-training-id="'+sourceId+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'>'+
    '<div class="training-entry-date"><strong>'+escapeHtml(dateMain)+'</strong><span>'+escapeHtml(dateSub)+'</span></div>'+
    '<div class="training-entry-main"><div class="training-entry-title"><strong>'+escapeHtml(t.title)+'</strong><span class="training-status '+(dueState||t.status)+'">'+escapeHtml(t._virtual?'Vorschau':trainingStatusLabel(t))+'</span></div>'+
    '<span><i class="training-kind-dot"></i>'+escapeHtml(emp)+' · '+escapeHtml(t.category||'Fortbildung')+' · '+escapeHtml(formatTrainingDateRange(t))+'</span>'+
    '<small>'+[recurrence,Number(t.hours)?formatVacationNumber(t.hours)+' h':'',Number(t.cost)?euro(t.cost):'',t.provider, due?'gültig bis '+new Date(due+'T12:00:00').toLocaleDateString('de-DE'):'' ].filter(Boolean).map(escapeHtml).join(' · ')+'</small>'+
    (conf.length?'<em class="training-conflict">! '+conf.length+' Überschneidung'+(conf.length===1?'':'en')+' mit Abwesenheit</em>':'')+
    '</div></article>';
}
function trainingStatusDropzonesHtml(){
  if(!trainingCanManage())return '';
  return '<span>Hierher ziehen:</span>'+
    '<div class="training-status-dropzone planned" data-training-drop-status="planned">Geplant</div>'+
    '<div class="training-status-dropzone in-progress" data-training-drop-status="in_progress">In Durchführung</div>'+
    '<div class="training-status-dropzone completed" data-training-drop-status="completed">Absolviert</div>'+
    '<div class="training-status-dropzone cancelled" data-training-drop-status="cancelled">Abgesagt</div>';
}
function renderTrainingDropzones(){
  ['trainingOverviewDropzones','trainingCalendarDropzones','trainingClassicDropzones'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.innerHTML=trainingStatusDropzonesHtml();
  });
}
async function updateTrainingStatusByDrop(id,status){
  if(!trainingCanManage()||!id||!['planned','in_progress','completed','cancelled'].includes(status))return;
  const {error}=await supabaseClient.from('teamplan_trainings').update({status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){alert(error.message);return}
  await loadTrainingData();showToast(status==='completed'?'Als absolviert markiert':status==='in_progress'?'Auf In Durchführung gesetzt':status==='cancelled'?'Als abgesagt markiert':'Auf geplant gesetzt');
}
function bindTrainingDragDrop(){
  if(!trainingCanManage())return;
  document.querySelectorAll('[draggable="true"][data-training-id]').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.effectAllowed='copyMove';
      e.dataTransfer.setData('text/training-id',el.dataset.trainingId);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  });
  document.querySelectorAll('[data-training-drop-status]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over')});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();zone.classList.remove('drag-over');
      const id=e.dataTransfer.getData('text/training-id');
      if(id)updateTrainingStatusByDrop(id,zone.dataset.trainingDropStatus);
    });
  });
  document.querySelectorAll('.training-my-cell').forEach(cell=>{
    cell.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/training-id')){e.preventDefault();cell.classList.add('drag-over')}});
    cell.addEventListener('dragleave',()=>cell.classList.remove('drag-over'));
    cell.addEventListener('drop',e=>{
      const id=e.dataTransfer.getData('text/training-id');if(!id)return;
      e.preventDefault();e.stopPropagation();cell.classList.remove('drag-over');
      const duplicate=!!(e.altKey||e.ctrlKey||e.metaKey);
      moveOrDuplicateTraining(id,{employeeId:cell.dataset.employee,year:Number(cell.dataset.year)},duplicate);
    });
  });
  document.querySelectorAll('.training-day').forEach(day=>{
    day.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/training-id')){e.preventDefault();day.classList.add('drag-over')}});
    day.addEventListener('dragleave',()=>day.classList.remove('drag-over'));
    day.addEventListener('drop',e=>{
      const id=e.dataTransfer.getData('text/training-id');if(!id)return;
      e.preventDefault();e.stopPropagation();day.classList.remove('drag-over');
      const duplicate=!!(e.altKey||e.ctrlKey||e.metaKey);
      moveOrDuplicateTraining(id,{date:day.dataset.date},duplicate);
    });
  });
}
function renderTrainingMetrics(items){
  const box=document.getElementById('trainingMetrics');if(!box)return;
  const planned=items.filter(t=>t.status==='planned').length;
  const running=items.filter(t=>t.status==='in_progress').length;
  const due=items.filter(t=>trainingDueState(t)==='due').length;
  const overdue=items.filter(t=>trainingDueState(t)==='overdue').length;
  const undated=items.filter(t=>t.status!=='cancelled'&&t.date_precision==='year').length;
  box.innerHTML=
    '<article><span>In Durchführung</span><strong>'+running+'</strong><small>läuft aktuell</small></article>'+
    '<article><span>Geplant</span><strong>'+planned+'</strong><small>'+trainingYear+'</small></article>'+
    '<article class="'+(overdue?'metric-alert':'')+'"><span>Handlungsbedarf</span><strong>'+due+' / '+overdue+'</strong><small>bald / überfällig</small></article>'+
    '<article><span>Termin offen</span><strong>'+undated+'</strong><small>nur Jahr bekannt</small></article>';
}
function renderTrainingOverview(items){
  renderTrainingMetrics(items);
  const today=dateKey(new Date());
  const running=items.filter(t=>t.status==='in_progress').sort((a,b)=>(a.start_date||String(a.training_year)+'-01-01').localeCompare(b.start_date||String(b.training_year)+'-01-01')).slice(0,30);
  const upcoming=items.filter(t=>t.status==='planned'&&(t.date_precision==='year'?Number(t.training_year)>=new Date().getFullYear():(t.end_date&&t.end_date>=today))).sort((a,b)=>{
    const ad=a.date_precision==='year'?String(a.training_year)+'-99-99':(a.start_date||'9999-99-99');
    const bd=b.date_precision==='year'?String(b.training_year)+'-99-99':(b.start_date||'9999-99-99');
    return ad.localeCompare(bd);
  }).slice(0,30);
  const due=items.filter(t=>['due','overdue'].includes(trainingDueState(t))).sort((a,b)=>(trainingDueDate(a)||'9999').localeCompare(trainingDueDate(b)||'9999')).slice(0,30);
  const run=document.getElementById('trainingRunningList'),up=document.getElementById('trainingUpcomingList'),dl=document.getElementById('trainingDueList');
  if(run)run.innerHTML=running.length?running.map(trainingEntryHtml).join(''):'<div class="empty-state success-state">Aktuell läuft keine Fortbildung.</div>';
  if(up)up.innerHTML=upcoming.length?upcoming.map(trainingEntryHtml).join(''):'<div class="empty-state">Keine geplanten Fortbildungen.</div>';
  if(dl)dl.innerHTML=due.length?due.map(trainingEntryHtml).join(''):'<div class="empty-state success-state">Kein akuter Handlungsbedarf.</div>';
}
function trainingItemsForMonth(items,year,month){
  const first=year+'-'+String(month+1).padStart(2,'0')+'-01';
  const last=year+'-'+String(month+1).padStart(2,'0')+'-'+String(new Date(year,month+1,0).getDate()).padStart(2,'0');
  return items.filter(t=>t.date_precision!=='year'&&t.start_date&&t.end_date&&t.start_date<=last&&t.end_date>=first);
}
function renderTrainingCalendar(items){
  const box=document.getElementById('trainingYearCalendar');if(!box)return;
  const undated=items.filter(t=>t.date_precision==='year'&&Number(t.training_year)===Number(trainingYear));
  const undatedCollapsed=localStorage.getItem('teamplan-training-undated-collapsed')==='1';
  const undatedHtml=undated.length?'<article class="training-undated glass '+(undatedCollapsed?'collapsed':'')+'"><button type="button" class="training-undated-toggle" data-training-undated-toggle aria-expanded="'+(!undatedCollapsed)+'"><span><strong>Termin noch offen</strong><small>Fortbildungen ohne konkretes Datum</small></span><span class="training-undated-toggle-meta"><b>'+undated.length+'</b><i aria-hidden="true">⌄</i></span></button><div class="training-month-items">'+undated.map(t=>{
    const rec=trainingRecurrenceLabel(t);
    return '<button type="button" class="training-month-item undated compact '+t.status+(t._virtual?' virtual':'')+'" style="--training-color:'+escapeHtml(trainingColor(t))+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'><i class="training-undated-color"></i><span class="training-undated-main"><b>'+escapeHtml(t.title)+(rec?' <span class="training-repeat-inline">↻</span>':'')+'</b><small><strong>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</strong>'+(rec?' · '+escapeHtml(rec):'')+'</small></span><span class="training-undated-year">'+escapeHtml(String(t.training_year))+'</span></button>';
  }).join('')+'</div></article>':'';
  box.innerHTML=undatedHtml+MONTHS.map((month,m)=>{
    const monthItems=trainingItemsForMonth(items,trainingYear,m);
    const programItems=monthItems.filter(trainingIsLongProgram);
    const dayItems=monthItems.filter(t=>!trainingIsLongProgram(t));
    const cost=monthItems.filter((t,i,a)=>a.findIndex(x=>(x._sourceId||x.id)===(t._sourceId||t.id))===i).reduce((s,t)=>s+Number(t.cost||0),0);
    const monthList=[...monthItems].sort((a,b)=>(a.start_date||'9999-99-99').localeCompare(b.start_date||'9999-99-99')||a.title.localeCompare(b.title));
    const monthListHtml=monthList.length?'<div class="training-month-list">'+monthList.map(t=>'<button type="button" class="training-month-list-item '+t.status+(t._virtual?' virtual':'')+'" style="--training-color:'+escapeHtml(trainingColor(t))+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'"><i></i><span><b>'+escapeHtml(t.title)+'</b><small>'+escapeHtml(trainingEmployeeName(t.employee_id))+' · '+escapeHtml(formatTrainingDateRange(t))+(trainingRecurrenceLabel(t)?' · '+escapeHtml(trainingRecurrenceLabel(t)):'')+'</small></span></button>').join('')+'</div>':'';
    const firstDow=(new Date(trainingYear,m,1).getDay()+6)%7,days=new Date(trainingYear,m+1,0).getDate();
    let cells='';
    for(let i=0;i<firstDow;i++)cells+='<span class="training-day blank"></span>';
    for(let day=1;day<=days;day++){
      const key=trainingYear+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      const matches=dayItems.filter(t=>t.start_date<=key&&t.end_date>=key),realMatches=matches.filter(t=>!t._virtual);
      const uniqueReal=[...new Map(realMatches.map(t=>[t.id,t])).values()];
      const statusClass=matches.some(t=>t.status==='in_progress')?'in-progress':matches.some(t=>t.status==='completed')?'completed':matches.some(t=>t.status==='planned')?'planned':matches.length?'cancelled':'';
      const titles=matches.map(t=>trainingEmployeeName(t.employee_id)+': '+t.title).join(' · ');
      const dragAttrs=trainingCanManage()&&uniqueReal.length===1?' draggable="true" data-training-id="'+uniqueReal[0].id+'"':'';
      const colorStyle=matches.length===1?' style="--training-color:'+escapeHtml(trainingColor(matches[0]))+'"':'';
      const quickTitle=(matches.length?titles+' · ':'')+'Klicken: Fortbildung am '+new Date(key+'T12:00:00').toLocaleDateString('de-DE')+' planen';
      cells+='<button type="button" class="training-day training-day-quick '+(matches.length?'has-training '+statusClass:'')+'" data-date="'+key+'" title="'+escapeHtml(quickTitle)+'" aria-label="'+escapeHtml('Fortbildung am '+new Date(key+'T12:00:00').toLocaleDateString('de-DE')+' planen')+'"'+colorStyle+dragAttrs+'><span>'+day+'</span>'+(matches.length?'<b>'+matches.length+'</b>':'')+'</button>';
    }
    return '<article class="training-month training-calendar-month glass"><div class="training-month-head"><strong>'+month+'</strong><span>'+monthItems.length+' · '+escapeHtml(euro(cost))+'</span></div>'+monthListHtml+'<div class="training-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="training-day-grid">'+cells+'</div></article>';
  }).join('');
}
function trainingItemsForEmployeeYear(empId,year){
  return trainingItemsWithProjections(year).filter(t=>t.employee_id===empId&&trainingIntersectsYear(t,year));
}
function renderTrainingMultiYear(){
  const box=document.getElementById('trainingMultiYearGrid');if(!box)return;
  const from=Math.min(trainingMultiYearFrom,trainingMultiYearTo),to=Math.max(trainingMultiYearFrom,trainingMultiYearTo);
  const years=[];for(let y=from;y<=to;y++)years.push(y);
  const employees=trainingVisibleEmployees();
  let html='<div class="training-multiyear-table" style="--year-count:'+years.length+'"><div class="training-my-corner">Mitarbeiter</div>'+years.map(y=>'<div class="training-my-year">'+y+'</div>').join('');
  employees.forEach(e=>{
    html+='<div class="training-my-employee" data-training-employee-row="'+e.id+'" '+(trainingCanManage()?'draggable="true"':'')+'><strong>'+escapeHtml(e.name)+'</strong><span>'+escapeHtml(e.role||'Mitarbeiter')+(trainingCanManage()?' · ziehen zum Sortieren':'')+'</span></div>';
    years.forEach(y=>{
      const rows=trainingItemsForEmployeeYear(e.id,y);
      html+='<div class="training-my-cell" data-employee="'+e.id+'" data-year="'+y+'">'+
        (trainingCanManage()?'<button type="button" class="training-my-add" data-training-add-employee="'+e.id+'" data-training-add-year="'+y+'">+ Fortbildung</button>':'')+
        rows.map(t=>{
          const recurrence=trainingRecurrenceLabel(t),multi=t.date_precision!=='year'&&t.start_date&&t.end_date&&t.start_date.slice(0,4)!==t.end_date.slice(0,4);
          return '<button type="button" class="training-my-item '+t.status+(t._virtual?' virtual':'')+'" style="--training-color:'+escapeHtml(trainingColor(t))+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" data-training-employee="'+e.id+'" data-training-type="'+(t.type_id||'')+'" data-training-year="'+y+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'><b>'+(t._virtual?'◇ ':'● ')+escapeHtml(t.title)+'</b><small>'+escapeHtml(t._virtual?'voraussichtlich':trainingStatusLabel(t))+(recurrence?' · '+escapeHtml(recurrence):'')+(multi?' · ↔ mehrjährig':'')+'</small></button>';
        }).join('')+
      '</div>';
    });
  });
  box.innerHTML=html+'</div>';
}
function teamStatusItemFor(empId,typeId,year){
  const candidates=trainingItemsWithProjections(year).filter(t=>t.employee_id===empId&&t.type_id===typeId&&trainingIntersectsYear(t,year));
  const real=candidates.filter(t=>!t._virtual);
  const completed=real.find(t=>t.status==='completed');
  if(completed)return {state:'completed',item:completed};
  const inProgress=real.find(t=>t.status==='in_progress');
  if(inProgress)return {state:'in_progress',item:inProgress};
  const planned=real.find(t=>t.status==='planned');
  if(planned)return {state:'planned',item:planned};
  const virtual=candidates.find(t=>t._virtual);
  if(virtual)return {state:'planned',item:virtual,virtual:true};
  return {state:'open',item:null};
}
function uiIcon(name){return '<svg class="ui-icon" aria-hidden="true"><use href="#i-'+name+'"></use></svg>'}
function trainingWriteRow(t){
  return {
    team_id:t.team_id,employee_id:t.employee_id,type_id:t.type_id||null,title:t.title,category:t.category||'Fortbildung',
    date_precision:t.date_precision||'exact',training_year:Number(t.training_year||((t.start_date||'').slice(0,4))||trainingYear),
    start_date:t.start_date||null,end_date:t.end_date||null,start_time:t.start_time||null,end_time:t.end_time||null,recurring:!!t.recurring,
    recurrence_unit:t.recurring?(t.recurrence_unit||'months'):'months',
    recurrence_interval:t.recurring?Number(t.recurrence_interval||t.recurrence_months||0)||null:null,
    recurrence_months:t.recurring&&trainingRecurrenceUnit(t)==='months'?Number(t.recurrence_interval||t.recurrence_months||0)||null:null,
    recurrence_weekday:t.recurring&&trainingRecurrenceUnit(t)==='weeks'?Number(t.recurrence_weekday||0)||null:null,
    recurrence_until:t.recurring&&trainingRecurrenceUnit(t)==='weeks'?(t.recurrence_until||null):null,status:t.status||'planned',
    hours:Number(t.hours||0),cost:Number(t.cost||0),provider:t.provider||'',valid_until:t.valid_until||null,
    note:t.note||'',updated_at:new Date().toISOString()
  };
}
function shiftTrainingIsoYear(value,delta){
  if(!value)return null;
  const d=new Date(value+'T12:00:00'),month=d.getMonth(),day=d.getDate();
  d.setDate(1);d.setFullYear(d.getFullYear()+delta);d.setMonth(month);
  d.setDate(Math.min(day,new Date(d.getFullYear(),month+1,0).getDate()));
  return dateKey(d);
}
async function moveOrDuplicateTraining(id,{employeeId='',year=null,date=''}={},duplicate=false){
  if(!trainingCanManage())return;
  const source=trainings.find(t=>t.id===id);if(!source)return;
  const row=trainingWriteRow(source);
  if(employeeId)row.employee_id=employeeId;
  if(date){
    const target=trainingDate(date);if(!target)return;
    if(source.date_precision==='exact'&&source.start_date&&source.end_date){
      const duration=Math.max(0,Math.round((trainingDate(source.end_date)-trainingDate(source.start_date))/86400000));
      row.date_precision='exact';row.start_date=date;row.end_date=dateKey(addDays(target,duration));row.training_year=target.getFullYear();
    }else{
      row.date_precision='exact';row.start_date=date;row.end_date=date;row.training_year=target.getFullYear();
    }
  }else if(year){
    const targetYear=Number(year);
    if(source.date_precision==='year'){
      row.training_year=targetYear;row.start_date=null;row.end_date=null;
    }else if(source.start_date&&source.end_date){
      const baseYear=Number(source.start_date.slice(0,4)),delta=targetYear-baseYear;
      row.start_date=shiftTrainingIsoYear(source.start_date,delta);
      row.end_date=shiftTrainingIsoYear(source.end_date,delta);
      row.training_year=targetYear;
    }
  }
  let res;
  if(duplicate)res=await supabaseClient.from('teamplan_trainings').insert(row);
  else res=await supabaseClient.from('teamplan_trainings').update(row).eq('id',id);
  if(res.error){alert(res.error.message);return}
  await loadTrainingData();
  showToast(duplicate?'Fortbildung dupliziert':'Fortbildung verschoben');
}
function openTrainingDuplicate(id){
  const t=trainings.find(x=>x.id===id);if(!t||!trainingCanManage())return;
  openTraining(id);
  document.getElementById('trainingId').value='';
  document.getElementById('trainingDialogTitle').textContent='Fortbildung duplizieren';
}
async function setTeamStatusEmployee(empId,typeId,year,status){
  if(!trainingCanManage()||!empId||!typeId||typeId==='__all__')return;
  const real=trainings.find(t=>t.employee_id===empId&&t.type_id===typeId&&!t._virtual&&trainingIntersectsYear(t,year));
  if(real){
    const {error}=await supabaseClient.from('teamplan_trainings').update({status,updated_at:new Date().toISOString()}).eq('id',real.id);
    if(error){alert(error.message);return}
    await loadTrainingData();showToast(status==='completed'?'Als absolviert markiert':status==='in_progress'?'Als in Durchführung markiert':'Fortbildung eingeplant');return;
  }
  await quickCreateTrainingStatus(empId,typeId,year,status);
}
function renderTrainingTeamStatusAll(types,employees){
  const metrics=document.getElementById('trainingTeamStatusMetrics'),board=document.getElementById('trainingTeamStatusBoard');
  const matrix=types.flatMap(type=>employees.map(employee=>({type,employee,...teamStatusItemFor(employee.id,type.id,trainingTeamStatusYear)})));
  const completed=matrix.filter(x=>x.state==='completed').length,running=matrix.filter(x=>x.state==='in_progress').length,planned=matrix.filter(x=>x.state==='planned').length,open=matrix.filter(x=>x.state==='open').length,total=matrix.length;
  metrics.innerHTML='<article><span>Fortbildungen</span><strong>'+types.length+'</strong></article><article><span>In Durchführung</span><strong>'+running+'</strong></article><article><span>Absolviert</span><strong>'+completed+'</strong></article><article><span>Noch offen</span><strong>'+open+'</strong></article>';
  const pool='<section class="training-teamstatus-pool"><header><div><strong>Mitarbeiter</strong><span>Auf eine Fortbildung ziehen → sofort vormerken</span></div></header><div>'+
    employees.map(e=>'<div class="training-employee-chip" draggable="'+(trainingCanManage()?'true':'false')+'" data-teamstatus-employee-drag="'+e.id+'"><span>'+uiIcon('users')+'</span><b>'+escapeHtml(e.name)+'</b>'+(trainingCanManage()?'<button type="button" class="training-employee-edit-inline" data-employee-edit="'+e.id+'" title="Mitarbeiter bearbeiten">'+uiIcon('edit')+'</button>':'')+'</div>').join('')+'</div></section>';
  const cards='<div class="training-teamstatus-all-grid">'+types.map(type=>{
    const rows=matrix.filter(x=>x.type.id===type.id),c=rows.filter(x=>x.state==='completed').length,r=rows.filter(x=>x.state==='in_progress').length,p=rows.filter(x=>x.state==='planned').length,o=rows.filter(x=>x.state==='open').length,coverage=rows.length?Math.round(c/rows.length*100):0;
    return '<article class="training-teamstatus-type-card" style="--training-color:'+escapeHtml(type.color||trainingCategoryFallbackColor(type.category))+'" data-teamstatus-type-drop="'+type.id+'" data-teamstatus-year="'+trainingTeamStatusYear+'"><header><div><strong>'+escapeHtml(type.name)+'</strong><span>'+escapeHtml(type.category||'Fortbildung')+(trainingTypeSeriesLabel(type)?' · '+escapeHtml(trainingTypeSeriesLabel(type)):(type.interval_months?' · '+type.interval_months+' Monate':''))+'</span></div><b>'+coverage+' %</b></header><div class="training-type-card-stats"><span><b>'+c+'</b> absolviert</span><span><b>'+r+'</b> läuft</span><span><b>'+p+'</b> geplant</span><span><b>'+o+'</b> offen</span></div><div class="training-type-drop-hint">'+uiIcon('plus')+' Mitarbeiter hierher ziehen</div><button type="button" class="training-type-open-btn" data-teamstatus-open-type="'+type.id+'">Details öffnen</button></article>';
  }).join('')+'</div>';
  board.className='training-teamstatus-board all-mode';
  board.innerHTML=pool+cards;
}
function renderTrainingTeamStatus(){
  const metrics=document.getElementById('trainingTeamStatusMetrics'),board=document.getElementById('trainingTeamStatusBoard');
  if(!metrics||!board)return;
  const types=trainingTypes.filter(t=>t.active!==false),teamSearch=trainingTeamStatusEmployeeSearch(),employees=trainingVisibleEmployees().filter(e=>trainingEmployeeMatchesSearch(e,teamSearch));
  if(!types.length){metrics.innerHTML='';board.innerHTML='<div class="empty-state">Bitte zuerst eine Fortbildungsart im Katalog anlegen.</div>';return}
  if(trainingTeamStatusTypeId==='__all__'){renderTrainingTeamStatusAll(types,employees);return}
  const type=trainingTypeById(trainingTeamStatusTypeId);
  if(!type){trainingTeamStatusTypeId='__all__';renderTrainingTeamStatusAll(types,employees);return}
  let rows=employees.map(e=>({employee:e,...teamStatusItemFor(e.id,type.id,trainingTeamStatusYear)}));
  if(trainingTeamStatusSort==='name')rows.sort((a,b)=>a.employee.name.localeCompare(b.employee.name,'de'));
  else rows.sort((a,b)=>({completed:0,in_progress:1,planned:2,open:3}[a.state]-({completed:0,in_progress:1,planned:2,open:3}[b.state])||a.employee.name.localeCompare(b.employee.name,'de')));
  const completed=rows.filter(r=>r.state==='completed'),running=rows.filter(r=>r.state==='in_progress'),planned=rows.filter(r=>r.state==='planned'),open=rows.filter(r=>r.state==='open'),coverage=rows.length?Math.round(completed.length/rows.length*100):0;
  metrics.innerHTML='<article><span>Teamabdeckung</span><strong>'+coverage+' %</strong></article><article><span>In Durchführung</span><strong>'+running.length+'</strong></article><article><span>Absolviert</span><strong>'+completed.length+'</strong></article><article><span>Noch offen</span><strong>'+open.length+'</strong></article>';
  const col=(title,arr,state)=>'<section class="training-teamstatus-column '+state+'" data-teamstatus-drop-state="'+state+'" data-training-type="'+type.id+'" data-training-year="'+trainingTeamStatusYear+'"><header><strong>'+title+'</strong><b>'+arr.length+'</b></header><div>'+ (arr.length?arr.map(r=>{
    const t=r.item;
    return '<article class="training-teamstatus-person" draggable="'+(trainingCanManage()?'true':'false')+'" data-teamstatus-employee-drag="'+r.employee.id+'" data-training-employee="'+r.employee.id+'" data-training-type="'+type.id+'" data-training-year="'+trainingTeamStatusYear+'" '+(t&&!t._virtual?'data-training-id="'+t.id+'"':'')+'><div><strong>'+escapeHtml(r.employee.name)+'</strong><span>'+escapeHtml(r.employee.role||'Mitarbeiter')+' · '+(t?escapeHtml(t._virtual?'Wiederholung vorgemerkt':formatTrainingDateRange(t)):'noch kein Eintrag')+'</span></div><div class="training-person-buttons">'+(trainingCanManage()?'<button type="button" class="training-employee-edit-inline" data-employee-edit="'+r.employee.id+'" title="Mitarbeiter bearbeiten">'+uiIcon('edit')+'</button>':'')+'<button type="button" class="training-person-action" title="Schnellaktionen">•••</button></div></article>';
  }).join(''):'<div class="empty-state">'+(state==='completed'?'Noch niemand absolviert.':state==='in_progress'?'Niemand in Durchführung.':state==='planned'?'Niemand in Planung.':'Alle berücksichtigt.')+'</div>')+'</div></section>';
  board.className='training-teamstatus-board';
  board.innerHTML=col('Absolviert',completed,'completed')+col('In Durchführung',running,'in_progress')+col('In Planung',planned,'planned')+col('Noch ohne Eintrag',open,'open');
}
function renderTrainingClassic(items){
  const body=document.getElementById('trainingClassicBody');if(!body)return;
  body.innerHTML=items.length?items.map(t=>{
    const due=trainingDueDate(t),rec=trainingRecurrenceLabel(t)||'—';
    return '<tr class="'+(t._virtual?'virtual':'')+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'>'+
      '<td>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</td>'+
      '<td class="training-classic-title" style="--training-color:'+escapeHtml(trainingColor(t))+'"><strong><i class="training-kind-dot"></i>'+escapeHtml(t.title)+'</strong><small>'+escapeHtml(t.category||'')+'</small></td>'+
      '<td>'+escapeHtml(formatTrainingDateRange(t))+'</td>'+
      '<td><span class="training-repeat-badge '+(t.recurring?'active':'')+'">'+escapeHtml(rec)+'</span></td>'+
      '<td><span class="training-status '+(trainingDueState(t)||t.status)+'">'+escapeHtml(t._virtual?'Vorschau':trainingStatusLabel(t))+'</span></td>'+
      '<td>'+formatVacationNumber(t.hours||0)+'</td>'+
      '<td>'+escapeHtml(euro(t.cost||0))+'</td>'+
      '<td>'+(due?escapeHtml(new Date(due+'T12:00:00').toLocaleDateString('de-DE')):'—')+'</td>'+
      '</tr>';
  }).join(''):'<tr><td colspan="8"><div class="empty-state">Keine Fortbildungen gefunden.</div></td></tr>';
}
function renderTrainingEmployees(items){
  const box=document.getElementById('trainingEmployeeCards');if(!box)return;
  const employeeSearch=trainingViewEmployeeSearch();
  const employees=trainingVisibleEmployees().filter(e=>trainingEmployeeMatchesSearch(e,employeeSearch)||items.some(t=>t.employee_id===e.id));
  box.innerHTML=employees.length?employees.map(e=>{
    const rows=items.filter(t=>t.employee_id===e.id),cost=rows.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+Number(t.cost||0),0),hours=rows.filter(t=>t.status==='completed').reduce((s,t)=>s+Number(t.hours||0),0),budget=trainingBudgetFor(e.id);
    const overdue=rows.filter(t=>trainingDueState(t)==='overdue').length,due=rows.filter(t=>trainingDueState(t)==='due').length;
    return '<article class="training-employee-card glass"><div class="training-employee-head"><div><strong>'+escapeHtml(e.name)+'</strong><span>'+escapeHtml(String(e.percent))+' % · '+escapeHtml(String(e.hours))+' h/Woche</span></div>'+(trainingCanManage()?'<button type="button" class="btn ghost training-budget-btn" data-employee="'+e.id+'">Budget</button>':'')+'</div>'+
      '<div class="training-employee-stats"><span><b>'+formatVacationNumber(hours)+'</b> Std.</span><span><b>'+euro(cost)+'</b> Kosten</span><span class="'+(overdue?'bad':'')+'"><b>'+due+' / '+overdue+'</b> fällig</span><span><b>'+euro(budget)+'</b> Budget</span></div>'+
      '<div class="training-employee-progress"><i style="width:'+Math.min(100,budget?cost/budget*100:0)+'%"></i></div>'+
      '<div class="training-employee-list">'+(rows.length?rows.slice(0,12).map(trainingEntryHtml).join(''):'<div class="empty-state">Keine Fortbildungen in '+trainingYear+'.</div>')+'</div></article>';
  }).join(''):'<div class="empty-state">Keine Mitarbeiter verfügbar.</div>';
}
function openTrainingPrefilled(empId,year=trainingYear,typeId=''){
  if(!trainingCanManage())return;
  openTraining();
  document.getElementById('trainingEmployee').value=empId||state.employees[0]?.id||'';
  document.getElementById('trainingYearOnly').checked=true;
  document.getElementById('trainingOnlyYear').value=String(year);
  if(typeId){
    document.getElementById('trainingType').value=typeId;
    applyTrainingTypeDefaults();
  }
  syncTrainingDateMode();syncTrainingRecurrenceMode();
}
async function quickCreateTrainingStatus(empId,typeId,year,status){
  if(!trainingCanManage())return;
  const type=trainingTypeById(typeId);if(!type){showToast('Fortbildungsart nicht gefunden');return}
  const cfg=window.TEAMPLAN_CONFIG||{};
  const recurring=!!type.series_enabled;
  const recurrenceUnit=type.series_unit||'months',recurrenceInterval=recurring?Number(type.series_interval||0):null;
  const row={team_id:cfg.teamId,employee_id:empId,type_id:type.id,title:type.name,category:type.category||'Fortbildung',date_precision:'year',training_year:Number(year),start_date:null,end_date:null,start_time:type.default_start_time||null,end_time:type.default_end_time||null,recurring,recurrence_unit:recurrenceUnit,recurrence_interval:recurrenceInterval,recurrence_months:recurring&&recurrenceUnit==='months'?recurrenceInterval:null,recurrence_weekday:recurring&&recurrenceUnit==='weeks'?Number(type.series_weekday||4):null,status,hours:Number(type.default_hours||0),cost:Number(type.default_cost||0),provider:'',valid_until:null,note:'',updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('teamplan_trainings').insert(row);
  if(error){alert(error.message);return}
  await loadTrainingData();showToast(status==='completed'?'Als absolviert erfasst':status==='in_progress'?'Als in Durchführung erfasst':'Fortbildung vorgemerkt');
}
function hideTrainingContextMenu(){
  document.getElementById('trainingContextMenu')?.classList.add('hidden');
}
function showTrainingContextMenu(x,y,{trainingId='',employeeId='',typeId='',year=trainingYear}={}){
  if(!trainingCanManage())return;
  const menu=document.getElementById('trainingContextMenu');if(!menu)return;
  const item=trainingId?trainings.find(t=>t.id===trainingId):null;
  const emp=state.employees.find(e=>e.id===employeeId)||state.employees.find(e=>e.id===item?.employee_id);
  const resolvedEmp=employeeId||item?.employee_id||'';
  const resolvedType=typeId||item?.type_id||'';
  const resolvedYear=Number(year||item?.training_year||trainingYear);
  menu.innerHTML='<div class="training-context-head"><strong>'+escapeHtml(emp?.name||'Fortbildung')+'</strong><span>'+(item?escapeHtml(item.title):escapeHtml(trainingTypeById(resolvedType)?.name||String(resolvedYear)))+'</span></div>'+
    (item?'<button data-training-context-status="planned">'+uiIcon('calendar')+'<span>Auf Geplant setzen</span></button><button data-training-context-status="in_progress">'+uiIcon('focus')+'<span>In Durchführung</span></button><button data-training-context-status="completed">'+uiIcon('check')+'<span>Als absolviert markieren</span></button><button data-training-context-status="cancelled">'+uiIcon('x')+'<span>Als abgesagt markieren</span></button><div class="training-context-sep"></div><button data-training-context-edit="1">'+uiIcon('edit')+'<span>Fortbildung bearbeiten…</span></button><button data-training-context-copy="1">'+uiIcon('copy')+'<span>Fortbildung duplizieren…</span></button>':
      (resolvedType?'<button data-training-context-create="planned">'+uiIcon('calendar')+'<span>Geplant vormerken</span></button><button data-training-context-create="in_progress">'+uiIcon('focus')+'<span>In Durchführung erfassen</span></button><button data-training-context-create="completed">'+uiIcon('check')+'<span>Als absolviert erfassen</span></button><div class="training-context-sep"></div>':'')+
      '<button data-training-context-new="1">'+uiIcon('plus')+'<span>Fortbildung detailliert anlegen…</span></button>')+
    '<div class="training-context-sep"></div><button data-training-context-employee="1">'+uiIcon('users')+'<span>Mitarbeiteransicht öffnen</span></button>'+
    (resolvedEmp&&canEditEmployees()?'<button data-training-context-edit-employee="1">'+uiIcon('edit')+'<span>Mitarbeiter bearbeiten…</span></button>':'');
  menu.classList.remove('hidden');
  menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
  menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
  menu.querySelectorAll('[data-training-context-status]').forEach(b=>b.addEventListener('click',()=>{hideTrainingContextMenu();updateTrainingStatusByDrop(item.id,b.dataset.trainingContextStatus)}));
  menu.querySelectorAll('[data-training-context-create]').forEach(b=>b.addEventListener('click',()=>{hideTrainingContextMenu();quickCreateTrainingStatus(resolvedEmp,resolvedType,resolvedYear,b.dataset.trainingContextCreate)}));
  menu.querySelector('[data-training-context-edit]')?.addEventListener('click',()=>{hideTrainingContextMenu();openTraining(item.id)});
  menu.querySelector('[data-training-context-copy]')?.addEventListener('click',()=>{hideTrainingContextMenu();openTrainingDuplicate(item.id)});
  menu.querySelector('[data-training-context-new]')?.addEventListener('click',()=>{hideTrainingContextMenu();openTrainingPrefilled(resolvedEmp,resolvedYear,resolvedType)});
  menu.querySelector('[data-training-context-employee]')?.addEventListener('click',()=>{
    hideTrainingContextMenu();
    const f=document.getElementById('trainingEmployeeFilter');if(f&&!f.classList.contains('hidden'))f.value=resolvedEmp;
    setTrainingView('employees');
  });
  menu.querySelector('[data-training-context-edit-employee]')?.addEventListener('click',()=>{hideTrainingContextMenu();openEmployee(resolvedEmp)});
}
function bindTrainingContextMenus(){
  if(!trainingCanManage())return;
  document.querySelectorAll('[data-training-id]').forEach(el=>el.addEventListener('contextmenu',e=>{
    if(el.classList.contains('training-teamstatus-person'))return;
    e.preventDefault();e.stopPropagation();
    const virtual=el.dataset.trainingVirtual==='1';
    showTrainingContextMenu(e.clientX,e.clientY,{trainingId:virtual?'':el.dataset.trainingId,employeeId:el.dataset.trainingEmployee||'',typeId:el.dataset.trainingType||'',year:Number(el.dataset.trainingYear||trainingYear)});
  }));
  document.querySelectorAll('.training-teamstatus-person').forEach(el=>el.addEventListener('contextmenu',e=>{
    e.preventDefault();e.stopPropagation();
    showTrainingContextMenu(e.clientX,e.clientY,{trainingId:el.dataset.trainingId||'',employeeId:el.dataset.trainingEmployee,typeId:el.dataset.trainingType,year:Number(el.dataset.trainingYear)});
  }));
  document.querySelectorAll('.training-person-action').forEach(btn=>btn.addEventListener('click',e=>{
    e.stopPropagation();const row=btn.closest('.training-teamstatus-person'),r=btn.getBoundingClientRect();
    showTrainingContextMenu(r.right-10,r.bottom+4,{trainingId:row.dataset.trainingId||'',employeeId:row.dataset.trainingEmployee,typeId:row.dataset.trainingType,year:Number(row.dataset.trainingYear)});
  }));
  document.querySelectorAll('.training-my-cell').forEach(el=>el.addEventListener('contextmenu',e=>{
    if(e.target.closest('[data-training-id]'))return;
    e.preventDefault();showTrainingContextMenu(e.clientX,e.clientY,{employeeId:el.dataset.employee,year:Number(el.dataset.year)});
  }));
}
function bindTrainingTeamStatusEvents(){
  if(!trainingCanManage())return;
  document.querySelectorAll('[data-employee-edit]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();openEmployee(btn.dataset.employeeEdit)}));
  document.querySelectorAll('[data-teamstatus-open-type]').forEach(btn=>btn.addEventListener('click',()=>{
    trainingTeamStatusTypeId=btn.dataset.teamstatusOpenType;localStorage.setItem('teamplan-training-teamstatus-type',trainingTeamStatusTypeId);renderTrainingModule();
  }));
  document.querySelectorAll('[data-teamstatus-employee-drag]').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/employee-id',el.dataset.teamstatusEmployeeDrag);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  });
  document.querySelectorAll('[data-teamstatus-drop-state]').forEach(zone=>{
    if(zone.dataset.teamstatusDropState==='open')return;
    zone.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/employee-id')){e.preventDefault();zone.classList.add('drag-over')}});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{
      const empId=e.dataTransfer.getData('text/employee-id');if(!empId)return;
      e.preventDefault();zone.classList.remove('drag-over');
      setTeamStatusEmployee(empId,zone.dataset.trainingType,Number(zone.dataset.trainingYear),zone.dataset.teamstatusDropState);
    });
  });
  document.querySelectorAll('[data-teamstatus-type-drop]').forEach(card=>{
    card.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/employee-id')){e.preventDefault();card.classList.add('drag-over')}});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{
      const empId=e.dataTransfer.getData('text/employee-id');if(!empId)return;
      e.preventDefault();card.classList.remove('drag-over');
      setTeamStatusEmployee(empId,card.dataset.teamstatusTypeDrop,Number(card.dataset.teamstatusYear),'planned');
    });
  });
}
function bindTrainingMultiYearEvents(){
  document.querySelectorAll('.training-my-add').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openTrainingPrefilled(b.dataset.trainingAddEmployee,Number(b.dataset.trainingAddYear))}));
  if(!trainingCanManage())return;
  let dragEmp='';
  document.querySelectorAll('[data-training-employee-row]').forEach(row=>{
    row.addEventListener('dragstart',e=>{dragEmp=row.dataset.trainingEmployeeRow;e.dataTransfer.effectAllowed='move'});
    row.addEventListener('dragover',e=>e.preventDefault());
    row.addEventListener('drop',e=>{
      e.preventDefault();const target=row.dataset.trainingEmployeeRow;if(!dragEmp||dragEmp===target)return;
      const a=state.employees.find(x=>x.id===dragEmp),b=state.employees.find(x=>x.id===target);if(!a||!b)return;
      const o=a.order;a.order=b.order;b.order=o;persist();renderTrainingModule();
    });
  });
}
async function exportTrainingCsv(){
  const rows=filteredTrainings().filter(t=>!t._virtual);
  const cols=['Mitarbeiter','Titel','Kategorie','Von','Bis','Startzeit','Endzeit','Jahr','Wiederkehrend','Serienart','Intervall','Wochentag','Serie bis','Status','Stunden','Kosten','Anbieter'];
  const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const csv=[cols.map(q).join(';')].concat(rows.map(t=>[trainingEmployeeName(t.employee_id),t.title,t.category,t.start_date||'',t.end_date||'',String(t.start_time||'').slice(0,5),String(t.end_time||'').slice(0,5),t.training_year||'',t.recurring?'Ja':'Nein',t.recurring?(t.recurrence_unit||'months'):'',t.recurring?(t.recurrence_interval||t.recurrence_months||''):'',t.recurrence_weekday?trainingWeekdayLabel(t.recurrence_weekday):'',t.recurrence_until||'',trainingStatusLabel(t),t.hours||0,t.cost||0,t.provider||''].map(q).join(';'))).join('\n');
  await saveExportFile('TeamPlan_Fortbildungen_'+trainingYear+'.csv','\ufeff'+csv,'text/csv;charset=utf-8','CSV-Datei',['.csv']);
}
async function exportTrainingJson(){
  const rows=filteredTrainings().filter(t=>!t._virtual);
  await saveExportFile('TeamPlan_Fortbildungen_'+trainingYear+'.json',JSON.stringify(rows,null,2),'application/json','JSON-Datei',['.json']);
}
function bindTrainingRenderedEvents(){
  document.querySelector('[data-training-undated-toggle]')?.addEventListener('click',()=>{
    const card=document.querySelector('.training-undated');if(!card)return;
    const collapsed=!card.classList.contains('collapsed');
    card.classList.toggle('collapsed',collapsed);
    localStorage.setItem('teamplan-training-undated-collapsed',collapsed?'1':'0');
    document.querySelector('[data-training-undated-toggle]')?.setAttribute('aria-expanded',String(!collapsed));
  });
  if(trainingCanManage())document.querySelectorAll('[data-training-id]:not(.training-day)').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();openTraining(el.dataset.trainingId)}));
  if(trainingCanManage())document.querySelectorAll('.training-day[data-date]').forEach(day=>day.addEventListener('click',e=>{
    if(day.classList.contains('blank'))return;
    e.preventDefault();e.stopPropagation();
    openTrainingForDate(day.dataset.date);
  }));
  document.querySelectorAll('.training-budget-btn').forEach(b=>b.addEventListener('click',()=>openTrainingBudget(b.dataset.employee)));
  bindTrainingContextMenus();bindTrainingMultiYearEvents();bindTrainingTeamStatusEvents();
}
function renderTrainingModule(){
  if(!document.getElementById('trainingModule'))return;
  populateTrainingControls();applyTrainingRoleUI();
  document.querySelector('.training-filterbar')?.classList.toggle('hidden',trainingView==='multiyear'||trainingView==='teamstatus');
  document.getElementById('trainingOverviewView').classList.toggle('hidden',trainingView!=='overview');
  document.getElementById('trainingCalendarView').classList.toggle('hidden',trainingView!=='calendar');
  document.getElementById('trainingMultiYearView').classList.toggle('hidden',trainingView!=='multiyear');
  document.getElementById('trainingTeamStatusView').classList.toggle('hidden',trainingView!=='teamstatus');
  document.getElementById('trainingEmployeesView').classList.toggle('hidden',trainingView!=='employees');
  document.getElementById('trainingClassicView').classList.toggle('hidden',trainingView!=='classic');
  document.getElementById('trainingOverviewBtn').classList.toggle('active',trainingView==='overview');
  document.getElementById('trainingCalendarBtn').classList.toggle('active',trainingView==='calendar');
  document.getElementById('trainingMultiYearBtn').classList.toggle('active',trainingView==='multiyear');
  document.getElementById('trainingTeamStatusBtn').classList.toggle('active',trainingView==='teamstatus');
  document.getElementById('trainingEmployeesBtn').classList.toggle('active',trainingView==='employees');
  document.getElementById('trainingClassicBtn').classList.toggle('active',trainingView==='classic');
  const items=filteredTrainings();
  if(trainingView==='overview')renderTrainingOverview(items);
  if(trainingView==='calendar')renderTrainingCalendar(items);
  if(trainingView==='multiyear')renderTrainingMultiYear();
  if(trainingView==='teamstatus')renderTrainingTeamStatus();
  if(trainingView==='employees')renderTrainingEmployees(items);
  if(trainingView==='classic')renderTrainingClassic(items);
  renderTrainingDropzones();applyTrainingZoom();
  const scope=sessionRole==='employee'?'Meine Fortbildungen':'Teamübersicht';
  document.getElementById('trainingHeadingSub').textContent=scope+' · '+trainingYear;
  bindTrainingRenderedEvents();bindTrainingDragDrop();
}
function setTrainingView(view){
  trainingView=view;localStorage.setItem('teamplan-training-view',view);renderTrainingModule();
}
function updateTrainingVacationWarning(){
  const box=document.getElementById('trainingVacationWarning');if(!box)return;
  if(document.getElementById('trainingYearOnly')?.checked){box.classList.add('hidden');box.textContent='';return}
  const conflicts=trainingHasVacationConflict(document.getElementById('trainingEmployee').value,document.getElementById('trainingStart').value,document.getElementById('trainingEnd').value);
  box.classList.toggle('hidden',!conflicts.length);
  box.textContent=conflicts.length?'Achtung: '+conflicts.map(x=>x.key+' ('+x.codes.join('+')+')').join(', ')+' bereits als Abwesenheit geplant.':'';
}
function syncTrainingDateMode(){
  const yearOnly=document.getElementById('trainingYearOnly').checked;
  document.getElementById('trainingYearOnlyField').classList.toggle('hidden',!yearOnly);
  document.getElementById('trainingStartField').classList.toggle('hidden',yearOnly);
  document.getElementById('trainingEndField').classList.toggle('hidden',yearOnly);
  document.getElementById('trainingStartTimeField')?.classList.toggle('hidden',yearOnly);
  document.getElementById('trainingEndTimeField')?.classList.toggle('hidden',yearOnly);
  document.getElementById('trainingStart').required=!yearOnly;
  document.getElementById('trainingEnd').required=!yearOnly;
  if(yearOnly){
    if(!document.getElementById('trainingOnlyYear').value)document.getElementById('trainingOnlyYear').value=trainingYear;
  }
  updateTrainingVacationWarning();
}
function enterTrainingFocus(){
  if(currentModule!=='training')switchModule('training',true);
  const tools=document.getElementById('trainingToolsPanel');
  if(tools){
    tools.dataset.focusWasHidden=tools.hidden?'1':'0';
    tools.hidden=false;
  }
  document.getElementById('trainingToolsToggle')?.setAttribute('aria-expanded','true');
  document.body.classList.add('training-focus');
  document.getElementById('trainingFocusBtn')?.classList.add('hidden');
  document.getElementById('trainingExitFocusBtn')?.classList.remove('hidden');
}
function exitTrainingFocus(){
  document.body.classList.remove('training-focus');
  document.getElementById('trainingFocusBtn')?.classList.remove('hidden');
  document.getElementById('trainingExitFocusBtn')?.classList.add('hidden');
  const tools=document.getElementById('trainingToolsPanel');
  if(tools&&tools.dataset.focusWasHidden==='1'){
    tools.hidden=true;
    document.getElementById('trainingToolsToggle')?.setAttribute('aria-expanded','false');
  }
  if(tools)delete tools.dataset.focusWasHidden;
}
function openTraining(id=null){
  if(!trainingCanManage()){showToast('Fortbildungen können nur Admin/Planer bearbeiten');return}
  populateTrainingControls();
  const t=id?trainings.find(x=>x.id===id):null,today=dateKey(new Date());
  document.getElementById('trainingDialogTitle').textContent=t?'Fortbildung bearbeiten':'Fortbildung planen';
  document.getElementById('trainingId').value=t?.id||'';
  document.getElementById('trainingEmployee').value=t?.employee_id||state.employees[0]?.id||'';
  document.getElementById('trainingType').value=t?.type_id||'';
  document.getElementById('trainingTitle').value=t?.title||'';
  document.getElementById('trainingCategory').value=t?.category||'Fortbildung';
  document.getElementById('trainingStatus').value=t?.status||'planned';
  const yearOnly=t?.date_precision==='year';
  document.getElementById('trainingYearOnly').checked=!!yearOnly;
  document.getElementById('trainingOnlyYear').value=t?.training_year||trainingYear;
  document.getElementById('trainingStart').value=t?.start_date||today;
  document.getElementById('trainingEnd').value=t?.end_date||today;
  document.getElementById('trainingStartTime').value=String(t?.start_time||'').slice(0,5);
  document.getElementById('trainingEndTime').value=String(t?.end_time||'').slice(0,5);
  document.getElementById('trainingRecurring').checked=!!t?.recurring;
  document.getElementById('trainingRecurrenceUnit').value=t?.recurrence_unit||'months';
  document.getElementById('trainingRecurrenceMonths').value=(t?.recurrence_unit||'months')==='months'?(t?.recurrence_interval||t?.recurrence_months||''):'';
  document.getElementById('trainingRecurrenceWeeks').value=(t?.recurrence_unit==='weeks'?(t?.recurrence_interval||2):2);
  document.getElementById('trainingRecurrenceWeekday').value=String(t?.recurrence_weekday||4);
  document.getElementById('trainingRecurrenceUntil').value=t?.recurrence_until||'';
  document.getElementById('trainingHours').value=Number(t?.hours||0);
  document.getElementById('trainingCost').value=Number(t?.cost||0);
  document.getElementById('trainingProvider').value=t?.provider||'';
  document.getElementById('trainingValidUntil').value=t?.valid_until||'';
  document.getElementById('trainingNote').value=t?.note||'';
  document.getElementById('deleteTrainingBtn').classList.toggle('hidden',!t);
  syncTrainingDateMode();syncTrainingRecurrenceMode();updateTrainingVacationWarning();safeShowDialog('trainingDialog');
}
function openTrainingForDate(date){
  if(!trainingCanManage())return;
  openTraining();
  const start=document.getElementById('trainingStart');
  const end=document.getElementById('trainingEnd');
  const yearOnly=document.getElementById('trainingYearOnly');
  const onlyYear=document.getElementById('trainingOnlyYear');
  if(yearOnly)yearOnly.checked=false;
  if(start)start.value=date;
  if(end)end.value=date;
  if(onlyYear)onlyYear.value=String(Number(String(date).slice(0,4))||trainingYear);
  syncTrainingDateMode();
  updateTrainingVacationWarning();
  window.setTimeout(()=>document.getElementById('trainingEmployee')?.focus(),0);
}
async function saveTrainingFromForm(){
  if(!trainingCanManage())return;
  const cfg=window.TEAMPLAN_CONFIG||{},id=document.getElementById('trainingId').value||null,yearOnly=document.getElementById('trainingYearOnly').checked,start=document.getElementById('trainingStart').value,end=document.getElementById('trainingEnd').value,onlyYear=Number(document.getElementById('trainingOnlyYear').value||trainingYear);
  if(yearOnly){
    if(onlyYear<2020||onlyYear>2100){alert('Bitte ein gültiges Jahr angeben.');return}
  }else if(!start||!end||end<start){alert('Bitte einen gültigen Zeitraum angeben.');return}
  const recurring=document.getElementById('trainingRecurring').checked;
  const recurrenceUnit=document.getElementById('trainingRecurrenceUnit').value||'months';
  const recurrenceMonths=Number(document.getElementById('trainingRecurrenceMonths').value||0);
  const recurrenceWeeks=Number(document.getElementById('trainingRecurrenceWeeks').value||0);
  const recurrenceWeekday=Number(document.getElementById('trainingRecurrenceWeekday').value||0);
  const recurrenceUntil=document.getElementById('trainingRecurrenceUntil').value||null;
  const startTime=document.getElementById('trainingStartTime').value||null,endTime=document.getElementById('trainingEndTime').value||null;
  if(startTime&&endTime&&endTime<=startTime){alert('Die Endzeit muss nach der Startzeit liegen.');return}
  if(recurring&&recurrenceUnit==='months'&&(recurrenceMonths<1||recurrenceMonths>240)){alert('Bitte ein gültiges Monatsintervall zwischen 1 und 240 angeben.');return}
  if(recurring&&recurrenceUnit==='weeks'){
    if(yearOnly){alert('Eine wöchentliche Terminserie benötigt ein konkretes Startdatum.');return}
    if(recurrenceWeeks<1||recurrenceWeeks>52||recurrenceWeekday<1||recurrenceWeekday>7){alert('Bitte Wochenintervall und Wochentag prüfen.');return}
    if(!recurrenceUntil||recurrenceUntil<start){alert('Bitte ein gültiges Serienende ab dem Startdatum angeben.');return}
  }
  const recurrenceInterval=recurring?(recurrenceUnit==='weeks'?recurrenceWeeks:recurrenceMonths):null;
  const row={team_id:cfg.teamId,employee_id:document.getElementById('trainingEmployee').value,type_id:document.getElementById('trainingType').value||null,title:document.getElementById('trainingTitle').value.trim(),category:document.getElementById('trainingCategory').value.trim()||'Fortbildung',date_precision:yearOnly?'year':'exact',training_year:yearOnly?onlyYear:Number(start.slice(0,4)),start_date:yearOnly?null:start,end_date:yearOnly?null:end,start_time:yearOnly?null:startTime,end_time:yearOnly?null:endTime,recurring,recurrence_unit:recurring?recurrenceUnit:'months',recurrence_interval:recurrenceInterval,recurrence_months:recurring&&recurrenceUnit==='months'?recurrenceMonths:null,recurrence_weekday:recurring&&recurrenceUnit==='weeks'?recurrenceWeekday:null,recurrence_until:recurring&&recurrenceUnit==='weeks'?recurrenceUntil:null,status:document.getElementById('trainingStatus').value,hours:Number(document.getElementById('trainingHours').value||0),cost:Number(document.getElementById('trainingCost').value||0),provider:document.getElementById('trainingProvider').value.trim(),valid_until:document.getElementById('trainingValidUntil').value||null,note:document.getElementById('trainingNote').value.trim(),updated_at:new Date().toISOString()};
  if(!row.employee_id||!row.title){alert('Bitte Mitarbeiter und Titel angeben.');return}
  const keepView=trainingView;
  let res;if(id)res=await supabaseClient.from('teamplan_trainings').update(row).eq('id',id);else res=await supabaseClient.from('teamplan_trainings').insert(row);
  if(res.error){alert(res.error.message);return}
  document.getElementById('trainingDialog').close();await loadTrainingData();trainingView=keepView;switchModule('training',true);renderTrainingModule();showToast(id?'Fortbildung aktualisiert':'Fortbildung geplant');
}
async function deleteTraining(){
  if(!trainingCanManage())return;
  const id=document.getElementById('trainingId').value;if(!id)return;
  if(!confirm('Fortbildung wirklich löschen?'))return;
  const {error}=await supabaseClient.from('teamplan_trainings').delete().eq('id',id);
  if(error){alert(error.message);return}
  document.getElementById('trainingDialog').close();await loadTrainingData();showToast('Fortbildung gelöscht');
}
function applyTrainingTypeDefaults(){
  const type=trainingTypeById(document.getElementById('trainingType').value);if(!type)return;
  document.getElementById('trainingTitle').value=type.name;
  document.getElementById('trainingCategory').value=type.category||'Fortbildung';
  document.getElementById('trainingHours').value=Number(type.default_hours||0);
  document.getElementById('trainingCost').value=Number(type.default_cost||0);
  document.getElementById('trainingStartTime').value=String(type.default_start_time||'').slice(0,5);
  document.getElementById('trainingEndTime').value=String(type.default_end_time||'').slice(0,5);
  const recurring=!!type.series_enabled;
  document.getElementById('trainingRecurring').checked=recurring;
  document.getElementById('trainingRecurrenceUnit').value=type.series_unit||'months';
  document.getElementById('trainingRecurrenceMonths').value=recurring&&(type.series_unit||'months')==='months'?Number(type.series_interval||type.interval_months||0)||'':'';
  document.getElementById('trainingRecurrenceWeeks').value=recurring&&type.series_unit==='weeks'?Number(type.series_interval||2):2;
  document.getElementById('trainingRecurrenceWeekday').value=String(type.series_weekday||4);
  syncTrainingRecurrenceMode();
}
function syncTrainingTypeSeriesMode(){
  const enabled=document.getElementById('trainingTypeSeriesEnabled')?.checked;
  const unit=document.getElementById('trainingTypeSeriesUnit')?.value||'months';
  document.getElementById('trainingTypeSeriesUnitField')?.classList.toggle('hidden',!enabled);
  document.getElementById('trainingTypeSeriesIntervalField')?.classList.toggle('hidden',!enabled);
  document.getElementById('trainingTypeSeriesWeekdayField')?.classList.toggle('hidden',!enabled||unit!=='weeks');
  const hint=document.getElementById('trainingTypeSeriesIntervalHint');
  if(hint)hint.textContent=unit==='weeks'?'Wochen':'Monate';
}
function trainingTypeSeriesLabel(t){
  if(!t?.series_enabled)return '';
  const interval=Number(t.series_interval||0),unit=t.series_unit||'months';
  if(!interval)return 'Serie aktiviert';
  if(unit==='weeks'){
    const day=trainingWeekdayLabel(t.series_weekday);
    return 'Serie: alle '+interval+(interval===1?' Woche':' Wochen')+(day?' · '+day:'');
  }
  if(interval%12===0)return 'Serie: alle '+(interval/12)+(interval===12?' Jahr':' Jahre');
  return 'Serie: alle '+interval+' Monate';
}
function resetTrainingTypeForm(){
  ['trainingTypeId','trainingTypeName','trainingTypeInterval','trainingTypeDescription','trainingTypeSeriesInterval','trainingTypeDefaultStartTime','trainingTypeDefaultEndTime'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
  document.getElementById('trainingTypeCategory').value='Pflichtfortbildung';
  document.getElementById('trainingTypeColor').value='#e59f23';
  document.getElementById('trainingTypeHours').value=0;
  document.getElementById('trainingTypeCost').value=0;
  document.getElementById('trainingTypeMandatory').checked=false;
  document.getElementById('trainingTypeSeriesEnabled').checked=false;
  document.getElementById('trainingTypeSeriesUnit').value='months';
  document.getElementById('trainingTypeSeriesWeekday').value='4';
  syncTrainingTypeSeriesMode();
}
function renderTrainingTypes(){
  const list=document.getElementById('trainingTypesList');if(!list)return;
  list.innerHTML=trainingTypes.length?trainingTypes.map(t=>{
    const series=trainingTypeSeriesLabel(t);
    const times=trainingTimeLabel({start_time:t.default_start_time,end_time:t.default_end_time});
    return '<div class="management-item training-type-row" data-type-id="'+t.id+'"><div class="training-type-main"><i class="training-type-color" style="--training-color:'+escapeHtml(t.color||trainingCategoryFallbackColor(t.category))+'"></i><div><strong>'+escapeHtml(t.name)+'</strong><span>'+[t.category||'',t.interval_months?('Gültigkeit '+t.interval_months+' Mon.'):'',series,times,t.mandatory?'Pflicht':''].filter(Boolean).map(escapeHtml).join(' · ')+'</span></div></div><div class="training-type-actions"><button type="button" class="btn ghost training-type-edit">Bearbeiten</button><button type="button" class="btn danger training-type-delete">Löschen</button></div></div>';
  }).join(''):'<div class="empty-state">Noch keine Fortbildungsarten angelegt.</div>';
  list.querySelectorAll('.training-type-row').forEach(row=>{
    row.querySelector('.training-type-edit').addEventListener('click',()=>editTrainingType(row.dataset.typeId));
    row.querySelector('.training-type-delete').addEventListener('click',()=>deleteTrainingType(row.dataset.typeId));
  });
}
function editTrainingType(id){
  const t=trainingTypeById(id);if(!t)return;
  document.getElementById('trainingTypeId').value=t.id;
  document.getElementById('trainingTypeName').value=t.name;
  document.getElementById('trainingTypeCategory').value=t.category||'';
  document.getElementById('trainingTypeInterval').value=t.interval_months||'';
  document.getElementById('trainingTypeHours').value=Number(t.default_hours||0);
  document.getElementById('trainingTypeCost').value=Number(t.default_cost||0);
  document.getElementById('trainingTypeColor').value=t.color||trainingCategoryFallbackColor(t.category);
  document.getElementById('trainingTypeMandatory').checked=!!t.mandatory;
  document.getElementById('trainingTypeDescription').value=t.description||'';
  document.getElementById('trainingTypeSeriesEnabled').checked=!!t.series_enabled;
  document.getElementById('trainingTypeSeriesUnit').value=t.series_unit||'months';
  document.getElementById('trainingTypeSeriesInterval').value=t.series_interval||'';
  document.getElementById('trainingTypeSeriesWeekday').value=String(t.series_weekday||4);
  document.getElementById('trainingTypeDefaultStartTime').value=String(t.default_start_time||'').slice(0,5);
  document.getElementById('trainingTypeDefaultEndTime').value=String(t.default_end_time||'').slice(0,5);
  syncTrainingTypeSeriesMode();
}
async function saveTrainingType(){
  if(!trainingCanManage())return;
  const cfg=window.TEAMPLAN_CONFIG||{},id=document.getElementById('trainingTypeId').value||null;
  const seriesEnabled=document.getElementById('trainingTypeSeriesEnabled').checked;
  const seriesUnit=document.getElementById('trainingTypeSeriesUnit').value||'months';
  const seriesInterval=Number(document.getElementById('trainingTypeSeriesInterval').value||0);
  const seriesWeekday=Number(document.getElementById('trainingTypeSeriesWeekday').value||0);
  if(seriesEnabled&&(!seriesInterval||(seriesUnit==='weeks'&&(seriesWeekday<1||seriesWeekday>7)))){alert('Bitte die Terminserie vollständig festlegen.');return}
  const startTime=document.getElementById('trainingTypeDefaultStartTime').value||null,endTime=document.getElementById('trainingTypeDefaultEndTime').value||null;
  if(startTime&&endTime&&endTime<=startTime){alert('Die Standard-Endzeit muss nach der Startzeit liegen.');return}
  const row={team_id:cfg.teamId,name:document.getElementById('trainingTypeName').value.trim(),category:document.getElementById('trainingTypeCategory').value.trim()||'Fortbildung',interval_months:Number(document.getElementById('trainingTypeInterval').value)||null,default_hours:Number(document.getElementById('trainingTypeHours').value||0),default_cost:Number(document.getElementById('trainingTypeCost').value||0),color:document.getElementById('trainingTypeColor').value||trainingCategoryFallbackColor(document.getElementById('trainingTypeCategory').value),mandatory:document.getElementById('trainingTypeMandatory').checked,description:document.getElementById('trainingTypeDescription').value.trim(),series_enabled:seriesEnabled,series_unit:seriesUnit,series_interval:seriesEnabled?seriesInterval:null,series_weekday:seriesEnabled&&seriesUnit==='weeks'?seriesWeekday:null,default_start_time:startTime,default_end_time:endTime,active:true,updated_at:new Date().toISOString()};
  if(!row.name)return;
  const res=id?await supabaseClient.from('teamplan_training_types').update(row).eq('id',id):await supabaseClient.from('teamplan_training_types').insert(row);
  if(res.error){alert(res.error.message);return}
  resetTrainingTypeForm();await loadTrainingData();renderTrainingTypes();showToast('Fortbildungsart gespeichert');
}
async function deleteTrainingType(id){
  if(!trainingCanManage()||!confirm('Fortbildungsart löschen? Bestehende Einträge bleiben erhalten.'))return;
  const {error}=await supabaseClient.from('teamplan_training_types').delete().eq('id',id);if(error){alert(error.message);return}
  await loadTrainingData();renderTrainingTypes();
}
function openTrainingBudget(empId){
  if(!trainingCanManage())return;
  const e=state.employees.find(x=>x.id===empId);if(!e)return;
  document.getElementById('trainingBudgetEmployee').value=empId;document.getElementById('trainingBudgetTitle').textContent=e.name;document.getElementById('trainingBudgetYearLabel').textContent=trainingYear;document.getElementById('trainingBudgetAmount').value=trainingBudgetFor(empId)||0;safeShowDialog('trainingBudgetDialog');
}
async function saveTrainingBudget(){
  if(!trainingCanManage())return;
  const cfg=window.TEAMPLAN_CONFIG||{},employee_id=document.getElementById('trainingBudgetEmployee').value,amount=Number(document.getElementById('trainingBudgetAmount').value||0);
  const {error}=await supabaseClient.from('teamplan_training_budgets').upsert({team_id:cfg.teamId,employee_id,year:trainingYear,amount,updated_at:new Date().toISOString()},{onConflict:'team_id,employee_id,year'});
  if(error){alert(error.message);return}
  document.getElementById('trainingBudgetDialog').close();await loadTrainingData();showToast('Budget gespeichert');
}
async function exportTrainingExcel(){
  if(!window.XLSX){alert('Excel-Export nicht verfügbar.');return}
  const rows=filteredTrainings().map(t=>({Mitarbeiter:trainingEmployeeName(t.employee_id),Titel:t.title,Kategorie:t.category,Von:t.date_precision==='year'?'':t.start_date,Bis:t.date_precision==='year'?'':t.end_date,Jahr:t.training_year||'',Terminstatus:t.date_precision==='year'?'nur Jahr bekannt':'genaues Datum',Wiederkehrend:t.recurring?'Ja':'Nein',Intervall_Monate:t.recurring?Number(t.recurrence_months||0):'',Status:trainingStatusLabel(t),Stunden:Number(t.hours||0),Kosten:Number(t.cost||0),Anbieter:t.provider||'',Gueltig_bis:trainingDueDate(t)||'',Notiz:t.note||''}));
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'Fortbildungen');
  const filename='TeamPlan_Fortbildungen_'+trainingYear+'.xlsx',data=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const saved=await saveExportFile(filename,data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Excel-Arbeitsmappe',['.xlsx']);
  if(saved)showToast('Excel gespeichert');
}
function applyTrainingZoom(){
  trainingZoom=Math.max(.7,Math.min(1.3,Number(trainingZoom||1)));
  document.documentElement.style.setProperty('--training-scale',trainingZoom);
  const range=document.getElementById('trainingZoomRange'),label=document.getElementById('trainingZoomLabel');
  if(range)range.value=String(Math.round(trainingZoom*100));
  if(label)label.textContent=Math.round(trainingZoom*100)+'%';
}
function setTrainingZoom(value){
  trainingZoom=Math.max(.7,Math.min(1.3,Number(value||1)));
  localStorage.setItem('teamplan-training-zoom',String(trainingZoom));
  applyTrainingZoom();
}
function changeTrainingZoom(delta){setTrainingZoom(Math.round((trainingZoom+delta)*100)/100)}
function syncTrainingRecurrenceMode(){
  const recurring=document.getElementById('trainingRecurring').checked;
  const unit=document.getElementById('trainingRecurrenceUnit').value||'months';
  document.getElementById('trainingRecurrenceUnitField')?.classList.toggle('hidden',!recurring);
  document.getElementById('trainingRecurrenceField')?.classList.toggle('hidden',!recurring||unit!=='months');
  document.getElementById('trainingRecurrenceWeeksField')?.classList.toggle('hidden',!recurring||unit!=='weeks');
  document.getElementById('trainingRecurrenceWeekdayField')?.classList.toggle('hidden',!recurring||unit!=='weeks');
  document.getElementById('trainingRecurrenceUntilField')?.classList.toggle('hidden',!recurring||unit!=='weeks');
  const months=document.getElementById('trainingRecurrenceMonths'),weeks=document.getElementById('trainingRecurrenceWeeks'),weekday=document.getElementById('trainingRecurrenceWeekday'),until=document.getElementById('trainingRecurrenceUntil');
  months.required=recurring&&unit==='months';
  weeks.required=recurring&&unit==='weeks';
  weekday.required=recurring&&unit==='weeks';
  until.required=recurring&&unit==='weeks';
  if(recurring&&unit==='months'&&!Number(months.value)){
    const type=trainingTypeById(document.getElementById('trainingType').value);
    months.value=Number(type?.interval_months||12);
  }
  if(recurring&&unit==='weeks'&&!Number(weeks.value))weeks.value=2;
}
function setCompactDrawer(buttonId,bodyId,open,storageKey){
  const btn=document.getElementById(buttonId),body=document.getElementById(bodyId);
  if(!btn||!body)return;
  body.hidden=!open;
  body.classList.toggle('hidden',!open);
  btn.setAttribute('aria-expanded',open?'true':'false');
  if(storageKey)localStorage.setItem(storageKey,open?'1':'0');
}
function initCompactDrawer(buttonId,bodyId,storageKey){
  const btn=document.getElementById(buttonId),body=document.getElementById(bodyId);
  if(!btn||!body)return;
  const open=localStorage.getItem(storageKey)==='1';
  setCompactDrawer(buttonId,bodyId,open,storageKey);
  btn.onclick=()=>{
    const next=body.hidden;
    setCompactDrawer(buttonId,bodyId,next,storageKey);
  };
}

function initTrainingModuleUI(){
  document.getElementById('moduleVacationBtn')?.addEventListener('click',()=>switchModule('vacation'));
  document.getElementById('moduleTrainingBtn')?.addEventListener('click',()=>switchModule('training'));
  document.getElementById('trainingOverviewBtn')?.addEventListener('click',()=>setTrainingView('overview'));
  document.getElementById('trainingCalendarBtn')?.addEventListener('click',()=>setTrainingView('calendar'));
  document.getElementById('trainingMultiYearBtn')?.addEventListener('click',()=>setTrainingView('multiyear'));
  document.getElementById('trainingTeamStatusBtn')?.addEventListener('click',()=>setTrainingView('teamstatus'));
  document.getElementById('trainingEmployeesBtn')?.addEventListener('click',()=>setTrainingView('employees'));
  document.getElementById('trainingClassicBtn')?.addEventListener('click',()=>setTrainingView('classic'));
  document.getElementById('trainingPrevYear')?.addEventListener('click',()=>{trainingYear--;localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  document.getElementById('trainingNextYear')?.addEventListener('click',()=>{trainingYear++;localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  document.getElementById('trainingYearSelect')?.addEventListener('change',e=>{trainingYear=Number(e.target.value);localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  ['trainingSearchInput','trainingEmployeeFilter','trainingTypeFilter','trainingCategoryFilter','trainingStatusFilter'].forEach(id=>document.getElementById(id)?.addEventListener(id==='trainingSearchInput'?'input':'change',renderTrainingModule));
  document.getElementById('trainingClearFiltersBtn')?.addEventListener('click',()=>{['trainingSearchInput','trainingEmployeeFilter','trainingTypeFilter','trainingCategoryFilter','trainingStatusFilter'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});renderTrainingModule()});
  document.getElementById('trainingMultiYearFrom')?.addEventListener('change',e=>{trainingMultiYearFrom=Math.max(2020,Number(e.target.value)||trainingYear-1);localStorage.setItem('teamplan-training-multiyear-from',trainingMultiYearFrom);renderTrainingModule()});
  document.getElementById('trainingMultiYearTo')?.addEventListener('change',e=>{trainingMultiYearTo=Math.min(2100,Number(e.target.value)||trainingYear+5);localStorage.setItem('teamplan-training-multiyear-to',trainingMultiYearTo);renderTrainingModule()});
  document.getElementById('trainingMultiYearFitBtn')?.addEventListener('click',()=>{const years=Math.abs(trainingMultiYearTo-trainingMultiYearFrom)+1;setTrainingZoom(Math.max(.7,Math.min(1,6/Math.max(1,years))));showToast('Mehrjahresansicht eingepasst')});
  document.getElementById('trainingTeamStatusType')?.addEventListener('change',e=>{trainingTeamStatusTypeId=e.target.value;localStorage.setItem('teamplan-training-teamstatus-type',trainingTeamStatusTypeId);renderTrainingModule()});
  document.getElementById('trainingTeamStatusYear')?.addEventListener('change',e=>{trainingTeamStatusYear=Number(e.target.value);localStorage.setItem('teamplan-training-teamstatus-year',trainingTeamStatusYear);renderTrainingModule()});
  document.getElementById('trainingTeamStatusSort')?.addEventListener('change',e=>{trainingTeamStatusSort=e.target.value;localStorage.setItem('teamplan-training-teamstatus-sort',trainingTeamStatusSort);renderTrainingModule()});
  document.getElementById('trainingTeamStatusSearch')?.addEventListener('input',renderTrainingModule);
  document.getElementById('addTrainingBtn')?.addEventListener('click',()=>openTraining());
  document.getElementById('trainingTypesBtn')?.addEventListener('click',()=>{if(!trainingCanManage())return;resetTrainingTypeForm();renderTrainingTypes();safeShowDialog('trainingTypesDialog')});
  document.getElementById('trainingFocusBtn')?.addEventListener('click',enterTrainingFocus);
  document.getElementById('trainingExitFocusBtn')?.addEventListener('click',exitTrainingFocus);
  document.getElementById('trainingZoomOutBtn')?.addEventListener('click',()=>changeTrainingZoom(-.05));
  document.getElementById('trainingZoomInBtn')?.addEventListener('click',()=>changeTrainingZoom(.05));
  document.getElementById('trainingZoomRange')?.addEventListener('input',e=>setTrainingZoom(Number(e.target.value)/100));
  document.getElementById('trainingYearOnly')?.addEventListener('change',syncTrainingDateMode);
  document.getElementById('trainingRecurring')?.addEventListener('change',syncTrainingRecurrenceMode);
  document.getElementById('trainingRecurrenceUnit')?.addEventListener('change',syncTrainingRecurrenceMode);
  document.getElementById('trainingOnlyYear')?.addEventListener('input',updateTrainingVacationWarning);
  document.getElementById('trainingExportBtn')?.addEventListener('click',exportTrainingExcel);
  document.getElementById('trainingPdfBtn')?.addEventListener('click',()=>safeShowDialog('trainingExportDialog'));
  document.getElementById('trainingExportForm')?.addEventListener('submit',e=>{e.preventDefault();exportTrainingPdf()});
  document.getElementById('trainingCsvBtn')?.addEventListener('click',exportTrainingCsv);
  document.getElementById('trainingJsonBtn')?.addEventListener('click',exportTrainingJson);
  document.getElementById('trainingForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingFromForm()});
  document.getElementById('deleteTrainingBtn')?.addEventListener('click',deleteTraining);
  document.getElementById('trainingType')?.addEventListener('change',applyTrainingTypeDefaults);
  ['trainingEmployee','trainingStart','trainingEnd'].forEach(id=>document.getElementById(id)?.addEventListener('change',updateTrainingVacationWarning));
  document.getElementById('trainingTypeForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingType()});
  document.getElementById('trainingTypeResetBtn')?.addEventListener('click',resetTrainingTypeForm);
  document.getElementById('trainingTypeSeriesEnabled')?.addEventListener('change',syncTrainingTypeSeriesMode);
  document.getElementById('trainingTypeSeriesUnit')?.addEventListener('change',syncTrainingTypeSeriesMode);
  document.getElementById('trainingBudgetForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingBudget()});
  initCompactDrawer('trainingToolsToggle','trainingToolsPanel','teamplan-training-tools-open');
  initCompactDrawer('trainingFilterToggle','trainingFilterBar','teamplan-training-filter-open');
  populateTrainingControls();applyTrainingRoleUI();applyTrainingZoom();
}


function buildTrainingPdfHtml(options){
  const year=trainingYear,items=trainingItemsWithProjections(year),sections=[],employees=trainingVisibleEmployees();
  const realItems=items.filter(t=>!t._virtual);
  if(options.overview){
    const planned=realItems.filter(t=>t.status==='planned').length,running=realItems.filter(t=>t.status==='in_progress').length,completed=realItems.filter(t=>t.status==='completed').length,due=realItems.filter(t=>['due','overdue'].includes(trainingDueState(t))).length;
    sections.push('<section><h2>Jahresübersicht '+year+'</h2><div class="cards"><div class="card"><small>Geplant</small><strong>'+planned+'</strong></div><div class="card"><small>In Durchführung</small><strong>'+running+'</strong></div><div class="card"><small>Absolviert</small><strong>'+completed+'</strong></div><div class="card"><small>Fällig / überfällig</small><strong>'+due+'</strong></div><div class="card"><small>Fortbildungsstunden</small><strong>'+formatVacationNumber(realItems.reduce((s,t)=>s+Number(t.hours||0),0))+' h</strong></div><div class="card"><small>Kosten</small><strong>'+euro(realItems.reduce((s,t)=>s+Number(t.cost||0),0))+'</strong></div></div></section>');
  }
  if(options.list){
    const rows=items.sort((a,b)=>(a.start_date||String(a.training_year)||'').localeCompare(b.start_date||String(b.training_year)||'')).map(t=>'<tr><td>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</td><td>'+escapeHtml(t.title)+'</td><td>'+escapeHtml(formatTrainingDateRange(t))+'</td><td>'+escapeHtml(t.category||'Fortbildung')+'</td><td>'+escapeHtml(t._virtual?'Vorschau':trainingStatusLabel(t))+'</td><td>'+formatVacationNumber(Number(t.hours||0))+'</td><td>'+euro(Number(t.cost||0))+'</td></tr>').join('');
    sections.push('<section><h2>Fortbildungsliste '+year+'</h2><table><thead><tr><th>Mitarbeiter</th><th>Fortbildung</th><th>Termin</th><th>Art</th><th>Status</th><th>Stunden</th><th>Kosten</th></tr></thead><tbody>'+rows+'</tbody></table></section>');
  }
  if(options.team){
    const types=trainingTypes.filter(t=>t.active!==false);
    const rows=employees.map(e=>{
      const empItems=realItems.filter(t=>t.employee_id===e.id),completed=empItems.filter(t=>t.status==='completed').length,running=empItems.filter(t=>t.status==='in_progress').length,planned=empItems.filter(t=>t.status==='planned').length,overdue=empItems.filter(t=>trainingDueState(t)==='overdue').length;
      return '<tr><td>'+escapeHtml(e.name)+'</td><td>'+completed+'</td><td>'+running+'</td><td>'+planned+'</td><td>'+overdue+'</td><td>'+types.length+'</td></tr>';
    }).join('');
    sections.push('<section><h2>Teamstatus '+year+'</h2><table><thead><tr><th>Mitarbeiter</th><th>Absolviert</th><th>Läuft</th><th>Geplant</th><th>Überfällig</th><th>Katalog</th></tr></thead><tbody>'+rows+'</tbody></table></section>');
  }
  if(options.budget){
    const rows=employees.map(e=>{const spent=realItems.filter(t=>t.employee_id===e.id).reduce((s,t)=>s+Number(t.cost||0),0),budget=trainingBudgetFor(e.id,year);return '<tr><td>'+escapeHtml(e.name)+'</td><td>'+euro(budget)+'</td><td>'+euro(spent)+'</td><td>'+euro(budget-spent)+'</td></tr>'}).join('');
    sections.push('<section><h2>Budgetübersicht '+year+'</h2><table><thead><tr><th>Mitarbeiter</th><th>Budget</th><th>Geplant / verbraucht</th><th>Rest</th></tr></thead><tbody>'+rows+'</tbody></table></section>');
  }
  if(options.multiyear){
    const from=Number(document.getElementById('trainingMultiYearFrom')?.value||trainingMultiYearFrom||year),to=Number(document.getElementById('trainingMultiYearTo')?.value||trainingMultiYearTo||year+3),years=[];for(let y=Math.min(from,to);y<=Math.max(from,to);y++)years.push(y);
    const head=years.map(y=>'<th>'+y+'</th>').join('');
    const rows=employees.map(e=>'<tr><td>'+escapeHtml(e.name)+'</td>'+years.map(y=>{const count=trainingItemsWithProjections(y).filter(t=>t.employee_id===e.id).length;return '<td>'+count+'</td>'}).join('')+'</tr>').join('');
    sections.push('<section><h2>Mehrjahresübersicht '+Math.min(from,to)+' bis '+Math.max(from,to)+'</h2><table><thead><tr><th>Mitarbeiter</th>'+head+'</tr></thead><tbody>'+rows+'</tbody></table><small>Anzahl Fortbildungs- und Weiterbildungseinträge inklusive berechneter Wiederholungen.</small></section>');
  }
  return reportBaseHtml('TeamPlan ZNA · Fortbildungsbericht','Fortbildungsjahr '+year,sections);
}
function exportTrainingPdf(){
  const options={overview:document.getElementById('trainingExportOverview')?.checked,list:document.getElementById('trainingExportList')?.checked,team:document.getElementById('trainingExportTeam')?.checked,budget:document.getElementById('trainingExportBudget')?.checked,multiyear:document.getElementById('trainingExportMultiYear')?.checked};
  if(!Object.values(options).some(Boolean)){showToast('Bitte mindestens einen PDF-Inhalt auswählen');return}
  reportPrintWindow('Fortbildungsbericht',buildTrainingPdfHtml(options),'trainingExportDialog');
}
