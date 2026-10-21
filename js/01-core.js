// Grundlagen: Konstanten, Zustand, Sitzungs-Timer, Rechte, Hilfsfunktionen
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
const CODES = ['U','X','XU','S','G'];
const CODE_CLASS = {U:'u',X:'x',XU:'xu',S:'s',G:'g'};
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DOW = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const DOW_LONG = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const WORKDAY_LABELS = [{d:1,l:'Mo'},{d:2,l:'Di'},{d:3,l:'Mi'},{d:4,l:'Do'},{d:5,l:'Fr'}];
const DEFAULT_CODE_COLORS = {U:'#dfeee9',X:'#e9eef1',XU:'#f7e5d8',S:'#e7e5f4',G:'#f7e2e5'};

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
  settings: {baseVacation:30,maxVacation:4,maxAbsence:7,countSchool:true,countCodes:['U','XU','S'],countRows:['U','XU','S','TOTAL','PRESENT','ABSENT_NAMES'],countMode:'people',confirmConflicts:true,state:'NW',vacationDisplayMode:'actual',theme:'light',zoom:1,customCodes:[],codeColors:{...DEFAULT_CODE_COLORS}},
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

const INACTIVITY_LOGOUT_MS = 15 * 60 * 1000;
const INACTIVITY_WARNING_MS = 60 * 1000;
let inactivityDeadline = 0;
let inactivityTickTimer = null;
let inactivityLastReset = 0;
let inactivityLogoutPending = false;

function formatSessionCountdown(ms){
  const total=Math.max(0,Math.ceil(ms/1000));
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}
function renderSessionTimer(){
  const timer=document.getElementById('sessionTimer'),value=document.getElementById('sessionTimerValue');
  if(!timer||!value)return;
  if(!authUser||!inactivityDeadline){
    timer.classList.add('hidden','warning');
    value.textContent='15:00';
    return;
  }
  const remaining=Math.max(0,inactivityDeadline-Date.now());
  value.textContent=formatSessionCountdown(remaining);
  timer.classList.remove('hidden');
  timer.classList.toggle('warning',remaining<=INACTIVITY_WARNING_MS);
  timer.title='Automatische Abmeldung bei Inaktivität in '+formatSessionCountdown(remaining);
}
async function inactivityLogout(){
  if(inactivityLogoutPending||!authUser)return;
  inactivityLogoutPending=true;
  stopInactivityTimer();
  try{
    if(supabaseClient)await supabaseClient.auth.signOut();
  }catch(err){
    console.error('Automatische Abmeldung fehlgeschlagen',err);
    authUser=null;authMembership=null;renderRoleControls();showLogin();
  }finally{
    inactivityLogoutPending=false;
    showToast('Aus Sicherheitsgründen nach 15 Minuten Inaktivität abgemeldet');
  }
}
function checkInactivity(){
  if(!authUser||!inactivityDeadline)return;
  renderSessionTimer();
  if(Date.now()>=inactivityDeadline)inactivityLogout();
}
function resetInactivityTimer(force=false){
  if(!authUser||inactivityLogoutPending)return;
  const now=Date.now();
  // A suspended mobile tab must not revive a session that has already expired.
  if(!force&&inactivityDeadline&&now>=inactivityDeadline){
    inactivityLogout();
    return;
  }
  if(!force&&now-inactivityLastReset<1000)return;
  inactivityLastReset=now;
  inactivityDeadline=now+INACTIVITY_LOGOUT_MS;
  renderSessionTimer();
}
function startInactivityTimer(){
  stopInactivityTimer();
  if(!authUser)return;
  resetInactivityTimer(true);
  inactivityTickTimer=window.setInterval(checkInactivity,1000);
}
function stopInactivityTimer(){
  if(inactivityTickTimer){window.clearInterval(inactivityTickTimer);inactivityTickTimer=null}
  inactivityDeadline=0;inactivityLastReset=0;
  renderSessionTimer();
}
['pointerdown','keydown','touchstart','wheel'].forEach(eventName=>{
  document.addEventListener(eventName,()=>resetInactivityTimer(),{passive:true,capture:true});
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkInactivity()});
window.addEventListener('focus',checkInactivity);
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
let selectedConflictIds = new Set();
let currentModule = localStorage.getItem('teamplan-module') || 'vacation';
let employeeInfoPrefs = (()=>{try{return {...{work:false,vacation:true,xu:false},...JSON.parse(localStorage.getItem('teamplan-employee-info')||'{}')}}catch{return {work:false,vacation:true,xu:false}}})();
let vacationToolsOpen = false;
let vacationCrosshairEnabled = localStorage.getItem('teamplan-vacation-crosshair') === '1';
let showExternalEmployees = localStorage.getItem('teamplan-show-external-employees') === '1';
let projectShowExternal = localStorage.getItem('teamplan-project-show-external') !== '0';
let projectView = localStorage.getItem('teamplan-project-view') || 'overview';
if(!['overview','my','roadmap','board','calendar','team','notes'].includes(projectView)){
  projectView='overview';
  localStorage.setItem('teamplan-project-view',projectView);
}
let projectCalendarMode = localStorage.getItem('teamplan-project-calendar-mode') || 'month';
let projectCalendarDate = (()=>{const r=localStorage.getItem('teamplan-project-calendar-date');const d=r?new Date(r+'T12:00:00'):new Date();return isNaN(d)?new Date():d})();
let projectProjects = [];
let projectMembers = [];
let projectTasks = [];
let projectTemplates = [];
let projectNotes = [];
let projectComments = [];
let projectActivity = [];
let projectChannel = null;
let projectLoadPromise = null;
let projectReloadTimer = null;
let projectUiInitialized = false;
let projectDialogReturnProjectId = null;
let projectMemberDraft = new Map();
let trainingView = localStorage.getItem('teamplan-training-view') || 'overview';
let trainingYear = Number(localStorage.getItem('teamplan-training-year')) || new Date().getFullYear();
let trainingZoom = Math.max(.7,Math.min(1.3,Number(localStorage.getItem('teamplan-training-zoom')||1)));
let trainingMultiYearFrom = Number(localStorage.getItem('teamplan-training-multiyear-from')) || Math.max(2025,new Date().getFullYear()-1);
let trainingMultiYearTo = Number(localStorage.getItem('teamplan-training-multiyear-to')) || trainingMultiYearFrom+6;
let trainingTeamStatusTypeId = localStorage.getItem('teamplan-training-teamstatus-type') || '';
let trainingTeamStatusYear = Number(localStorage.getItem('teamplan-training-teamstatus-year')) || new Date().getFullYear();
let trainingTeamStatusSort = localStorage.getItem('teamplan-training-teamstatus-sort') || 'name';
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
  const incomingSettings=s.settings||{};
  s.settings={...defaultState.settings,...incomingSettings}; s.settings.customCodes=Array.isArray(s.settings.customCodes)?s.settings.customCodes:[]; s.settings.codeColors={...DEFAULT_CODE_COLORS,...(s.settings.codeColors||{})};
  if(!Array.isArray(incomingSettings.countCodes)){
    s.settings.countCodes=['U','XU',...(incomingSettings.countSchool===false?[]:['S']),...s.settings.customCodes.filter(c=>c.absence).map(c=>c.key)];
  }
  s.settings.countCodes=[...new Set(s.settings.countCodes.map(String))];
  if(!Array.isArray(incomingSettings.countRows))s.settings.countRows=['U','XU','S','TOTAL','PRESENT','ABSENT_NAMES'];
  s.settings.countRows=[...new Set(s.settings.countRows.map(String))];
  if(!['people','entries'].includes(s.settings.countMode))s.settings.countMode='people';
  s.employees=s.employees||[]; s.entries=s.entries||{}; s.blackouts=s.blackouts||[]; s.audit=s.audit||[];
  s.employees.forEach((e,i)=>{e.order=e.order??i;e.workweek=e.workweek||[1,2,3,4,5];e.carry=Number(e.carry||0);e.adjustment=Number(e.adjustment||0);e.role=e.role||'employee';e.external=!!e.external;e.organization=String(e.organization||'');e.autoWeekend=e.autoWeekend||{enabled:false,intervalWeeks:2,anchorDate:''}});
  Object.values(s.entries).forEach(empEntries=>Object.values(empEntries||{}).forEach(v=>{v.status=v.status||'wish';v.plannerMarkers=Array.isArray(v.plannerMarkers)?v.plannerMarkers:[]}));
  return s;
}
function authConfigured(){const c=window.TEAMPLAN_CONFIG||{};return !!(c.supabaseUrl&&c.supabaseAnonKey&&window.supabase)}
function persist(){
  state.updatedAt=new Date().toISOString(); localStorage.setItem('helios-teamplan-v1',JSON.stringify(state));
  if(!isApplyingRemote && supabaseClient && canManage()){clearTimeout(syncTimer);syncTimer=setTimeout(pushRemote,350)}
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function roleLabel(role=sessionRole){
  return role==='admin'?'Admin':role==='planner'?'Planer':role==='employee'?'Mitarbeiter':role==='external'?'Externer Projektmitarbeiter':'Nur Lesen';
}
function actorName(){
  if(sessionRole==='employee'||sessionRole==='external') return state.employees.find(e=>e.id===sessionEmployeeId)?.name || (sessionRole==='external'?'Externe Person':'Mitarbeiter');
  return roleLabel(sessionRole);
}
function teamEmployees(){return state.employees.filter(e=>!e.external)}
function externalEmployees(){return state.employees.filter(e=>!!e.external)}
function employeeDisplayLabel(e){return e?e.name+(e.external?' · extern'+(e.organization?' · '+e.organization:''):''):''}
function canPlan(empId){
  if(state.employees.find(e=>e.id===empId)?.external)return false;
  return sessionRole==='admin'||sessionRole==='planner'||(sessionRole==='employee'&&empId===sessionEmployeeId)
}
function canApprove(){return sessionRole==='admin'||sessionRole==='planner'}
function canManage(){return sessionRole==='admin'||sessionRole==='planner'}
function canEditEmployees(){return sessionRole==='admin'||sessionRole==='planner'}
function canDiscuss(){return !!authUser&&sessionRole!=='viewer'}
