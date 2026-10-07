// 구글 캘린더 일정 읽기 (읽기 전용). 일정 추가와 수정은 구글 캘린더에서 해요.
// 접근 권한(토큰)은 1시간 동안 유효하고, 지나면 [일정 불러오기]를 한 번 눌러 다시 받아요.
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const LS = 'gcal-token';

let clientId = '', hint = '', tokenClient = null, token = null, pending = null;

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('구글 로그인 도구를 불러오지 못했어요'));
    document.head.appendChild(s);
  });
}
function readSaved() {
  try { const t = JSON.parse(localStorage.getItem(LS) || 'null'); if (t && t.exp > Date.now() + 60000) return t; } catch (e) {}
  return null;
}

export function configure(id, email) {
  clientId = id || ''; hint = email || '';
  token = readSaved();
  if (clientId) loadGis().catch(() => {});
}
export const enabled = () => !!clientId;
export const hasToken = () => !!(token && token.exp > Date.now() + 60000);
export const wasConnected = () => { try { return localStorage.getItem(LS) !== null; } catch (e) { return false; } };

// 반드시 버튼을 누른 순간에 불러야 팝업이 막히지 않아요
export async function connect() {
  await loadGis();
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE, hint,
      callback: r => {
        const p = pending; pending = null;
        if (r.error) return p && p.rej(new Error(r.error));
        token = { v: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        try { localStorage.setItem(LS, JSON.stringify(token)); } catch (e) {}
        p && p.res();
      },
      error_callback: e => { const p = pending; pending = null; p && p.rej(new Error(e.type || 'popup')); }
    });
  }
  return new Promise((res, rej) => { pending = { res, rej }; tokenClient.requestAccessToken({ prompt: wasConnected() ? '' : 'consent' }); });
}

export function disconnect() {
  if (token && window.google && google.accounts) try { google.accounts.oauth2.revoke(token.v, () => {}); } catch (e) {}
  token = null;
  try { localStorage.removeItem(LS); } catch (e) {}
}

async function get(path, params) {
  const url = API + path + '?' + new URLSearchParams(params);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token.v } });
  if (r.status === 401) { token = null; throw new Error('expired'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

// from~to(Date) 사이 일정을 날짜별로 묶어 돌려줘요: { 'YYYY-MM-DD': [{id,title,time,sort,color}] }
export async function fetchRange(from, to) {
  if (!hasToken()) throw new Error('expired');
  const list = await get('/users/me/calendarList', { minAccessRole: 'reader', maxResults: '50' });
  const cals = (list.items || []).filter(c => c.selected || c.primary);
  const out = {};
  const add = (k, ev) => (out[k] = out[k] || []).push(ev);
  await Promise.all(cals.map(async c => {
    const res = await get('/calendars/' + encodeURIComponent(c.id) + '/events', {
      timeMin: from.toISOString(), timeMax: to.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '500'
    });
    (res.items || []).forEach(e => {
      if (e.status === 'cancelled') return;
      const title = e.summary || '(제목 없음)', color = c.backgroundColor || '';
      const id = (c.primary ? '' : c.id + '|') + e.id;
      if (e.start && e.start.date) {          // 종일 일정 (끝 날짜는 포함하지 않음)
        const s = new Date(e.start.date + 'T00:00:00'), end = new Date(e.end.date + 'T00:00:00');
        for (let d = new Date(s); d < end; d.setDate(d.getDate() + 1)) add(dkey(d), { id, title, time: '종일', sort: '', color });
      } else if (e.start && e.start.dateTime) {
        const s = new Date(e.start.dateTime), end = new Date(e.end.dateTime);
        const last = new Date(end.getTime() - 1);
        for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= last; d.setDate(d.getDate() + 1)) {
          const first = dkey(d) === dkey(s);
          add(dkey(d), { id, title, time: first ? hm(s) : '이어서', sort: first ? hm(s) : '00:00', color });
        }
      }
    });
  }));
  Object.values(out).forEach(a => a.sort((x, y) => x.sort.localeCompare(y.sort)));
  return out;
}
