// Team-Chat, Lesestatus, Live-Präsenz, Rückgängig
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
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
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_discussions'},async()=>{await loadDiscussions();if(activeDiscussionId)await selectDiscussion(activeDiscussionId)})
    .on('postgres_changes',{event:'*',schema:'public',table:'teamplan_messages'},async payload=>{
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
