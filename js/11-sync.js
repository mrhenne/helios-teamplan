// Supabase-Verbindung, Live-Sync, Statusanzeige
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
async function retrySyncCall(fn,label,attempts=3){
  let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await fn()}
    catch(err){
      lastError=err;
      console.warn(label+' Versuch '+attempt+' fehlgeschlagen',err);
      if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,350*attempt));
    }
  }
  throw lastError;
}

async function completeSignedIn(user){
  if(!user)throw new Error('Anmeldung erfolgreich, aber kein Benutzerkonto wurde zurückgegeben.');
  authUser=user;
  startInactivityTimer();

  // Only authentication-critical data may block the login screen.
  await retrySyncCall(()=>loadAuthMembership(),'Team-Zuordnung');
  hideLogin();
  setSync('live','● Angemeldet');

  // Core vacation plan remains part of the initial app load.
  try{
    await retrySyncCall(()=>loadRemotePlan(),'Urlaubsplan');
  }catch(err){
    console.error('Urlaubsplan konnte nicht geladen werden',err);
    showToast('Angemeldet · Urlaubsplan derzeit nicht synchron');
  }

  // Optional modules must never throw the user back to the login dialog.
  const safeModuleLoad=async(label,fn)=>{
    try{await fn()}
    catch(err){
      console.error(label+' konnte nicht geladen werden',err);
      showToast(label+' konnte nicht geladen werden');
    }
  };

  const externalAccess=sessionRole==='external';
  await Promise.allSettled([
    externalAccess?Promise.resolve():safeModuleLoad('Fortbildungen',()=>retrySyncCall(()=>loadTrainingData(),'Fortbildungen',2)),
    safeModuleLoad('Projekte',()=>retrySyncCall(()=>loadProjectData(),'Projekte',2)),
    externalAccess?Promise.resolve():safeModuleLoad('Online-Status',startPresence),
    externalAccess?Promise.resolve():safeModuleLoad('Team-Chat',()=>retrySyncCall(()=>startDiscussionRealtime(),'Team-Chat',2))
  ]);

  // Realtime subscriptions are non-critical and are started independently.
  if(!externalAccess)startTrainingRealtime().catch(err=>console.error('Fortbildungs-Realtime',err));
  startProjectRealtime().catch(err=>console.error('Projekt-Realtime',err));

  setSync('live','● Live synchron');
  switchModule(currentModule,true);
}


async function initRemote(){
  const cfg=window.TEAMPLAN_CONFIG||{};
  if(!authConfigured()){setSync('local','● Lokal');return}
  try{
    supabaseClient=window.TEAMPLAN_LOGIN_CLIENT || window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    window.TEAMPLAN_LOGIN_CLIENT=supabaseClient;
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
      const user=session.user;
      await completeSignedIn(user);
    }
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      window.setTimeout(async()=>{
        if(event==='SIGNED_OUT'||!session){
          await stopProjectRealtime();await stopTrainingRealtime();await stopDiscussionRealtime();await stopPresence();
          stopInactivityTimer();authUser=null;authMembership=null;renderRoleControls();setSync('local','● Abgemeldet');showLogin();return;
        }
        if(event==='TOKEN_REFRESHED'){
          authUser=session.user||authUser;
          return;
        }
        if(event==='SIGNED_IN'&&authUser?.id!==session.user?.id){
          try{await completeSignedIn(session.user)}
          catch(err){
            console.error(err);
            const errEl=document.getElementById('loginError');
            if(errEl){errEl.textContent=err.message||String(err);errEl.classList.remove('hidden')}
            showLogin();
          }
        }
      },0);
    });
    supabaseClient.channel('teamplan-live').on('postgres_changes',{event:'*',schema:'public',table:'team_plans'},payload=>{const remote=payload.new?.data;if(remote&&remote.updatedAt!==state.updatedAt){isApplyingRemote=true;state=normalizeState(remote);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;render();showToast('Plan wurde aktualisiert')}}).subscribe();
  }catch(err){
    console.error(err);
    try{
      const {data:{session}}=supabaseClient?await supabaseClient.auth.getSession():{data:{session:null}};
      if(!session){
        setSync('error','● Login-Fehler');
        showLogin();
      }else{
        authUser=session.user||authUser;
        hideLogin();
        setSync('live','● Live synchron');
        window.setTimeout(async()=>{
          const results=await Promise.allSettled([
            retrySyncCall(()=>loadRemotePlan(),'Urlaubsplan Wiederholung',2),
            retrySyncCall(()=>loadTrainingData(),'Fortbildungen Wiederholung',2),
            retrySyncCall(()=>loadProjectData(),'Projekte Wiederholung',2)
          ]);
          results.forEach((r,i)=>{if(r.status==='rejected')console.error(['Urlaubsplan','Fortbildungen','Projekte'][i]+' Wiederholung fehlgeschlagen',r.reason)});
          setSync('live','● Live synchron');
        },700);
      }
    }catch{
      setSync('error','● Login-Fehler');
      showLogin();
    }
  }
}
async function pushRemote(){
  if(!supabaseClient||!authUser||!canManage())return;
  const cfg=window.TEAMPLAN_CONFIG;
  try{const {error}=await supabaseClient.from('team_plans').upsert({team_id:cfg.teamId,data:state,updated_at:new Date().toISOString()},{onConflict:'team_id'});if(error)throw error;setSync('live','● Live synchron')}
  catch(e){console.error(e);setSync('error','● Sync-Fehler')}
}
function setSync(cls,text){const p=document.getElementById('syncPill');if(!p)return;p.className='sync-pill '+cls;p.textContent=text}
