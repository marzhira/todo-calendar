import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => key(new Date());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = id => document.getElementById(id);

let days = {};            // dateKey -> {items:[{id,text,done}]}
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
  $('logout').hidden = !signedIn;
}

onAuthStateChanged(auth, user => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  days = {};
  if (!user) { daysCol = null; showApp(false); setSync(''); return; }
  showApp(true);
  setSync(user.email || '로그인됨');
  daysCol = collection(db, 'users', user.uid, 'days');
  unsubscribe = onSnapshot(daysCol, { includeMetadataChanges: true }, snap => {
    const next = {};
    snap.docs.forEach(d => { const v = d.data(); if (Array.isArray(v.items)) next[d.id] = { items: v.items.map(i => ({ ...i })) }; });
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
$('logout').onclick = () => signOut(auth);

function persist(k) {
  if (!daysCol) return;
  const d = days[k];
  const ref = doc(daysCol, k);
  const p = (!d || !d.items.length) ? (delete days[k], deleteDoc(ref)) : setDoc(ref, { items: d.items, updatedAt: Date.now() });
  p.catch(err => setSync('저장 실패: ' + err.code, true));
}

// ---------- helpers ----------
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
    b.setAttribute('aria-label', (d.getMonth() + 1) + '월 ' + d.getDate() + '일' + (s.pct !== null ? ' 달성률 ' + s.pct + '%' : ''));
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
      days[selected] = { items: days[src].items.filter(i => !i.done).map(i => ({ id: newId(), text: i.text, done: false })) };
      persist(selected); render();
    };
  }
}
function render() { renderCal(); renderDay(); }

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('newItem').value.trim(); if (!v) return;
  (days[selected] = days[selected] || { items: [] }).items.push({ id: newId(), text: v, done: false });
  $('newItem').value = ''; persist(selected); render();
});
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); };
$('goToday').onclick = () => { selected = todayKey(); view = new Date(); view.setDate(1); render(); };

// 자정이 지나면 오늘 표시를 새로 고침
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
