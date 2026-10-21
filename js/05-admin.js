// Rollen, Benutzerverwaltung, Sperrzeiten, Verlauf
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function renderRoleControls(){
  const role=document.getElementById('roleSelect'),emp=document.getElementById('roleEmployeeSelect'),authMode=!!authUser;
  role.value=sessionRole;
  const selectableTeam=[...teamEmployees()].sort((a,b)=>a.order-b.order);
  emp.innerHTML=selectableTeam.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  if(!sessionEmployeeId&&selectableTeam.length)sessionEmployeeId=selectableTeam[0].id;
  emp.value=sessionEmployeeId;
  role.classList.toggle('hidden',authMode);
  emp.classList.toggle('hidden',authMode||sessionRole!=='employee');
  const pill=document.getElementById('authUserPill'),logout=document.getElementById('logoutBtn'),onlinePill=document.getElementById('onlinePill');
  pill.classList.toggle('hidden',!authMode);logout.classList.toggle('hidden',!authMode);if(onlinePill)onlinePill.classList.toggle('hidden',!authMode);
  if(authMode)pill.textContent='Angemeldet: '+(authUser.email||'Benutzer')+' · '+roleLabel(sessionRole);
  const externalAccess=sessionRole==='external';
  document.getElementById('moduleVacationBtn')?.classList.toggle('hidden',externalAccess);
  document.getElementById('moduleTrainingBtn')?.classList.toggle('hidden',externalAccess);
  document.getElementById('moduleProjectsBtn')?.classList.remove('hidden');
  if(externalAccess&&currentModule!=='projects'){currentModule='projects';localStorage.setItem('teamplan-module','projects')}
  ['blackoutsBtn','addEmployeeBtn','importNamesBtn','planImportBtn'].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=!canManage();el.classList.toggle('hidden',!canManage())}});
  document.querySelectorAll('.manager-only').forEach(el=>el.classList.toggle('hidden',!canManage()));
  document.getElementById('settingsBtn').disabled=false;
  document.getElementById('usersBtn').classList.toggle('hidden',sessionRole!=='admin'||!authUser);
  const discussionsBtn=document.getElementById('discussionsBtn');if(discussionsBtn)discussionsBtn.classList.toggle('hidden',!authUser);
  updateDiscussionBadge();
  applyTrainingRoleUI();
  renderProjectModule();
}

async function invokeUserAdmin(body){
  if(!supabaseClient||sessionRole!=='admin')throw new Error('Nur Admins dürfen Benutzer verwalten.');
  const {data,error}=await supabaseClient.functions.invoke('teamplan-users',{body:{teamId:(window.TEAMPLAN_CONFIG||{}).teamId,...body}});
  if(error){
    let message=error.message||'Benutzerverwaltung fehlgeschlagen';
    try{
      const payload=await error.context?.json();
      if(payload?.error)message=payload.error;
    }catch{}
    throw new Error(message);
  }
  if(data?.error)throw new Error(data.error);
  return data;
}
function employeeOptions(selected='',role=''){
  const internal=[...teamEmployees()].sort((a,b)=>a.order-b.order);
  const external=[...externalEmployees()].sort((a,b)=>a.order-b.order);
  const showInternal=role!=='external',showExternal=role!=='employee';
  let html='<option value="">Keine Verknüpfung</option>';
  if(showInternal&&internal.length)html+='<optgroup label="ZNA-Team">'+internal.map(e=>'<option value="'+e.id+'" '+(e.id===selected?'selected':'')+'>'+escapeHtml(e.name)+'</option>').join('')+'</optgroup>';
  if(showExternal&&external.length)html+='<optgroup label="Externe Personen">'+external.map(e=>'<option value="'+e.id+'" '+(e.id===selected?'selected':'')+'>'+escapeHtml(e.name)+(e.organization?' · '+escapeHtml(e.organization):'')+'</option>').join('')+'</optgroup>';
  return html;
}
function syncInviteEmployeeOptions(){
  const role=document.getElementById('inviteRole')?.value||'employee',select=document.getElementById('inviteEmployee');if(!select)return;
  const old=select.value;select.innerHTML=employeeOptions(old,role);
  if(![...select.options].some(o=>o.value===old))select.value='';
}
async function openUsersDialog(){
  if(sessionRole!=='admin'){showToast('Nur Admins dürfen Benutzer verwalten');return}
  document.getElementById('inviteEmployee').innerHTML=employeeOptions('',document.getElementById('inviteRole')?.value||'employee');
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
          <option value="external" ${m.role==='external'?'selected':''}>Externer Projektmitarbeiter</option>
          <option value="viewer" ${m.role==='viewer'?'selected':''}>Nur Lesen</option>
        </select>
        <select class="user-employee">${employeeOptions(m.employee_id||'',m.role)}</select>
        <button type="button" class="btn ghost user-save">Speichern</button>
        <button type="button" class="btn ${m.active?'danger':'ghost'} user-toggle">${m.active?'Deaktivieren':'Reaktivieren'}</button>
        <button type="button" class="btn danger user-delete">Löschen</button>
      </div>`).join(''):'<div class="empty-state">Noch keine Benutzer gefunden.</div>';
    list.querySelectorAll('.user-row').forEach(row=>{
      row.querySelector('.user-role').addEventListener('change',()=>{
        const role=row.querySelector('.user-role').value,select=row.querySelector('.user-employee'),old=select.value;
        select.innerHTML=employeeOptions(old,role);
        if(![...select.options].some(o=>o.value===old))select.value='';
      });
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
