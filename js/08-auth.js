// Einstellungen, Konto, Ersteinrichtung, Anmeldung, Remote-Plan
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
function openSettings(){
  const s=state.settings;renderBaseCodeColorsSettings();renderCustomCodesSettings();
  document.getElementById('settingBaseVacation').value=s.baseVacation;document.getElementById('settingMaxVacation').value=s.maxVacation;document.getElementById('settingMaxAbsence').value=s.maxAbsence;document.getElementById('settingCountSchool').checked=selectedCountCodes().includes('S');document.getElementById('settingConfirmConflicts').checked=s.confirmConflicts;
  document.getElementById('accountName').value=authMembership?.display_name||'';
  document.getElementById('accountEmail').value=authUser?.email||'';
  document.getElementById('accountPassword').value='';
  document.getElementById('accountInfo').textContent='E-Mail-Änderungen können eine Bestätigung an die neue Adresse auslösen.';
  const planning=document.getElementById('planningSettingsSection'),save=document.getElementById('planningSettingsSaveBtn');
  document.querySelectorAll('.manager-only').forEach(el=>el.classList.toggle('hidden',!canManage()));
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
  if(sessionRole==='external'){
    const {data,error}=await supabaseClient.rpc('get_my_project_directory',{p_team_id:cfg.teamId});
    if(error)throw error;
    const safe=structuredClone(defaultState);
    safe.employees=Array.isArray(data)?data:[];
    safe.entries={};safe.blackouts=[];safe.audit=[];
    state=normalizeState(safe);
    renderRoleControls();
    return true;
  }
  const {data,error}=await supabaseClient.from('team_plans').select('data,updated_at').eq('team_id',cfg.teamId).maybeSingle();
  if(error)throw error;
  if(data?.data){
    isApplyingRemote=true;
    state=normalizeState(data.data);
    localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));
    isApplyingRemote=false;
    try{
      renderRoleControls();
      render();
    }catch(renderErr){
      console.error('Urlaubsplan-Renderfehler',renderErr);
    }
  }else if(canManage()){
    await pushRemote();
  }
  return true;
}
function showLogin(){
  const d=document.getElementById('loginDialog');if(d&&!d.open)d.showModal();
}
function hideLogin(){const d=document.getElementById('loginDialog');if(d?.open)d.close()}
