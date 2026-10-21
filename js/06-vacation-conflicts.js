// Urlaub: Konfliktprüfung
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function conflictItems(year=viewDate.getFullYear()){
  const out=[];
  for(let d=new Date(year,0,1);d<=new Date(year,11,31);d=addDays(d,1)){
    const key=dateKey(d),c=dailyCounts(key),b=blackoutForKey(key),conf=conflictLevel(key);
    if(conf.vacation||conf.total){
      const affected=teamEmployees().filter(e=>{
        const v=entryFor(e.id,key);if(!entryIsActive(v))return false;
        const codes=v.codes||[];
        return conf.vacation?codes.includes('U'):codes.some(code=>selectedCountCodes().includes(code));
      }).map(e=>e.id);
      out.push({
        id:'staffing:'+key,
        key,type:'Besetzung',
        text:`${c.U} Urlaub · ${c.total} relevante Abwesenheiten`,
        employeeIds:affected
      });
    }
    if(b){
      const affected=teamEmployees().filter(e=>{
        const v=entryFor(e.id,key);
        return entryIsActive(v)&&v.codes?.some(x=>['U','XU'].includes(x));
      });
      if(affected.length)out.push({
        id:'blackout:'+key,
        key,type:'Sperrzeit',
        text:`${b.name}: ${affected.map(e=>e.name).join(', ')}`,
        employeeIds:affected.map(e=>e.id)
      });
    }
    teamEmployees().forEach(e=>{
      const v=entryFor(e.id,key);
      if((v.status||'wish')==='wish'&&v.codes?.some(x=>['U','XU'].includes(x))){
        out.push({
          id:'wish:'+key+':'+e.id,
          key,type:'Offener Wunsch',
          text:e.name+' · '+v.codes.join('+'),
          employeeIds:[e.id],
          employeeId:e.id
        });
      }
    });
  }
  return out;
}
function conflictDateLabel(key){
  const d=new Date(key+'T12:00:00');
  return {day:String(d.getDate()).padStart(2,'0'),month:MONTHS[d.getMonth()].slice(0,3),dow:DOW[d.getDay()],full:d.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})};
}
function conflictTypeClass(type){
  return type==='Besetzung'?'staffing':type==='Sperrzeit'?'blackout':'wish';
}
function conflictTargetEntries(item){
  const targets=[];
  (item.employeeIds||[]).forEach(empId=>{
    const entry=state.entries?.[empId]?.[item.key];
    if(entry)targets.push({empId,key:item.key,entry});
  });
  return targets;
}
function updateConflictBulkUi(visible=[]){
  const count=document.getElementById('conflictSelectedCount');
  const apply=document.getElementById('conflictBulkApply');
  const clear=document.getElementById('conflictSelectionClear');
  const selectVisible=document.getElementById('conflictSelectVisible');
  const visibleIds=new Set(visible.map(x=>x.id));
  const selectedVisible=[...selectedConflictIds].filter(id=>visibleIds.has(id)).length;
  if(count)count.textContent=selectedConflictIds.size+' ausgewählt';
  if(apply)apply.disabled=!selectedConflictIds.size||!canManage();
  if(clear)clear.disabled=!selectedConflictIds.size;
  if(selectVisible){
    selectVisible.checked=visible.length>0&&selectedVisible===visible.length;
    selectVisible.indeterminate=selectedVisible>0&&selectedVisible<visible.length;
  }
}
function applyConflictBulkStatus(){
  if(!canManage()||!selectedConflictIds.size)return;
  const status=document.getElementById('conflictBulkStatus')?.value||'preliminary';
  const items=conflictItems().filter(x=>selectedConflictIds.has(x.id));
  const touched=new Map();
  items.forEach(item=>{
    conflictTargetEntries(item).forEach(({empId,key,entry})=>{
      const token=empId+'|'+key;
      if(touched.has(token))return;
      touched.set(token,true);
      if(!state.entries[empId])state.entries[empId]={};
      state.entries[empId][key]={...entry,status};
    });
  });
  if(!touched.size){showToast('Keine passenden Planeinträge gefunden');return}
  const label=status==='approved'?'genehmigt':status==='rejected'?'abgelehnt':status==='wish'?'auf Wunsch gesetzt':'vorläufig gesetzt';
  trackAction('Konflikte gesammelt geändert',touched.size+' Einträge · '+label);
  persist();
  touched.forEach((_,token)=>{
    const [empId,key]=token.split('|');
    saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);
  });
  selectedConflictIds.clear();
  render();renderConflicts();
  showToast(touched.size+' Planeinträge '+label);
}
function renderConflicts(){
  const items=conflictItems(),summary=document.getElementById('conflictsSummary'),list=document.getElementById('conflictsList');
  const counts=items.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{});
  summary.innerHTML=`<button type="button" data-summary-filter="all" class="${conflictFilter==='all'?'active':''}"><strong>${items.length}</strong><span>Gesamt</span><small>alle offenen Punkte</small></button><button type="button" data-summary-filter="Besetzung" class="${conflictFilter==='Besetzung'?'active':''}"><strong>${counts['Besetzung']||0}</strong><span>Besetzung</span><small>Grenzwerte überschritten</small></button><button type="button" data-summary-filter="Sperrzeit" class="${conflictFilter==='Sperrzeit'?'active':''}"><strong>${counts['Sperrzeit']||0}</strong><span>Sperrzeiten</span><small>Urlaub im gesperrten Zeitraum</small></button><button type="button" data-summary-filter="Offener Wunsch" class="${conflictFilter==='Offener Wunsch'?'active':''}"><strong>${counts['Offener Wunsch']||0}</strong><span>Wünsche</span><small>noch nicht entschieden</small></button>`;
  document.querySelectorAll('[data-conflict-filter]').forEach(b=>b.classList.toggle('active',b.dataset.conflictFilter===conflictFilter));
  const sortSelect=document.getElementById('conflictSort');if(sortSelect)sortSelect.value=conflictSort;
  let visible=conflictFilter==='all'?[...items]:items.filter(x=>x.type===conflictFilter);
  const order={'Besetzung':0,'Sperrzeit':1,'Offener Wunsch':2};
  visible.sort((a,b)=>conflictSort==='date'
    ? a.key.localeCompare(b.key)||(order[a.type]??9)-(order[b.type]??9)
    : (order[a.type]??9)-(order[b.type]??9)||a.key.localeCompare(b.key));

  const validIds=new Set(items.map(x=>x.id));
  [...selectedConflictIds].forEach(id=>{if(!validIds.has(id))selectedConflictIds.delete(id)});

  list.innerHTML=visible.length?visible.slice(0,500).map(x=>{
    const date=conflictDateLabel(x.key),selected=selectedConflictIds.has(x.id),people=(x.employeeIds||[]).length;
    return `<article class="conflict-card conflict-type-${conflictTypeClass(x.type)} ${selected?'selected':''}" data-conflict-id="${escapeHtml(x.id)}" data-date="${x.key}" data-type="${escapeHtml(x.type)}">
      <label class="conflict-check" title="Für Sammeländerung auswählen"><input type="checkbox" data-conflict-select ${selected?'checked':''}></label>
      <button type="button" class="conflict-date conflict-jump" title="Im Kalender öffnen"><strong>${date.day}</strong><span>${date.month}</span><small>${date.dow}</small></button>
      <div class="conflict-card-main">
        <div class="conflict-card-head"><span class="conflict-kind">${escapeHtml(x.type)}</span><small>${people} ${people===1?'Mitarbeiter':'Mitarbeiter'}</small></div>
        <strong>${escapeHtml(x.text)}</strong>
        <span>${escapeHtml(date.full)}</span>
      </div>
      <div class="conflict-card-actions">
        <button type="button" class="btn ghost conflict-jump">Kalender</button>
        ${canDiscuss()?'<button type="button" class="btn ghost conflict-discuss">Chat</button>':''}
      </div>
    </article>`;
  }).join(''):'<div class="empty-state success-state"><strong>Alles sauber</strong><span>Keine offenen Punkte für diesen Filter.</span></div>';

  summary.querySelectorAll('[data-summary-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    conflictFilter=btn.dataset.summaryFilter;
    selectedConflictIds.clear();
    renderConflicts();
  }));
  list.querySelectorAll('[data-conflict-select]').forEach(input=>input.addEventListener('change',()=>{
    const card=input.closest('.conflict-card'),id=card.dataset.conflictId;
    input.checked?selectedConflictIds.add(id):selectedConflictIds.delete(id);
    card.classList.toggle('selected',input.checked);
    updateConflictBulkUi(visible);
  }));
  list.querySelectorAll('.conflict-jump').forEach(btn=>btn.addEventListener('click',()=>{
    const item=btn.closest('.conflict-card'),d=new Date(item.dataset.date+'T12:00:00');
    viewDate=new Date(d.getFullYear(),d.getMonth(),1);currentView='month';
    document.getElementById('conflictsDialog').close();render();
  }));
  list.querySelectorAll('.conflict-discuss').forEach(btn=>btn.addEventListener('click',()=>{
    const item=btn.closest('.conflict-card');document.getElementById('conflictsDialog').close();
    openNewDiscussion({date:item.dataset.date,title:item.dataset.type+' · '+item.dataset.date,message:'Bitte hierzu im Team abstimmen.'});
  }));
  updateConflictBulkUi(visible);
}
