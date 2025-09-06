// app.js — Firestore realtime + hodinové dovolenky (0–8, 0 = zrušiť) + admin CRUD + export/import v2 + rollover
// + ZÁMOK MINULOSTI: zamestnanec nemôže meniť dni pred dneškom
// + IMPORT: importuje LEN users a bookings (config sa neprepisuje)

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

const el = (q, parent=document) => parent.querySelector(q);
const els = (q, parent=document) => [...parent.querySelectorAll(q)];
const fmtDate = (d) => d.toISOString().split('T')[0];
const ymd = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

const HOURS_PER_DAY = 8;
const weekdays = ["Po","Ut","St","Št","Pi","So","Ne"];
const months = ["Január","Február","Marec","Apríl","Máj","Jún","Júl","August","September","Október","November","December"];

let state = {
  role: null, // 'admin' | 'employee'
  currentUserId: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth()+1,
  data: { 
    adminCode: "", 
    lastRolloverYear: null, 
    users: [], 
    bookings: {}, 
    notes: {}   // 🔵 nové pole na poznámky admina
  }
};

// ---------- Firestore helpers ----------
async function loadConfig(){
  const snap = await getDoc(doc(db,"config","admin"));
  if(snap.exists()){
    state.data.adminCode = snap.data().adminCode;
    state.data.lastRolloverYear = snap.data().lastRolloverYear ?? null;
  }
}
async function loadUsers(){
  const q = await getDocs(collection(db,"users"));
  state.data.users = q.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function loadBookings(){
  const q = await getDocs(collection(db,"bookings"));
  state.data.bookings = {};
  q.docs.forEach(d=>{
    state.data.bookings[d.id] = d.data().items || [];
  });
}

// realtime
function subscribe(){
  onSnapshot(doc(db,"config","admin"), snap=>{
    if(snap.exists()){
      state.data.adminCode = snap.data().adminCode;
      state.data.lastRolloverYear = snap.data().lastRolloverYear ?? null;
    }
  });
  onSnapshot(collection(db,"users"), snap=>{
    state.data.users = snap.docs.map(d=>({id:d.id,...d.data()}));
    render(); refreshSide();
  });
  onSnapshot(collection(db,"bookings"), snap=>{
    state.data.bookings = {};
    snap.docs.forEach(d=>{
      state.data.bookings[d.id] = d.data().items || [];
    });
    render(); refreshSide();
  });// realtime NOTES
onSnapshot(collection(db,"notes"), snap=>{
  const next = {};
  snap.docs.forEach(d=>{
    const data = d.data();
    // očakávame tvar: { items: [{id, text, by, at}] }
    next[d.id] = Array.isArray(data.items) ? data.items : [];
  });
  state.data.notes = next;
  render(); // prekreslí kalendár aj s modrými poznámkami
});
}

// ---------- Utils ----------
const getUserById = id => state.data.users.find(u=>u.id===id);
const getUserByCode = code => state.data.users.find(u=>u.code===code);

// clamp 1..8 (0 používame iba ako signál „zrušiť“, neukladá sa)
const clampH = x => {
  const n = Number.isFinite(+x) ? Math.floor(+x) : HOURS_PER_DAY;
  return Math.min(Math.max(n,1),HOURS_PER_DAY);
};

function approvedHoursFor(userId, year){
  let sum = 0;
  for(const [date, items] of Object.entries(state.data.bookings)){
    if(!date.startsWith(String(year))) continue;
    for(const it of items){
      if(it.userId===userId && it.status==='approved'){
        sum += clampH(it.hours);
      }
    }
  }
  return sum;
}

function computeUsage(){
  // Vypočíta využitie (schválené) v celom dataset-e
  const usage = {}; const totals = {};
  for(const u of state.data.users){ usage[u.id]={oldH:0,newH:0}; totals[u.id]=0; }
  for(const items of Object.values(state.data.bookings)){
    for(const b of items){
      if(b.status!=="approved") continue;
      totals[b.userId]=(totals[b.userId]||0)+clampH(b.hours);
    }
  }
  for(const u of state.data.users){
    const capOld=(+u.oldAllowance||0)*HOURS_PER_DAY;
    const t=totals[u.id]||0;
    const useOld=Math.min(t,capOld);
    usage[u.id].oldH=useOld;
    usage[u.id].newH=Math.max(0,t-useOld);
  }
  return usage;
}

function fmtDays(h){ return (h / HOURS_PER_DAY).toFixed(1); }

function showToast(msg){
  try {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111a;border:1px solid #333;padding:10px 14px;border-radius:10px;color:#fff;z-index:9999;font:500 14px/1.2 Inter,system-ui,sans-serif';
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 1800);
  } catch {}
}
// ---- Email notify helper ----
const ADMIN_EMAILS = [
  "tvoja-admin-adresa@firma.sk" // ← sem daj 1–N admin e-mailov
];

async function sendNotify({ toList = ADMIN_EMAILS, subject, text, html }) {
  // pošli samostatne na každého príjemcu (SendGrid personalizations je u nás single)
  for (const to of toList) {
    try {
      await fetch('/.netlify/functions/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, text, html })
      });
    } catch (e) {
      console.warn('sendNotify fail', to, e);
    }
  }
}

// ---------- Hodinový picker (0–8; 0 = zrušiť) ----------
function showHourPicker({title="Hodiny", initial=8, onSave, onCancel}){
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9998';
  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'min-width:280px;max-width:92vw;background:#0b1220;padding:16px;border-radius:14px;box-shadow:0 10px 30px #0006';
  card.innerHTML = `
    <h3 style="margin:0 0 8px 0">${title}</h3>
    <div class="row" style="align-items:center;gap:8px;margin:8px 0 14px">
      <button class="btn ghost" data-act="-">−</button>
      <input type="number" id="hpVal" min="0" max="8" step="1" value="${Math.max(0, Math.min(8, Number(initial)||0))}" style="width:80px;text-align:center">
      <button class="btn ghost" data-act="+">+</button>
      <span class="muted small">h (0–8, 0 = zrušiť)</span>
    </div>
    <div class="row" style="gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="hpCancel">Zrušiť</button>
      <button class="btn primary" id="hpSave">Uložiť</button>
    </div>
  `;
  root.appendChild(card);
  document.body.appendChild(root);

  const input = card.querySelector('#hpVal');
  card.querySelectorAll('button[data-act]').forEach(b=>b.onclick=()=>{
    const op = b.getAttribute('data-act');
    let v = Number(input.value)||0;
    v = op==='+' ? v+1 : v-1;
    v = Math.max(0, Math.min(8, v));
    input.value = v;
  });
  card.querySelector('#hpCancel').onclick = ()=>{ root.remove(); onCancel && onCancel(); };
  card.querySelector('#hpSave').onclick = ()=>{
    const v = Math.max(0, Math.min(8, Number(input.value)||0)); // 0..8
    root.remove();
    onSave && onSave(v);
  };
}

// ---------- Auth UI ----------
function setupAuth(){
  const tabs = els('.tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const name = t.dataset.tab;
    el('#tab-employee').hidden = name!=='employee';
    el('#tab-admin').hidden = name!=='admin';
  }));

  el('#loginAdmin').onclick = async () => {
    await loadConfig();
    const code = el('#adminCode').value.trim();
    if(code === state.data.adminCode){
      state.role = 'admin'; state.currentUserId = null; showApp();
    }else{
      alert('Nesprávny admin kód.');
    }
  };

  el('#loginEmployee').onclick = async () => {
    await loadUsers();
    const code = el('#employeeCode').value.trim();
    const user = getUserByCode(code);
    if(user){ state.role = 'employee'; state.currentUserId = user.id; showApp(); }
    else alert('Nesprávny kód.');
  };
}

function logout(){
  state.role = null;
  state.currentUserId = null;
  el('#appView').hidden = true;
  el('#authView').hidden = false;
}

// ---------- App UI ----------
function showApp(){
  el('#authView').hidden = true;
  el('#appView').hidden = false;
  el('#adminPanel').hidden = state.role!=='admin';
  el('#whoAmI').textContent = state.role==='admin' ? 'Admin' : (getUserById(state.currentUserId)?.name || '—');

  // Skryť ⚙️ pre zamestnanca
  const settingsBtn = el('#openSettings');
  if(settingsBtn) settingsBtn.style.display = (state.role === 'admin') ? 'inline-block' : 'none';

  buildMonthSelectors();
  render();
}

function buildMonthSelectors(){
  const msel = el('#monthSelect'), ysel = el('#yearSelect');
  msel.innerHTML = months.map((name,i)=>`<option value="${i+1}" ${i+1===state.viewMonth?'selected':''}>${name}</option>`).join('');
  const thisYear = new Date().getFullYear();
  const years = []; for(let y=thisYear-2; y<=thisYear+3; y++) years.push(y);
  ysel.innerHTML = years.map(y=>`<option ${y===state.viewYear?'selected':''}>${y}</option>`).join('');
  msel.onchange = () => { state.viewMonth = +msel.value; render(); };
  ysel.onchange = () => { state.viewYear = +ysel.value; render(); };
  el('#prevMonth').onclick = () => { let m=state.viewMonth-1,y=state.viewYear; if(m<1){m=12;y--;} state.viewMonth=m; state.viewYear=y; buildMonthSelectors(); render(); };
  el('#nextMonth').onclick = () => { let m=state.viewMonth+1,y=state.viewYear; if(m>12){m=1;y++;} state.viewMonth=m; state.viewYear=y; buildMonthSelectors(); render(); };
}

function render(){
  const cal = el('#calendar');
  cal.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'cal-header';
  weekdays.forEach(w => {
    const c = document.createElement('div');
    c.className = 'cell';
    c.innerHTML = `<div class="date" style="text-align:center">${w}</div>`;
    header.appendChild(c);
  });
  cal.appendChild(header);

  const firstDay = new Date(state.viewYear, state.viewMonth-1, 1);
  const startDay = (firstDay.getDay()+6)%7;
  const daysInMonth = new Date(state.viewYear, state.viewMonth, 0).getDate();
  const todayStr = fmtDate(new Date()); // YYYY-MM-DD

  for(let i=0;i<startDay;i++){
    const c = document.createElement('div'); c.className = 'cell disabled'; cal.appendChild(c);
  }

  for(let d=1; d<=daysInMonth; d++){
    const c = document.createElement('div');
    const dateStr = ymd(state.viewYear, state.viewMonth, d);
    const items = (state.data.bookings[dateStr]||[]);
    const isPast = dateStr < todayStr; // lex porovnanie na YYYY-MM-DD je OK
    const badges = [];

    // štítky
    for(const b of items){
      const user = getUserById(b.userId);
      const cls = b.status==='approved' ? 'approved' : 'pending';
      const hrs = clampH(b.hours);
      if(state.role==='admin'){
        badges.push(`<span class="badge ${cls}">${user?.name||'N/A'} ${hrs}h</span>`);
      }else if(state.role==='employee' && b.userId===state.currentUserId){
        badges.push(`<span class="badge ${cls}">${user?.name||'—'} ${hrs}h</span>`);
      }
    }
        // poznámky – modré
    if(state.role === 'admin' && state.data.notes[dateStr]){
      for(const note of state.data.notes[dateStr]){
        badges.push(`<span class="badge note" title="${note.text}">${note.text}</span>`);
      }
    }

    // vzhľad bunky + klikateľnosť podľa roly a minulosti
    const isEmployeePast = (state.role==='employee' && isPast);
    c.className = 'cell' + (isEmployeePast ? ' disabled' : ' clickable');
    const lock = isEmployeePast ? ' 🔒' : '';
    const todayMark = dateStr===todayStr ? ' • dnes' : '';
    c.innerHTML = `<div class="date">${d}${todayMark}${lock}</div><div class="badges">${badges.join('')}</div>`;

    // click handler
    if(state.role==='employee' && !isPast){
      c.addEventListener('click', () => {
        // inline výber hodín (0–8; 0 = zrušiť)
        const uid=state.currentUserId;
        const items=state.data.bookings[dateStr]?[...state.data.bookings[dateStr]]:[];
        const myIdx=items.findIndex(b=>b.userId===uid);
        if(myIdx>-1 && items[myIdx].status==='approved'){
          alert('Schválené nemôžete meniť.');
          return;
        }
        const init = myIdx>-1 ? Math.max(0, Math.min(8, Number(items[myIdx].hours)||0)) : HOURS_PER_DAY;
        showHourPicker({
          title: `Koľko hodín ${dateStr}?`,
          initial: init,
          onSave: async (hrs)=>{
            // extra kontrola proti minulosti
            if(dateStr < fmtDate(new Date())){ alert('Minulé dni už nemožno meniť.'); return; }

            if(hrs===0){
              // zmaž moju žiadosť
              if(myIdx>-1) items.splice(myIdx,1);
            }else{
              if(myIdx===-1) items.push({userId:uid,status:'pending',hours:hrs});
              else items[myIdx].hours = hrs;
            }
            if(items.length) await setDoc(doc(db,"bookings",dateStr),{items}); else await deleteDoc(doc(db,"bookings",dateStr));
          }
        });
      });
    } else if (state.role==='admin') {
      c.addEventListener('click', () => cycleAdminStatus(dateStr));
    }

    cal.appendChild(c);
  }

  refreshSide();
}

// ---------- Actions ----------
async function cycleAdminStatus(dateStr){
  const existing = state.data.bookings[dateStr] ? [...state.data.bookings[dateStr]] : [];
  const names = state.data.users.map(u => u.name).join(', ');

  // --- Prompt; zrušenie = null -> skonči, prázdny reťazec "" = zmazať poznámku
  const raw = prompt(`Meno (${names}) alebo napíš poznámku:`);
  if (raw === null) return;           // klikol Zrušiť
  const choice = String(raw).trim();  // môže byť aj ""

  // ak zadaný text NIE JE meno, pracujeme s poznámkou
  const user = state.data.users.find(u => u.name.toLowerCase() === choice.toLowerCase());
  if (!user) {
    const txt = choice; // môže byť aj ""
    if (txt === "") {
      // prázdny = ZMAZAŤ poznámky pre tento deň
      await deleteDoc(doc(db, "notes", dateStr));
      delete state.data.notes?.[dateStr]; // zmaž aj z lokálneho stavu (ak existuje)
      showToast("Poznámky zmazané");
      render();
      return; // neskáč ďalej do logiky dovolenky
    }

    // pridať / doplniť poznámku
    const note = { id: crypto.randomUUID(), text: txt, by: "admin", at: Date.now() };
    const existingNotes = state.data.notes?.[dateStr] || [];
    existingNotes.push(note);
    await setDoc(doc(db, "notes", dateStr), { items: existingNotes });
    state.data.notes = state.data.notes || {};
    state.data.notes[dateStr] = existingNotes; // update lokálne
    showToast("Poznámka pridaná");
    render();
    return; // skonči – neprechádzame na dovolenky
  }

  // ... (ďalej nechaj pôvodnú logiku pre dovolenky – výber hodín, pending/approved atď.)

  let item = existing.find(b => b.userId===user.id);
  if(!item){
    // vytvárame nový – 0 znamená nič nevytvárať
    showHourPicker({
      title:`Koľko hodín (${user.name})`,
      initial:HOURS_PER_DAY,
      onSave: async (hrs)=>{
        if(hrs===0){ return; }
        const newItem = {userId:user.id,status:"pending",hours:hrs};
        const approvedSum = existing.filter(it=>it.userId===user.id && it.status==='approved').reduce((s,it)=>s+clampH(it.hours),0);
        if(approvedSum + hrs > HOURS_PER_DAY){
          if(!confirm(`Upozornenie: ${user.name} by mal spolu ${approvedSum+hrs}h v tento deň. Pokračovať?`)) return;
        }
        existing.push(newItem);
        await setDoc(doc(db,"bookings",dateStr),{items:existing});
      }
    });
  }else{
    // upraviť 0..8 (0 = zmazať) + toggle
    const approvedSumOther = existing
      .filter(it=>it.userId===user.id && it!==item && it.status==='approved')
      .reduce((s,it)=>s+clampH(it.hours),0);

    showHourPicker({
      title:`Hodiny (${user.name})`,
      initial: Math.max(0, Math.min(8, Number(item.hours)||0)),
      onSave: async (hrs)=>{
        if(hrs===0){
          // zmaž tento záznam
          const filtered = existing.filter(b=>!(b.userId===user.id && b===item));
          if(filtered.length===0) await deleteDoc(doc(db,"bookings",dateStr));
          else await setDoc(doc(db,"bookings",dateStr),{items:filtered});
          showToast('Dovolenka zrušená');
          return;
        }
        let next = item.status==='pending' ? 'approved' : 'pending';
        if(next==='approved' && approvedSumOther + hrs > HOURS_PER_DAY){
          if(!confirm(`Upozornenie: schválením bude mať ${user.name} ${approvedSumOther+hrs}h v tento deň. Pokračovať?`)){
            return;
          }
        }
        item.status = next;
        item.hours = hrs;
        await setDoc(doc(db,"bookings",dateStr),{items:existing});
      }
    });
  }
}

// ---------- Admin: users CRUD ----------
async function createUser({ name, code, oldAllowance, newAllowance }) {
  await addDoc(collection(db, "users"), {
    name: String(name||'').trim(),
    code: String(code||'').trim(),
    oldAllowance: Number(oldAllowance ?? 0),
    newAllowance: Number(newAllowance ?? 0),
  });
}
async function updateUser(userId, { name, code, oldAllowance, newAllowance }) {
  await updateDoc(doc(db,"users",userId), {
    name: String(name||'').trim(),
    code: String(code||'').trim(),
    oldAllowance: Number(oldAllowance ?? 0),
    newAllowance: Number(newAllowance ?? 0),
  });
}
async function deleteUserEverywhere(userId){
  await deleteDoc(doc(db,"users",userId));
  const entries = Object.entries(state.data.bookings);
  for(const [date, items] of entries){
    const filtered = items.filter(b=>b.userId!==userId);
    if(filtered.length===items.length) continue;
    if(filtered.length===0) await deleteDoc(doc(db,"bookings",date));
    else await setDoc(doc(db,"bookings",date),{items:filtered});
  }
}

// Add user
el('#addUserBtn')?.addEventListener('click', async () => {
  const name = prompt('Meno osoby:'); if(!name) return;
  const code = prompt('Prístupový kód (unikátny):', name.toLowerCase().replace(/\s+/g,'')); if(!code) return;
  const oldA = prompt('Stará dovolenka (dni):','0');
  const newA = prompt('Nová dovolenka (dni):','20');
  try{
    await createUser({ name, code, oldAllowance: Number(oldA), newAllowance: Number(newA) });
    showToast('Používateľ pridaný');
  }catch(e){ alert('Chyba pri pridávaní: '+e.message); }
});

// ---------- Side panel ----------
function refreshSide(){
  const sum = el('#summary');
  const usage = computeUsage();

  if(state.role==='employee'){
    const u = getUserById(state.currentUserId);
    const capOld = (Number(u.oldAllowance)||0)*HOURS_PER_DAY;
    const capNew = (Number(u.newAllowance)||0)*HOURS_PER_DAY;
    const leftOld = (capOld - usage[u.id].oldH);
    const leftNew = (capNew - usage[u.id].newH);
    const styleNeg = n => n<0 ? 'style="color:#f87171"' : '';
    sum.innerHTML = `
      <div class="card">
        <h3>${u.name}</h3>
        <p>Stará dovolenka: <strong ${styleNeg(leftOld)}>${fmtDays(leftOld)}</strong> dňa (${leftOld} h) / ${u.oldAllowance} dní</p>
        <p>Nová dovolenka: <strong ${styleNeg(leftNew)}>${fmtDays(leftNew)}</strong> dňa (${leftNew} h) / ${u.newAllowance} dní</p>
      </div>
    `;
  }else{
    // --------- ADMIN: "Stavy" (abecedne zoradené, bez zalamovania) ----------
    let html = `<div class="card">
      <h3>Stavy</h3>
      <div id="statusList">
    `;

    const usersSorted = [...state.data.users].sort((a, b) =>
      a.name.localeCompare(b.name, 'sk', { sensitivity: 'base' })
    );

    for(const u of usersSorted){
      const capOld=(Number(u.oldAllowance)||0)*HOURS_PER_DAY;
      const capNew=(Number(u.newAllowance)||0)*HOURS_PER_DAY;
      const leftOld=(capOld - (usage[u.id]?.oldH||0));
      const leftNew=(capNew - (usage[u.id]?.newH||0));
      const styleNeg = n => n<0 ? 'style="color:#f87171"' : '';
      html += `
        <div>
          <strong>${u.name}</strong>
          &nbsp; Stará: <span ${styleNeg(leftOld)}>${fmtDays(leftOld)}</span> / ${u.oldAllowance} dňa
          &nbsp;•&nbsp; Nová: <span ${styleNeg(leftNew)}>${fmtDays(leftNew)}</span> / ${u.newAllowance} dňa
        </div>
      `;
    }
    html += `</div></div>`;

    // Čakajúce žiadosti pre aktuálny mesiac
    const monthStr = `${state.viewYear}-${String(state.viewMonth).padStart(2,'0')}`;
    const pending = [];
    for(const [date, items] of Object.entries(state.data.bookings)){
      if(!date.startsWith(monthStr)) continue;
      for(const it of items){
        if(it.status==='pending'){
          const u = getUserById(it.userId);
          pending.push({date, name:u?.name||'N/A', hours: clampH(it.hours)});
        }
      }
    }
    if(pending.length){
      html += '<div class="card"><h3>Čakajúce žiadosti</h3>';
      for(const p of pending.sort((a,b)=>a.date.localeCompare(b.date))){
        html += `<div class="row" style="justify-content:space-between">
          <div>${p.name} (${p.hours}h)</div><div>${p.date}</div>
        </div>`;
      }
      html += '</div>';
    }
    sum.innerHTML = html || '<p>Žiadne dáta.</p>';
  }

  // Admin users list
  if (state.role === 'admin') {
    const list = el('#usersList');
    list.innerHTML = '';
    for (const u of state.data.users) {
      const t = el('#userRowTpl').content.cloneNode(true);
      t.querySelector('.name').textContent = u.name;
      t.querySelector('.code').textContent = u.code;

      // predvyplň
      t.querySelector('.inp-name').value = u.name;
      t.querySelector('.inp-code').value = u.code;
      t.querySelector('.inp-old').value = u.oldAllowance;
      t.querySelector('.inp-new').value = u.newAllowance;

      // Uložiť
      t.querySelector('.saveUser').onclick = async (e) => {
        const host = e.currentTarget.closest('.userRow');
        const name = host.querySelector('.inp-name').value || u.name;
        const code = host.querySelector('.inp-code').value || u.code;
        const oldA = Number(host.querySelector('.inp-old').value);
        const newA = Number(host.querySelector('.inp-new').value);
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Ukladám…';
        try {
          await updateUser(u.id, { name, code, oldAllowance: oldA, newAllowance: newA });
          showToast('Uložené');
        } catch (err) {
          alert('Chyba pri ukladaní: ' + err.message);
        } finally {
          e.currentTarget.disabled = false; e.currentTarget.textContent = 'Uložiť';
        }
      };

      // Zmazať
      t.querySelector('.delUser').onclick = async () => {
        if (!confirm(`Naozaj zmazať používateľa ${u.name}?`)) return;
        try {
          await deleteUserEverywhere(u.id);
          showToast('Používateľ zmazaný');
        } catch (e) {
          alert('Chyba pri mazaní: ' + e.message);
        }
      };

      list.appendChild(t);
    }
  }
}

// ---------- Export/Import v2 (robust bind) ----------
(function wireExports() {
  // Pomocné funkcie
  const csvEscape = (val) => {
    if (val == null) return '';
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCSV = (filename, rows) => {
    const csv = '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const WEEKDAYS_FULL = ['Pondelok','Utorok','Streda','Štvrtok','Piatok','Sobota','Nedeľa'];

  // Helper: nájdi tlačidlo podľa ID alebo textu
  function findBtn(id, textStarts) {
    const byId = document.getElementById(id);
    if (byId) return byId;
    // fallback podľa textu (slovenské názvy z tvojho UI)
    const candidates = [...document.querySelectorAll('button, a[role="button"]')];
    return candidates.find(b => (b.textContent || '').trim().toLowerCase().startsWith(textStarts.toLowerCase())) || null;
  }

  // --- Export JSON ---
  function doExportJSON() {
    const payload = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      // config len pre info; import ho ignoruje
      config: { adminCode: state.data.adminCode, lastRolloverYear: state.data.lastRolloverYear ?? null },
      users: state.data.users,
      bookings: state.data.bookings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dovolenky-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Export CSV (rok) ---
  function doExportCsvYear() {
    if (!state?.data?.users || !state?.data?.bookings) { alert('Dáta ešte nie sú načítané.'); return; }
    const year = state.viewYear || new Date().getFullYear();
    const byId = Object.fromEntries(state.data.users.map(u => [u.id, u]));
    const rows = [['Rok','Meno','Kód','Dátum','Deň','Hodiny','Typ','Stav']];

    const entries = Object.entries(state.data.bookings)
      .filter(([d]) => d.startsWith(String(year)))
      .sort(([a],[b]) => a.localeCompare(b));

    for (const [date, items] of entries) {
      const jsDate = new Date(date + 'T00:00:00');
      const weekday = WEEKDAYS_FULL[(jsDate.getDay()+6)%7];
      for (const it of items) {
        const u = byId[it.userId]; if (!u) continue;
        rows.push([
          String(year),
          u.name,
          u.code,
          date,
          weekday,
          Number(it.hours) || 0,
          (it.kind || 'DOV').toUpperCase(),
          it.status || 'pending'
        ]);
      }
    }
    if (rows.length === 1) { alert(`Za rok ${year} nie sú žiadne záznamy.`); return; }
    downloadCSV(`dovolenky-${year}-vsetci.csv`, rows);
  }

  // --- Export CSV – Sumár (rok) ---
  function approvedHoursFor(userId, year){
    let sum = 0;
    for(const [date, items] of Object.entries(state.data.bookings)){
      if(!date.startsWith(String(year))) continue;
      for(const it of items){
        if(it.userId===userId && it.status==='approved'){
          const v = Number(it.hours) || 0;
          const n = Math.max(1, Math.min(8, Math.floor(v))); // clamp 1..8
          sum += n;
        }
      }
    }
    return sum;
  }
  function doExportCsvSummary() {
    if (!state?.data?.users || !state?.data?.bookings) { alert('Dáta ešte nie sú načítané.'); return; }
    const HOURS_PER_DAY = 8;
    const year = state.viewYear || new Date().getFullYear();
    const rows = [['Rok','Meno','Kód','Schválené hod (spolu)','Schválené dni','Zostatok stará (dni)','Zostatok nová (dni)']];

    for (const u of [...state.data.users].sort((a,b)=>a.name.localeCompare(b.name,'sk'))) {
      const usedH = approvedHoursFor(u.id, year);
      const capOldH = Number(u.oldAllowance||0) * HOURS_PER_DAY;
      const capNewH = Number(u.newAllowance||0) * HOURS_PER_DAY;
      const useOld = Math.min(usedH, capOldH);
      const useNew = Math.min(Math.max(usedH - useOld, 0), capNewH);

      const leftOldDays = (capOldH - useOld) / HOURS_PER_DAY;
      const leftNewDays = (capNewH - useNew) / HOURS_PER_DAY;

      rows.push([
        String(year),
        u.name,
        u.code,
        usedH,
        (usedH / HOURS_PER_DAY).toFixed(1),
        leftOldDays.toFixed(1),
        leftNewDays.toFixed(1)
      ]);
    }
    downloadCSV(`dovolenky-${year}-sumar.csv`, rows);
  }

  // --- Import JSON (users + bookings; config sa neprepisuje) ---
  async function doImportJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const mode = prompt('Import mód: napíš "merge" (zlúčiť) alebo "replace" (nahradiť všetko).', 'merge') || 'merge';

    // users
    if(Array.isArray(data.users)){
      if(mode==='replace'){
        const cur = await getDocs(collection(db,'users'));
        for(const d of cur.docs) await deleteDoc(d.ref);
      }
      for(const u of data.users){
        if(u.id){
          await setDoc(doc(db,"users",u.id), {
            name:u.name, code:u.code,
            oldAllowance:Number(u.oldAllowance||0),
            newAllowance:Number(u.newAllowance||0)
          });
        }else{
          await addDoc(collection(db,'users'), {
            name:String(u.name||'').trim(),
            code:String(u.code||'').trim(),
            oldAllowance:Number(u.oldAllowance||0),
            newAllowance:Number(u.newAllowance||0)
          });
        }
      }
    }

    // bookings
    if(data.bookings && typeof data.bookings==='object'){
      if(mode==='replace'){
        const cur = await getDocs(collection(db,'bookings'));
        for(const d of cur.docs) await deleteDoc(d.ref);
      }
      for(const [date, items] of Object.entries(data.bookings)){
        if(items?.length) await setDoc(doc(db,"bookings",date),{items});
      }
    }
    showToast('Import hotový');
  }

  // ==== Naviazanie na tlačidlá (ID alebo text) ====
  const btnExportJson      = findBtn('exportBtn',          'export json');
  const btnExportCsvYear   = findBtn('exportCsvYear',      'export csv (rok');
  const btnExportCsvSum    = findBtn('exportCsvSummary',   'export csv – sumár');
  const btnExportByUser    = document.getElementById('exportCsvByUser'); // to už funguje – necháme tak
  let   inputImport        = document.getElementById('importFile');

  // a) Export JSON
  if (btnExportJson && !btnExportJson._wired) {
    btnExportJson.addEventListener('click', doExportJSON);
    btnExportJson._wired = true;
  }

  // b) Export CSV (rok)
  if (btnExportCsvYear && !btnExportCsvYear._wired) {
    btnExportCsvYear.addEventListener('click', doExportCsvYear);
    btnExportCsvYear._wired = true;
  }

  // c) Export CSV – Sumár (rok)
  if (btnExportCsvSum && !btnExportCsvSum._wired) {
    btnExportCsvSum.addEventListener('click', doExportCsvSummary);
    btnExportCsvSum._wired = true;
  }

  // d) Import JSON – ak input chýba, vytvoríme (skrytý) a pripojíme k admin panelu
  if (!inputImport) {
    inputImport = document.createElement('input');
    inputImport.type = 'file';
    inputImport.accept = 'application/json';
    inputImport.id = 'importFile';
    inputImport.hidden = true;
    const adminPanel = document.getElementById('adminPanel') || document.body;
    adminPanel.appendChild(inputImport);
  }
  if (!inputImport._wired) {
    inputImport.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if(!file) return;
      try { await doImportJSON(file); }
      catch(err){ alert('Chyba importu: '+(err?.message||err)); }
      finally { e.target.value = ''; }
    });
    inputImport._wired = true;
  }
})();

// >>> CSV BY USER – nový bezpečný export (podľa osoby alebo všetkých) za zvolený rok
(function addCsvExportByUser(){
  const btn = el('#exportCsvByUser');
  if(!btn) return;

  const WEEKDAYS_FULL = ['Pondelok','Utorok','Streda','Štvrtok','Piatok','Sobota','Nedeľa'];

  const csvEscape = (val) => {
    if (val == null) return '';
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCSV = (filename, rows) => {
    const csv = '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  btn.addEventListener('click', () => {
    if (!state?.data?.users || !state?.data?.bookings) {
      alert("Dáta ešte nie sú načítané, skús po prihlásení.");
      return;
    }
    const year = state.viewYear || new Date().getFullYear();

    const names = state.data.users.map(u => u.name).sort((a,b)=>a.localeCompare(b,'sk'));
    const input = prompt(
      `Zadaj meno presne ako v zozname (alebo nechaj prázdne pre VŠETKÝCH):\n\n${names.join(', ')}`,
      ''
    );
    const filterName = (input || '').trim().toLowerCase();

    const rows = [['Rok','Meno','Kód','Dátum','Deň','Hodiny','Typ','Stav']];
    const byId = Object.fromEntries(state.data.users.map(u => [u.id, u]));

    const entries = Object.entries(state.data.bookings)
      .filter(([d]) => d.startsWith(String(year)))
      .sort(([a],[b]) => a.localeCompare(b));

    for (const [date, items] of entries) {
      const jsDate = new Date(date + 'T00:00:00');
      const weekday = WEEKDAYS_FULL[(jsDate.getDay()+6)%7]; // Po..Ne
      for (const it of items) {
        const u = byId[it.userId]; if(!u) continue;
        if (filterName && u.name.toLowerCase() !== filterName) continue;

        rows.push([
          String(year),
          u.name,
          u.code,
          date,
          weekday,
          Number(it.hours) || 0,
          (it.kind || 'DOV').toUpperCase(),
          it.status || 'pending'
        ]);
      }
    }

    if (rows.length === 1) {
      alert(filterName ? `Pre ${input} za rok ${year} nie sú žiadne záznamy.` : `Za rok ${year} nie sú žiadne záznamy.`);
      return;
    }

    const base = filterName
      ? `dovolenky-${year}-${filterName.replace(/\s+/g,'_')}`
      : `dovolenky-${year}-vsetci`;
    downloadCSV(`${base}.csv`, rows);
  });
})();

// ---------- Rollover (prechod na ďalší rok) ----------
el('#rolloverBtn')?.addEventListener('click', async () => {
  const y = state.viewYear; // roluj podľa zvoleného roka v hlavičke
  if(state.data.lastRolloverYear === y){
    if(!confirm(`Rollover pre rok ${y} už bol zaznamenaný. Spustiť znova?`)) return;
  }
  let def = prompt(`Nastav nový nárok (dni) pre rok ${y+1} pre všetkých (20 alebo 25):`,`25`);
  if(!def) return;
  def = Number(def);
  if(!(def===20 || def===25)){ alert('Zadaj 20 alebo 25.'); return; }

  // Pre každého používateľa vypočítaj zostatky za rok y
  for(const u of state.data.users){
    const capOldH = Number(u.oldAllowance||0) * HOURS_PER_DAY;
    const capNewH = Number(u.newAllowance||0) * HOURS_PER_DAY;
    const usedH = approvedHoursFor(u.id, y);
    const useOld = Math.min(usedH, capOldH);
    const useNew = Math.min(Math.max(usedH - useOld, 0), capNewH);
    const leftoverNewDays = (capNewH - useNew) / HOURS_PER_DAY; // môže byť 0+
    const carry = Math.max(0, Math.round(leftoverNewDays*10)/10); // zaokrúhlenie na 0.1 dňa

    await updateUser(u.id, {
      name: u.name,
      code: u.code,
      oldAllowance: carry,     // stará = nevyčerpané z NOVEJ z minulého roka
      newAllowance: def        // nová = nárok na nový rok (20/25)
    });
  }

  alert(`Rollover na rok ${y+1} hotový.\nNová dovolenka: ${def} dní, stará = nevyčerpaný zostatok z minulého roka.`);
});

// ---------- Settings + logout ----------
el('#openSettings')?.addEventListener('click', async () => {
  if(state.role !== 'admin') return;
  const newCode = prompt('Zmeňte admin kód:', state.data.adminCode || '');
  if(newCode){
    // config zapisujeme len z UI (nie z importu)
    await setDoc(doc(db,"config","admin"), {
      adminCode: newCode.trim(),
      lastRolloverYear: state.data.lastRolloverYear ?? null
    });
    showToast('Admin kód zmenený');
  }
});
el('#logout')?.addEventListener('click', logout);

// ---------- Init ----------
function init(){
  setupAuth();
  subscribe();
}
init();