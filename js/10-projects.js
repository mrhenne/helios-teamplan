// Modul Projekte
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
/* =========================================================
   Projektmanagement
   ========================================================= */
const projectDefaultTemplates=[
  {id:'local-template-duty',name:'Dienstplan schreiben',description:'Monatlichen Dienstplan vorbereiten, prüfen und veröffentlichen',default_priority:'high',recurrence:'monthly',icon:'calendar',sort_order:10,active:true},
  {id:'local-template-med',name:'Medikamentenkontrolle',description:'Bestände, Verfall und Vollständigkeit kontrollieren',default_priority:'high',recurrence:'monthly',icon:'check',sort_order:20,active:true},
  {id:'local-template-hygiene',name:'Hygienekontrolle',description:'Hygienestandards und offene Punkte prüfen',default_priority:'medium',recurrence:'monthly',icon:'check',sort_order:30,active:true},
  {id:'local-template-vacation',name:'Urlaubsplanung',description:'Urlaubsplanung des Teams vorbereiten und abstimmen',default_priority:'high',recurrence:'yearly',icon:'calendar',sort_order:40,active:true},
  {id:'local-template-holiday',name:'Weihnachts- und Silvesterplanung',description:'Feiertagsbesetzung und Wünsche koordinieren',default_priority:'high',recurrence:'yearly',icon:'calendar',sort_order:50,active:true},
  {id:'local-template-meeting',name:'Teamsitzung vorbereiten',description:'Agenda, Themen und offene Punkte sammeln',default_priority:'medium',recurrence:'monthly',icon:'users',sort_order:60,active:true}
];
function projectCanManage(){return canManage()}
function projectIsLead(projectId){
  if(sessionRole!=='employee')return false;
  const p=projectProjects.find(x=>x.id===projectId);
  const employeeId=authMembership?.employee_id||sessionEmployeeId;
  if(!p||!employeeId)return false;
  return p.lead_employee_id===employeeId||projectMembers.some(m=>m.project_id===projectId&&m.employee_id===employeeId&&m.is_responsible===true);
}
function projectCanManageProject(projectId){return projectCanManage()||projectIsLead(projectId)}
function projectCanManageTask(task){
  return !!task&&(projectCanManageProject(task.project_id)||(['employee','external'].includes(sessionRole)&&task.assignee_employee_id===(authMembership?.employee_id||sessionEmployeeId)));
}
function currentProjectEmployeeId(){return authMembership?.employee_id||sessionEmployeeId||''}
function projectEmployeeName(id){return state.employees.find(e=>e.id===id)?.name||'Nicht zugewiesen'}
function projectEmployeeInitials(id){
  const name=projectEmployeeName(id);
  if(name==='Nicht zugewiesen')return '?';
  return name.split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase();
}
function projectTeamAvatarHtml(projectId){
  const ids=[...new Set(projectMembers.filter(m=>m.project_id===projectId).map(m=>m.employee_id))];
  const p=projectProjects.find(x=>x.id===projectId);
  if(p?.lead_employee_id&&!ids.includes(p.lead_employee_id))ids.unshift(p.lead_employee_id);
  const shown=ids.slice(0,4);
  return '<span class="project-mini-team">'+shown.map(id=>'<i title="'+escapeHtml(projectEmployeeName(id))+'">'+escapeHtml(projectEmployeeInitials(id))+'</i>').join('')+(ids.length>4?'<b>+'+(ids.length-4)+'</b>':'')+'</span>';
}

function projectName(id){return projectProjects.find(p=>p.id===id)?.name||'Ohne Projekt'}
function projectStatusLabel(s){return s==='active'?'In Arbeit':s==='paused'?'Pausiert':s==='done'?'Erledigt':'In Planung'}
function projectTaskStatusLabel(s){return s==='progress'?'In Arbeit':s==='waiting'?'Rückfrage':s==='done'?'Erledigt':'Offen'}
function projectPriorityLabel(s){return s==='high'?'Hoch':s==='low'?'Niedrig':'Mittel'}
function projectDateLabel(v){if(!v)return 'ohne Termin';const d=new Date(v+'T12:00:00');return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})}

function saveProjectLocal(){
  localStorage.setItem('teamplan-projects-local',JSON.stringify({projects:projectProjects,members:projectMembers,tasks:projectTasks,templates:projectTemplates,notes:projectNotes,comments:projectComments,activity:projectActivity}));
}
function loadProjectLocal(){
  try{
    const raw=JSON.parse(localStorage.getItem('teamplan-projects-local')||'{}');
    projectProjects=Array.isArray(raw.projects)?raw.projects:[];
    projectMembers=Array.isArray(raw.members)?raw.members:[];
    projectTasks=Array.isArray(raw.tasks)?raw.tasks:[];
    projectTemplates=Array.isArray(raw.templates)&&raw.templates.length?raw.templates:structuredClone(projectDefaultTemplates);
    projectNotes=Array.isArray(raw.notes)?raw.notes:[];
    projectComments=Array.isArray(raw.comments)?raw.comments:[];
    projectActivity=Array.isArray(raw.activity)?raw.activity:[];
  }catch{
    projectProjects=[];projectMembers=[];projectTasks=[];projectTemplates=structuredClone(projectDefaultTemplates);projectNotes=[];projectComments=[];projectActivity=[];
  }
}
async function loadProjectData(){
  if(projectLoadPromise)return projectLoadPromise;
  projectLoadPromise=(async()=>{
    if(!supabaseClient||!authUser){
      loadProjectLocal();
      try{renderProjectModule()}catch(err){console.error('Projekt-Renderfehler lokal',err)}
      return;
    }
    const cfg=window.TEAMPLAN_CONFIG||{};
    const [p,m,t,tt,n,c,a]=await Promise.all([
      supabaseClient.from('teamplan_projects').select('*').eq('team_id',cfg.teamId).order('created_at'),
      supabaseClient.from('teamplan_project_members').select('*').eq('team_id',cfg.teamId),
      supabaseClient.from('teamplan_tasks').select('*').eq('team_id',cfg.teamId).order('sort_order').order('created_at'),
      supabaseClient.from('teamplan_task_templates').select('*').eq('team_id',cfg.teamId).eq('active',true).order('sort_order'),
      supabaseClient.from('teamplan_notes').select('*').eq('team_id',cfg.teamId).order('created_at',{ascending:false}),
      supabaseClient.from('teamplan_task_comments').select('*').eq('team_id',cfg.teamId).order('created_at'),
      supabaseClient.from('teamplan_project_activity').select('*').eq('team_id',cfg.teamId).order('created_at',{ascending:false}).limit(300)
    ]);
    for(const r of [p,m,t,tt,n,c,a])if(r.error)throw r.error;
    projectProjects=p.data||[];
    projectMembers=m.data||[];
    projectTasks=t.data||[];
    projectTemplates=tt.data||[];
    projectNotes=n.data||[];
    projectComments=c.data||[];
    projectActivity=a.data||[];
    try{
      renderProjectModule();
    }catch(err){
      console.error('Projekt-Renderfehler',err);
      projectView='overview';
      localStorage.setItem('teamplan-project-view','overview');
      try{renderProjectModule()}catch(secondErr){console.error('Projekt-Fallback-Renderfehler',secondErr)}
    }
  })().finally(()=>{projectLoadPromise=null});
  return projectLoadPromise;
}
function scheduleProjectReload(){
  if(projectReloadTimer)clearTimeout(projectReloadTimer);
  projectReloadTimer=setTimeout(()=>{
    projectReloadTimer=null;
    loadProjectData().catch(err=>{
      console.error('Projekt-Realtime-Reload',err);
      showToast('Projekt-Sync konnte nicht aktualisiert werden');
    });
  },220);
}
async function startProjectRealtime(){
  if(!supabaseClient||!authUser)return;
  if(projectChannel){try{await supabaseClient.removeChannel(projectChannel)}catch{}}
  const cfg=window.TEAMPLAN_CONFIG||{};
  projectChannel=supabaseClient.channel('teamplan-projects-live-'+cfg.teamId)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_projects'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_project_members'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_tasks'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_task_templates'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_notes'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_task_comments'},scheduleProjectReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_project_activity'},scheduleProjectReload)
    .subscribe();
}
async function stopProjectRealtime(){
  if(projectReloadTimer){clearTimeout(projectReloadTimer);projectReloadTimer=null}
  if(projectChannel){try{await supabaseClient.removeChannel(projectChannel)}catch{}}
  projectChannel=null;projectProjects=[];projectMembers=[];projectTasks=[];projectNotes=[];projectTemplates=[];projectComments=[];projectActivity=[];renderProjectModule();
}
function populateProjectControls(){
  const projectOptions='<option value="">Alle Projekte</option>'+projectProjects.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join('');
  const projectTaskOptions='<option value="">Ohne Projekt</option>'+projectProjects.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join('');
  const internal=[...teamEmployees()].sort((a,b)=>a.order-b.order),external=[...externalEmployees()].sort((a,b)=>a.order-b.order);
  const employeeOptions='<option value="">Nicht zugewiesen</option>'+(internal.length?'<optgroup label="ZNA-Team">'+internal.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('')+'</optgroup>':'')+(external.length?'<optgroup label="Externe">'+external.map(e=>'<option value="'+e.id+'">'+escapeHtml(employeeDisplayLabel(e))+'</option>').join('')+'</optgroup>':'');
  const pf=document.getElementById('projectsProjectFilter');if(pf){const old=pf.value;pf.innerHTML=projectOptions;if([...pf.options].some(o=>o.value===old))pf.value=old}
  const af=document.getElementById('projectsAssigneeFilter');if(af){const old=af.value;af.innerHTML='<option value="">Alle Mitarbeiter</option>'+employeeOptions.replace('<option value="">Nicht zugewiesen</option>','');if([...af.options].some(o=>o.value===old))af.value=old}
  ['projectTaskProject','projectNoteProject'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=projectTaskOptions});
  const lead=document.getElementById('projectLead');if(lead)lead.innerHTML=employeeOptions;
  const ass=document.getElementById('projectTaskAssignee');if(ass)ass.innerHTML=employeeOptions;
  const tpl=document.getElementById('projectsTemplateSelect');
  if(tpl){tpl.innerHTML='<option value="">Schnellaufgabe aus Vorlage…</option>'+projectTemplates.filter(x=>x.active!==false).map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+'</option>').join('')}
}
function filteredProjectTasks(){
  const q=(document.getElementById('projectsSearchInput')?.value||'').trim().toLowerCase();
  const projectId=document.getElementById('projectsProjectFilter')?.value||'';
  const assignee=document.getElementById('projectsAssigneeFilter')?.value||'';
  const status=document.getElementById('projectsStatusFilter')?.value||'';
  return projectTasks.filter(t=>(!projectId||t.project_id===projectId)&&(!assignee||t.assignee_employee_id===assignee)&&(!status||t.status===status)&&(!q||[t.title,t.description,projectName(t.project_id),projectEmployeeName(t.assignee_employee_id)].join(' ').toLowerCase().includes(q)));
}
function filteredProjects(){
  const q=(document.getElementById('projectsSearchInput')?.value||'').trim().toLowerCase();
  const projectId=document.getElementById('projectsProjectFilter')?.value||'';
  return projectProjects.filter(p=>(!projectId||p.id===projectId)&&(!q||[p.name,p.description,projectEmployeeName(p.lead_employee_id)].join(' ').toLowerCase().includes(q)));
}
function projectCardHtml(p){
  const tasks=projectTasks.filter(t=>t.project_id===p.id),done=tasks.filter(t=>t.status==='done').length,open=tasks.filter(t=>t.status!=='done').length,progressInfo=projectProgressInfo(p.id,p.progress),progress=progressInfo.percent;
  const memberCount=new Set(projectMembers.filter(m=>m.project_id===p.id).map(m=>m.employee_id)).size,responsibleCount=new Set(projectMembers.filter(m=>m.project_id===p.id&&m.is_responsible).map(m=>m.employee_id)).size;
  return '<article class="project-card" data-project-id="'+p.id+'" draggable="'+(projectCanManageProject(p.id)?'true':'false')+'" style="--project-color:'+escapeHtml(p.color||'#d8891c')+';--progress:'+progress+'%;--progress-color:'+projectProgressColor(progress)+'"><div class="project-card-head"><div><strong>'+escapeHtml(p.name)+'</strong><span>'+escapeHtml(projectStatusLabel(p.status))+' '+'</span></div><span class="project-progress-number">'+progress+' %</span></div><div class="project-progress"><i></i></div><div class="project-card-teamrow"><span>'+projectTeamAvatarHtml(p.id)+'</span><small>'+memberCount+' im Team · '+open+' offen · '+done+' erledigt</small></div><div class="project-meta"><span class="project-chip">'+escapeHtml(projectPriorityLabel(p.priority))+'</span><span class="project-chip">Leitung: '+escapeHtml(projectEmployeeName(p.lead_employee_id))+'</span>'+(responsibleCount?'<span class="project-chip">'+responsibleCount+' weitere verantwortlich</span>':'')+(p.due_date?'<span class="project-chip">'+escapeHtml(projectDateLabel(p.due_date))+'</span>':'')+'</div></article>';
}
function projectTaskConflictInfo(task){
  if(!task?.assignee_employee_id||!task?.due_date)return null;
  const entry=entryFor(task.assignee_employee_id,task.due_date);
  const absence=(entryIsActive(entry)?(entry.codes||[]).filter(c=>['U','XU','S'].includes(c)):[]);
  const dayTraining=trainingForEmployeeDate(task.assignee_employee_id,task.due_date);
  if(!absence.length&&!dayTraining.length)return null;
  const parts=[];
  if(absence.length)parts.push('Abwesenheit: '+absence.join('+'));
  if(dayTraining.length)parts.push('Fortbildung: '+dayTraining.map(t=>t.title).join(', '));
  return parts.join(' · ');
}
function projectChecklistProgress(task){
  const list=Array.isArray(task?.checklist)?task.checklist:[];
  return {total:list.length,done:list.filter(x=>x.done).length};
}
function projectProgressInfo(projectId,fallback=0){
  const tasks=projectTasks.filter(t=>t.project_id===projectId);
  if(!tasks.length)return {percent:Number(fallback||0),doneUnits:0,totalUnits:0};
  let totalUnits=0,doneUnits=0;
  tasks.forEach(task=>{
    const list=Array.isArray(task.checklist)?task.checklist:[];
    const units=Math.max(1,list.length);
    totalUnits+=units;
    if(task.status==='done')doneUnits+=units;
    else if(list.length)doneUnits+=list.filter(x=>x.done).length;
  });
  const percent=totalUnits?Math.round(doneUnits/totalUnits*100):0;
  return {percent,doneUnits,totalUnits};
}
function projectProgressColor(percent){
  const p=Math.max(0,Math.min(100,Number(percent)||0));
  const hue=Math.round(18+(122-18)*(p/100));
  return 'hsl('+hue+' 62% 43%)';
}
function projectIsOverdue(task){
  return !!(task?.status!=='done'&&task?.due_date&&task.due_date<dateKey(new Date()));
}
function renderProjectMy(){
  const box=document.getElementById('projectsMyTasks');if(!box)return;
  const employeeId=currentProjectEmployeeId();
  let tasks=projectTasks.filter(t=>t.status!=='done'&&(!employeeId||t.assignee_employee_id===employeeId));
  tasks.sort((a,b)=>(a.due_date||'9999-99-99').localeCompare(b.due_date||'9999-99-99'));
  const today=dateKey(new Date()),soon=dateKey(addDays(new Date(),14));
  const groups=[
    ['Überfällig',tasks.filter(t=>t.due_date&&t.due_date<today)],
    ['Heute',tasks.filter(t=>t.due_date===today)],
    ['Nächste 14 Tage',tasks.filter(t=>t.due_date&&t.due_date>today&&t.due_date<=soon)],
    ['Ohne Termin / später',tasks.filter(t=>!t.due_date||t.due_date>soon)]
  ];
  document.getElementById('projectsMyScope').textContent=employeeId?projectEmployeeName(employeeId):'Alle offenen Aufgaben';
  box.innerHTML=groups.map(([label,rows])=>'<section class="projects-my-group"><header><strong>'+label+'</strong><span>'+rows.length+'</span></header><div class="project-task-list">'+(rows.length?rows.map(projectTaskHtml).join(''):'<div class="empty-state">Keine Aufgaben</div>')+'</div></section>').join('');
}
function projectTaskHtml(t){
  const conflict=projectTaskConflictInfo(t),check=projectChecklistProgress(t),overdue=projectIsOverdue(t),canDrag=projectCanManageTask(t),assignee=t.assignee_employee_id?projectEmployeeName(t.assignee_employee_id):'Nicht zugewiesen';
  return '<article class="project-task-card priority-'+escapeHtml(t.priority||'medium')+(overdue?' overdue':'')+'" data-project-task-id="'+t.id+'" draggable="'+(canDrag?'true':'false')+'"><div class="project-task-head"><strong>'+escapeHtml(t.title)+'</strong><span class="project-task-status '+escapeHtml(t.status)+'">'+escapeHtml(projectTaskStatusLabel(t.status))+'</span></div><div class="project-task-owner"><i>'+escapeHtml(projectEmployeeInitials(t.assignee_employee_id))+'</i><span>'+escapeHtml(assignee)+'</span><small>'+escapeHtml(projectName(t.project_id))+'</small>'+'</div><div class="project-meta"><span class="project-chip">'+escapeHtml(projectPriorityLabel(t.priority))+'</span>'+(t.due_date?'<span class="project-chip '+(overdue?'project-chip-danger':'')+'">bis '+escapeHtml(projectDateLabel(t.due_date))+'</span>':'')+(t.recurrence&&t.recurrence!=='none'?'<span class="project-chip">↻ '+escapeHtml(t.recurrence)+'</span>':'')+(check.total?'<span class="project-chip">☑ '+check.done+'/'+check.total+'</span>':'')+(conflict?'<span class="project-chip project-chip-warning" title="'+escapeHtml(conflict)+'">⚠ Termin</span>':'')+'</div></article>';
}
function projectAttentionRows(){
  const today=dateKey(new Date()),soon=dateKey(addDays(new Date(),7));
  const rows=[];
  projectTasks.filter(t=>t.status!=='done').forEach(t=>{
    if(t.due_date&&t.due_date<today)rows.push({task:t,kind:'danger',label:'Überfällig',detail:'Fällig '+projectDateLabel(t.due_date)});
    else if(t.due_date&&t.due_date>=today&&t.due_date<=soon)rows.push({task:t,kind:'soon',label:'Bald fällig',detail:'Bis '+projectDateLabel(t.due_date)});
    if(t.status==='waiting')rows.push({task:t,kind:'waiting',label:'Rückfrage',detail:'Klärung erforderlich'});
    if(!t.assignee_employee_id)rows.push({task:t,kind:'unassigned',label:'Ohne Verantwortlichen',detail:'Bitte zuweisen'});
  });
  const priority={danger:0,waiting:1,unassigned:2,soon:3};
  return rows.sort((a,b)=>priority[a.kind]-priority[b.kind]||(a.task.due_date||'9999').localeCompare(b.task.due_date||'9999'));
}
function renderProjectAttention(){
  const box=document.getElementById('projectsAttentionList'),count=document.getElementById('projectsAttentionCount');
  if(!box)return;
  const rows=projectAttentionRows();
  if(count){count.textContent=String(rows.length);count.classList.toggle('project-chip-danger',rows.some(r=>r.kind==='danger'))}
  box.innerHTML=rows.length?rows.slice(0,10).map(r=>'<button type="button" class="project-attention-row '+r.kind+'" data-project-task-id="'+r.task.id+'"><span class="project-attention-icon">'+(r.kind==='danger'?'!':r.kind==='waiting'?'?':r.kind==='unassigned'?'@':'•')+'</span><span><strong>'+escapeHtml(r.label)+'</strong><small>'+escapeHtml(r.task.title)+' · '+escapeHtml(r.detail)+'</small></span></button>').join(''):'<div class="empty-state">Aktuell kein besonderer Handlungsbedarf.</div>';
}
function renderProjectDialogSummary(projectId){
  const wrap=document.getElementById('projectDialogSummary');if(!wrap)return;
  wrap.classList.toggle('hidden',!projectId);
  if(!projectId)return;
  const rows=projectTasks.filter(t=>t.project_id===projectId),open=rows.filter(t=>t.status!=='done').length,waiting=rows.filter(t=>t.status==='waiting').length,overdue=rows.filter(projectIsOverdue).length,progress=projectProgressInfo(projectId).percent;
  document.getElementById('projectSummaryProgress').textContent=progress+' %';
  const progressBar=document.getElementById('projectDialogProgress');
  if(progressBar){progressBar.classList.remove('hidden');progressBar.style.setProperty('--progress',progress+'%');progressBar.style.setProperty('--progress-color',projectProgressColor(progress))}
  document.getElementById('projectSummaryOpen').textContent=String(open);
  document.getElementById('projectSummaryWaiting').textContent=String(waiting);
  document.getElementById('projectSummaryOverdue').textContent=String(overdue);
  document.getElementById('projectSummaryOverdue').closest('article')?.classList.toggle('metric-alert',overdue>0);
}
function projectStats(){
  const today=dateKey(new Date()),week=dateKey(addDays(new Date(),7));
  const tasks=projectTasks,open=tasks.filter(t=>t.status!=='done');
  const count=st=>tasks.filter(t=>t.status===st).length;
  return {
    active:projectProjects.filter(p=>p.status==='active').length,
    open:open.length,done:count('done'),progress:count('progress'),waiting:count('waiting'),todo:count('open'),total:tasks.length,
    unassigned:open.filter(t=>!t.assignee_employee_id).length,
    overdue:open.filter(t=>t.due_date&&t.due_date<today).length,
    soon:open.filter(t=>t.due_date&&t.due_date>=today&&t.due_date<=week).length,
    quota:tasks.length?Math.round(count('done')/tasks.length*100):0
  };
}
function renderProjectMetrics(){
  const box=document.getElementById('projectsMetrics');if(!box)return;
  const st=projectStats();
  const tile=(tone,label,big,unit,chip,deco,left,right,view)=>'<article class="tn-kpi tone-'+tone+'"'+(view?' data-project-kpi-view="'+view+'" tabindex="0" role="button"':'')+'><header><span>'+label+'</span>'+trainingArrow()+'</header><div class="tn-kpi-body"><strong>'+big+'</strong><em>'+unit+'</em>'+(chip?'<b class="tn-kpi-chip">'+chip+'</b>':'')+'</div><div class="tn-kpi-deco">'+deco+'</div><footer><span>'+left+'</span><span>'+right+'</span></footer></article>';
  const meter=(pct,cls='')=>'<div class="tn-meter '+cls+'"><i style="width:'+Math.min(100,pct)+'%"></i></div>';
  box.innerHTML=
    tile('violet','Aktive Projekte',st.active,st.active===1?'Projekt':'Projekte',st.active?'in Arbeit':'',trainingSparkSvg([0,1,1,2,2,Math.max(1,st.active),st.active],'#8b5cf6'),'Gesamt '+projectProjects.length,'','roadmap')+
    tile('blue','Offene Aufgaben',st.open,'Aufgaben',st.waiting?st.waiting+' Rückfrage':'',trainingBarsSvg([st.todo,st.progress,st.waiting,st.done,0,0,0,0,0,0,0,0].slice(0,4).concat([0,0,0,0,0,0,0,0]),'#4f8ff0'),st.todo+' offen',st.progress+' in Arbeit','board')+
    tile(st.unassigned?'amber':'mint','Ohne Verantwortlichen',st.unassigned,'zuzuweisen',st.unassigned?'Handlungsbedarf':'alles zugewiesen',meter(st.open?st.unassigned/st.open*100:0),st.open-st.unassigned+' zugewiesen',st.unassigned+' offen','board')+
    tile(st.overdue?'rose':'peach','Überfällig',st.overdue,'Aufgaben',st.soon?st.soon+' diese Woche':'',trainingSparkSvg([0,1,0,2,1,Math.max(1,st.soon),st.overdue],st.overdue?'#d9505a':'#e0892c'),'bald '+st.soon,'überfällig '+st.overdue,'calendar')+
    tile('mint','Erledigt',st.done,'Aufgaben',st.total?st.quota+' %':'',meter(st.quota),st.done+' erledigt','von '+st.total,'board')+
    tile('sky','Diese Woche fällig',st.soon,'Aufgaben','',trainingSparkSvg([0,1,2,1,Math.max(1,st.soon)],'#2a7fa8'),'nächste 7 Tage','','calendar');
  box.querySelectorAll('[data-project-kpi-view]').forEach(el=>{
    const go=()=>setProjectView(el.dataset.projectKpiView);
    el.addEventListener('click',go);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  });
}
function renderProjectHero(){
  const box=document.getElementById('projectsHero');if(!box)return;
  const st=projectStats(),total=Math.max(st.total,1);
  const call=(cls,label,value,sub)=>'<div class="tn-callout '+cls+'"><i></i><span>'+label+'</span><b>'+value+'</b><small>'+sub+'</small></div>';
  box.innerHTML='<div class="tn-hero-ring"><svg viewBox="0 0 220 220" role="img" aria-label="Aufgabenfortschritt '+st.quota+' Prozent">'+
    trainingArc(98,st.done/total,'#13a085',11)+trainingArc(78,st.progress/total,'#8b5cf6',11)+trainingArc(58,(st.todo+st.waiting)/total,'#4f8ff0',11)+
    '</svg><div class="tn-hero-ring-center"><strong>'+st.quota+'<small>%</small></strong><span>erledigt</span></div></div>'+
    call('c-a','Erledigt',st.done,'Aufgaben')+call('c-b','In Arbeit',st.progress,'laufend')+call('c-c','Offen',st.todo,'Aufgaben')+call('c-d','Rückfrage',st.waiting,'wartet');
}
function renderProjectSideCard(){
  const box=document.getElementById('projectsSideCard');if(!box)return;
  const st=projectStats(),n=st.overdue+st.unassigned;
  box.innerHTML='<b>'+(n?n+' Punkt'+(n===1?'':'e')+' brauch'+(n===1?'t':'en')+' Aufmerksamkeit':'Alles im grünen Bereich')+'</b><small>'+(n?'Überfällige oder nicht zugewiesene Aufgaben prüfen.':'Keine überfälligen oder nicht zugewiesenen Aufgaben.')+'</small><button type="button" class="tn-side-card-btn">Aufgaben öffnen</button>';
  box.querySelector('.tn-side-card-btn')?.addEventListener('click',()=>setProjectView('board'));
}
function renderProjectOverview(){
  renderProjectMetrics();renderProjectHero();
  const focus=document.getElementById('projectsFocusList'),next=document.getElementById('projectsNextTasks'),activity=document.getElementById('projectsRecentActivity');
  renderProjectAttention();
  const projects=filteredProjects().filter(p=>p.status!=='done').slice(0,8);
  if(focus)focus.innerHTML=projects.length?projects.map(projectCardHtml).join(''):'<div class="empty-state">Noch keine aktiven Projekte.</div>';
  let tasks=filteredProjectTasks().filter(t=>t.status!=='done').sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  if(sessionRole==='employee'&&sessionEmployeeId)tasks=tasks.filter(t=>t.assignee_employee_id===sessionEmployeeId);
  if(next)next.innerHTML=tasks.length?tasks.slice(0,10).map(projectTaskHtml).join(''):'<div class="empty-state">Keine offenen Aufgaben.</div>';
  if(activity){
    const rows=[...projectActivity].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,8);
    activity.innerHTML=rows.length?rows.map(a=>'<div class="project-change-row"><span class="project-change-dot"></span><div><strong>'+escapeHtml(a.action)+'</strong><span>'+escapeHtml(a.details||'')+'</span><small>'+escapeHtml(a.actor_name||'Team')+' · '+new Date(a.created_at||Date.now()).toLocaleString('de-DE')+'</small></div></div>').join(''):'<div class="empty-state">Noch keine Änderungen protokolliert.</div>';
  }
}
function renderProjectRoadmap(){
  const statuses=[['planned','In Planung'],['active','In Arbeit'],['paused','Pausiert'],['done','Erledigt']];
  const board=document.getElementById('projectsRoadmapBoard');if(!board)return;
  board.innerHTML=statuses.map(([s,label])=>{const items=filteredProjects().filter(p=>p.status===s);return '<section class="roadmap-column" data-project-drop-status="'+s+'"><header><strong>'+label+'</strong><span>'+items.length+'</span></header><div class="roadmap-list">'+(items.length?items.map(projectCardHtml).join(''):'<div class="empty-state">Leer</div>')+'</div></section>'}).join('');
}
function renderProjectKanban(){
  const statuses=[['open','Offen'],['progress','In Arbeit'],['waiting','Rückfrage'],['done','Erledigt']];
  const board=document.getElementById('projectsKanban'),items=filteredProjectTasks();if(!board)return;
  board.innerHTML=statuses.map(([s,label])=>{const rows=items.filter(t=>t.status===s);return '<section class="kanban-column" data-task-drop-status="'+s+'"><header><strong>'+label+'</strong><span>'+rows.length+'</span></header><div class="kanban-list">'+(rows.length?rows.map(projectTaskHtml).join(''):'<div class="empty-state">Leer</div>')+'</div></section>'}).join('');
}
function startOfCalendarGrid(d){const x=new Date(d.getFullYear(),d.getMonth(),1);const dow=(x.getDay()+6)%7;x.setDate(x.getDate()-dow);return x}
function renderProjectCalendar(){
  const body=document.getElementById('projectsCalendarBody'),label=document.getElementById('projectsCalendarLabel');
  document.getElementById('projectsCalendarMonthBtn')?.classList.toggle('active',projectCalendarMode==='month');
  document.getElementById('projectsCalendarYearBtn')?.classList.toggle('active',projectCalendarMode==='year');
  if(projectCalendarMode==='year'){
    label.textContent=String(projectCalendarDate.getFullYear());
    const y=projectCalendarDate.getFullYear();
    body.innerHTML='<div class="projects-calendar-year">'+Array.from({length:12},(_,m)=>{
      const first=new Date(y,m,1),daysInMonth=new Date(y,m+1,0).getDate(),offset=(first.getDay()+6)%7;
      let cells='';
      for(let i=0;i<offset;i++)cells+='<span class="project-year-day empty"></span>';
      for(let day=1;day<=daysInMonth;day++){
        const key=y+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
        const projects=filteredProjects().filter(p=>p.due_date===key);
        const tasks=filteredProjectTasks().filter(t=>t.due_date===key);
        const total=projects.length+tasks.length;
        const title=[...projects.map(p=>'Projekt: '+p.name),...tasks.map(t=>'Aufgabe: '+t.title)].join(' · ');
        cells+='<button type="button" class="project-year-day '+(total?'has-items':'')+'" data-project-date="'+key+'" title="'+escapeHtml((title?title+' · ':'')+'Klicken: Projekt an diesem Tag anlegen')+'"><span>'+day+'</span>'+(total?'<b>'+total+'</b>':'')+'</button>';
      }
      return '<section class="project-year-month"><header><h3>'+MONTHS[m]+'</h3><span>'+filteredProjects().filter(p=>p.due_date&&p.due_date.startsWith(y+'-'+String(m+1).padStart(2,'0'))).length+' Projekte</span></header><div class="project-year-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="project-year-days">'+cells+'</div></section>';
    }).join('')+'</div>';
    return;
  }
  label.textContent=MONTHS[projectCalendarDate.getMonth()]+' '+projectCalendarDate.getFullYear();
  const start=startOfCalendarGrid(projectCalendarDate),days=Array.from({length:42},(_,i)=>addDays(start,i));
  body.innerHTML='<div class="projects-calendar-month">'+['Mo','Di','Mi','Do','Fr','Sa','So'].map(x=>'<div class="project-calendar-weekday">'+x+'</div>').join('')+days.map(d=>{const key=dateKey(d),outside=d.getMonth()!==projectCalendarDate.getMonth(),today=key===dateKey(new Date());const tasks=filteredProjectTasks().filter(t=>t.due_date===key),projects=filteredProjects().filter(p=>p.due_date===key);return '<div class="project-calendar-day '+(outside?'outside ':'')+(today?'today':'')+'" data-project-date="'+key+'"><header><span>'+d.getDate()+'</span></header>'+projects.map(p=>'<button class="project-calendar-item project" data-project-id="'+p.id+'" type="button">▣ '+escapeHtml(p.name)+'</button>').join('')+tasks.map(t=>'<button class="project-calendar-item" data-project-task-id="'+t.id+'" draggable="'+(projectCanManage()?'true':'false')+'" type="button">✓ '+escapeHtml(t.title)+'</button>').join('')+'</div>'}).join('')+'</div>';
}
function renderProjectTeam(){
  const box=document.getElementById('projectsTeamGrid');if(!box)return;
  const employees=[...state.employees].sort((a,b)=>a.order-b.order);
  box.innerHTML=employees.map(e=>{
    const tasks=projectTasks.filter(t=>t.assignee_employee_id===e.id&&t.status!=='done');
    const memberProjectIds=new Set(projectMembers.filter(m=>m.employee_id===e.id).map(m=>m.project_id));
    const projects=projectProjects.filter(p=>(p.lead_employee_id===e.id||memberProjectIds.has(p.id))&&p.status!=='done');
    const initials=e.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
    return '<article class="project-team-card"><header><div class="project-team-avatar">'+escapeHtml(initials)+'</div><div><h3>'+escapeHtml(e.name)+'</h3><small>'+projects.length+' Projekte · '+tasks.length+' offene Aufgaben</small></div></header><div class="project-team-list">'+projects.map(p=>'<button type="button" data-project-id="'+p.id+'"><span>▣ '+escapeHtml(p.name)+'</span><b>'+(p.lead_employee_id===e.id?'Leitung':projectMembers.some(m=>m.project_id===p.id&&m.employee_id===e.id&&m.is_responsible)?'Verantwortlich':'Team')+'</b></button>').join('')+tasks.slice(0,6).map(t=>'<button type="button" data-project-task-id="'+t.id+'"><span>✓ '+escapeHtml(t.title)+'</span><b>'+escapeHtml(projectTaskStatusLabel(t.status))+'</b></button>').join('')+'</div></article>';
  }).join('');
}
function renderProjectNotes(){
  const box=document.getElementById('projectsNotesBoard');if(!box)return;
  box.innerHTML=projectNotes.length?projectNotes.map(n=>'<article class="project-note-card '+escapeHtml(n.category||'info')+'" data-project-note-id="'+n.id+'"><h3>'+escapeHtml(n.title||({idea:'Idee',important:'Wichtig',problem:'Problem',info:'Info'}[n.category]||'Notiz'))+'</h3><p>'+escapeHtml(n.body)+'</p><footer>'+escapeHtml(n.author_name||'Team')+(n.project_id?' · '+escapeHtml(projectName(n.project_id)):'')+' · '+escapeHtml(new Date(n.created_at||Date.now()).toLocaleDateString('de-DE'))+'</footer></article>').join(''):'<div class="empty-state">Noch keine Notizen.</div>';
}
function renderProjectModule(){
  if(!document.getElementById('projectsModule'))return;
  if(!['overview','my','roadmap','board','calendar','team','notes'].includes(projectView))projectView='overview';
  populateProjectControls();
  const canCreateTask=projectCanManage()||projectProjects.some(p=>projectIsLead(p.id));
  document.getElementById('addProjectBtn')?.classList.toggle('hidden',!projectCanManage());
  document.getElementById('projectsTemplatesBtn')?.classList.toggle('hidden',!projectCanManage());
  document.getElementById('addTaskBtn')?.classList.toggle('hidden',!canCreateTask);
  document.getElementById('projectsTemplateSelect')?.classList.toggle('hidden',!canCreateTask);
  const views=['overview','my','roadmap','board','calendar','team','notes'];
  views.forEach(v=>{
    document.getElementById('projects'+v[0].toUpperCase()+v.slice(1)+'View')?.classList.toggle('hidden',projectView!==v);
    document.getElementById('projects'+v[0].toUpperCase()+v.slice(1)+'Btn')?.classList.toggle('active',projectView===v);
  });
  if(projectView==='overview')renderProjectOverview();
  if(projectView==='my')renderProjectMy();
  if(projectView==='roadmap')renderProjectRoadmap();
  if(projectView==='board')renderProjectKanban();
  if(projectView==='calendar')renderProjectCalendar();
  if(projectView==='team')renderProjectTeam();
  if(projectView==='notes')renderProjectNotes();
  document.getElementById('projectsGreeting').textContent=trainingGreeting();
  const me=sessionRole==='employee'?state.employees.find(e=>e.id===sessionEmployeeId):null;
  document.getElementById('projectsHeadingTitle').textContent=(me?me.name.split(' ')[0]:'Team')+'.';
  renderProjectSideCard();
  const sub=document.getElementById('projectsHeadingSub');if(sub)sub.textContent=(sessionRole==='external'?'Externer Projektzugang':sessionRole==='employee'?'Meine Aufgaben':'ZNA Management')+' · '+projectProjects.length+' Projekte';
  bindProjectRenderedEvents();
}
function setProjectView(view){projectView=view;localStorage.setItem('teamplan-project-view',view);renderProjectModule()}
function updateProjectMemberCount(){
  const selected=[...projectMemberDraft.values()].filter(x=>x.checked).length;
  const responsible=[...projectMemberDraft.values()].filter(x=>x.checked&&x.is_responsible).length;
  const label=document.getElementById('projectMemberCount');
  if(label)label.textContent=selected+' im Team · '+responsible+' zusätzlich verantwortlich';
}
function renderProjectMemberChoices(projectId){
  const box=document.getElementById('projectMembersList');if(!box)return;
  const extToggle=document.getElementById('projectShowExternal');if(extToggle)extToggle.checked=projectShowExternal;
  if(!projectMemberDraft.size&&projectId){
    projectMembers.filter(m=>m.project_id===projectId).forEach(m=>projectMemberDraft.set(m.employee_id,{employee_id:m.employee_id,checked:true,is_responsible:!!m.is_responsible}));
  }
  const q=(document.getElementById('projectMemberSearch')?.value||'').trim().toLowerCase();
  box.innerHTML=[...state.employees].sort((a,b)=>Number(a.external)-Number(b.external)||a.order-b.order).filter(emp=>{
    const saved=projectMemberDraft.get(emp.id)||{employee_id:emp.id,checked:false,is_responsible:false};
    if(emp.external&&!projectShowExternal&&!saved.checked)return false;
    return !q||[emp.name,emp.organization].filter(Boolean).join(' ').toLowerCase().includes(q);
  }).map(emp=>{
    const saved=projectMemberDraft.get(emp.id)||{employee_id:emp.id,checked:false,is_responsible:false};
    const meta=emp.external?'<small class="project-member-external-meta"><b>Extern</b>'+(emp.organization?' · '+escapeHtml(emp.organization):'')+'</small>':'';
    return '<div class="project-member-row '+(emp.external?'external':'')+'" data-employee-id="'+emp.id+'"><label class="project-member-main"><input class="project-member-active" type="checkbox" value="'+emp.id+'" '+(saved.checked?'checked':'')+'><span>'+escapeHtml(emp.name)+meta+'</span></label><label class="project-member-responsible-label" title="Darf das Projekt wie die Projektleitung bearbeiten"><input class="project-member-responsible" type="checkbox" '+(saved.is_responsible?'checked':'')+'><span>Verantwortlich</span></label></div>';
  }).join('');
  box.querySelectorAll('.project-member-row').forEach(row=>{
    const id=row.dataset.employeeId,active=row.querySelector('.project-member-active'),resp=row.querySelector('.project-member-responsible');
    active.addEventListener('change',()=>{if(!active.checked)resp.checked=false;projectMemberDraft.set(id,{employee_id:id,checked:active.checked,is_responsible:resp.checked});updateProjectMemberCount()});
    resp.addEventListener('change',()=>{if(resp.checked)active.checked=true;projectMemberDraft.set(id,{employee_id:id,checked:active.checked,is_responsible:resp.checked});updateProjectMemberCount()});
  });
  updateProjectMemberCount();
}
function collectProjectMemberRows(){
  return [...projectMemberDraft.values()].filter(x=>x.checked).map(x=>({employee_id:x.employee_id,is_responsible:!!x.is_responsible}));
}
function collectProjectMemberChoices(){
  return collectProjectMemberRows().map(x=>x.employee_id);
}function renderProjectDialogTasks(projectId){
  const box=document.getElementById('projectTasksBox'),list=document.getElementById('projectDialogTasks');
  if(!box||!list)return;
  box.classList.toggle('hidden',!projectId);
  if(!projectId){list.innerHTML='';return}
  const rows=projectTasks.filter(t=>t.project_id===projectId).sort((a,b)=>(a.status==='done')-(b.status==='done')||(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  list.innerHTML=rows.length?rows.map(t=>{
    const check=projectChecklistProgress(t),done=t.status==='done';
    return '<div class="project-dialog-task '+(done?'done':'')+'" data-project-task-id="'+t.id+'"><button type="button" class="project-task-quickcheck" aria-label="'+(done?'Aufgabe wieder öffnen':'Aufgabe erledigen')+'" title="'+(done?'Wieder öffnen':'Als erledigt markieren')+'">'+(done?'✓':'')+'</button><button type="button" class="project-dialog-task-main"><span><strong>'+escapeHtml(t.title)+'</strong><small>'+escapeHtml(projectEmployeeName(t.assignee_employee_id))+(t.due_date?' · bis '+escapeHtml(projectDateLabel(t.due_date)):'')+(check.total?' · Checkliste '+check.done+'/'+check.total:'')+'</small></span></button><span class="project-task-status '+escapeHtml(t.status)+'">'+escapeHtml(projectTaskStatusLabel(t.status))+'</span></div>';
  }).join(''):'<div class="empty-state">Noch keine Aufgaben. Lege die erste Aufgabe für dieses Projekt an.</div>';
  list.querySelectorAll('.project-dialog-task').forEach(row=>row.addEventListener('click',e=>{if(e.target.closest('.project-task-quickcheck'))return;document.getElementById('projectDialog')?.close();openProjectTask(row.dataset.projectTaskId)}));
  list.querySelectorAll('.project-task-quickcheck').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const row=btn.closest('[data-project-task-id]');toggleProjectTaskDone(row.dataset.projectTaskId)}));
}
function populateProjectAssigneeForProject(projectId,selected=''){
  const el=document.getElementById('projectTaskAssignee');if(!el)return;
  const memberIds=new Set(projectMembers.filter(m=>m.project_id===projectId).map(m=>m.employee_id));
  const project=projectProjects.find(p=>p.id===projectId);if(project?.lead_employee_id)memberIds.add(project.lead_employee_id);
  const employees=[...state.employees].sort((a,b)=>Number(a.external)-Number(b.external)||a.order-b.order);
  const team=employees.filter(e=>memberIds.has(e.id)),othersInternal=employees.filter(e=>!memberIds.has(e.id)&&!e.external),othersExternal=employees.filter(e=>!memberIds.has(e.id)&&e.external);
  el.innerHTML='<option value="">Nicht zugewiesen</option>'+(team.length?'<optgroup label="Projektteam">'+team.map(e=>'<option value="'+e.id+'">'+escapeHtml(employeeDisplayLabel(e))+'</option>').join('')+'</optgroup>':'')+(othersInternal.length?'<optgroup label="Weitere ZNA-Mitarbeitende">'+othersInternal.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('')+'</optgroup>':'')+(othersExternal.length?'<optgroup label="Externe">'+othersExternal.map(e=>'<option value="'+e.id+'">'+escapeHtml(employeeDisplayLabel(e))+'</option>').join('')+'</optgroup>':'');
  if([...el.options].some(o=>o.value===selected))el.value=selected;
}
async function ensureProjectMember(projectId,employeeId){
  if(!projectId||!employeeId||projectMembers.some(m=>m.project_id===projectId&&m.employee_id===employeeId))return;
  const teamId=(window.TEAMPLAN_CONFIG||{}).teamId||'local';
  if(supabaseClient&&authUser){
    const {error}=await supabaseClient.from('teamplan_project_members').insert({project_id:projectId,team_id:teamId,employee_id:employeeId,is_responsible:false});
    if(error&&error.code!=='23505')throw error;
  }else{
    projectMembers.push({project_id:projectId,team_id:teamId,employee_id:employeeId,is_responsible:false,created_at:new Date().toISOString()});
  }
}
async function logProjectActivity(entityType,entityId,action,details=''){
  const row={team_id:(window.TEAMPLAN_CONFIG||{}).teamId||'local',entity_type:entityType,entity_id:entityId||null,action,details,actor_name:authMembership?.display_name||actorName(),created_at:new Date().toISOString()};
  if(supabaseClient&&authUser){
    row.actor_user_id=authUser.id;
    const {error}=await supabaseClient.from('teamplan_project_activity').insert(row);
    if(error)console.error('Projektaktivität',error);
  }else{
    projectActivity.unshift({id:uid(),...row});
    saveProjectLocal();
  }
}
function renderProjectChecklistEditor(list=[]){
  const box=document.getElementById('projectTaskChecklist');if(!box)return;
  const rows=Array.isArray(list)?list:[];
  box.innerHTML=rows.map((item,i)=>'<div class="project-checklist-row" data-check-index="'+i+'"><input class="project-check-done" type="checkbox" '+(item.done?'checked':'')+'><input class="project-check-text" value="'+escapeHtml(item.text||'')+'" maxlength="180" placeholder="Checklistenpunkt"><button class="icon-btn project-check-remove" type="button" title="Entfernen">×</button></div>').join('');
  box.querySelectorAll('.project-check-remove').forEach(btn=>btn.addEventListener('click',()=>{btn.closest('.project-checklist-row').remove()}));
}
function addProjectChecklistRow(){
  const box=document.getElementById('projectTaskChecklist');if(!box)return;
  const row=document.createElement('div');row.className='project-checklist-row';row.innerHTML='<input class="project-check-done" type="checkbox"><input class="project-check-text" maxlength="180" placeholder="Checklistenpunkt"><button class="icon-btn project-check-remove" type="button" title="Entfernen">×</button>';
  row.querySelector('.project-check-remove').addEventListener('click',()=>row.remove());box.appendChild(row);row.querySelector('.project-check-text').focus();
}
function collectProjectChecklist(){
  return [...document.querySelectorAll('#projectTaskChecklist .project-checklist-row')].map(row=>({text:row.querySelector('.project-check-text').value.trim(),done:row.querySelector('.project-check-done').checked})).filter(x=>x.text);
}
function updateProjectTaskConflictWarning(){
  const task={assignee_employee_id:document.getElementById('projectTaskAssignee')?.value||null,due_date:document.getElementById('projectTaskDue')?.value||null};
  const info=projectTaskConflictInfo(task),box=document.getElementById('projectTaskConflictWarning');
  if(!box)return;
  box.classList.toggle('hidden',!info);box.textContent=info?'⚠ '+info:'';
}
function renderProjectTaskCollaboration(task){
  const collab=document.getElementById('projectTaskCollaboration'),activitySection=document.getElementById('projectTaskActivitySection');
  if(!task){collab?.classList.add('hidden');activitySection?.classList.add('hidden');return}
  collab?.classList.remove('hidden');activitySection?.classList.remove('hidden');
  const comments=projectComments.filter(c=>c.task_id===task.id);
  const list=document.getElementById('projectTaskComments'),count=document.getElementById('projectTaskCommentCount');
  if(count)count.textContent=comments.length+' Kommentare';
  if(list)list.innerHTML=comments.length?comments.map(c=>'<div class="project-comment"><strong>'+escapeHtml(c.author_name||'Team')+'</strong><span>'+escapeHtml(c.body)+'</span><small>'+new Date(c.created_at||Date.now()).toLocaleString('de-DE')+'</small></div>').join(''):'<div class="empty-state">Noch keine Kommentare.</div>';
  const acts=projectActivity.filter(a=>a.entity_type==='task'&&a.entity_id===task.id).slice(0,12),activity=document.getElementById('projectTaskActivity');
  if(activity)activity.innerHTML=acts.length?acts.map(a=>'<div class="project-activity-item"><strong>'+escapeHtml(a.action)+'</strong><span>'+escapeHtml(a.details||'')+'</span><small>'+escapeHtml(a.actor_name||'Team')+' · '+new Date(a.created_at||Date.now()).toLocaleString('de-DE')+'</small></div>').join(''):'<div class="empty-state">Noch keine Aktivität.</div>';
  const input=document.getElementById('projectTaskCommentInput'),add=document.getElementById('projectTaskCommentAdd');
  if(input)input.disabled=sessionRole==='viewer';if(add)add.disabled=sessionRole==='viewer';
}
async function addProjectTaskComment(){
  const taskId=document.getElementById('projectTaskId').value,input=document.getElementById('projectTaskCommentInput');
  const body=input?.value.trim();if(!taskId||!body||sessionRole==='viewer')return;
  const row={team_id:(window.TEAMPLAN_CONFIG||{}).teamId||'local',task_id:taskId,body,author_name:authMembership?.display_name||actorName(),created_at:new Date().toISOString()};
  if(supabaseClient&&authUser){row.author_user_id=authUser.id;const {error}=await supabaseClient.from('teamplan_task_comments').insert(row);if(error){alert(error.message);return}await logProjectActivity('task',taskId,'Kommentar hinzugefügt',body.slice(0,120));await loadProjectData()}
  else{projectComments.push({id:uid(),...row});await logProjectActivity('task',taskId,'Kommentar hinzugefügt',body.slice(0,120));saveProjectLocal()}
  input.value='';renderProjectTaskCollaboration(projectTasks.find(t=>t.id===taskId));
}
function recurrenceShiftDate(value,recurrence){
  if(!value)return null;
  const d=new Date(value+'T12:00:00');
  if(recurrence==='weekly')d.setDate(d.getDate()+7);
  if(recurrence==='monthly')d.setMonth(d.getMonth()+1);
  if(recurrence==='quarterly')d.setMonth(d.getMonth()+3);
  if(recurrence==='halfyear')d.setMonth(d.getMonth()+6);
  if(recurrence==='yearly')d.setFullYear(d.getFullYear()+1);
  return dateKey(d);
}
function localNextRecurringTask(task){
  if(!task||task.status!=='done'||!task.due_date||!task.recurrence||task.recurrence==='none')return;
  if(projectTasks.some(x=>x.recurrence_parent_id===task.id))return;
  const next={...task,id:uid(),status:'open',completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),recurrence_parent_id:task.id,start_date:recurrenceShiftDate(task.start_date,task.recurrence),due_date:recurrenceShiftDate(task.due_date,task.recurrence),checklist:(Array.isArray(task.checklist)?task.checklist:[]).map(x=>({...x,done:false}))};
  projectTasks.push(next);
  projectActivity.unshift({id:uid(),team_id:'local',entity_type:'task',entity_id:next.id,action:'Wiederholungsaufgabe erstellt',details:next.title,actor_name:'TeamPlan',created_at:new Date().toISOString()});
}
function openProject(id=null){
  projectDialogReturnProjectId=id||null;
  const p=id?projectProjects.find(x=>x.id===id):null;
  if(!p&&!projectCanManage())return;
  populateProjectControls();
  document.getElementById('projectDialogTitle').textContent=p?'Projekt bearbeiten':'Projekt anlegen';
  document.getElementById('projectId').value=p?.id||'';
  document.getElementById('projectName').value=p?.name||'';
  document.getElementById('projectDescription').value=p?.description||'';
  document.getElementById('projectStatus').value=p?.status||'planned';
  document.getElementById('projectPriority').value=p?.priority||'medium';
  document.getElementById('projectStart').value=p?.start_date||'';
  document.getElementById('projectDue').value=p?.due_date||'';
  document.getElementById('projectLead').value=p?.lead_employee_id||'';
  document.getElementById('projectLead').disabled=!!p&&!projectCanManage();
  document.getElementById('projectColor').value=p?.color||'#d8891c';
  const canEditProject=!p||projectCanManageProject(p.id);
  ['projectName','projectDescription','projectStatus','projectPriority','projectStart','projectDue','projectColor'].forEach(fid=>{const el=document.getElementById(fid);if(el)el.disabled=!canEditProject});
  document.getElementById('projectLead').disabled=!!p&&!projectCanManage();
  document.getElementById('projectMembersAllBtn')?.classList.toggle('hidden',!canEditProject);
  document.getElementById('projectMembersNoneBtn')?.classList.toggle('hidden',!canEditProject);
  document.getElementById('projectAddTaskBtn')?.classList.toggle('hidden',!canEditProject);
  document.getElementById('projectForm')?.querySelector('button[type="submit"]')?.classList.toggle('hidden',!canEditProject);
  document.getElementById('deleteProjectBtn').classList.toggle('hidden',!p||!projectCanManage());
  const memberSearch=document.getElementById('projectMemberSearch');if(memberSearch)memberSearch.value='';
  projectMemberDraft=new Map(projectMembers.filter(m=>m.project_id===(p?.id||'')).map(m=>[m.employee_id,{employee_id:m.employee_id,checked:true,is_responsible:!!m.is_responsible}]));
  const teamBody=document.getElementById('projectTeamBody'),teamToggle=document.getElementById('projectTeamToggle');
  if(teamBody)teamBody.hidden=true;
  if(teamToggle)teamToggle.setAttribute('aria-expanded','false');
  renderProjectMemberChoices(p?.id||'');
  renderProjectDialogSummary(p?.id||'');
  renderProjectDialogTasks(p?.id||'');
  safeShowDialog('projectDialog');
}
function openProjectForDate(date){
  if(!projectCanManage()){showToast('Projekte können nur Admin/Planer anlegen');return}
  openProject();
  const start=document.getElementById('projectStart');
  const due=document.getElementById('projectDue');
  if(start)start.value=date;
  if(due)due.value=date;
  window.setTimeout(()=>document.getElementById('projectName')?.focus(),0);
}

async function saveProjectFromForm(){
  const id=document.getElementById('projectId').value||null,existing=id?projectProjects.find(x=>x.id===id):null;
  if((!id&&!projectCanManage())||(id&&!projectCanManageProject(id)))return;
  const row={name:document.getElementById('projectName').value.trim(),description:document.getElementById('projectDescription').value.trim(),status:document.getElementById('projectStatus').value,priority:document.getElementById('projectPriority').value,start_date:document.getElementById('projectStart').value||null,due_date:document.getElementById('projectDue').value||null,lead_employee_id:projectCanManage()?(document.getElementById('projectLead').value||null):(existing?.lead_employee_id||null),color:document.getElementById('projectColor').value||'#d8891c',updated_at:new Date().toISOString()};
  if(!row.name)return;
  const selectedRows=collectProjectMemberRows();
  if(row.lead_employee_id&&!selectedRows.some(x=>x.employee_id===row.lead_employee_id))selectedRows.push({employee_id:row.lead_employee_id,is_responsible:false});
  const selectedMembers=[...new Set(selectedRows.map(x=>x.employee_id))];let savedId=id;
  if(supabaseClient&&authUser){
    row.team_id=(window.TEAMPLAN_CONFIG||{}).teamId;
    let res;
    if(id)res=await supabaseClient.from('teamplan_projects').update(row).eq('id',id).select('id').single();
    else res=await supabaseClient.from('teamplan_projects').insert(row).select('id').single();
    if(res.error){alert(res.error.message);return}
    savedId=res.data.id;
    const del=await supabaseClient.from('teamplan_project_members').delete().eq('project_id',savedId);if(del.error){alert(del.error.message);return}
    if(selectedRows.length){const ins=await supabaseClient.from('teamplan_project_members').insert(selectedRows.map(x=>({project_id:savedId,team_id:row.team_id,employee_id:x.employee_id,is_responsible:!!x.is_responsible})));if(ins.error){alert(ins.error.message);return}}
    await logProjectActivity('project',savedId,id?'Projekt aktualisiert':'Projekt angelegt',row.name);await loadProjectData();
  }else{
    if(id){const i=projectProjects.findIndex(x=>x.id===id);if(i>=0)projectProjects[i]={...projectProjects[i],...row}}
    else{savedId=uid();projectProjects.push({id:savedId,...row,created_at:new Date().toISOString()})}
    projectMembers=projectMembers.filter(m=>m.project_id!==savedId).concat(selectedRows.map(x=>({project_id:savedId,team_id:'local',employee_id:x.employee_id,is_responsible:!!x.is_responsible})));
    await logProjectActivity('project',savedId,id?'Projekt aktualisiert':'Projekt angelegt',row.name);saveProjectLocal();renderProjectModule();
  }
  document.getElementById('projectDialog').close();showToast(id?'Projekt aktualisiert':'Projekt angelegt');
}
async function deleteProject(){
  const id=document.getElementById('projectId').value;if(!id||!projectCanManage()||!confirm('Projekt wirklich löschen? Zugeordnete Aufgaben bleiben ohne Projekt erhalten.'))return;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_projects').delete().eq('id',id);if(error){alert(error.message);return}await loadProjectData()}
  else{projectProjects=projectProjects.filter(x=>x.id!==id);projectMembers=projectMembers.filter(x=>x.project_id!==id);projectTasks=projectTasks.map(t=>t.project_id===id?{...t,project_id:null}:t);saveProjectLocal();renderProjectModule()}
  document.getElementById('projectDialog').close();showToast('Projekt gelöscht');
}
function openProjectTask(id=null,defaults={}){
  const t=id?projectTasks.find(x=>x.id===id):null;
  projectDialogReturnProjectId=defaults.project_id||t?.project_id||projectDialogReturnProjectId||null;
  const leadProjects=projectProjects.filter(p=>projectCanManageProject(p.id));
  if(!t&&!projectCanManage()&&!leadProjects.length)return;
  populateProjectControls();
  document.getElementById('projectTaskDialogTitle').textContent=t?'Aufgabe bearbeiten':'Aufgabe anlegen';
  document.getElementById('projectTaskId').value=t?.id||'';
  document.getElementById('projectTaskTitle').value=defaults.title||t?.title||'';
  document.getElementById('projectTaskDescription').value=defaults.description||t?.description||'';
  document.getElementById('projectTaskProject').value=defaults.project_id||t?.project_id||(!projectCanManage()&&leadProjects[0]?.id)||'';
  populateProjectAssigneeForProject(document.getElementById('projectTaskProject').value,defaults.assignee_employee_id||t?.assignee_employee_id||'');
  document.getElementById('projectTaskStatus').value=defaults.status||t?.status||'open';
  document.getElementById('projectTaskPriority').value=defaults.priority||t?.priority||'medium';
  document.getElementById('projectTaskStart').value=defaults.start_date||t?.start_date||'';
  document.getElementById('projectTaskDue').value=defaults.due_date||t?.due_date||'';
  document.getElementById('projectTaskRecurrence').value=defaults.recurrence||t?.recurrence||'none';
  renderProjectChecklistEditor(t?.checklist||defaults.checklist||[]);
  renderProjectTaskCollaboration(t);
  updateProjectTaskConflictWarning();
  const full=t?projectCanManageProject(t.project_id):(projectCanManage()||projectIsLead(document.getElementById('projectTaskProject').value));
  const own=t&&sessionRole==='employee'&&t.assignee_employee_id===currentProjectEmployeeId();
  const readOnly=t&&!full&&!own;
  ['projectTaskTitle','projectTaskDescription','projectTaskProject','projectTaskAssignee','projectTaskPriority','projectTaskStart','projectTaskDue','projectTaskRecurrence'].forEach(x=>{const el=document.getElementById(x);if(el)el.disabled=!full});
  document.getElementById('projectTaskStatus').disabled=readOnly;
  document.getElementById('projectTaskAddChecklist').disabled=readOnly;
  document.querySelectorAll('#projectTaskChecklist input,#projectTaskChecklist button').forEach(el=>el.disabled=readOnly);
  document.getElementById('projectTaskForm').querySelector('button[type="submit"]').classList.toggle('hidden',readOnly);
  document.getElementById('deleteProjectTaskBtn').classList.toggle('hidden',!t||!projectCanManageProject(t.project_id));
  document.getElementById('projectTaskBackBtn')?.classList.toggle('hidden',!projectDialogReturnProjectId);
  safeShowDialog('projectTaskDialog');
}
async function saveProjectTaskFromForm(){
  const id=document.getElementById('projectTaskId').value||null,existing=id?projectTasks.find(x=>x.id===id):null;
  const projectId=document.getElementById('projectTaskProject').value||null;
  const full=projectCanManageProject(projectId),own=existing&&sessionRole==='employee'&&existing.assignee_employee_id===currentProjectEmployeeId();
  if(!full&&!own)return;
  const row={title:document.getElementById('projectTaskTitle').value.trim(),description:document.getElementById('projectTaskDescription').value.trim(),project_id:projectId,assignee_employee_id:document.getElementById('projectTaskAssignee').value||null,status:document.getElementById('projectTaskStatus').value,priority:document.getElementById('projectTaskPriority').value,start_date:document.getElementById('projectTaskStart').value||null,due_date:document.getElementById('projectTaskDue').value||null,recurrence:document.getElementById('projectTaskRecurrence').value,checklist:collectProjectChecklist(),completed_at:document.getElementById('projectTaskStatus').value==='done'?new Date().toISOString():null,updated_at:new Date().toISOString()};
  if(!row.title)return;
  if(own&&!full){row.title=existing.title;row.description=existing.description;row.project_id=existing.project_id;row.assignee_employee_id=existing.assignee_employee_id;row.priority=existing.priority;row.start_date=existing.start_date;row.due_date=existing.due_date;row.recurrence=existing.recurrence}
  let savedId=id;
  if(supabaseClient&&authUser){
    row.team_id=(window.TEAMPLAN_CONFIG||{}).teamId;
    const res=id?await supabaseClient.from('teamplan_tasks').update(row).eq('id',id).select('id').single():await supabaseClient.from('teamplan_tasks').insert(row).select('id').single();
    if(res.error){alert(res.error.message);return}
    savedId=res.data.id;
    try{await ensureProjectMember(row.project_id,row.assignee_employee_id)}catch(err){alert('Aufgabe gespeichert, aber Projektteam konnte nicht ergänzt werden: '+err.message)}
    await logProjectActivity('task',savedId,id?'Aufgabe aktualisiert':'Aufgabe angelegt',row.title);await loadProjectData();
  }else{
    if(id){const i=projectTasks.findIndex(x=>x.id===id);if(i>=0)projectTasks[i]={...projectTasks[i],...row}}
    else{savedId=uid();projectTasks.push({id:savedId,...row,created_at:new Date().toISOString()})}
    await ensureProjectMember(row.project_id,row.assignee_employee_id);
    const savedTask=projectTasks.find(x=>x.id===savedId);localNextRecurringTask(savedTask);
    await logProjectActivity('task',savedId,id?'Aufgabe aktualisiert':'Aufgabe angelegt',row.title);saveProjectLocal();renderProjectModule();
  }
  document.getElementById('projectTaskDialog').close();showToast(id?'Aufgabe aktualisiert':'Aufgabe angelegt');
}
async function deleteProjectTask(){
  const id=document.getElementById('projectTaskId').value,t=projectTasks.find(x=>x.id===id);if(!id||!projectCanManageProject(t?.project_id)||!confirm('Aufgabe wirklich löschen?'))return;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_tasks').delete().eq('id',id);if(error){alert(error.message);return}await loadProjectData()}
  else{projectTasks=projectTasks.filter(x=>x.id!==id);projectComments=projectComments.filter(x=>x.task_id!==id);saveProjectLocal();renderProjectModule()}
  document.getElementById('projectTaskDialog').close();showToast('Aufgabe gelöscht');
}

async function toggleProjectTaskDone(taskId){
  const task=projectTasks.find(t=>t.id===taskId);if(!task||!projectCanManageTask(task))return;
  const next=task.status==='done'?'open':'done',patch={status:next,completed_at:next==='done'?new Date().toISOString():null};
  if(supabaseClient&&authUser){
    const {error}=await supabaseClient.from('teamplan_tasks').update({...patch,updated_at:new Date().toISOString()}).eq('id',taskId);
    if(error){alert(error.message);return}
    await logProjectActivity('task',taskId,next==='done'?'Aufgabe erledigt':'Aufgabe wieder geöffnet',task.title);
    await loadProjectData();
  }else{
    Object.assign(task,patch,{updated_at:new Date().toISOString()});localNextRecurringTask(task);
    await logProjectActivity('task',taskId,next==='done'?'Aufgabe erledigt':'Aufgabe wieder geöffnet',task.title);
    saveProjectLocal();renderProjectModule();
  }
  const pid=task.project_id;
  if(document.getElementById('projectDialog')?.open&&pid){renderProjectDialogSummary(pid);renderProjectDialogTasks(pid)}
}
async function saveProjectBackup(){
  const payload={version:1,exported_at:new Date().toISOString(),projects:projectProjects,members:projectMembers,tasks:projectTasks,templates:projectTemplates,notes:projectNotes,comments:projectComments,activity:projectActivity};
  const filename='TeamPlan-Projekte-'+dateKey(new Date())+'.json',data=JSON.stringify(payload,null,2);
  try{
    if(window.showSaveFilePicker){
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'TeamPlan Projekt-Sicherung',accept:{'application/json':['.json']}}]});
      const writable=await handle.createWritable();await writable.write(data);await writable.close();showToast('Projekt-Sicherung gespeichert');return;
    }
  }catch(err){if(err?.name==='AbortError')return;console.warn(err)}
  const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Projekt-Sicherung erstellt');
}
function projectResponsibleNames(projectId){
  return projectMembers.filter(m=>m.project_id===projectId&&m.is_responsible).map(m=>projectEmployeeName(m.employee_id));
}
function projectReportTaskRows(tasks){
  return tasks.map(t=>'<tr><td>'+escapeHtml(t.title)+'</td><td>'+escapeHtml(projectName(t.project_id))+'</td><td>'+escapeHtml(projectEmployeeName(t.assignee_employee_id))+'</td><td>'+escapeHtml(projectTaskStatusLabel(t.status))+'</td><td>'+escapeHtml(projectPriorityLabel(t.priority))+'</td><td>'+(t.due_date?escapeHtml(projectDateLabel(t.due_date)):'')+'</td></tr>').join('');
}
function buildProjectPdfHtml(options){
  const year=projectCalendarDate.getFullYear(),month=projectCalendarDate.getMonth(),sections=[];
  if(options.projects)sections.push('<section><h2>Aktuelle Projekte</h2>'+projectProjects.filter(p=>p.status!=='done').map(p=>{const info=projectProgressInfo(p.id,p.progress),responsibles=projectResponsibleNames(p.id);return '<div class="report-project"><div class="report-project-head"><strong>'+escapeHtml(p.name)+'</strong><b>'+info.percent+' %</b></div><div class="bar"><i style="width:'+info.percent+'%;background:'+projectProgressColor(info.percent)+'"></i></div><p>Status: '+escapeHtml(projectStatusLabel(p.status))+' · Leitung: '+escapeHtml(projectEmployeeName(p.lead_employee_id))+(responsibles.length?' · Weitere Verantwortliche: '+escapeHtml(responsibles.join(', ')):'')+(p.due_date?' · Ziel: '+escapeHtml(projectDateLabel(p.due_date)):'')+'</p></div>'}).join('')+'</section>');
  if(options.tasks)sections.push('<section><h2>Aufgaben & Status</h2><table><thead><tr><th>Aufgabe</th><th>Projekt</th><th>Verantwortlich</th><th>Status</th><th>Priorität</th><th>Fällig</th></tr></thead><tbody>'+projectReportTaskRows(projectTasks)+'</tbody></table></section>');
  if(options.month){
    const monthly=projectTasks.filter(t=>t.due_date&&new Date(t.due_date+'T12:00:00').getFullYear()===year&&new Date(t.due_date+'T12:00:00').getMonth()===month),monthlyProjects=projectProjects.filter(p=>p.due_date&&new Date(p.due_date+'T12:00:00').getFullYear()===year&&new Date(p.due_date+'T12:00:00').getMonth()===month);
    const entries=[...monthlyProjects.map(p=>({date:p.due_date,text:'Projekt: '+p.name})),...monthly.map(t=>({date:t.due_date,text:'Aufgabe: '+t.title+' · '+projectEmployeeName(t.assignee_employee_id)}))].sort((a,b)=>a.date.localeCompare(b.date));
    sections.push('<section><h2>Monatsübersicht '+MONTHS[month]+' '+year+'</h2><div class="date-list">'+(entries.length?entries.map(x=>'<div><time>'+escapeHtml(projectDateLabel(x.date))+'</time><span>'+escapeHtml(x.text)+'</span></div>').join(''):'<p>Keine Termine in diesem Monat.</p>')+'</div></section>');
  }
  if(options.year)sections.push('<section><h2>Jahresübersicht '+year+'</h2><div class="year-grid">'+Array.from({length:12},(_,m)=>{const ts=projectTasks.filter(t=>t.due_date&&new Date(t.due_date+'T12:00:00').getFullYear()===year&&new Date(t.due_date+'T12:00:00').getMonth()===m),ps=projectProjects.filter(p=>p.due_date&&new Date(p.due_date+'T12:00:00').getFullYear()===year&&new Date(p.due_date+'T12:00:00').getMonth()===m);return '<div><h3>'+MONTHS[m]+'</h3><p>'+ps.length+' Projekte · '+ts.length+' Aufgaben</p>'+[...ps.map(p=>'▣ '+p.name),...ts.slice(0,6).map(t=>'✓ '+t.title)].map(x=>'<span>'+escapeHtml(x)+'</span>').join('')+'</div>'}).join('')+'</div></section>');
  if(options.team)sections.push('<section><h2>Projektteams</h2>'+projectProjects.map(p=>{const members=projectMembers.filter(m=>m.project_id===p.id);return '<div class="team-row"><strong>'+escapeHtml(p.name)+'</strong><p>Leitung: '+escapeHtml(projectEmployeeName(p.lead_employee_id))+'</p><p>Verantwortliche: '+escapeHtml(members.filter(m=>m.is_responsible).map(m=>projectEmployeeName(m.employee_id)).join(', ')||'keine zusätzlichen')+'</p><p>Team: '+escapeHtml(members.map(m=>projectEmployeeName(m.employee_id)).join(', ')||'kein Team hinterlegt')+'</p></div>'}).join('')+'</section>');
  if(options.notes)sections.push('<section><h2>Notizen</h2>'+projectNotes.map(n=>'<div class="note"><strong>'+escapeHtml(n.title||'Notiz')+'</strong><p>'+escapeHtml(n.body).replace(/\n/g,'<br>')+'</p><small>'+escapeHtml(projectName(n.project_id))+' · '+escapeHtml(n.author_name||'Team')+'</small></div>').join('')+'</section>');
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>TeamPlan Projektbericht</title><style>@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#24332f;font-size:10px;line-height:1.35}header{border-bottom:2px solid #d8891c;padding-bottom:8px;margin-bottom:14px}h1{font-size:20px;margin:0}header p{margin:3px 0 0;color:#687b75}section{margin:0 0 18px}h2{font-size:13px;margin:0 0 8px;color:#915d13}h3{font-size:10px;margin:0 0 4px}.report-project,.team-row,.note{break-inside:avoid;border:1px solid #dfe8e5;border-radius:7px;padding:7px;margin-bottom:6px}.report-project-head{display:flex;justify-content:space-between}.bar{height:5px;background:#edf0ef;border-radius:9px;overflow:hidden;margin:5px 0}.bar i{display:block;height:100%}p{margin:3px 0}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #dfe8e5;text-align:left;vertical-align:top}th{background:#f5f7f6}.date-list>div{display:grid;grid-template-columns:80px 1fr;border-bottom:1px solid #edf0ef;padding:4px}.date-list time{font-weight:bold}.year-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.year-grid>div{break-inside:avoid;border:1px solid #dfe8e5;border-radius:7px;padding:6px;min-height:76px}.year-grid span{display:block;font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{color:#71837e}</style></head><body><header><h1>TeamPlan ZNA · Projektbericht</h1><p>Erstellt am '+new Date().toLocaleString('de-DE')+'</p></header>'+sections.join('')+'</body></html>';
}
function exportProjectPdf(){
  const options={projects:document.getElementById('projectExportProjects')?.checked,tasks:document.getElementById('projectExportTasks')?.checked,month:document.getElementById('projectExportMonth')?.checked,year:document.getElementById('projectExportYear')?.checked,team:document.getElementById('projectExportTeam')?.checked,notes:document.getElementById('projectExportNotes')?.checked};
  if(!Object.values(options).some(Boolean)){showToast('Bitte mindestens einen PDF-Inhalt auswählen');return}
  reportPrintWindow('Projektbericht',buildProjectPdfHtml(options),'projectExportDialog');
}
function openProjectNote(id=null){
  const n=id?projectNotes.find(x=>x.id===id):null;
  if(n&&sessionRole!=='admin'&&sessionRole!=='planner'&&authUser&&n.author_user_id!==authUser.id)return;
  populateProjectControls();
  document.getElementById('projectNoteDialogTitle').textContent=n?'Notiz bearbeiten':'Notiz hinzufügen';
  document.getElementById('projectNoteId').value=n?.id||'';
  document.getElementById('projectNoteTitle').value=n?.title||'';
  document.getElementById('projectNoteBody').value=n?.body||'';
  document.getElementById('projectNoteCategory').value=n?.category||'info';
  document.getElementById('projectNoteProject').value=n?.project_id||'';
  document.getElementById('deleteProjectNoteBtn').classList.toggle('hidden',!n);
  safeShowDialog('projectNoteDialog');
}
async function saveProjectNoteFromForm(){
  const id=document.getElementById('projectNoteId').value||null,row={title:document.getElementById('projectNoteTitle').value.trim(),body:document.getElementById('projectNoteBody').value.trim(),category:document.getElementById('projectNoteCategory').value,project_id:document.getElementById('projectNoteProject').value||null,author_name:authMembership?.display_name||actorName(),updated_at:new Date().toISOString()};
  if(!row.body)return;
  if(supabaseClient&&authUser){row.team_id=(window.TEAMPLAN_CONFIG||{}).teamId;if(!id)row.author_user_id=authUser.id;const res=id?await supabaseClient.from('teamplan_notes').update(row).eq('id',id):await supabaseClient.from('teamplan_notes').insert(row);if(res.error){alert(res.error.message);return}await loadProjectData()}
  else{if(id){const i=projectNotes.findIndex(x=>x.id===id);if(i>=0)projectNotes[i]={...projectNotes[i],...row}}else projectNotes.unshift({id:uid(),...row,created_at:new Date().toISOString()});saveProjectLocal();renderProjectModule()}
  document.getElementById('projectNoteDialog').close();showToast(id?'Notiz aktualisiert':'Notiz hinzugefügt');
}
async function deleteProjectNote(){
  const id=document.getElementById('projectNoteId').value;if(!id||!confirm('Notiz wirklich löschen?'))return;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_notes').delete().eq('id',id);if(error){alert(error.message);return}await loadProjectData()}
  else{projectNotes=projectNotes.filter(x=>x.id!==id);saveProjectLocal();renderProjectModule()}
  document.getElementById('projectNoteDialog').close();showToast('Notiz gelöscht');
}
async function updateProjectStatusByDrop(id,status){
  if(!projectCanManageProject(id))return;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_projects').update({status,updated_at:new Date().toISOString()}).eq('id',id);if(error){alert(error.message);return}await logProjectActivity('project',id,'Status geändert',projectStatusLabel(status));await loadProjectData()}
  else{const p=projectProjects.find(x=>x.id===id);if(p)p.status=status;await logProjectActivity('project',id,'Status geändert',projectStatusLabel(status));saveProjectLocal();renderProjectModule()}
}
async function updateProjectTaskByDrop(id,patch){
  const t=projectTasks.find(x=>x.id===id);if(!t||!projectCanManageTask(t))return;
  const full=projectCanManageProject(t.project_id);
  if(!full)patch={status:patch.status||t.status};
  if(patch.status==='done')patch.completed_at=new Date().toISOString();
  if(patch.status&&patch.status!=='done')patch.completed_at=null;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_tasks').update({...patch,updated_at:new Date().toISOString()}).eq('id',id);if(error){alert(error.message);return}await logProjectActivity('task',id,'Aufgabe verschoben',patch.status?projectTaskStatusLabel(patch.status):('Termin '+projectDateLabel(patch.due_date)));await loadProjectData()}
  else{Object.assign(t,patch);localNextRecurringTask(t);await logProjectActivity('task',id,'Aufgabe verschoben',patch.status?projectTaskStatusLabel(patch.status):('Termin '+projectDateLabel(patch.due_date)));saveProjectLocal();renderProjectModule()}
}
async function reorderProjectTask(dragId,targetId,status){
  if(!dragId||dragId===targetId)return;
  const drag=projectTasks.find(t=>t.id===dragId),target=projectTasks.find(t=>t.id===targetId);if(!drag||!target||!projectCanManageTask(drag))return;
  const others=projectTasks.filter(t=>t.id!==dragId&&t.status===status).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const targetIndex=Math.max(0,others.findIndex(t=>t.id===targetId));drag.status=status;
  others.splice(targetIndex,0,drag);
  others.forEach((t,i)=>t.sort_order=(i+1)*10);
  if(supabaseClient&&authUser){
    const results=await Promise.all(others.map(t=>supabaseClient.from('teamplan_tasks').update({status:t.status,sort_order:t.sort_order,updated_at:new Date().toISOString()}).eq('id',t.id)));
    const bad=results.find(r=>r.error);if(bad){alert(bad.error.message);return}await loadProjectData();
  }else{saveProjectLocal();renderProjectModule()}
}
function resetProjectTemplateForm(){
  document.getElementById('projectTemplateId').value='';
  document.getElementById('projectTemplateName').value='';
  document.getElementById('projectTemplateDescription').value='';
  document.getElementById('projectTemplatePriority').value='medium';
  document.getElementById('projectTemplateRecurrence').value='none';
  document.getElementById('projectTemplateSort').value='100';
  document.getElementById('deleteProjectTemplateBtn').classList.add('hidden');
}
function renderProjectTemplatesList(){
  const list=document.getElementById('projectTemplatesList');if(!list)return;
  const rows=[...projectTemplates].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  list.innerHTML=rows.length?rows.map(t=>'<button type="button" class="management-row project-template-row" data-project-template-id="'+t.id+'"><span><strong>'+escapeHtml(t.name)+'</strong><small>'+escapeHtml(projectPriorityLabel(t.default_priority))+' · '+escapeHtml(t.recurrence||'none')+'</small></span><span>Bearbeiten</span></button>').join(''):'<div class="empty-state">Noch keine Vorlagen.</div>';
  list.querySelectorAll('[data-project-template-id]').forEach(btn=>btn.addEventListener('click',()=>editProjectTemplate(btn.dataset.projectTemplateId)));
}
function editProjectTemplate(id){
  const t=projectTemplates.find(x=>x.id===id);if(!t)return;
  document.getElementById('projectTemplateId').value=t.id;
  document.getElementById('projectTemplateName').value=t.name||'';
  document.getElementById('projectTemplateDescription').value=t.description||'';
  document.getElementById('projectTemplatePriority').value=t.default_priority||'medium';
  document.getElementById('projectTemplateRecurrence').value=t.recurrence||'none';
  document.getElementById('projectTemplateSort').value=String(t.sort_order||100);
  document.getElementById('deleteProjectTemplateBtn').classList.remove('hidden');
}
function openProjectTemplates(){
  if(!projectCanManage())return;renderProjectTemplatesList();resetProjectTemplateForm();safeShowDialog('projectTemplatesDialog');
}
async function saveProjectTemplate(){
  if(!projectCanManage())return;
  const id=document.getElementById('projectTemplateId').value||null,row={name:document.getElementById('projectTemplateName').value.trim(),description:document.getElementById('projectTemplateDescription').value.trim(),default_priority:document.getElementById('projectTemplatePriority').value,recurrence:document.getElementById('projectTemplateRecurrence').value,sort_order:Number(document.getElementById('projectTemplateSort').value||100),active:true};
  if(!row.name)return;
  if(supabaseClient&&authUser){row.team_id=(window.TEAMPLAN_CONFIG||{}).teamId;const res=id?await supabaseClient.from('teamplan_task_templates').update(row).eq('id',id):await supabaseClient.from('teamplan_task_templates').insert(row);if(res.error){alert(res.error.message);return}await loadProjectData()}
  else{if(id){const i=projectTemplates.findIndex(x=>x.id===id);if(i>=0)projectTemplates[i]={...projectTemplates[i],...row}}else projectTemplates.push({id:uid(),...row});saveProjectLocal()}
  renderProjectTemplatesList();resetProjectTemplateForm();populateProjectControls();showToast(id?'Vorlage aktualisiert':'Vorlage angelegt');
}
async function deleteProjectTemplate(){
  const id=document.getElementById('projectTemplateId').value;if(!id||!projectCanManage()||!confirm('Vorlage wirklich löschen?'))return;
  if(supabaseClient&&authUser){const {error}=await supabaseClient.from('teamplan_task_templates').delete().eq('id',id);if(error){alert(error.message);return}await loadProjectData()}
  else{projectTemplates=projectTemplates.filter(x=>x.id!==id);saveProjectLocal()}
  renderProjectTemplatesList();resetProjectTemplateForm();populateProjectControls();showToast('Vorlage gelöscht');
}
function bindProjectRenderedEvents(){
  document.querySelectorAll('[data-project-id]').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('[data-project-task-id]'))return;const id=el.dataset.projectId;if(id)openProject(id)}));
  document.querySelectorAll('[data-project-task-id]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();openProjectTask(el.dataset.projectTaskId)}));
  document.querySelectorAll('[data-project-note-id]').forEach(el=>el.addEventListener('click',()=>openProjectNote(el.dataset.projectNoteId)));
  document.querySelectorAll('.project-card[draggable="true"]').forEach(el=>{el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/project-id',el.dataset.projectId);el.classList.add('dragging')});el.addEventListener('dragend',()=>el.classList.remove('dragging'))});
  document.querySelectorAll('[data-project-drop-status]').forEach(z=>{z.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/project-id')){e.preventDefault();z.classList.add('drag-over')}});z.addEventListener('dragleave',()=>z.classList.remove('drag-over'));z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('drag-over');const id=e.dataTransfer.getData('text/project-id');if(id)updateProjectStatusByDrop(id,z.dataset.projectDropStatus)})});
  document.querySelectorAll('.project-task-card[draggable="true"],.project-calendar-item[draggable="true"]').forEach(el=>{el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/project-task-id',el.dataset.projectTaskId);el.classList.add('dragging')});el.addEventListener('dragend',()=>el.classList.remove('dragging'))});
  document.querySelectorAll('.kanban-list .project-task-card').forEach(card=>{card.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/project-task-id'))e.preventDefault()});card.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('text/project-task-id');const col=card.closest('[data-task-drop-status]');if(id&&col)reorderProjectTask(id,card.dataset.projectTaskId,col.dataset.taskDropStatus)})});
  document.querySelectorAll('[data-task-drop-status]').forEach(z=>{z.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/project-task-id')){e.preventDefault();z.classList.add('drag-over')}});z.addEventListener('dragleave',()=>z.classList.remove('drag-over'));z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('drag-over');const id=e.dataTransfer.getData('text/project-task-id');if(id)updateProjectTaskByDrop(id,{status:z.dataset.taskDropStatus})})});
  document.querySelectorAll('[data-project-date]').forEach(day=>{
    day.addEventListener('click',e=>{
      if(e.target.closest('[data-project-id],[data-project-task-id]'))return;
      e.preventDefault();e.stopPropagation();
      openProjectForDate(day.dataset.projectDate);
    });
    day.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('text/project-task-id')){e.preventDefault();day.classList.add('drag-over')}});
    day.addEventListener('dragleave',()=>day.classList.remove('drag-over'));
    day.addEventListener('drop',e=>{e.preventDefault();day.classList.remove('drag-over');const id=e.dataTransfer.getData('text/project-task-id');if(id)updateProjectTaskByDrop(id,{due_date:day.dataset.projectDate})});
  });
}
function createTaskFromTemplate(id){
  const t=projectTemplates.find(x=>x.id===id);if(!t)return;
  document.getElementById('projectsTemplateSelect').value='';
  openProjectTask(null,{title:t.name,description:t.description,priority:t.default_priority||'medium',recurrence:t.recurrence||'none'});
}
function initProjectModuleUI(){
  if(projectUiInitialized)return;
  projectUiInitialized=true;
  document.getElementById('moduleProjectsBtn')?.addEventListener('click',()=>switchModule('projects'));
  const map={projectsOverviewBtn:'overview',projectsMyBtn:'my',projectsRoadmapBtn:'roadmap',projectsBoardBtn:'board',projectsCalendarBtn:'calendar',projectsTeamBtn:'team',projectsNotesBtn:'notes'};
  Object.entries(map).forEach(([id,v])=>document.getElementById(id)?.addEventListener('click',()=>setProjectView(v)));
  ['projectsSearchInput','projectsProjectFilter','projectsAssigneeFilter','projectsStatusFilter'].forEach(id=>document.getElementById(id)?.addEventListener(id==='projectsSearchInput'?'input':'change',renderProjectModule));
  document.getElementById('projectsTemplateSelect')?.addEventListener('change',e=>{if(e.target.value)createTaskFromTemplate(e.target.value)});
  document.getElementById('projectsSaveBtn')?.addEventListener('click',saveProjectBackup);
  document.getElementById('projectsPdfBtn')?.addEventListener('click',()=>safeShowDialog('projectExportDialog'));
  document.getElementById('projectExportForm')?.addEventListener('submit',e=>{e.preventDefault();exportProjectPdf()});
  document.getElementById('projectsTemplatesBtn')?.addEventListener('click',openProjectTemplates);
  document.getElementById('addProjectBtn')?.addEventListener('click',()=>openProject());
  document.getElementById('addTaskBtn')?.addEventListener('click',()=>openProjectTask());
  document.getElementById('projectMemberSearch')?.addEventListener('input',()=>renderProjectMemberChoices(document.getElementById('projectId').value||''));
  document.getElementById('projectShowExternal')?.addEventListener('change',e=>{projectShowExternal=e.target.checked;localStorage.setItem('teamplan-project-show-external',projectShowExternal?'1':'0');renderProjectMemberChoices(document.getElementById('projectId').value||'')});
  document.getElementById('projectMembersAllBtn')?.addEventListener('click',()=>{state.employees.forEach(emp=>{const old=projectMemberDraft.get(emp.id)||{employee_id:emp.id,is_responsible:false};projectMemberDraft.set(emp.id,{...old,checked:true})});renderProjectMemberChoices(document.getElementById('projectId').value||'')});
  document.getElementById('projectMembersNoneBtn')?.addEventListener('click',()=>{projectMemberDraft.forEach((v,k)=>projectMemberDraft.set(k,{...v,checked:false,is_responsible:false}));renderProjectMemberChoices(document.getElementById('projectId').value||'')});
  document.getElementById('projectAddTaskBtn')?.addEventListener('click',()=>{const projectId=document.getElementById('projectId').value;if(!projectId)return;document.getElementById('projectDialog').close();openProjectTask(null,{project_id:projectId})});
  document.getElementById('projectBackBtn')?.addEventListener('click',()=>{document.getElementById('projectDialog')?.close();setProjectView('overview')});
  document.getElementById('projectTaskBackBtn')?.addEventListener('click',()=>{const pid=projectDialogReturnProjectId;document.getElementById('projectTaskDialog')?.close();if(pid)openProject(pid)});
  document.getElementById('projectTeamToggle')?.addEventListener('click',()=>{
    const body=document.getElementById('projectTeamBody'),btn=document.getElementById('projectTeamToggle');if(!body||!btn)return;
    body.hidden=!body.hidden;btn.setAttribute('aria-expanded',String(!body.hidden));
  });
  document.getElementById('projectTaskProject')?.addEventListener('change',e=>{projectDialogReturnProjectId=e.target.value||null;populateProjectAssigneeForProject(e.target.value,document.getElementById('projectTaskAssignee').value)});
  document.getElementById('addNoteBtn')?.addEventListener('click',()=>openProjectNote());
  document.getElementById('projectForm')?.addEventListener('submit',e=>{e.preventDefault();saveProjectFromForm()});
  document.getElementById('projectTaskForm')?.addEventListener('submit',e=>{e.preventDefault();saveProjectTaskFromForm()});
  document.getElementById('projectNoteForm')?.addEventListener('submit',e=>{e.preventDefault();saveProjectNoteFromForm()});
  document.getElementById('projectTemplateForm')?.addEventListener('submit',e=>{e.preventDefault();saveProjectTemplate()});
  document.getElementById('resetProjectTemplateBtn')?.addEventListener('click',resetProjectTemplateForm);
  document.getElementById('deleteProjectTemplateBtn')?.addEventListener('click',deleteProjectTemplate);
  document.getElementById('projectTaskAddChecklist')?.addEventListener('click',addProjectChecklistRow);
  document.getElementById('projectTaskCommentAdd')?.addEventListener('click',addProjectTaskComment);
  document.getElementById('projectTaskCommentInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addProjectTaskComment()}});
  ['projectTaskAssignee','projectTaskDue'].forEach(id=>document.getElementById(id)?.addEventListener('change',updateProjectTaskConflictWarning));
  document.getElementById('deleteProjectBtn')?.addEventListener('click',deleteProject);
  document.getElementById('deleteProjectTaskBtn')?.addEventListener('click',deleteProjectTask);
  document.getElementById('deleteProjectNoteBtn')?.addEventListener('click',deleteProjectNote);
  document.getElementById('projectsCalendarPrev')?.addEventListener('click',()=>{projectCalendarDate=projectCalendarMode==='year'?new Date(projectCalendarDate.getFullYear()-1,0,1):new Date(projectCalendarDate.getFullYear(),projectCalendarDate.getMonth()-1,1);localStorage.setItem('teamplan-project-calendar-date',dateKey(projectCalendarDate));renderProjectCalendar();bindProjectRenderedEvents()});
  document.getElementById('projectsCalendarNext')?.addEventListener('click',()=>{projectCalendarDate=projectCalendarMode==='year'?new Date(projectCalendarDate.getFullYear()+1,0,1):new Date(projectCalendarDate.getFullYear(),projectCalendarDate.getMonth()+1,1);localStorage.setItem('teamplan-project-calendar-date',dateKey(projectCalendarDate));renderProjectCalendar();bindProjectRenderedEvents()});
  document.getElementById('projectsCalendarToday')?.addEventListener('click',()=>{projectCalendarDate=new Date();localStorage.setItem('teamplan-project-calendar-date',dateKey(projectCalendarDate));renderProjectCalendar();bindProjectRenderedEvents()});
  document.getElementById('projectsCalendarMonthBtn')?.addEventListener('click',()=>{projectCalendarMode='month';localStorage.setItem('teamplan-project-calendar-mode',projectCalendarMode);renderProjectCalendar();bindProjectRenderedEvents()});
  document.getElementById('projectsCalendarYearBtn')?.addEventListener('click',()=>{projectCalendarMode='year';localStorage.setItem('teamplan-project-calendar-mode',projectCalendarMode);renderProjectCalendar();bindProjectRenderedEvents()});
  initCompactDrawer('projectsFilterToggle','projectsFilterBar','teamplan-project-filter-open');
  loadProjectLocal();renderProjectModule();
}

