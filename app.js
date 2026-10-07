import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, googleClientId } from "./firebase-config.js";
import * as gcal from "./gcal.js";

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => key(new Date());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = id => document.getElementById(id);

let days = {};            // dateKey -> {items:[{id,text,done}], note:string, eventsDone:{eventId:title}}
let events = {};          // dateKey -> 구글 캘린더 일정 (저장하지 않고 매번 읽어 와요)
let eventsRange = '';     // 지금 불러온 달력 범위
let eventsState = 'idle'; // idle | loading | ok | need | error
let eventsTried = '';     // 마지막으로 불러오기를 시도한 범위
let selected = todayKey();
let view = new Date(); view.setDate(1);
let daysCol = null;
let unsubscribe = null;

const syncEl = $('sync');
function setSync(text, warn) { syncEl.textContent = text; syncEl.classList.toggle('warn', !!warn); }

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// 오프라인에서도 쓰고, 다시 연결되면 자동으로 동기화
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

function showApp(signedIn) {
  $('login').hidden = signedIn;
  $('calPanel').hidden = !signedIn;
  $('dayPanel').hidden = !signedIn;
  $('menuWrap').hidden = !signedIn;
  if (!signedIn) setMenu(false);
}

onAuthStateChanged(auth, user => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  days = {};
  if (!user) { daysCol = null; showApp(false); setSync(''); return; }
  showApp(true);
  setSync(user.email || '로그인됨');
  daysCol = collection(db, 'users', user.uid, 'days');
  gcal.configure(googleClientId, user.email);
  eventsRange = ''; eventsTried = ''; events = {};
  unsubscribe = onSnapshot(daysCol, { includeMetadataChanges: true }, snap => {
    const next = {};
    snap.docs.forEach(d => { const v = d.data(); if (Array.isArray(v.items) || v.note || v.eventsDone) next[d.id] = { items: (v.items || []).map(i => ({ ...i })), note: v.note || '', eventsDone: { ...(v.eventsDone || {}) } }; });
    days = next;
    setSync(snap.metadata.fromCache ? '오프라인 · 연결되면 동기화돼요' : (user.email || '동기화됨'), snap.metadata.fromCache);
    render();
  }, err => setSync('동기화 오류: ' + err.code, true));
  render();
});

$('loginBtn').onclick = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    // 홈 화면 앱처럼 팝업이 막히는 환경에서는 리디렉트로 로그인
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') signInWithRedirect(auth, provider);
    else if (e.code !== 'auth/popup-closed-by-user') setSync('로그인 실패: ' + e.code, true);
  }
};
$('logout').onclick = () => { gcal.disconnect(); events = {}; eventsRange = ''; eventsTried = ''; signOut(auth); };

// 오른쪽 위 ⋯ 메뉴 (기록 보관, 로그아웃)
function setMenu(open) {
  $('menu').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
  if (open) $('backupNote').textContent = '';
}
$('menuBtn').onclick = e => { e.stopPropagation(); setMenu($('menu').hidden); };
document.addEventListener('click', e => { if (!e.target.download && !$('menuWrap').contains(e.target)) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

function persist(k) {
  if (!daysCol) return;
  const d = days[k];
  const ref = doc(daysCol, k);
  const empty = !d || (!d.items.length && !d.note && !Object.keys(d.eventsDone || {}).length);
  const p = empty ? (delete days[k], deleteDoc(ref)) : setDoc(ref, { items: d.items, note: d.note || '', eventsDone: d.eventsDone || {}, updatedAt: Date.now() });
  p.catch(err => setSync('저장 실패: ' + err.code, true));
}

// ---------- helpers ----------
const ensureDay = k => (days[k] = days[k] || { items: [], note: '', eventsDone: {} });
function stats(k) {
  const it = (days[k] && days[k].items) || [];
  const done = it.filter(i => i.done).length;
  return { total: it.length, done, pct: it.length ? Math.round(done / it.length * 100) : null };
}
function prevWithUnfinished(k) {
  const keys = Object.keys(days).filter(x => x < k && days[x].items.some(i => !i.done)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

// ---------- render ----------
$('dows').innerHTML = WD.map((w, i) => '<div class="dow' + (i === 0 ? ' sun' : '') + '">' + w + '</div>').join('');

function renderCal() {
  $('monthLabel').textContent = view.getFullYear() + '년 ' + (view.getMonth() + 1) + '월';
  const start = new Date(view); start.setDate(1 - view.getDay());
  const cal = $('cal'); cal.innerHTML = '';
  const tk = todayKey();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d), s = stats(k);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell';
    if (d.getMonth() !== view.getMonth()) b.classList.add('out');
    if (k === tk) b.classList.add('today');
    if (k === selected) b.classList.add('sel');
    if (s.pct === 100) b.classList.add('full');
    if (days[k] && days[k].note) b.classList.add('has-note');
    b.setAttribute('aria-label', (d.getMonth() + 1) + '월 ' + d.getDate() + '일' + (s.pct !== null ? ' 달성률 ' + s.pct + '%' : '') + (events[k] && events[k].length ? ' 일정 ' + events[k].length + '개' : ''));
    b.innerHTML = '<span class="fill" style="height:' + (s.pct || 0) + '%"></span><span class="n"></span><span class="p"></span>';
    b.querySelector('.n').textContent = d.getDate();
    b.querySelector('.p').textContent = s.pct !== null ? s.pct + '%' : '';
    b.onclick = () => { selected = k; if (d.getMonth() !== view.getMonth()) view = new Date(d.getFullYear(), d.getMonth(), 1); render(); };
    cal.appendChild(b);
  }
}

function renderDay() {
  const d = parse(selected);
  $('dayLabel').textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')' + (selected === todayKey() ? ' · 오늘' : '');
  const s = stats(selected);
  $('pct').innerHTML = (s.pct === null ? '0' : s.pct) + '%<small></small>';
  $('pct').querySelector('small').textContent = s.total ? s.done + ' / ' + s.total + ' 완료' : '';
  $('barFill').style.width = (s.pct || 0) + '%';
  $('yay').hidden = s.pct !== 100;
  const ul = $('items'); ul.innerHTML = '';
  const it = (days[selected] && days[selected].items) || [];
  it.forEach(item => {
    const li = document.createElement('li'); if (item.done) li.className = 'done';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!item.done; cb.id = 'cb-' + item.id;
    cb.onchange = () => { item.done = cb.checked; persist(selected); render(); };
    const t = document.createElement('label'); t.className = 't'; t.htmlFor = cb.id; t.textContent = item.text;
    const del = document.createElement('button'); del.className = 'del'; del.type = 'button'; del.textContent = '×'; del.setAttribute('aria-label', '삭제: ' + item.text);
    del.onclick = () => { days[selected].items = it.filter(x => x !== item); persist(selected); render(); };
    li.append(cb, t, del); ul.appendChild(li);
  });
  $('empty').hidden = it.length > 0;
  const carry = $('carry'), src = it.length ? null : prevWithUnfinished(selected);
  carry.hidden = !src;
  if (src) {
    const sd = parse(src), n = days[src].items.filter(i => !i.done).length;
    carry.textContent = (sd.getMonth() + 1) + '/' + sd.getDate() + '에 못 끝낸 ' + n + '개 가져오기';
    carry.onclick = () => {
      ensureDay(selected).items = days[src].items.filter(i => !i.done).map(i => ({ id: newId(), text: i.text, done: false }));
      persist(selected); render();
    };
  }
}
// 하루 기록: 평소에는 확정된 글로 보여 주고, [수정]을 눌렀을 때만 입력 칸이 열려요
const drafts = {};        // dateKey -> 저장 전 입력 중인 글 (날짜를 옮겨도 유지)
const savedNote = k => (days[k] && days[k].note) || '';
function renderNote() {
  const editing = selected in drafts, saved = savedNote(selected);
  $('noteView').hidden = editing || !saved;
  $('noteView').textContent = saved;
  $('noteStart').hidden = editing || !!saved;
  $('noteEdit').hidden = !editing;
  $('noteEditBtn').hidden = editing || !saved;
  if (editing && $('note').value !== drafts[selected]) { $('note').value = drafts[selected]; autosize(); }
}
function autosize() { const box = $('note'); box.style.height = 'auto'; box.style.height = Math.max(box.scrollHeight, 120) + 'px'; }
function openNote() { drafts[selected] = savedNote(selected); renderNote(); $('note').focus(); autosize(); }
$('noteStart').onclick = openNote;
$('noteEditBtn').onclick = openNote;
$('note').addEventListener('input', () => { drafts[selected] = $('note').value; autosize(); });
$('noteSave').onclick = () => {
  const v = $('note').value.replace(/\s+$/, '');
  delete drafts[selected];
  if (v !== savedNote(selected)) { ensureDay(selected).note = v; persist(selected); }
  render();
};
$('noteCancel').onclick = () => { delete drafts[selected]; renderNote(); };

// ---------- 구글 캘린더 일정 ----------
function gridRange() {
  const from = new Date(view); from.setDate(1 - view.getDay());
  const to = new Date(from); to.setDate(from.getDate() + 42);
  return [from, to];
}
async function loadEvents(force) {
  if (!gcal.enabled() || !daysCol) return;
  const [from, to] = gridRange(), rk = key(from);
  // 같은 달을 이미 불러왔거나 불러오는 중이면 다시 요청하지 않아요
  if (!force && rk === eventsTried && eventsState !== 'need') return;
  eventsTried = rk;
  if (!gcal.hasToken()) { eventsState = gcal.wasConnected() ? 'need' : 'idle'; renderEvents(); return; }
  eventsState = 'loading'; renderEvents();
  try { events = await gcal.fetchRange(from, to); eventsRange = rk; eventsState = 'ok'; }
  catch (e) { eventsState = e.message === 'expired' ? 'need' : 'error'; }
  renderCal(); renderEvents();
}
async function connectCalendar() {
  try { await gcal.connect(); } catch (e) { eventsState = 'error'; renderEvents(); return; }
  loadEvents(true);
}
function renderEvents() {
  const box = $('eventsBox');
  box.hidden = !gcal.enabled();
  if (box.hidden) return;
  const act = $('eventsAction'), msg = $('eventsMsg'), ul = $('events');
  ul.innerHTML = '';
  act.hidden = eventsState === 'loading';
  act.textContent = eventsState === 'ok' ? '새로고침' : (eventsState === 'idle' ? '구글 캘린더 연결' : '일정 불러오기');
  const list = events[selected] || [];
  const done = (days[selected] && days[selected].eventsDone) || {};
  msg.textContent = {
    idle: '구글 캘린더를 연결하면 그날 일정이 여기 보여요.',
    need: '일정을 보려면 [일정 불러오기]를 눌러 주세요.',
    loading: '일정을 불러오는 중…',
    error: '일정을 불러오지 못했어요. [일정 불러오기]를 다시 눌러 주세요.',
    ok: list.length ? '' : '이 날은 일정이 없어요.'
  }[eventsState];
  msg.hidden = !msg.textContent;
  if (eventsState !== 'ok') return;
  list.forEach((ev, n) => {
    const li = document.createElement('li'); if (done[ev.id]) li.className = 'done';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!done[ev.id]; cb.id = 'ev-' + n;
    cb.onchange = () => {
      const d = ensureDay(selected); d.eventsDone = d.eventsDone || {};
      if (cb.checked) d.eventsDone[ev.id] = ev.title; else delete d.eventsDone[ev.id];
      persist(selected); render();
    };
    const tm = document.createElement('span'); tm.className = 'ev-color';
    if (ev.color) tm.style.setProperty('--ev', ev.color);
    const t = document.createElement('label'); t.className = 't'; t.htmlFor = cb.id; t.textContent = ev.title;
    li.append(cb, tm, t); ul.appendChild(li);
  });
}
$('eventsAction').onclick = () => { if (gcal.hasToken()) loadEvents(true); else connectCalendar(); };

function render() { renderCal(); renderDay(); renderNote(); renderEvents(); loadEvents(false); }

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('newItem').value.trim(); if (!v) return;
  ensureDay(selected).items.push({ id: newId(), text: v, done: false });
  $('newItem').value = ''; persist(selected); render();
});
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); };
$('goToday').onclick = () => { selected = todayKey(); view = new Date(); view.setDate(1); render(); };

// ---------- 기록 내려받기 / 백업 불러오기 ----------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const note = t => { $('backupNote').textContent = t; };
const sortedKeys = () => Object.keys(days).filter(k => days[k].items.length || days[k].note || Object.keys(days[k].eventsDone || {}).length).sort();

$('exportCsv').onclick = () => {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['날짜', '할 일', '완료', '그날 달성률', '그날 기록'].map(q).join(',')];
  sortedKeys().forEach(k => {
    const s = stats(k), pct = s.pct === null ? '' : s.pct + '%', note = days[k].note || '';
    if (!days[k].items.length) rows.push([k, '', '', '', note].map(q).join(','));
    days[k].items.forEach((i, n) => rows.push([k, i.text, i.done ? 'O' : 'X', pct, n === 0 ? note : ''].map(q).join(',')));
    Object.values(days[k].eventsDone || {}).forEach(t => rows.push([k, '[일정] ' + t, 'O', '', ''].map(q).join(',')));
  });
  // 엑셀에서 한글이 깨지지 않도록 BOM을 붙여요
  download('todo-records-' + todayKey() + '.csv', '\ufeff' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  note(sortedKeys().length + '일치 기록을 CSV로 내려받았어요.');
};

$('exportJson').onclick = () => {
  const out = { app: 'todo-calendar', version: 1, exportedAt: new Date().toISOString(), days: {} };
  sortedKeys().forEach(k => { out.days[k] = { items: days[k].items, note: days[k].note || '', eventsDone: days[k].eventsDone || {} }; });
  download('todo-backup-' + todayKey() + '.json', JSON.stringify(out, null, 2), 'application/json');
  note(sortedKeys().length + '일치 기록을 백업 파일로 내려받았어요.');
};

$('importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { note('파일을 읽지 못했어요. 이 앱에서 내려받은 백업 파일(.json)인지 확인해 주세요.'); return; }
  if (!data || typeof data.days !== 'object') { note('이 앱의 백업 파일이 아니에요.'); return; }
  // 이미 있는 할 일은 그대로 두고, 백업에만 있는 할 일을 더해요
  let added = 0;
  Object.entries(data.days).forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) return;
    const cur = ensureDay(k);
    const ids = new Set(cur.items.map(i => i.id));
    let changed = false;
    const n = typeof v.note === 'string' ? v.note.trim() : '';
    if (n && !(cur.note || '').includes(n)) { cur.note = cur.note ? cur.note + '\n\n' + n : n; added++; changed = true; }
    if (v.eventsDone && typeof v.eventsDone === 'object') Object.entries(v.eventsDone).forEach(([id, t]) => {
      cur.eventsDone = cur.eventsDone || {};
      if (!cur.eventsDone[id]) { cur.eventsDone[id] = String(t).slice(0, 200); added++; changed = true; }
    });
    (Array.isArray(v.items) ? v.items : []).forEach(i => {
      if (!i || typeof i.text !== 'string' || ids.has(i.id)) return;
      cur.items.push({ id: i.id || newId(), text: i.text.slice(0, 200), done: !!i.done }); added++; changed = true;
    });
    if (changed) persist(k); else if (!cur.items.length && !cur.note && !Object.keys(cur.eventsDone || {}).length) delete days[k];
  });
  render();
  note(added ? '할 일과 기록 ' + added + '개를 불러왔어요.' : '새로 불러올 할 일이 없어요. 이미 모두 들어 있어요.');
};

// 자정이 지나면 오늘 표시를 새로 고침
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) {
  // 새 버전이 설치되면 한 번 새로고침해서 바로 새 화면을 보여 줘요
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
}
