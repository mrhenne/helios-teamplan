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
const roundTwo = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
const formatVacationNumber = n => {
  const v=roundTwo(n);
  return Number.isInteger(v)?String(v):String(v).replace('.',',');
};

const defaultState = {
  version: 1,
  settings: {baseVacation:30,maxVacation:4,maxAbsence:7,countSchool:true,confirmConflicts:true,state:'NW',vacationDisplayMode:'actual',theme:'light',zoom:1,customCodes:[]},
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
let selectedPlannerMarkers = new Set();
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
let presenceChannel = null;
let onlinePresence = new Map();
let discussionChannel = null;
let discussions = [];
let activeDiscussionId = null;
let discussionFilter = 'open';
let unreadDiscussionIds = new Set();
let conflictFilter = 'all';
let conflictSort = 'type';
let currentModule = localStorage.getItem('teamplan-module') || 'vacation';
let trainingView = localStorage.getItem('teamplan-training-view') || 'overview';
let trainingYear = Number(localStorage.getItem('teamplan-training-year')) || new Date().getFullYear();
let trainingZoom = Math.max(.7,Math.min(1.3,Number(localStorage.getItem('teamplan-training-zoom')||1)));
let trainingTypes = [];
let trainings = [];
let trainingBudgets = [];
let trainingChannel = null;
let focusPanMode = false;
let focusPanning = false;
let focusPanStartX = 0;
let focusPanStartY = 0;
let focusPanScrollLeft = 0;
let focusPanScrollTop = 0;
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
  s.settings={...defaultState.settings,...(s.settings||{})}; s.settings.customCodes=Array.isArray(s.settings.customCodes)?s.settings.customCodes:[]; s.employees=s.employees||[]; s.entries=s.entries||{}; s.blackouts=s.blackouts||[]; s.audit=s.audit||[];
  s.employees.forEach((e,i)=>{e.order=e.order??i;e.workweek=e.workweek||[1,2,3,4,5];e.carry=Number(e.carry||0);e.adjustment=Number(e.adjustment||0);e.role=e.role||'employee';e.autoWeekend=e.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''}});
  Object.values(s.entries).forEach(empEntries=>Object.values(empEntries||{}).forEach(v=>{v.status=v.status||'wish';v.plannerMarkers=Array.isArray(v.plannerMarkers)?v.plannerMarkers:[]}));
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
function canDiscuss(){return !!authUser&&sessionRole!=='viewer'}
function renderUnreadMessageBadge(){
  document.querySelectorAll('.employee-message-badge').forEach(el=>el.remove());
  document.querySelectorAll('.employee-row').forEach(row=>row.classList.remove('employee-has-message'));
  const employeeId=authMembership?.employee_id;
  if(!employeeId||!unreadDiscussionIds.size)return;
  const name=document.querySelector('.employee-row[data-id="'+employeeId+'"] .employee-name');
  const row=document.querySelector('.employee-row[data-id="'+employeeId+'"]');
  if(!name)return;
  const badge=document.createElement('span');
  badge.className='employee-message-badge';
  badge.textContent=unreadDiscussionIds.size>9?'9+':String(unreadDiscussionIds.size);
  badge.title=unreadDiscussionIds.size+' neue '+(unreadDiscussionIds.size===1?'Nachricht/Unterhaltung':'Nachrichten/Unterhaltungen');
  name.appendChild(badge);
  row?.classList.add('employee-has-message');
}
async function loadUnreadDiscussionState(){
  unreadDiscussionIds=new Set();
  if(!supabaseClient||!authUser||!authMembership?.employee_id){renderUnreadMessageBadge();return}
  const target=discussions.filter(d=>d.employee_id===authMembership.employee_id);
  if(!target.length){renderUnreadMessageBadge();return}
  const ids=target.map(d=>d.id),cfg=window.TEAMPLAN_CONFIG||{};
  const [readsRes,msgRes]=await Promise.all([
    supabaseClient.from('teamplan_discussion_reads').select('discussion_id,last_read_at').eq('team_id',cfg.teamId).eq('user_id',authUser.id).in('discussion_id',ids),
    supabaseClient.from('teamplan_messages').select('discussion_id,user_id,created_at').eq('team_id',cfg.teamId).in('discussion_id',ids).neq('user_id',authUser.id).order('created_at',{ascending:false})
  ]);
  if(readsRes.error){console.error(readsRes.error);renderUnreadMessageBadge();return}
  if(msgRes.error){console.error(msgRes.error);renderUnreadMessageBadge();return}
  const readMap=new Map((readsRes.data||[]).map(r=>[r.discussion_id,new Date(r.last_read_at).getTime()]));
  const latest=new Map();
  (msgRes.data||[]).forEach(m=>{if(!latest.has(m.discussion_id))latest.set(m.discussion_id,new Date(m.created_at).getTime())});
  target.forEach(d=>{
    const last=latest.get(d.id);if(!last)return;
    const read=readMap.get(d.id)||0;
    if(last>read)unreadDiscussionIds.add(d.id);
  });
  renderUnreadMessageBadge();
}
async function markDiscussionRead(id){
  if(!supabaseClient||!authUser||!id)return;
  const cfg=window.TEAMPLAN_CONFIG||{};
  const {error}=await supabaseClient.from('teamplan_discussion_reads').upsert({
    team_id:cfg.teamId,discussion_id:id,user_id:authUser.id,last_read_at:new Date().toISOString()
  },{onConflict:'team_id,discussion_id,user_id'});
  if(error){console.error(error);return}
  unreadDiscussionIds.delete(id);renderUnreadMessageBadge();
}

function discussionEmployeeName(id){return id?(state.employees.find(e=>e.id===id)?.name||'Mitarbeiter'):''}
function formatDiscussionRange(start,end){
  const a=new Date(start+'T12:00:00'),b=new Date(end+'T12:00:00');
  const fa=a.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:a.getFullYear()!==b.getFullYear()?'numeric':undefined});
  const fb=b.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  return start===end?fb:fa+' – '+fb;
}
function fillDiscussionEmployeeOptions(selected=''){
  const el=document.getElementById('discussionNewEmployee');if(!el)return;
  el.innerHTML='<option value="">Gesamtes Team / kein einzelner Mitarbeiter</option>'+[...state.employees].sort((a,b)=>a.order-b.order).map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
  el.value=selected||'';
}
function updateDiscussionBadge(){
  const badge=document.getElementById('discussionBadge'),btn=document.getElementById('discussionsBtn');
  const openCount=discussions.filter(d=>d.status==='open').length;
  if(badge){badge.textContent=String(openCount);badge.classList.toggle('hidden',!openCount)}
  if(btn){btn.classList.toggle('hidden',!authUser);btn.title=openCount?openCount+' aktiven Chat'+(openCount===1?'':'en'):'Team-Chat'}
}
async function loadDiscussions(){
  if(!supabaseClient||!authUser)return;
  const cfg=window.TEAMPLAN_CONFIG||{};
  const {data,error}=await supabaseClient.from('teamplan_discussions').select('*').eq('team_id',cfg.teamId).order('updated_at',{ascending:false}).limit(250);
  if(error){console.error(error);return}
  discussions=data||[];updateDiscussionBadge();renderDiscussionList();await loadUnreadDiscussionState();
}
function renderDiscussionList(){
  const list=document.getElementById('discussionList');if(!list)return;
  const items=discussionFilter==='open'?discussions.filter(d=>d.status==='open'):discussions;
  document.getElementById('discussionOpenFilter')?.classList.toggle('active',discussionFilter==='open');
  document.getElementById('discussionAllFilter')?.classList.toggle('active',discussionFilter==='all');
  list.innerHTML=items.length?items.map(d=>{
    const emp=discussionEmployeeName(d.employee_id);
    return '<button type="button" class="discussion-item '+(d.id===activeDiscussionId?'active':'')+'" data-discussion-id="'+d.id+'">'+
      '<div class="discussion-item-top"><strong>'+escapeHtml(d.title)+'</strong><span class="discussion-state '+d.status+'">'+(d.status==='open'?'Aktiv':'Erledigt')+'</span></div>'+
      '<span>'+escapeHtml(formatDiscussionRange(d.start_date,d.end_date))+(emp?' · '+escapeHtml(emp):'')+'</span>'+
      '<small>'+escapeHtml(d.created_by_name||'Team')+'</small></button>';
  }).join(''):'<div class="empty-state">'+(discussionFilter==='open'?'Keine aktiven Chats.':'Noch keine Chats.')+'</div>';
  list.querySelectorAll('.discussion-item').forEach(b=>b.addEventListener('click',()=>selectDiscussion(b.dataset.discussionId)));
}
async function loadDiscussionMessages(id){
  if(!supabaseClient||!id)return;
  const {data,error}=await supabaseClient.from('teamplan_messages').select('*').eq('discussion_id',id).order('created_at',{ascending:true}).limit(500);
  if(error){console.error(error);return}
  const box=document.getElementById('discussionMessages');
  box.innerHTML=(data||[]).length?(data||[]).map(m=>'<article class="discussion-message '+(m.user_id===authUser?.id?'mine':'')+'"><div><strong>'+escapeHtml(m.author_name||'Nutzer')+'</strong><time>'+new Date(m.created_at).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</time></div><p>'+escapeHtml(m.message).replace(/\n/g,'<br>')+'</p></article>').join(''):'<div class="empty-state">Noch keine Nachrichten.</div>';
  requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight});
}
async function selectDiscussion(id){
  const d=discussions.find(x=>x.id===id);if(!d)return;
  activeDiscussionId=id;renderDiscussionList();
  document.getElementById('discussionEmpty').classList.add('hidden');
  document.getElementById('discussionDetail').classList.remove('hidden');
  document.getElementById('discussionTitle').textContent=d.title;
  const emp=discussionEmployeeName(d.employee_id);
  document.getElementById('discussionMeta').textContent=formatDiscussionRange(d.start_date,d.end_date)+(emp?' · '+emp:'')+' · '+(d.status==='open'?'offen':'erledigt');
  const resolve=document.getElementById('discussionResolveBtn');
  resolve.classList.toggle('hidden',!canManage());
  resolve.textContent=d.status==='open'?'Als erledigt markieren':'Wieder öffnen';
  const form=document.getElementById('discussionMessageForm');
  form.classList.toggle('hidden',!canDiscuss());
  await loadDiscussionMessages(id);
  await markDiscussionRead(id);
}
async function openDiscussionsDialog(){
  if(!authUser){showToast('Bitte anmelden, um Abstimmungen zu nutzen');return}
  safeShowDialog('discussionsDialog');await loadDiscussions();
  if(activeDiscussionId&&discussions.some(d=>d.id===activeDiscussionId))await selectDiscussion(activeDiscussionId);
}
function openNewDiscussion(prefill={}){
  if(!canDiscuss()){showToast('Keine Schreibberechtigung für Abstimmungen');return}
  fillDiscussionEmployeeOptions(prefill.employeeId||'');
  const today=dateKey(new Date());
  document.getElementById('discussionNewTitle').value=prefill.title||'';
  document.getElementById('discussionNewStart').value=prefill.start||prefill.date||today;
  document.getElementById('discussionNewEnd').value=prefill.end||prefill.date||today;
  document.getElementById('discussionNewMessage').value=prefill.message||'';
  safeShowDialog('newDiscussionDialog');
}
async function createDiscussionFromForm(){
  if(!canDiscuss())return;
  const cfg=window.TEAMPLAN_CONFIG||{},title=document.getElementById('discussionNewTitle').value.trim(),start=document.getElementById('discussionNewStart').value,end=document.getElementById('discussionNewEnd').value,employeeId=document.getElementById('discussionNewEmployee').value||null,message=document.getElementById('discussionNewMessage').value.trim();
  if(!title||!start||!end||end<start||!message){alert('Bitte Titel, gültigen Zeitraum und eine Nachricht angeben.');return}
  const author=authMembership?.display_name||authUser.email||actorName();
  const {data,error}=await supabaseClient.from('teamplan_discussions').insert({team_id:cfg.teamId,title,start_date:start,end_date:end,employee_id:employeeId,status:'open',created_by:authUser.id,created_by_name:author}).select().single();
  if(error){alert(error.message);return}
  const {error:msgError}=await supabaseClient.from('teamplan_messages').insert({discussion_id:data.id,team_id:cfg.teamId,user_id:authUser.id,author_name:author,message});
  if(msgError){alert(msgError.message);return}
  document.getElementById('newDiscussionDialog').close();activeDiscussionId=data.id;await loadDiscussions();await selectDiscussion(data.id);showToast('Chat gestartet');
}
async function sendDiscussionMessage(){
  if(!canDiscuss()||!activeDiscussionId)return;
  const input=document.getElementById('discussionMessageInput'),message=input.value.trim();if(!message)return;
  const cfg=window.TEAMPLAN_CONFIG||{},author=authMembership?.display_name||authUser.email||actorName();
  const {error}=await supabaseClient.from('teamplan_messages').insert({discussion_id:activeDiscussionId,team_id:cfg.teamId,user_id:authUser.id,author_name:author,message});
  if(error){alert(error.message);return}
  input.value='';await loadDiscussionMessages(activeDiscussionId);
}
async function toggleDiscussionResolved(){
  if(!canManage()||!activeDiscussionId)return;
  const d=discussions.find(x=>x.id===activeDiscussionId);if(!d)return;
  const status=d.status==='open'?'resolved':'open';
  const {error}=await supabaseClient.from('teamplan_discussions').update({status,updated_at:new Date().toISOString()}).eq('id',d.id);
  if(error){alert(error.message);return}
  await loadDiscussions();await selectDiscussion(d.id);showToast(status==='resolved'?'Chat erledigt':'Chat wieder geöffnet');
}
async function startDiscussionRealtime(){
  if(!supabaseClient||!authUser)return;
  if(discussionChannel){try{await supabaseClient.removeChannel(discussionChannel)}catch{}}
  const cfg=window.TEAMPLAN_CONFIG||{};
  discussionChannel=supabaseClient.channel('teamplan-discussions-live-'+cfg.teamId)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_discussions',filter:'team_id=eq.'+cfg.teamId},async()=>{await loadDiscussions();if(activeDiscussionId)await selectDiscussion(activeDiscussionId)})
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_messages',filter:'team_id=eq.'+cfg.teamId},async payload=>{
      if(activeDiscussionId&&payload.new?.discussion_id===activeDiscussionId&&document.getElementById('discussionsDialog')?.open){
        await loadDiscussionMessages(activeDiscussionId);await markDiscussionRead(activeDiscussionId);
      }else await loadUnreadDiscussionState();
    })
    .subscribe();
  await loadDiscussions();
}
async function stopDiscussionRealtime(){
  if(discussionChannel){try{await supabaseClient.removeChannel(discussionChannel)}catch{}}
  discussionChannel=null;discussions=[];activeDiscussionId=null;unreadDiscussionIds=new Set();updateDiscussionBadge();renderUnreadMessageBadge();
}

function renderPresenceUI(){
  const onlineEmployeeIds=new Set([...onlinePresence.values()].map(x=>x.employee_id).filter(Boolean));
  document.querySelectorAll('.employee-row').forEach(row=>{
    const online=onlineEmployeeIds.has(row.dataset.id);
    row.classList.toggle('employee-online',online);
    const dot=row.querySelector('.presence-dot');if(dot)dot.classList.toggle('online',online);
  });
  const pill=document.getElementById('onlinePill');
  if(pill){
    const people=[...onlinePresence.values()];
    pill.classList.toggle('hidden',!authUser);
    pill.textContent='● '+people.length+' online';
    pill.title=people.length?'Online: '+people.map(x=>x.display_name||x.email||'Nutzer').join(', '):'Aktuell niemand online';
  }
}
function syncPresenceState(){
  if(!presenceChannel)return;
  const raw=presenceChannel.presenceState()||{},next=new Map();
  Object.entries(raw).forEach(([key,list])=>{
    (list||[]).forEach(p=>{if(p?.user_id)next.set(p.user_id,p)});
  });
  onlinePresence=next;renderPresenceUI();
}
async function startPresence(){
  if(!supabaseClient||!authUser||!authMembership)return;
  if(presenceChannel){try{await presenceChannel.untrack()}catch{};try{await supabaseClient.removeChannel(presenceChannel)}catch{}}
  const cfg=window.TEAMPLAN_CONFIG||{};
  presenceChannel=supabaseClient.channel('teamplan-presence-'+cfg.teamId,{config:{presence:{key:authUser.id}}});
  presenceChannel
    .on('presence',{event:'sync'},syncPresenceState)
    .on('presence',{event:'join'},syncPresenceState)
    .on('presence',{event:'leave'},syncPresenceState)
    .subscribe(async status=>{
      if(status!=='SUBSCRIBED')return;
      await presenceChannel.track({
        user_id:authUser.id,
        employee_id:authMembership.employee_id||null,
        display_name:authMembership.display_name||authUser.email||'Nutzer',
        email:authUser.email||'',
        role:authMembership.role||'viewer',
        online_at:new Date().toISOString()
      });
    });
}
async function stopPresence(){
  if(!presenceChannel)return;
  try{await presenceChannel.untrack()}catch{}
  try{await supabaseClient.removeChannel(presenceChannel)}catch{}
  presenceChannel=null;onlinePresence=new Map();renderPresenceUI();
}

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
function allCodeDefs(){
  const base=[
    {key:'U',label:'Urlaub',className:'u',absence:true},
    {key:'X',label:'Frei-WE',className:'x',absence:true},
    {key:'XU',label:'Wunsch-WE',className:'xu',absence:true},
    {key:'S',label:'Schule',className:'s',absence:true},
    {key:'G',label:'Geburtstag',className:'g',absence:false}
  ];
  return [...base,...(state.settings.customCodes||[])];
}
function codeDef(key){return allCodeDefs().find(c=>c.key===key)||{key,label:key,className:'custom-code',absence:false,color:'#6f7f8f'}}
function codeClassName(key){return codeDef(key).className||'custom-code'}
function isAbsenceCode(key){return !!codeDef(key).absence}
function renderCustomCodesSettings(){
  const list=document.getElementById('customCodesList');if(!list)return;
  const custom=state.settings.customCodes||[];
  list.innerHTML=custom.length?custom.map(c=>'<div class="custom-code-row" data-key="'+escapeHtml(c.key)+'"><span class="custom-code-swatch" style="--code-color:'+escapeHtml(c.color||'#6f7f8f')+'">'+escapeHtml(c.key)+'</span><div><strong>'+escapeHtml(c.label)+'</strong><small>'+(c.absence?'zählt als Abwesenheit':'nur Kennzeichnung')+'</small></div><button type="button" class="btn danger custom-code-delete">Löschen</button></div>').join(''):'<div class="empty-state">Keine zusätzlichen Kürzel angelegt.</div>';
  list.querySelectorAll('.custom-code-delete').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.closest('.custom-code-row').dataset.key;if(!confirm('Kürzel '+key+' wirklich löschen? Bereits eingetragene Werte bleiben im Plan sichtbar.'))return;trackAction('Kürzel gelöscht',key);state.settings.customCodes=state.settings.customCodes.filter(c=>c.key!==key);persist();renderCustomCodesSettings();render()}));
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
function absentCount(key){return state.employees.filter(e=>{const v=entryFor(e.id,key),c=v.codes||[];return entryIsActive(v)&&c.some(isAbsenceCode);}).length;}
function presentCount(key){return Math.max(0,state.employees.length-absentCount(key));}
function absentEmployees(key){
  return [...state.employees].sort((a,b)=>a.order-b.order).filter(e=>{
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
function dailyCounts(key){let U=0,XU=0,S=0,extraAbsence=0;state.employees.forEach(e=>{const v=entryFor(e.id,key);if(!entryIsActive(v))return;const c=v.codes||[];if(c.includes('U'))U++;if(c.includes('XU'))XU++;if(c.includes('S'))S++;extraAbsence+=c.filter(code=>!['U','X','XU','S','G'].includes(code)&&isAbsenceCode(code)).length});return {U,XU,S,extraAbsence,total:U+XU+(state.settings.countSchool?S:0)+extraAbsence};}
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
    const employeeFocusClass=sessionRole==='employee'?(e.id===sessionEmployeeId?'employee-own-row':'employee-muted-row'):'';
    html+=`<tr class="employee-row ${employeeFocusClass}" draggable="true" data-id="${e.id}"><td class="employee-col employee-cell"><div class="employee-card"><span class="drag-handle">⠿</span><div class="employee-edit" data-id="${e.id}"><div class="employee-name"><span class="presence-dot" title="Offline"></span>${escapeHtml(e.name)}</div><div class="employee-meta">${e.hours} h · ${e.percent}% · ${e.workdays} Tage/Woche · ${formatVacationNumber(vacationDaysPerWeek(e))} U/Woche · XU ${xu}</div></div><div class="employee-stats ${status}"><div class="vacation-stat-line"><strong>${formatVacationNumber(used)}/${formatVacationNumber(total)}</strong>${state.settings.vacationDisplayMode==='actual'?`<span class="vacation-factor-badge">× ${formatVacationNumber(vacationFactor(e))}</span>`:''}</div><small>${formatVacationNumber(remain)} übrig</small></div></div></td>`;
    dates.forEach(d=>{const key=dateKey(d),v=entryFor(e.id,key),we=[0,6].includes(d.getDay()),nonwork=!isWorkday(e,d),conf=conflictLevel(key),school=schoolBreakForDate(d),monthTone=d.getMonth()%2===0?'month-even':'month-odd',blackout=blackoutForKey(key),status=v.status||'wish';const codes=(v.codes||[]).map(c=>{const d=codeDef(c),weighted=c==='U'&&state.settings.vacationDisplayMode==='actual';return `<span class="cell-code ${codeClassName(c)} ${weighted?'weighted-u':''}"${d.color?` style="--code-color:${escapeHtml(d.color)}"`:''}>${c}${weighted?`<small class="u-weight">${formatVacationNumber(vacationFactor(e))}</small>`:''}</span>`}).join('');const plannerMarkers=(v.plannerMarkers||[]).map(m=>`<span class="planner-marker marker-${m==='V?'?'v':m==='T?'?'t':'k'}">${escapeHtml(m)}</span>`).join('');const dayTrainings=trainingForEmployeeDate(e.id,key);const trainingMark=dayTrainings.length?`<span class="cell-training-mark" title="${escapeHtml(dayTrainings.map(t=>t.title).join(' · '))}">F</span>`:'';const warn=(conf.vacation&&entryIsActive(v)&&v.codes?.includes('U'))||(conf.total&&entryIsActive(v)&&v.codes?.some(c=>['U','XU','S'].includes(c)));html+=`<td class="day-cell ${we?'weekend':''} ${nonwork?'nonwork':''} ${school?'school-holiday-cell':''} ${monthTone} status-${status} ${blackout?'blackout-cell':''}" data-emp="${e.id}" data-date="${key}" title="${escapeHtml([v.note,blackout&&('Sperrzeit: '+blackout.name),school&&('NRW '+school),status&&('Status: '+status),(v.plannerMarkers||[]).length&&('Planer: '+v.plannerMarkers.join(', '))].filter(Boolean).join(' · '))}"><div class="cell-codes">${codes}</div><div class="planner-markers">${plannerMarkers}</div>${trainingMark}${(v.codes||[]).length?`<span class="status-mark status-${status}"></span>`:''}${v.priority?`<span class="cell-priority p${v.priority}"></span>`:''}${v.note?`<span class="cell-note-preview" title="${escapeHtml(v.note)}">${escapeHtml(String(v.note).trim().slice(0,14))}</span>`:''}${warn?'<span class="cell-warning-mark">!</span>':''}</td>`});
    html+='</tr>';
  });
  html+=summaryRow(state.settings.vacationDisplayMode==='full'?'Urlaub U':'Urlaub U anteilig','U',dates);html+=summaryRow('Wunschfrei XU','XU',dates);html+=summaryRow('Schule S','S',dates);html+=presenceRow(dates);html+=absenceNamesRow(dates);html+='</tbody></table>';
  document.getElementById('planner').innerHTML=html; bindPlannerEvents(); renderMetrics(); syncViewControls(); applyAppearance(); renderDynamicCodes(); renderPresenceUI(); renderUnreadMessageBadge();
  if(currentView==='month') setupFlowingMonthScroll();
  if(currentView==='year') renderYearOverview();
}
function summaryRow(label,code,dates){const modeClass=code==='U'?(state.settings.vacationDisplayMode==='actual'?' vacation-summary actual':' vacation-summary full'):'';let s=`<tr class="summary-row ${code==='U'?'alarm':''}${modeClass}"><td class="employee-col">Σ ${label}</td>`;dates.forEach(d=>{const key=dateKey(d),c=dailyCounts(key);let n=c[code];if(code==='U'&&state.settings.vacationDisplayMode==='actual'){n=roundTwo(state.employees.reduce((sum,e)=>{const v=entryFor(e.id,key);return sum+(entryIsActive(v)&&v.codes?.includes('U')?vacationFactor(e):0)},0))}const rawU=c.U,hot=code==='U'&&rawU>state.settings.maxVacation,warn=code==='U'&&rawU===state.settings.maxVacation;s+=`<td class="${hot?'count-hot':warn?'count-warn':''}">${n?formatVacationNumber(n):''}</td>`});return s+'</tr>'}
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
  const employees=document.getElementById('metricEmployees');if(!employees)return;
  employees.textContent=state.employees.length;
  document.getElementById('metricVacation').textContent=state.employees.reduce((a,e)=>a+usedVacation(e),0);
  document.getElementById('metricXU').textContent=state.employees.reduce((a,e)=>a+countCode(e,'XU'),0);
  document.getElementById('metricConflicts').textContent=activePlannerDates().filter(d=>{const c=conflictLevel(dateKey(d));return c.vacation||c.total}).length;
}

function syncViewControls(){
  document.getElementById('monthView').classList.toggle('hidden',currentView==='year');
  document.getElementById('yearView').classList.toggle('hidden',currentView!=='year');
  document.getElementById('monthViewBtn').classList.toggle('active',currentView==='month');
  document.getElementById('yearViewBtn').classList.toggle('active',currentView==='year');
  const full=state.settings.vacationDisplayMode==='full';
  document.getElementById('vacationFullBtn').classList.toggle('active',full);
  document.getElementById('vacationActualBtn').classList.toggle('active',!full);
  document.body.classList.toggle('vacation-mode-full',full);
  document.body.classList.toggle('vacation-mode-actual',!full);
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
  document.body.classList.toggle('planner-zoom-tiny',z<.45);
  document.body.classList.toggle('planner-zoom-small',z>=.45&&z<.65);
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
  const focusLabel=document.getElementById('focusZoomLabel');if(focusLabel)focusLabel.textContent=Math.round(z*100)+'%';
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
  const m=document.getElementById('focusPeriodMonth'),y=document.getElementById('focusPeriodYear'),select=document.getElementById('focusMonthSelect');
  if(m)m.textContent=MONTHS[viewDate.getMonth()];
  if(y)y.textContent=String(viewDate.getFullYear());
  if(select)select.value=String(viewDate.getMonth());
}
function scrollFocusToMonth(month,forceRender=false){
  month=Math.max(0,Math.min(11,Number(month)));
  const targetYear=viewDate.getFullYear();
  viewDate=new Date(targetYear,month,1);saveLastViewDate();updateFocusPeriod();
  const doScroll=()=>{
    const planner=document.getElementById('planner'),band=document.querySelector('.month-band[data-month="'+month+'"]');
    if(planner&&band){
      planner.scrollTo({left:Math.max(0,band.offsetLeft-planner.clientWidth*.16),behavior:'smooth'});
      plannerScrollLeft=planner.scrollLeft;
    }
  };
  if(forceRender){plannerScrollLeft=null;render();requestAnimationFrame(()=>requestAnimationFrame(doScroll))}
  else doScroll();
}
function stepFocusMonth(delta){
  const oldYear=viewDate.getFullYear(),d=new Date(oldYear,viewDate.getMonth()+delta,1);
  const yearChanged=d.getFullYear()!==oldYear;
  viewDate=d;saveLastViewDate();updateFocusPeriod();
  if(yearChanged){plannerScrollLeft=null;render();requestAnimationFrame(()=>requestAnimationFrame(()=>scrollFocusToMonth(viewDate.getMonth(),false)))}
  else scrollFocusToMonth(d.getMonth(),false);
}
function toggleFocusSearch(force){
  const wrap=document.getElementById('focusSearchWrap'),input=document.getElementById('focusSearchInput');
  const open=typeof force==='boolean'?force:!wrap.classList.contains('open');
  wrap.classList.toggle('open',open);
  if(open){input.value=document.getElementById('searchInput').value;setTimeout(()=>input.focus(),20)}
}
function setFocusPanMode(enabled){
  focusPanMode=!!enabled;focusPanning=false;
  const btn=document.getElementById('focusPanBtn'),planner=document.getElementById('planner');
  if(btn){btn.classList.toggle('active',focusPanMode);btn.setAttribute('aria-pressed',String(focusPanMode));btn.title=focusPanMode?'Navigationsmodus aktiv · klicken zum Entsperren':'Navigationsmodus: Kalender frei horizontal und vertikal verschieben'}
  if(planner)planner.classList.toggle('pan-mode',focusPanMode);
}
function enterPlannerFocus(){
  if(currentView!=='month'){currentView='month';plannerScrollLeft=null;render()}
  document.body.classList.add('planner-focus');
  document.getElementById('focusSearchInput').value=document.getElementById('searchInput').value;
  updateFocusPeriod();setFocusPanMode(false);toggleFocusSearch(false);
}
function exitPlannerFocus(){
  setFocusPanMode(false);toggleFocusSearch(false);document.body.classList.remove('planner-focus');
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
  document.getElementById('dragApprovedVacationBtn').classList.toggle('hidden',!canApprove());
  document.getElementById('dragPlannerMarkers').classList.toggle('hidden',!canManage());
  if(canManage()){
    document.querySelectorAll('[data-drag-marker]').forEach(btn=>{
      const marker=btn.dataset.dragMarker;
      const allHave=[...dragSelectedKeys].every(key=>(entryFor(dragEmployeeId,key).plannerMarkers||[]).includes(marker));
      btn.classList.toggle('active',allHave);
    });
  }
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
    state.entries[dragEmployeeId][key]={...old,codes,priority:old.priority||0,note:old.note||'',status:sessionRole==='employee'?'wish':(old.status||'wish'),plannerMarkers:old.plannerMarkers||[]};
  });
  const changed=[...dragSelectedKeys];const count=changed.length;persist();changed.forEach(key=>saveRemoteEntry(dragEmployeeId,key,state.entries[dragEmployeeId][key]));clearDragSelection();render();showToast(`${code} für ${count} Tage eingetragen`);
}
function applyDragPlannerMarker(marker){
  if(!canManage()||!dragEmployeeId||!dragSelectedKeys.size)return;
  const keys=[...dragSelectedKeys];
  const remove=keys.every(key=>(entryFor(dragEmployeeId,key).plannerMarkers||[]).includes(marker));
  trackAction(remove?'Planungsstatus entfernt':'Planungsstatus gesetzt',marker+' · '+keys.length+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  keys.forEach(key=>{
    const old=entryFor(dragEmployeeId,key),set=new Set(old.plannerMarkers||[]);
    remove?set.delete(marker):set.add(marker);
    const next={...old,plannerMarkers:[...set]};
    if((next.codes||[]).length||next.priority||next.note||next.plannerMarkers.length)state.entries[dragEmployeeId][key]=next;
    else delete state.entries[dragEmployeeId][key];
  });
  const count=keys.length;persist();clearDragSelection();render();
  showToast(marker+' '+(remove?'entfernt':'gesetzt')+' · '+count+' Tage');
}
function applyApprovedVacation(){
  if(!canApprove()||!dragEmployeeId||!dragSelectedKeys.size)return;
  const blocked=[...dragSelectedKeys].filter(key=>blackoutBlocks(key));if(blocked.length){alert('Dieser Zeitraum enthält eine Urlaubssperre: '+blackoutBlocks(blocked[0]).name);return}
  trackAction('Urlaub direkt genehmigt',dragSelectedKeys.size+' Tage');
  if(!state.entries[dragEmployeeId])state.entries[dragEmployeeId]={};
  dragSelectedKeys.forEach(key=>{const old=entryFor(dragEmployeeId,key);state.entries[dragEmployeeId][key]={...old,codes:[...new Set([...(old.codes||[]),'U'])],status:'approved'}});
  const count=dragSelectedKeys.size;persist();clearDragSelection();render();showToast(count+' Urlaubstage genehmigt eingetragen');
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
function hideCellContextMenu(){
  const menu=document.getElementById('cellContextMenu');if(menu)menu.classList.add('hidden');
}
function quickCellCode(empId,key,code,status=null){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  if(['U','XU'].includes(code)&&blackoutBlocks(key)){showToast('Urlaubssperre: '+blackoutBlocks(key).name);return}
  if(!state.entries[empId])state.entries[empId]={};
  const old=entryFor(empId,key);
  trackAction('Schnelleintrag', (state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+code);
  state.entries[empId][key]={...old,codes:[...new Set([...(old.codes||[]),code])],status:status||(old.status||'wish')};
  persist();saveRemoteEntry(empId,key,state.entries[empId][key]);hideCellContextMenu();render();
  showToast(code+(status==='approved'?' genehmigt':'')+' eingetragen');
}
function quickEditCellNote(empId,key){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  const old=entryFor(empId,key),current=old.note||'';
  const value=prompt(current?'Notiz bearbeiten':'Notiz hinzufügen',current);
  if(value===null)return;
  const note=value.trim();
  if(!state.entries[empId])state.entries[empId]={};
  const next={...old,note,status:sessionRole==='employee'?'wish':(old.status||'wish'),plannerMarkers:old.plannerMarkers||[]};
  trackAction(note?'Notiz geändert':'Notiz entfernt',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key);
  if((next.codes||[]).length||next.priority||note||(next.plannerMarkers||[]).length)state.entries[empId][key]=next;
  else delete state.entries[empId][key];
  persist();saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);hideCellContextMenu();render();
  showToast(note?'Notiz gespeichert':'Notiz entfernt');
}
function quickDeleteCell(empId,key){
  if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte');return}
  if(!state.entries[empId]?.[key]){hideCellContextMenu();return}
  trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key);
  delete state.entries[empId][key];persist();saveRemoteEntry(empId,key,null);hideCellContextMenu();render();showToast('Eintrag gelöscht');
}
function showCellContextMenu(event,empId,key){
  event.preventDefault();event.stopPropagation();
  if(!canPlan(empId)){
    if(sessionRole==='employee')showToast('Du kannst nur deine eigene Zeile bearbeiten');
    return;
  }
  clearDragSelection();
  const menu=document.getElementById('cellContextMenu'),entry=entryFor(empId,key),emp=state.employees.find(e=>e.id===empId),d=new Date(key+'T12:00:00');
  const codeButtons=allCodeDefs().map(c=>{
    const active=(entry.codes||[]).includes(c.key),style=c.color?' style="--code-color:'+escapeHtml(c.color)+'"':'';
    return '<button type="button" class="context-code '+codeClassName(c.key)+(active?' active':'')+'" data-context-code="'+escapeHtml(c.key)+'"'+style+'><b>'+escapeHtml(c.key)+'</b><span>'+escapeHtml(c.label)+'</span>'+(active?'<i>✓</i>':'')+'</button>';
  }).join('');
  const markerButtons=canManage()?'<div class="context-section planner-context-section"><small>Planer-Hinweis</small>'+
    ['V?','T?','K!'].map(m=>'<button type="button" class="context-code planner-context-marker '+((entry.plannerMarkers||[]).includes(m)?'active':'')+'" data-context-marker="'+m+'"><b>'+m+'</b><span>'+(m==='V?'?'Verschiebung':m==='T?'?'Tausch':'Klärung')+'</span>'+((entry.plannerMarkers||[]).includes(m)?'<i>✓</i>':'')+'</button>').join('')+'</div>':'';
  menu.innerHTML='<div class="context-head"><strong>'+escapeHtml(emp?.name||'')+'</strong><span>'+DOW[d.getDay()]+' · '+d.getDate()+'. '+MONTHS[d.getMonth()]+'</span></div>'+
    '<div class="context-section"><small>Schnell eintragen</small>'+codeButtons+'</div>'+
    (canApprove()?'<button type="button" class="context-action approve-context" data-context-approved="1"><b>U✓</b><span>Urlaub genehmigt</span></button>':'')+
    markerButtons+
    '<div class="context-separator"></div>'+
    (canDiscuss()?'<button type="button" class="context-action discussion-context" data-context-discussion="1"><b>◌</b><span>Team-Chat starten…</span></button>':'')+
    '<button type="button" class="context-action note-context" data-context-note="1"><b>≡</b><span>'+(entry.note?'Notiz bearbeiten…':'Notiz hinzufügen…')+'</span></button>'+
    '<button type="button" class="context-action" data-context-edit="1"><b>✎</b><span>Vollständig bearbeiten…</span></button>'+
    '<button type="button" class="context-action danger-context" data-context-delete="1"><b>⌫</b><span>Eintrag löschen</span></button>';
  menu.querySelectorAll('[data-context-code]').forEach(b=>b.addEventListener('click',()=>quickCellCode(empId,key,b.dataset.contextCode)));
  menu.querySelector('[data-context-approved]')?.addEventListener('click',()=>quickCellCode(empId,key,'U','approved'));
  menu.querySelectorAll('[data-context-marker]').forEach(b=>b.addEventListener('click',()=>{
    if(!canManage())return;
    const marker=b.dataset.contextMarker,old=entryFor(empId,key),set=new Set(old.plannerMarkers||[]);
    set.has(marker)?set.delete(marker):set.add(marker);
    if(!state.entries[empId])state.entries[empId]={};
    const next={...old,plannerMarkers:[...set]};
    if((next.codes||[]).length||next.priority||next.note||next.plannerMarkers.length)state.entries[empId][key]=next;else delete state.entries[empId][key];
    trackAction('Planungsstatus geändert',(emp?.name||'')+' · '+key+' · '+marker);
    persist();hideCellContextMenu();render();showToast(marker+' aktualisiert');
  }));
  menu.querySelector('[data-context-discussion]')?.addEventListener('click',()=>{
    hideCellContextMenu();
    openNewDiscussion({date:key,employeeId:empId,title:'Chat '+(emp?.name||'')+' · '+key});
  });
  menu.querySelector('[data-context-note]').addEventListener('click',()=>quickEditCellNote(empId,key));
  menu.querySelector('[data-context-edit]').addEventListener('click',()=>{hideCellContextMenu();openCell(empId,key)});
  menu.querySelector('[data-context-delete]').addEventListener('click',()=>quickDeleteCell(empId,key));
  menu.classList.remove('hidden');
  const pad=8,w=menu.offsetWidth||230,h=menu.offsetHeight||360;
  const x=Math.min(event.clientX,window.innerWidth-w-pad),y=Math.min(event.clientY,window.innerHeight-h-pad);
  menu.style.left=Math.max(pad,x)+'px';menu.style.top=Math.max(pad,y)+'px';
}
function bindPlannerEvents(){
  document.querySelectorAll('.day-cell').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(focusPanMode&&document.body.classList.contains('planner-focus'))return;
      if(e.ctrlKey){e.preventDefault();showCellContextMenu(e,el.dataset.emp,el.dataset.date);return}
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
  let dragged=null; document.querySelectorAll('.employee-row').forEach(row=>{row.addEventListener('dragstart',e=>{if(focusPanMode&&document.body.classList.contains('planner-focus')){e.preventDefault();return}dragged=row.dataset.id;row.style.opacity=.45});row.addEventListener('dragend',()=>{row.style.opacity='';document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drop-target')});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.id;if(dragged&&dragged!==target){reorder(dragged,target)}})});
}
function reorder(sourceId,targetId){if(!canEditEmployees()){showToast('Keine Rechte für Stammdaten');return}trackAction('Reihenfolge geändert');const arr=[...state.employees].sort((a,b)=>a.order-b.order);const from=arr.findIndex(e=>e.id===sourceId),to=arr.findIndex(e=>e.id===targetId);const [x]=arr.splice(from,1);arr.splice(to,0,x);arr.forEach((e,i)=>e.order=i);state.employees=arr;persist();render();showToast('Reihenfolge gespeichert')}

function cleanupMatchesDate(key,period){
  if(period==='all')return true;
  const year=String(viewDate.getFullYear());
  if(period==='year')return key.startsWith(year+'-');
  const month=String(viewDate.getMonth()+1).padStart(2,'0');
  return key.startsWith(year+'-'+month+'-');
}
function cleanupAffectedEntries(){
  const empValue=document.getElementById('cleanupEmployee')?.value||'all';
  const period=document.getElementById('cleanupPeriod')?.value||'month';
  const code=document.getElementById('cleanupCode')?.value||'all';
  const employees=empValue==='all'?state.employees:state.employees.filter(e=>e.id===empValue);
  const matches=[];
  employees.forEach(emp=>{
    Object.entries(state.entries[emp.id]||{}).forEach(([key,entry])=>{
      if(!cleanupMatchesDate(key,period))return;
      if(code==='all'){
        if((entry.codes||[]).length||entry.note||entry.priority||entry.status)matches.push({empId:emp.id,key,code:null});
      }else if((entry.codes||[]).includes(code))matches.push({empId:emp.id,key,code});
    });
  });
  return matches;
}
function updateCleanupPreview(){
  const box=document.getElementById('cleanupPreview');if(!box)return;
  const count=cleanupAffectedEntries().length;
  const emp=document.getElementById('cleanupEmployee'),period=document.getElementById('cleanupPeriod'),code=document.getElementById('cleanupCode');
  const empText=emp?.options[emp.selectedIndex]?.text||'',periodText=period?.options[period.selectedIndex]?.text||'',codeText=code?.options[code.selectedIndex]?.text||'';
  box.innerHTML='<strong>'+count+' '+(count===1?'Eintrag':'Einträge')+'</strong><span>'+escapeHtml(empText)+' · '+escapeHtml(periodText)+' · '+escapeHtml(codeText)+'</span>';
  box.classList.toggle('empty',count===0);
}
function openCleanupDialog(selectedEmpId='all'){
  if(!canManage()){showToast('Nur Admin und Planer dürfen Planungsdaten gesammelt löschen');return}
  const emp=document.getElementById('cleanupEmployee'),code=document.getElementById('cleanupCode');
  emp.innerHTML='<option value="all">Alle Mitarbeiter</option>'+[...state.employees].sort((a,b)=>a.order-b.order).map(e=>'<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
  emp.value=selectedEmpId&&state.employees.some(e=>e.id===selectedEmpId)?selectedEmpId:'all';
  code.innerHTML='<option value="all">Alle Einträge</option>'+allCodeDefs().map(c=>'<option value="'+escapeHtml(c.key)+'">'+escapeHtml(c.key+' · '+c.label)+'</option>').join('');
  document.getElementById('cleanupPeriod').value='month';
  updateCleanupPreview();
  safeShowDialog('cleanupDialog');
}
function applyCleanup(){
  if(!canManage())return;
  const matches=cleanupAffectedEntries();if(!matches.length){showToast('Keine passenden Einträge gefunden');return}
  const emp=document.getElementById('cleanupEmployee'),period=document.getElementById('cleanupPeriod'),code=document.getElementById('cleanupCode');
  const summary=[emp.options[emp.selectedIndex]?.text,period.options[period.selectedIndex]?.text,code.options[code.selectedIndex]?.text].filter(Boolean).join(' · ');
  if(!confirm(matches.length+' '+(matches.length===1?'Eintrag':'Einträge')+' wirklich löschen?\n\n'+summary+'\n\nDie Aktion kann über Verlauf → Rückgängig wiederhergestellt werden.'))return;
  trackAction('Planungsdaten gelöscht',summary+' · '+matches.length+' Einträge');
  matches.forEach(({empId,key,code:targetCode})=>{
    const entry=state.entries[empId]?.[key];if(!entry)return;
    if(!targetCode){delete state.entries[empId][key];return}
    const codes=(entry.codes||[]).filter(c=>c!==targetCode);
    if(codes.length||entry.note||entry.priority){state.entries[empId][key]={...entry,codes}}
    else delete state.entries[empId][key];
  });
  persist();render();document.getElementById('cleanupDialog').close();showToast(matches.length+' Einträge gelöscht');
}
function openEmployee(id=null){
  if(!canEditEmployees()){showToast('Keine Rechte für Mitarbeiter-Stammdaten');return}
  const d=document.getElementById('employeeDialog'),e=id?state.employees.find(x=>x.id===id):null; document.getElementById('employeeDialogTitle').textContent=e?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen';document.getElementById('employeeId').value=e?.id||'';document.getElementById('employeeName').value=e?.name||'';document.getElementById('employeeHours').value=e?.hours??38.5;document.getElementById('employeePercent').value=e?.percent??100;document.getElementById('employeeWorkdays').value=e?.workdays??5;document.getElementById('employeeCarry').value=e?.carry??0;document.getElementById('employeeAdjustment').value=e?.adjustment??0;document.getElementById('employeeRole').value=e?.role||'employee';document.getElementById('employeeRole').disabled=sessionRole!=='admin';document.getElementById('deleteEmployeeBtn').classList.toggle('hidden',!e||sessionRole!=='admin');document.getElementById('employeeRangeBtn').classList.toggle('hidden',!e||!canPlan(e.id));document.getElementById('employeeCleanupBtn').classList.toggle('hidden',!e||!canManage());const aw=e?.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''};document.getElementById('employeeAutoWeekend').checked=!!aw.enabled;document.getElementById('employeeWeekendInterval').value=String(aw.intervalWeeks||2);document.getElementById('employeeWeekendAnchor').value=aw.anchorDate||'';document.getElementById('autoWeekendOptions').classList.toggle('disabled-block',!aw.enabled);renderWorkweekToggles(e?.workweek||[1,2,3,4,5]);updateVacationPreview();d.showModal();
}
function renderWorkweekToggles(days){document.getElementById('workweekToggles').innerHTML=WORKDAY_LABELS.map(x=>`<button type="button" data-day="${x.d}" class="weekday-toggle ${days.includes(x.d)?'active':''}">${x.l}</button>`).join('');document.querySelectorAll('.weekday-toggle').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');syncWorkdaysFromToggles();updateVacationPreview()}))}
function syncWorkdaysFromToggles(){document.getElementById('employeeWorkdays').value=document.querySelectorAll('.weekday-toggle.active').length||1}
function updateVacationPreview(){const percent=Math.max(0,Math.min(100,Number(document.getElementById('employeePercent').value||100))),carry=Number(document.getElementById('employeeCarry').value||0),adj=Number(document.getElementById('employeeAdjustment').value||0),base=state.settings.baseVacation,total=roundHalf(base+carry+adj),weekly=roundTwo(5*percent/100);document.getElementById('vacationPreview').innerHTML=`<div class="vacation-preview-main"><strong>${formatVacationNumber(total)} Tage Jahresanspruch</strong><strong>${formatVacationNumber(weekly)} U je voller Urlaubswoche</strong></div><span>Klinikplaner: 5 × ${formatVacationNumber(percent)} % = ${formatVacationNumber(weekly)} U pro voller Urlaubswoche. Der Jahresanspruch bleibt unverändert.</span>`}

function openCell(empId,key){if(!canPlan(empId)){showToast('Keine Bearbeitungsrechte für diesen Mitarbeiter');return}const clickedDate=new Date(key+'T12:00:00');viewDate=new Date(clickedDate.getFullYear(),clickedDate.getMonth(),1);saveLastViewDate();const e=state.employees.find(x=>x.id===empId),v=entryFor(empId,key);selectedCodes=new Set(v.codes||[]);selectedPlannerMarkers=new Set(v.plannerMarkers||[]);document.getElementById('cellEmployeeId').value=empId;document.getElementById('cellDateValue').value=key;document.getElementById('cellEmployee').textContent=e.name;const d=new Date(key+'T12:00:00');document.getElementById('cellDate').textContent=`${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;document.getElementById('cellStatus').value=v.status||'wish';document.getElementById('cellStatus').disabled=!canApprove();document.getElementById('cellDirectApprove').checked=false;document.getElementById('cellDirectApproveLine').classList.toggle('hidden',!canApprove());document.getElementById('plannerMarkerBlock').classList.toggle('hidden',!canManage());document.querySelectorAll('[data-planner-marker]').forEach(b=>b.classList.toggle('selected',selectedPlannerMarkers.has(b.dataset.plannerMarker)));document.getElementById('cellPriority').value=v.priority||0;document.getElementById('cellNote').value=v.note||'';document.querySelectorAll('#cellDialog .code-btn').forEach(b=>b.classList.toggle('selected',selectedCodes.has(b.dataset.code)));updateCellWarning(empId,key);document.getElementById('cellDialog').showModal()}
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
  document.getElementById('bulkStatus').value='wish';document.getElementById('bulkStatus').disabled=!canApprove();document.getElementById('bulkDirectApprove').checked=false;document.getElementById('bulkDirectApproveLine').classList.toggle('hidden',!canApprove());document.getElementById('bulkPriority').value='0';document.getElementById('bulkMode').value='merge';document.getElementById('bulkNote').value='';
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
  const priority=Number(document.getElementById('bulkPriority').value),note=document.getElementById('bulkNote').value.trim(),status=canApprove()&&document.getElementById('bulkDirectApprove').checked&&bulkSelectedCodes.has('U')?'approved':canApprove()?document.getElementById('bulkStatus').value:'wish';
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
  const pill=document.getElementById('authUserPill'),logout=document.getElementById('logoutBtn'),onlinePill=document.getElementById('onlinePill');
  pill.classList.toggle('hidden',!authMode);logout.classList.toggle('hidden',!authMode);if(onlinePill)onlinePill.classList.toggle('hidden',!authMode);
  if(authMode)pill.textContent=(authUser.email||'Angemeldet')+' · '+sessionRole;
  ['blackoutsBtn','addEmployeeBtn','importNamesBtn','planImportBtn'].forEach(id=>{const el=document.getElementById(id);if(el){el.disabled=!canManage();el.classList.toggle('hidden',!canManage())}});
  document.querySelectorAll('.manager-only').forEach(el=>el.classList.toggle('hidden',!canManage()));
  document.getElementById('settingsBtn').disabled=false;
  document.getElementById('usersBtn').classList.toggle('hidden',sessionRole!=='admin'||!authUser);
  const discussionsBtn=document.getElementById('discussionsBtn');if(discussionsBtn)discussionsBtn.classList.toggle('hidden',!authUser);
  updateDiscussionBadge();
  applyTrainingRoleUI();
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
  summary.innerHTML=`<button type="button" data-summary-filter="all" class="${conflictFilter==='all'?'active':''}"><strong>${items.length}</strong><span>gesamt</span></button><button type="button" data-summary-filter="Besetzung" class="${conflictFilter==='Besetzung'?'active':''}"><strong>${counts['Besetzung']||0}</strong><span>Besetzung</span></button><button type="button" data-summary-filter="Sperrzeit" class="${conflictFilter==='Sperrzeit'?'active':''}"><strong>${counts['Sperrzeit']||0}</strong><span>Sperrzeiten</span></button><button type="button" data-summary-filter="Offener Wunsch" class="${conflictFilter==='Offener Wunsch'?'active':''}"><strong>${counts['Offener Wunsch']||0}</strong><span>offene Wünsche</span></button>`;
  document.querySelectorAll('[data-conflict-filter]').forEach(b=>b.classList.toggle('active',b.dataset.conflictFilter===conflictFilter));
  const sortSelect=document.getElementById('conflictSort');if(sortSelect)sortSelect.value=conflictSort;
  let visible=conflictFilter==='all'?[...items]:items.filter(x=>x.type===conflictFilter);
  const order={'Besetzung':0,'Sperrzeit':1,'Offener Wunsch':2};
  visible.sort((a,b)=>conflictSort==='date'
    ? a.key.localeCompare(b.key)||(order[a.type]??9)-(order[b.type]??9)
    : (order[a.type]??9)-(order[b.type]??9)||a.key.localeCompare(b.key));
  list.innerHTML=visible.length?visible.slice(0,500).map(x=>`<div class="management-item conflict-item conflict-type-${x.type==='Besetzung'?'staffing':x.type==='Sperrzeit'?'blackout':'wish'}" data-date="${x.key}" data-type="${escapeHtml(x.type)}"><span class="conflict-kind">${escapeHtml(x.type)}</span><button type="button" class="conflict-jump"><div><strong>${x.key}</strong><span>${escapeHtml(x.text)}</span></div></button>${canDiscuss()?'<button type="button" class="btn ghost conflict-discuss">✉ Chat</button>':''}</div>`).join(''):'<div class="empty-state success-state">Keine Einträge für diesen Filter.</div>';
  summary.querySelectorAll('[data-summary-filter]').forEach(btn=>btn.addEventListener('click',()=>{conflictFilter=btn.dataset.summaryFilter;renderConflicts()}));
  list.querySelectorAll('.conflict-jump').forEach(btn=>btn.addEventListener('click',()=>{const item=btn.closest('.conflict-item'),d=new Date(item.dataset.date+'T12:00:00');viewDate=new Date(d.getFullYear(),d.getMonth(),1);currentView='month';document.getElementById('conflictsDialog').close();render()}));
  list.querySelectorAll('.conflict-discuss').forEach(btn=>btn.addEventListener('click',()=>{const item=btn.closest('.conflict-item');document.getElementById('conflictsDialog').close();openNewDiscussion({date:item.dataset.date,title:item.dataset.type+' · '+item.dataset.date,message:'Bitte hierzu im Team abstimmen.'})}));
}
async function exportExcel(){
  if(!window.XLSX){alert('Excel-Export ist nicht verfügbar.');return}
  const year=viewDate.getFullYear(),rows=[['Mitarbeiter','Jahresanspruch','Verbraucht nach Arbeitstagen','Rest','XU']];
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
  const s=state.settings;renderCustomCodesSettings();
  document.getElementById('settingBaseVacation').value=s.baseVacation;document.getElementById('settingMaxVacation').value=s.maxVacation;document.getElementById('settingMaxAbsence').value=s.maxAbsence;document.getElementById('settingCountSchool').checked=s.countSchool;document.getElementById('settingConfirmConflicts').checked=s.confirmConflicts;
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
  const {data,error}=await supabaseClient.from('team_plans').select('data,updated_at').eq('team_id',cfg.teamId).maybeSingle();
  if(error)throw error;
  if(data?.data){isApplyingRemote=true;state=normalizeState(data.data);localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));isApplyingRemote=false;renderRoleControls();render()}
  else if(canManage())await pushRemote();
}
function showLogin(){
  const d=document.getElementById('loginDialog');if(d&&!d.open)d.showModal();
}
function hideLogin(){const d=document.getElementById('loginDialog');if(d?.open)d.close()}

function trainingCanManage(){return canManage()}
function trainingEmployeeName(id){return state.employees.find(e=>e.id===id)?.name||'Unbekannter Mitarbeiter'}
function trainingTypeById(id){return trainingTypes.find(t=>t.id===id)||null}
function trainingBudgetFor(empId,year=trainingYear){return Number(trainingBudgets.find(b=>b.employee_id===empId&&Number(b.year)===Number(year))?.amount||0)}
function trainingDate(d){return d?new Date(d+'T12:00:00'):null}
function addMonthsISO(date,months){
  if(!date||!months)return null;
  const d=trainingDate(date);if(!d)return null;
  const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+Number(months));
  const max=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,max));
  return dateKey(d);
}
function trainingRecurrenceMonths(t){
  if(!t?.recurring)return 0;
  return Number(t.recurrence_months||trainingTypeById(t.type_id)?.interval_months||0);
}
function trainingRecurrenceLabel(t){
  const months=trainingRecurrenceMonths(t);if(!months)return '';
  if(months%12===0)return '↻ alle '+(months/12)+(months===12?' Jahr':' Jahre');
  return '↻ alle '+months+' Monate';
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
  const due=trainingDueState(t);
  if(due==='overdue')return 'Überfällig';
  if(due==='due')return 'Bald fällig';
  return t.status==='completed'?'Abgeschlossen':t.status==='cancelled'?'Abgesagt':'Geplant';
}
function trainingVisibleEmployees(){
  if(sessionRole==='employee')return state.employees.filter(e=>e.id===sessionEmployeeId);
  return [...state.employees].sort((a,b)=>a.order-b.order);
}
function trainingProjectionForYear(t,year){
  const months=trainingRecurrenceMonths(t);
  if(!months||!t.recurring)return [];
  const baseYear=Number(t.training_year||(t.start_date||'').slice(0,4));
  if(!baseYear||year<=baseYear)return [];
  const out=[];
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
function filteredTrainings(){
  const search=(document.getElementById('trainingSearchInput')?.value||'').trim().toLowerCase();
  const empFilter=sessionRole==='employee'?sessionEmployeeId:(document.getElementById('trainingEmployeeFilter')?.value||'');
  const status=document.getElementById('trainingStatusFilter')?.value||'';
  return trainingItemsWithProjections(trainingYear).filter(t=>{
    if(!trainingIntersectsYear(t))return false;
    if(empFilter&&t.employee_id!==empFilter)return false;
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
  return trainings.filter(t=>t.employee_id===empId&&t.status!=='cancelled'&&t.date_precision!=='year'&&t.start_date&&t.end_date&&t.start_date<=key&&t.end_date>=key);
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
  return t.start_date===t.end_date?fmt(a):fmt(a)+' – '+fmt(b);
}
function euro(n){return Number(n||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'})}

function switchModule(module,silent=false){
  currentModule=module==='training'?'training':'vacation';
  localStorage.setItem('teamplan-module',currentModule);
  if(currentModule==='training'&&document.body.classList.contains('planner-focus'))exitPlannerFocus();
  if(currentModule==='vacation'&&document.body.classList.contains('training-focus'))exitTrainingFocus();
  const vacation=currentModule==='vacation';
  ['vacationToolbar','monthView','plannerFocusControls','yearView','vacationHint'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(id==='monthView')el.classList.toggle('hidden',!vacation||currentView==='year');
    else if(id==='yearView')el.classList.toggle('hidden',!vacation||currentView!=='year');
    else if(id==='plannerFocusControls')el.classList.toggle('module-hidden',!vacation);
    else el.classList.toggle('hidden',!vacation);
  });
  document.getElementById('trainingModule')?.classList.toggle('hidden',vacation);
  document.getElementById('moduleVacationBtn')?.classList.toggle('active',vacation);
  document.getElementById('moduleTrainingBtn')?.classList.toggle('active',!vacation);
  document.body.classList.toggle('training-module-active',!vacation);
  if(!vacation)renderTrainingModule();
  if(!silent)showToast(vacation?'Urlaubsplanung':'Fortbildungsplaner');
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
  const type=document.getElementById('trainingType');
  if(type){
    const old=type.value;
    type.innerHTML='<option value="">Freier Eintrag</option>'+trainingTypes.filter(t=>t.active!==false).map(t=>'<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>').join('');
    if([...type.options].some(o=>o.value===old))type.value=old;
  }
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
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_trainings',filter:'team_id=eq.'+cfg.teamId},loadTrainingData)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_training_types',filter:'team_id=eq.'+cfg.teamId},loadTrainingData)
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_training_budgets',filter:'team_id=eq.'+cfg.teamId},loadTrainingData)
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
  return '<article class="training-entry '+(trainingCanManage()&&!t._virtual?'editable':'')+(yearOnly?' year-only':'')+(t._virtual?' virtual':'')+'" data-training-id="'+sourceId+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'>'+
    '<div class="training-entry-date"><strong>'+escapeHtml(dateMain)+'</strong><span>'+escapeHtml(dateSub)+'</span></div>'+
    '<div class="training-entry-main"><div class="training-entry-title"><strong>'+escapeHtml(t.title)+'</strong><span class="training-status '+(dueState||t.status)+'">'+escapeHtml(t._virtual?'Vorschau':trainingStatusLabel(t))+'</span></div>'+
    '<span>'+escapeHtml(emp)+' · '+escapeHtml(t.category||'Fortbildung')+' · '+escapeHtml(formatTrainingDateRange(t))+'</span>'+
    '<small>'+[recurrence,Number(t.hours)?formatVacationNumber(t.hours)+' h':'',Number(t.cost)?euro(t.cost):'',t.provider, due?'gültig bis '+new Date(due+'T12:00:00').toLocaleDateString('de-DE'):'' ].filter(Boolean).map(escapeHtml).join(' · ')+'</small>'+
    (conf.length?'<em class="training-conflict">! '+conf.length+' Überschneidung'+(conf.length===1?'':'en')+' mit Abwesenheit</em>':'')+
    '</div></article>';
}
function trainingStatusDropzonesHtml(){
  if(!trainingCanManage())return '';
  return '<span>Hierher ziehen:</span>'+
    '<div class="training-status-dropzone planned" data-training-drop-status="planned">Geplant</div>'+
    '<div class="training-status-dropzone completed" data-training-drop-status="completed">Abgeschlossen</div>'+
    '<div class="training-status-dropzone cancelled" data-training-drop-status="cancelled">Abgesagt</div>';
}
function renderTrainingDropzones(){
  ['trainingOverviewDropzones','trainingCalendarDropzones','trainingClassicDropzones'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.innerHTML=trainingStatusDropzonesHtml();
  });
}
async function updateTrainingStatusByDrop(id,status){
  if(!trainingCanManage()||!id||!['planned','completed','cancelled'].includes(status))return;
  const {error}=await supabaseClient.from('teamplan_trainings').update({status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){alert(error.message);return}
  await loadTrainingData();showToast(status==='completed'?'Als abgeschlossen markiert':status==='cancelled'?'Als abgesagt markiert':'Auf geplant gesetzt');
}
function bindTrainingDragDrop(){
  if(!trainingCanManage())return;
  document.querySelectorAll('[draggable="true"][data-training-id]').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.effectAllowed='move';
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
}
function renderTrainingMetrics(items){
  const box=document.getElementById('trainingMetrics');if(!box)return;
  const active=items.filter(t=>t.status==='planned').length;
  const completed=items.filter(t=>t.status==='completed').length;
  const due=items.filter(t=>trainingDueState(t)==='due').length;
  const overdue=items.filter(t=>trainingDueState(t)==='overdue').length;
  const cost=items.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+Number(t.cost||0),0);
  const employees=trainingVisibleEmployees();
  const budget=employees.reduce((s,e)=>s+trainingBudgetFor(e.id),0);
  box.innerHTML=
    '<article><span>Geplant</span><strong>'+active+'</strong><small>'+trainingYear+'</small></article>'+
    '<article><span>Abgeschlossen</span><strong>'+completed+'</strong><small>'+trainingYear+'</small></article>'+
    '<article class="'+(overdue?'metric-alert':'')+'"><span>Fälligkeiten</span><strong>'+due+' / '+overdue+'</strong><small>bald / überfällig</small></article>'+
    '<article><span>Kosten</span><strong>'+escapeHtml(euro(cost))+'</strong><small>'+(budget?escapeHtml(euro(budget))+' Budget':'kein Budget hinterlegt')+'</small></article>';
}
function renderTrainingOverview(items){
  renderTrainingMetrics(items);
  const today=dateKey(new Date());
  const upcoming=items.filter(t=>t.status==='planned'&&(t.date_precision==='year'?Number(t.training_year)>=new Date().getFullYear():(t.end_date&&t.end_date>=today))).sort((a,b)=>{
    const ad=a.date_precision==='year'?String(a.training_year)+'-99-99':(a.start_date||'9999-99-99');
    const bd=b.date_precision==='year'?String(b.training_year)+'-99-99':(b.start_date||'9999-99-99');
    return ad.localeCompare(bd);
  }).slice(0,30);
  const due=items.filter(t=>['due','overdue'].includes(trainingDueState(t))).sort((a,b)=>(trainingDueDate(a)||'9999').localeCompare(trainingDueDate(b)||'9999')).slice(0,30);
  const up=document.getElementById('trainingUpcomingList'),dl=document.getElementById('trainingDueList');
  if(up)up.innerHTML=upcoming.length?upcoming.map(trainingEntryHtml).join(''):'<div class="empty-state">Keine geplanten Fortbildungen.</div>';
  if(dl)dl.innerHTML=due.length?due.map(trainingEntryHtml).join(''):'<div class="empty-state success-state">Keine fälligen Fortbildungen.</div>';
}
function renderTrainingCalendar(items){
  const box=document.getElementById('trainingYearCalendar');if(!box)return;
  const undated=items.filter(t=>t.date_precision==='year'&&Number(t.training_year)===Number(trainingYear));
  const undatedHtml=undated.length?'<article class="training-undated glass"><div class="training-month-head"><strong>Termin noch offen</strong><span>'+undated.length+'</span></div><div class="training-month-items">'+undated.map(t=>'<button type="button" class="training-month-item undated '+t.status+(t._virtual?' virtual':'')+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'><b>'+escapeHtml(t.title)+(trainingRecurrenceLabel(t)?' <span class="training-repeat-inline">↻</span>':'')+'</b><span>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</span><small>im Jahr '+escapeHtml(String(t.training_year))+(trainingRecurrenceLabel(t)?' · '+escapeHtml(trainingRecurrenceLabel(t)):'')+'</small></button>').join('')+'</div></article>':'';
  box.innerHTML=undatedHtml+MONTHS.map((month,m)=>{
    const first=trainingYear+'-'+String(m+1).padStart(2,'0')+'-01';
    const last=trainingYear+'-'+String(m+1).padStart(2,'0')+'-'+String(new Date(trainingYear,m+1,0).getDate()).padStart(2,'0');
    const monthItems=items.filter(t=>t.date_precision!=='year'&&t.start_date&&t.end_date&&t.start_date<=last&&t.end_date>=first).sort((a,b)=>a.start_date.localeCompare(b.start_date));
    return '<article class="training-month glass"><div class="training-month-head"><strong>'+month+'</strong><span>'+monthItems.length+'</span></div><div class="training-month-items">'+
      (monthItems.length?monthItems.map(t=>'<button type="button" class="training-month-item '+t.status+(t._virtual?' virtual':'')+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'><b>'+escapeHtml(t.title)+(trainingRecurrenceLabel(t)?' <span class="training-repeat-inline">↻</span>':'')+'</b><span>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</span><small>'+escapeHtml(formatTrainingDateRange(t))+(trainingRecurrenceLabel(t)?' · '+escapeHtml(trainingRecurrenceLabel(t)):'')+'</small></button>').join(''):'<div class="training-month-empty">—</div>')+
      '</div></article>';
  }).join('');
}
function renderTrainingClassic(items){
  const body=document.getElementById('trainingClassicBody');if(!body)return;
  body.innerHTML=items.length?items.map(t=>{
    const due=trainingDueDate(t),rec=trainingRecurrenceLabel(t)||'—';
    return '<tr class="'+(t._virtual?'virtual':'')+'" data-training-id="'+(t._sourceId||t.id)+'" data-training-virtual="'+(t._virtual?'1':'0')+'" '+(trainingCanManage()&&!t._virtual?'draggable="true"':'')+'>'+
      '<td>'+escapeHtml(trainingEmployeeName(t.employee_id))+'</td>'+
      '<td><strong>'+escapeHtml(t.title)+'</strong><small>'+escapeHtml(t.category||'')+'</small></td>'+
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
  const employees=trainingVisibleEmployees();
  box.innerHTML=employees.length?employees.map(e=>{
    const rows=items.filter(t=>t.employee_id===e.id),cost=rows.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+Number(t.cost||0),0),hours=rows.filter(t=>t.status==='completed').reduce((s,t)=>s+Number(t.hours||0),0),budget=trainingBudgetFor(e.id);
    const overdue=rows.filter(t=>trainingDueState(t)==='overdue').length,due=rows.filter(t=>trainingDueState(t)==='due').length;
    return '<article class="training-employee-card glass"><div class="training-employee-head"><div><strong>'+escapeHtml(e.name)+'</strong><span>'+escapeHtml(String(e.percent))+' % · '+escapeHtml(String(e.hours))+' h/Woche</span></div>'+(trainingCanManage()?'<button type="button" class="btn ghost training-budget-btn" data-employee="'+e.id+'">Budget</button>':'')+'</div>'+
      '<div class="training-employee-stats"><span><b>'+formatVacationNumber(hours)+'</b> Std.</span><span><b>'+euro(cost)+'</b> Kosten</span><span class="'+(overdue?'bad':'')+'"><b>'+due+' / '+overdue+'</b> fällig</span><span><b>'+euro(budget)+'</b> Budget</span></div>'+
      '<div class="training-employee-progress"><i style="width:'+Math.min(100,budget?cost/budget*100:0)+'%"></i></div>'+
      '<div class="training-employee-list">'+(rows.length?rows.slice(0,12).map(trainingEntryHtml).join(''):'<div class="empty-state">Keine Fortbildungen in '+trainingYear+'.</div>')+'</div></article>';
  }).join(''):'<div class="empty-state">Keine Mitarbeiter verfügbar.</div>';
}
function bindTrainingRenderedEvents(){
  if(trainingCanManage())document.querySelectorAll('[data-training-id]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();openTraining(el.dataset.trainingId)}));
  document.querySelectorAll('.training-budget-btn').forEach(b=>b.addEventListener('click',()=>openTrainingBudget(b.dataset.employee)));
}
function renderTrainingModule(){
  if(!document.getElementById('trainingModule'))return;
  populateTrainingControls();applyTrainingRoleUI();
  document.getElementById('trainingOverviewView').classList.toggle('hidden',trainingView!=='overview');
  document.getElementById('trainingCalendarView').classList.toggle('hidden',trainingView!=='calendar');
  document.getElementById('trainingEmployeesView').classList.toggle('hidden',trainingView!=='employees');
  document.getElementById('trainingClassicView').classList.toggle('hidden',trainingView!=='classic');
  document.getElementById('trainingOverviewBtn').classList.toggle('active',trainingView==='overview');
  document.getElementById('trainingCalendarBtn').classList.toggle('active',trainingView==='calendar');
  document.getElementById('trainingEmployeesBtn').classList.toggle('active',trainingView==='employees');
  document.getElementById('trainingClassicBtn').classList.toggle('active',trainingView==='classic');
  const items=filteredTrainings();
  if(trainingView==='overview')renderTrainingOverview(items);
  if(trainingView==='calendar')renderTrainingCalendar(items);
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
  document.getElementById('trainingStart').required=!yearOnly;
  document.getElementById('trainingEnd').required=!yearOnly;
  if(yearOnly){
    if(!document.getElementById('trainingOnlyYear').value)document.getElementById('trainingOnlyYear').value=trainingYear;
  }
  updateTrainingVacationWarning();
}
function enterTrainingFocus(){
  if(currentModule!=='training')switchModule('training',true);
  document.body.classList.add('training-focus');
  document.getElementById('trainingFocusBtn').classList.add('hidden');
  document.getElementById('trainingExitFocusBtn').classList.remove('hidden');
}
function exitTrainingFocus(){
  document.body.classList.remove('training-focus');
  document.getElementById('trainingFocusBtn')?.classList.remove('hidden');
  document.getElementById('trainingExitFocusBtn')?.classList.add('hidden');
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
  document.getElementById('trainingHours').value=Number(t?.hours||0);
  document.getElementById('trainingCost').value=Number(t?.cost||0);
  document.getElementById('trainingProvider').value=t?.provider||'';
  document.getElementById('trainingValidUntil').value=t?.valid_until||'';
  document.getElementById('trainingNote').value=t?.note||'';
  document.getElementById('deleteTrainingBtn').classList.toggle('hidden',!t);
  syncTrainingDateMode();updateTrainingVacationWarning();safeShowDialog('trainingDialog');
}
async function saveTrainingFromForm(){
  if(!trainingCanManage())return;
  const cfg=window.TEAMPLAN_CONFIG||{},id=document.getElementById('trainingId').value||null,yearOnly=document.getElementById('trainingYearOnly').checked,start=document.getElementById('trainingStart').value,end=document.getElementById('trainingEnd').value,onlyYear=Number(document.getElementById('trainingOnlyYear').value||trainingYear);
  if(yearOnly){
    if(onlyYear<2020||onlyYear>2100){alert('Bitte ein gültiges Jahr angeben.');return}
  }else if(!start||!end||end<start){alert('Bitte einen gültigen Zeitraum angeben.');return}
  const row={team_id:cfg.teamId,employee_id:document.getElementById('trainingEmployee').value,type_id:document.getElementById('trainingType').value||null,title:document.getElementById('trainingTitle').value.trim(),category:document.getElementById('trainingCategory').value.trim()||'Fortbildung',date_precision:yearOnly?'year':'exact',training_year:yearOnly?onlyYear:Number(start.slice(0,4)),start_date:yearOnly?null:start,end_date:yearOnly?null:end,status:document.getElementById('trainingStatus').value,hours:Number(document.getElementById('trainingHours').value||0),cost:Number(document.getElementById('trainingCost').value||0),provider:document.getElementById('trainingProvider').value.trim(),valid_until:document.getElementById('trainingValidUntil').value||null,note:document.getElementById('trainingNote').value.trim(),updated_at:new Date().toISOString()};
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
}
function resetTrainingTypeForm(){
  ['trainingTypeId','trainingTypeName','trainingTypeInterval','trainingTypeDescription'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('trainingTypeCategory').value='Pflichtfortbildung';
  document.getElementById('trainingTypeHours').value=0;document.getElementById('trainingTypeCost').value=0;document.getElementById('trainingTypeMandatory').checked=false;
}
function renderTrainingTypes(){
  const list=document.getElementById('trainingTypesList');if(!list)return;
  list.innerHTML=trainingTypes.length?trainingTypes.map(t=>'<div class="management-item training-type-row" data-type-id="'+t.id+'"><div><strong>'+escapeHtml(t.name)+'</strong><span>'+escapeHtml(t.category||'')+(t.interval_months?' · alle '+t.interval_months+' Monate':'')+(t.mandatory?' · Pflicht':'')+'</span></div><div class="training-type-actions"><button type="button" class="btn ghost training-type-edit">Bearbeiten</button><button type="button" class="btn danger training-type-delete">Löschen</button></div></div>').join(''):'<div class="empty-state">Noch keine Fortbildungsarten angelegt.</div>';
  list.querySelectorAll('.training-type-row').forEach(row=>{
    row.querySelector('.training-type-edit').addEventListener('click',()=>editTrainingType(row.dataset.typeId));
    row.querySelector('.training-type-delete').addEventListener('click',()=>deleteTrainingType(row.dataset.typeId));
  });
}
function editTrainingType(id){
  const t=trainingTypeById(id);if(!t)return;
  document.getElementById('trainingTypeId').value=t.id;document.getElementById('trainingTypeName').value=t.name;document.getElementById('trainingTypeCategory').value=t.category||'';document.getElementById('trainingTypeInterval').value=t.interval_months||'';document.getElementById('trainingTypeHours').value=Number(t.default_hours||0);document.getElementById('trainingTypeCost').value=Number(t.default_cost||0);document.getElementById('trainingTypeMandatory').checked=!!t.mandatory;document.getElementById('trainingTypeDescription').value=t.description||'';
}
async function saveTrainingType(){
  if(!trainingCanManage())return;
  const cfg=window.TEAMPLAN_CONFIG||{},id=document.getElementById('trainingTypeId').value||null,row={team_id:cfg.teamId,name:document.getElementById('trainingTypeName').value.trim(),category:document.getElementById('trainingTypeCategory').value.trim()||'Fortbildung',interval_months:Number(document.getElementById('trainingTypeInterval').value)||null,default_hours:Number(document.getElementById('trainingTypeHours').value||0),default_cost:Number(document.getElementById('trainingTypeCost').value||0),mandatory:document.getElementById('trainingTypeMandatory').checked,description:document.getElementById('trainingTypeDescription').value.trim(),active:true,updated_at:new Date().toISOString()};
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
function exportTrainingExcel(){
  if(!window.XLSX){alert('Excel-Export nicht verfügbar.');return}
  const rows=filteredTrainings().map(t=>({Mitarbeiter:trainingEmployeeName(t.employee_id),Titel:t.title,Kategorie:t.category,Von:t.date_precision==='year'?'':t.start_date,Bis:t.date_precision==='year'?'':t.end_date,Jahr:t.training_year||'',Terminstatus:t.date_precision==='year'?'nur Jahr bekannt':'genaues Datum',Status:trainingStatusLabel(t),Stunden:Number(t.hours||0),Kosten:Number(t.cost||0),Anbieter:t.provider||'',Gueltig_bis:trainingDueDate(t)||'',Notiz:t.note||''}));
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'Fortbildungen');XLSX.writeFile(wb,'TeamPlan_Fortbildungen_'+trainingYear+'.xlsx');
}
function initTrainingModuleUI(){
  document.getElementById('moduleVacationBtn')?.addEventListener('click',()=>switchModule('vacation'));
  document.getElementById('moduleTrainingBtn')?.addEventListener('click',()=>switchModule('training'));
  document.getElementById('trainingOverviewBtn')?.addEventListener('click',()=>setTrainingView('overview'));
  document.getElementById('trainingCalendarBtn')?.addEventListener('click',()=>setTrainingView('calendar'));
  document.getElementById('trainingEmployeesBtn')?.addEventListener('click',()=>setTrainingView('employees'));
  document.getElementById('trainingPrevYear')?.addEventListener('click',()=>{trainingYear--;localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  document.getElementById('trainingNextYear')?.addEventListener('click',()=>{trainingYear++;localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  document.getElementById('trainingYearSelect')?.addEventListener('change',e=>{trainingYear=Number(e.target.value);localStorage.setItem('teamplan-training-year',trainingYear);renderTrainingModule()});
  ['trainingSearchInput','trainingEmployeeFilter','trainingStatusFilter'].forEach(id=>document.getElementById(id)?.addEventListener(id==='trainingSearchInput'?'input':'change',renderTrainingModule));
  document.getElementById('addTrainingBtn')?.addEventListener('click',()=>openTraining());
  document.getElementById('trainingTypesBtn')?.addEventListener('click',()=>{if(!trainingCanManage())return;resetTrainingTypeForm();renderTrainingTypes();safeShowDialog('trainingTypesDialog')});
  document.getElementById('trainingFocusBtn')?.addEventListener('click',enterTrainingFocus);
  document.getElementById('trainingExitFocusBtn')?.addEventListener('click',exitTrainingFocus);
  document.getElementById('trainingYearOnly')?.addEventListener('change',syncTrainingDateMode);
  document.getElementById('trainingOnlyYear')?.addEventListener('input',updateTrainingVacationWarning);
  document.getElementById('trainingExportBtn')?.addEventListener('click',exportTrainingExcel);
  document.getElementById('trainingForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingFromForm()});
  document.getElementById('deleteTrainingBtn')?.addEventListener('click',deleteTraining);
  document.getElementById('trainingType')?.addEventListener('change',applyTrainingTypeDefaults);
  ['trainingEmployee','trainingStart','trainingEnd'].forEach(id=>document.getElementById(id)?.addEventListener('change',updateTrainingVacationWarning));
  document.getElementById('trainingTypeForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingType()});
  document.getElementById('trainingTypeResetBtn')?.addEventListener('click',resetTrainingTypeForm);
  document.getElementById('trainingBudgetForm')?.addEventListener('submit',e=>{e.preventDefault();saveTrainingBudget()});
  populateTrainingControls();applyTrainingRoleUI();
}

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
      authUser=user;await loadAuthMembership();await loadRemotePlan();await loadTrainingData();await startPresence();await startDiscussionRealtime();await startTrainingRealtime();hideLogin();setSync('live','● Live synchron');switchModule(currentModule,true);
    }
    supabaseClient.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_OUT'||!session){await stopTrainingRealtime();await stopDiscussionRealtime();await stopPresence();authUser=null;authMembership=null;renderRoleControls();setSync('local','● Abgemeldet');showLogin();return}
      if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){
        const {data:{user}}=await supabaseClient.auth.getUser();authUser=user;
        try{await loadAuthMembership();await loadRemotePlan();await loadTrainingData();await startPresence();await startDiscussionRealtime();await startTrainingRealtime();hideLogin();setSync('live','● Live synchron');switchModule(currentModule,true)}catch(err){console.error(err);document.getElementById('loginError').textContent=err.message;document.getElementById('loginError').classList.remove('hidden');showLogin()}
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
document.getElementById('vacationFullBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='full';persist();render();showToast('Urlaub: Gesamt – jedes U zählt 1,0')});
document.getElementById('vacationActualBtn').addEventListener('click',()=>{state.settings.vacationDisplayMode='actual';persist();render();showToast('Urlaub: Anteilig nach Stellenprozent')});
['employeePercent','employeeCarry','employeeAdjustment'].forEach(id=>document.getElementById(id)?.addEventListener('input',updateVacationPreview));
document.getElementById('searchInput').addEventListener('input',render);
document.getElementById('addEmployeeBtn').addEventListener('click',()=>openEmployee());
document.getElementById('importNamesBtn').addEventListener('click',()=>{if(!canManage())return;document.getElementById('namesPasteInput').value='';document.getElementById('namesFileInput').value='';updateNamesImportPreview([]);document.getElementById('namesImportDialog').showModal()});
document.getElementById('settingsBtn').addEventListener('click',openSettings);
document.getElementById('discussionsBtn').addEventListener('click',openDiscussionsDialog);
document.getElementById('newDiscussionBtn').addEventListener('click',()=>openNewDiscussion());
document.getElementById('discussionOpenFilter').addEventListener('click',()=>{discussionFilter='open';renderDiscussionList()});
document.getElementById('discussionAllFilter').addEventListener('click',()=>{discussionFilter='all';renderDiscussionList()});
document.getElementById('discussionResolveBtn').addEventListener('click',toggleDiscussionResolved);
document.getElementById('newDiscussionForm').addEventListener('submit',e=>{e.preventDefault();createDiscussionFromForm()});
document.getElementById('discussionMessageForm').addEventListener('submit',e=>{e.preventDefault();sendDiscussionMessage()});
document.getElementById('usersBtn').addEventListener('click',openUsersDialog);
document.getElementById('accountSaveBtn').addEventListener('click',saveMyAccount);
document.getElementById('undoBtn').addEventListener('click',undoLastAction);
document.querySelectorAll('[data-conflict-filter]').forEach(btn=>btn.addEventListener('click',()=>{conflictFilter=btn.dataset.conflictFilter;renderConflicts()}));
document.getElementById('conflictSort').addEventListener('change',e=>{conflictSort=e.target.value;renderConflicts()});
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
document.getElementById('employeeCleanupBtn').addEventListener('click',()=>{const id=document.getElementById('employeeId').value;if(!id)return;document.getElementById('employeeDialog').close();openCleanupDialog(id)});
document.getElementById('openCleanupBtn').addEventListener('click',()=>openCleanupDialog('all'));
['cleanupEmployee','cleanupPeriod','cleanupCode'].forEach(id=>document.getElementById(id).addEventListener('change',updateCleanupPreview));
document.getElementById('cleanupForm').addEventListener('submit',e=>{e.preventDefault();applyCleanup()});
document.getElementById('fitEmployeesBtn').addEventListener('click',fitAllEmployees);
document.getElementById('focusFitBtn').addEventListener('click',fitAllEmployees);
document.getElementById('focusModeBtn').addEventListener('click',enterPlannerFocus);
document.getElementById('exitFocusBtn').addEventListener('click',exitPlannerFocus);
document.getElementById('focusSearchBtn').addEventListener('click',()=>toggleFocusSearch());
document.getElementById('focusPanBtn').addEventListener('click',()=>setFocusPanMode(!focusPanMode));
document.getElementById('focusZoomOutBtn').addEventListener('click',()=>changeZoom(-.05));
document.getElementById('focusZoomInBtn').addEventListener('click',()=>changeZoom(.05));
document.getElementById('focusMonthSelect').addEventListener('change',e=>scrollFocusToMonth(Number(e.target.value)));
document.getElementById('focusPrevMonthBtn').addEventListener('click',()=>stepFocusMonth(-1));
document.getElementById('focusNextMonthBtn').addEventListener('click',()=>stepFocusMonth(1));
document.getElementById('focusSearchInput').addEventListener('input',e=>{
  document.getElementById('searchInput').value=e.target.value;
  render();
});
document.getElementById('focusSearchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toggleFocusSearch(false)}});
const focusPlanner=document.getElementById('planner');
focusPlanner.addEventListener('pointerdown',e=>{
  if(!focusPanMode||!document.body.classList.contains('planner-focus')||e.button!==0)return;
  e.preventDefault();hideCellContextMenu();clearDragSelection();focusPanning=true;
  focusPanStartX=e.clientX;focusPanStartY=e.clientY;focusPanScrollLeft=focusPlanner.scrollLeft;focusPanScrollTop=focusPlanner.scrollTop;
  focusPlanner.classList.add('panning');focusPlanner.style.scrollBehavior='auto';
  try{focusPlanner.setPointerCapture(e.pointerId)}catch{}
});
focusPlanner.addEventListener('pointermove',e=>{
  if(!focusPanning)return;
  e.preventDefault();
  const dx=e.clientX-focusPanStartX,dy=e.clientY-focusPanStartY;
  focusPlanner.scrollLeft=focusPanScrollLeft-dx;
  focusPlanner.scrollTop=focusPanScrollTop-dy;
  plannerScrollLeft=focusPlanner.scrollLeft;
});
const stopFocusPan=e=>{
  if(!focusPanning)return;focusPanning=false;focusPlanner.classList.remove('panning');focusPlanner.style.scrollBehavior='';
  plannerScrollLeft=focusPlanner.scrollLeft;
  try{focusPlanner.releasePointerCapture(e.pointerId)}catch{}
};
focusPlanner.addEventListener('pointerup',stopFocusPan);
focusPlanner.addEventListener('pointercancel',stopFocusPan);
focusPlanner.addEventListener('pointerleave',e=>{if(focusPanning&&!(e.buttons&1))stopFocusPan(e)});
document.getElementById('employeeForm').addEventListener('submit',e=>{e.preventDefault();if(!canEditEmployees())return;const id=document.getElementById('employeeId').value||uid();const current=state.employees.find(x=>x.id===id);trackAction(current?'Mitarbeiter geändert':'Mitarbeiter angelegt',document.getElementById('employeeName').value.trim());const workweek=[...document.querySelectorAll('.weekday-toggle.active')].map(b=>Number(b.dataset.day));const autoWeekend={enabled:document.getElementById('employeeAutoWeekend').checked,intervalWeeks:Number(document.getElementById('employeeWeekendInterval').value||2),anchorDate:document.getElementById('employeeWeekendAnchor').value};if(autoWeekend.enabled&&!autoWeekend.anchorDate){alert('Bitte einen Referenz-Samstag für die freien Wochenenden auswählen.');return}if(current)clearAutoWeekendX(id);const obj={id,name:document.getElementById('employeeName').value.trim(),hours:Number(document.getElementById('employeeHours').value),percent:Number(document.getElementById('employeePercent').value),workdays:Number(document.getElementById('employeeWorkdays').value),workweek,carry:Number(document.getElementById('employeeCarry').value),adjustment:Number(document.getElementById('employeeAdjustment').value),autoWeekend,role:sessionRole==='admin'?document.getElementById('employeeRole').value:(current?.role||'employee'),order:current?.order??state.employees.length};if(current)Object.assign(current,obj);else state.employees.push(obj);ensureAutoWeekendEntries(viewDate.getFullYear());persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gespeichert')});
document.getElementById('deleteEmployeeBtn').addEventListener('click',()=>{if(sessionRole!=='admin')return;const id=document.getElementById('employeeId').value;if(!id)return;if(confirm('Mitarbeiter und alle zugehörigen Planeinträge wirklich löschen?')){const name=state.employees.find(e=>e.id===id)?.name||'';trackAction('Mitarbeiter gelöscht',name);state.employees=state.employees.filter(e=>e.id!==id);delete state.entries[id];persist();renderRoleControls();render();document.getElementById('employeeDialog').close();showToast('Mitarbeiter gelöscht')}});

document.getElementById('cellForm').addEventListener('submit',e=>{e.preventDefault();const empId=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(empId))return;const blocked=blackoutBlocks(key);if(blocked&&[...selectedCodes].some(c=>['U','XU'].includes(c))){alert('Urlaub ist in dieser Sperrzeit blockiert: '+blocked.name);return}if(!state.entries[empId])state.entries[empId]={};const existing=entryFor(empId,key);const candidate={codes:[...selectedCodes],priority:Number(document.getElementById('cellPriority').value),note:document.getElementById('cellNote').value.trim(),status:canApprove()&&document.getElementById('cellDirectApprove').checked&&selectedCodes.has('U')?'approved':canApprove()?document.getElementById('cellStatus').value:'wish',plannerMarkers:canManage()?[...selectedPlannerMarkers]:(existing.plannerMarkers||[])};const warn=document.getElementById('cellWarning').textContent;if(warn&&state.settings.confirmConflicts&&!confirm(warn+' Trotzdem speichern?'))return;trackAction('Planung geändert',(state.employees.find(e=>e.id===empId)?.name||'')+' · '+key+' · '+candidate.codes.join('+'));if(candidate.codes.length||candidate.priority||candidate.note||candidate.plannerMarkers.length)state.entries[empId][key]=candidate;else delete state.entries[empId][key];persist();saveRemoteEntry(empId,key,state.entries[empId]?.[key]??null);render();document.getElementById('cellDialog').close();showToast('Planung aktualisiert')});
document.getElementById('clearCellBtn').addEventListener('click',()=>{const emp=document.getElementById('cellEmployeeId').value,key=document.getElementById('cellDateValue').value;if(!canPlan(emp))return;if(state.entries[emp]){trackAction('Eintrag gelöscht',(state.employees.find(e=>e.id===emp)?.name||'')+' · '+key);delete state.entries[emp][key]}persist();saveRemoteEntry(emp,key,null);render();document.getElementById('cellDialog').close();showToast('Eintrag gelöscht')});

document.querySelectorAll('[data-planner-marker]').forEach(b=>b.addEventListener('click',()=>{
  if(!canManage())return;
  const marker=b.dataset.plannerMarker;
  selectedPlannerMarkers.has(marker)?selectedPlannerMarkers.delete(marker):selectedPlannerMarkers.add(marker);
  b.classList.toggle('selected',selectedPlannerMarkers.has(marker));
}));
document.getElementById('addCustomCodeBtn').addEventListener('click',()=>{
  if(!canManage())return;
  const key=document.getElementById('customCodeKey').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  const label=document.getElementById('customCodeLabel').value.trim();
  const color=document.getElementById('customCodeColor').value||'#6f7f8f';
  const absence=document.getElementById('customCodeAbsence').checked;
  if(!key||!label){alert('Bitte Kürzel und Bezeichnung angeben.');return}
  if(allCodeDefs().some(c=>c.key===key)){alert('Dieses Kürzel existiert bereits.');return}
  trackAction('Kürzel angelegt',key+' · '+label);
  state.settings.customCodes.push({key,label,color,absence,className:'custom-code'});
  persist();
  document.getElementById('customCodeKey').value='';
  document.getElementById('customCodeLabel').value='';
  document.getElementById('customCodeAbsence').checked=false;
  renderCustomCodesSettings();render();showToast('Kürzel '+key+' angelegt');
});
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
document.querySelectorAll('[data-drag-marker]').forEach(b=>b.addEventListener('click',()=>applyDragPlannerMarker(b.dataset.dragMarker)));
document.getElementById('dragApprovedVacationBtn').addEventListener('click',applyApprovedVacation);
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
      try{await loadAuthMembership();await loadRemotePlan();await startPresence();await startDiscussionRealtime();hideLogin();setSync('live','● Live synchron')}catch(err){errEl.textContent=err.message;errEl.classList.remove('hidden')}
    }else{
      errEl.textContent='Konto angelegt. Bitte bestätige gegebenenfalls die E-Mail und melde dich danach an. Der Setup-Code bleibt lokal gespeichert.';errEl.classList.remove('hidden');
    }
    return;
  }
  const {error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){errEl.textContent=error.message;errEl.classList.remove('hidden')}
});
document.getElementById('logoutBtn').addEventListener('click',async()=>{if(supabaseClient)await supabaseClient.auth.signOut()});
document.getElementById('planner').addEventListener('contextmenu',e=>{
  const cell=e.target.closest('.day-cell');
  if(!cell)return;
  e.preventDefault();
  showCellContextMenu(e,cell.dataset.emp,cell.dataset.date);
});
document.getElementById('planner').addEventListener('click',e=>{
  if(!e.ctrlKey)return;
  const cell=e.target.closest('.day-cell');if(!cell)return;
  e.preventDefault();e.stopPropagation();
  showCellContextMenu(e,cell.dataset.emp,cell.dataset.date);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(dragSelectedKeys.size)clearDragSelection();hideCellContextMenu()}
  if(e.shiftKey&&e.key==='F10'){
    const cell=document.querySelector('.day-cell:hover');if(!cell)return;
    e.preventDefault();
    const r=cell.getBoundingClientRect();
    showCellContextMenu({preventDefault(){},stopPropagation(){},clientX:r.left+12,clientY:r.top+12},cell.dataset.emp,cell.dataset.date);
  }
});
document.addEventListener('click',e=>{if(!e.target.closest('#cellContextMenu'))hideCellContextMenu()});
window.addEventListener('resize',hideCellContextMenu);
document.getElementById('planner').addEventListener('scroll',hideCellContextMenu,{passive:true});

initTrainingModuleUI();renderRoleControls();render();switchModule(currentModule,true);initRemote();
