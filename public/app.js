const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLI_NAMES = { claude: 'Claude CLI', codex: 'Codex CLI', gemini: 'Gemini CLI', template: '기본 엔진' };

const state = { catalog: null, session: null, engine: { enhance: null, build: null }, pairTimer: null };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      // http://<LAN-IP> is not a secure context, so fall back to execCommand.
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('📋 복사했습니다');
  } catch { toast('복사에 실패했습니다'); }
}

const targetName = (id) => state.catalog.TARGETS.find((t) => t.id === id)?.name || id;
const timeText = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------------- tabs ----------------
function go(tab) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  if (tab === 'history') loadHistory();
  if (tab === 'library') loadLibrary();
  if (tab === 'connect') renderConnect();
  history.replaceState(null, '', `#${tab}`);
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-go]');
  if (t) go(t.dataset.tab || t.dataset.go);
});

// ---------------- form widgets ----------------
const CHIP_SOURCES = { targets: 'TARGETS', purpose: 'PURPOSES', techniques: 'TECHNIQUES' };
const DEFAULTS = {
  enhance: { targets: ['chatgpt', 'claude', 'gemini'], purpose: ['general'], techniques: [] },
  build: { targets: ['chatgpt'], techniques: ['examples'], role: 'marketer', task: 'write', goal: 'inform', tone: 'professional', format: 'auto', length: 'medium', lang: 'ko' },
};

function setupForm(form, kind) {
  for (const box of $$('[data-chips]', form)) {
    const key = box.dataset.chips;
    const multi = Number(box.dataset.multi || 1);
    const list = state.catalog[CHIP_SOURCES[key]].map((o) => ({ id: o.id, label: o.label || o.name }));
    box.innerHTML = list.map((o) => `<button type="button" class="chip" data-id="${o.id}">${esc(o.label)}</button>`).join('');
    const pick = new Set(DEFAULTS[kind][key] || []);
    $$('.chip', box).forEach((c) => c.classList.toggle('on', pick.has(c.dataset.id)));
    box.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const on = $$('.chip.on', box);
      if (multi === 1 && key !== 'techniques') { on.forEach((x) => x.classList.remove('on')); c.classList.add('on'); return; }
      if (!c.classList.contains('on') && on.length >= multi) { toast(`최대 ${multi}개까지 선택할 수 있습니다`); return; }
      c.classList.toggle('on');
      if (key !== 'techniques' && !$('.chip.on', box)) c.classList.add('on');
    });
  }
  for (const sel of $$('select[data-select]', form)) {
    const list = state.catalog[sel.dataset.select];
    const optional = kind === 'enhance' || sel.hasAttribute('data-optional');
    sel.innerHTML = (optional && sel.dataset.select !== 'LANGS' ? '<option value="">선택 안 함</option>' : '')
      + list.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('');
    const def = DEFAULTS[kind][sel.name];
    if (def) sel.value = def;
  }
}

const chipValues = (form, key) => $$(`[data-chips="${key}"] .chip.on`, form).map((c) => c.dataset.id);

function collect(form, kind) {
  const fd = new FormData(form);
  const v = (k) => (fd.get(k) || '').toString();
  return {
    mode: kind,
    input: v('input'),
    targets: chipValues(form, 'targets'),
    purpose: chipValues(form, 'purpose')[0] || 'general',
    options: { role: v('role'), task: v('task'), goal: v('goal'), audience: v('audience'), tone: v('tone'), format: v('format'), length: v('length'), lang: v('lang') || 'ko', topic: v('topic'), extra: v('extra'), techniques: chipValues(form, 'techniques') },
  };
}

function fillForm(form, kind, req) {
  for (const [k, val] of Object.entries(req.options || {})) {
    const el = form.elements[k];
    if (el && typeof val === 'string') el.value = val;
  }
  if (form.elements.input) form.elements.input.value = req.input || '';
  const mark = (key, ids) => $$(`[data-chips="${key}"] .chip`, form).forEach((c) => c.classList.toggle('on', ids.includes(c.dataset.id)));
  mark('targets', req.targets || []);
  if (kind === 'enhance') mark('purpose', [req.purpose || 'general']);
  mark('techniques', req.options?.techniques || []);
}

// ---------------- engine (which AI account runs the generation) ----------------
function engineAvailability(p) {
  const s = state.session;
  if (!s) return null;
  if (s.isLocal && s.local?.[p]?.available) return { via: 'local', label: '이 PC 계정' };
  if (s.bridge?.connected && s.bridge.clis?.[p]?.available) return { via: 'bridge', label: `내 PC 연결${s.bridge.hostname ? ` · ${s.bridge.hostname}` : ''}` };
  return null;
}

function renderEngines() {
  for (const kind of ['enhance', 'build']) {
    const box = $(`#${kind}Form [data-engine]`);
    const avail = Object.fromEntries(['claude', 'codex', 'gemini'].map((p) => [p, engineAvailability(p)]));
    if (!state.engine[kind] || (state.engine[kind] !== 'template' && !avail[state.engine[kind]])) {
      let last = null;
      try { last = localStorage.getItem('spm_engine'); } catch { /* storage blocked */ }
      state.engine[kind] = (last && (last === 'template' || avail[last]) && last) || ['claude', 'codex', 'gemini'].find((p) => avail[p]) || 'template';
    }
    box.innerHTML = `<div class="engine-title">생성 엔진 <small>${avail.claude || avail.codex || avail.gemini ? '내 계정 토큰으로 실행' : '<a href="#connect" data-go="connect">AI 연결하기 →</a>'}</small></div>
      <div class="engine-opts">${['claude', 'codex', 'gemini', 'template'].map((p) => {
        const a = p === 'template' ? { label: '오프라인 · 토큰 없음' } : avail[p];
        return `<button type="button" class="engine-opt ${state.engine[kind] === p ? 'on' : ''}" data-engine-id="${p}" ${a ? '' : 'disabled'}>
          <b>${CLI_NAMES[p]}</b><small>${a ? esc(a.label) : '연결 필요'}</small></button>`;
      }).join('')}</div>`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-engine-id]');
      if (!b || b.disabled) return;
      state.engine[kind] = b.dataset.engineId;
      renderEngines();
    };
  }
}

function renderPill() {
  const s = state.session;
  const dot = $('#connPill .dot');
  const local = s?.isLocal ? ['claude', 'codex', 'gemini'].filter((p) => s.local?.[p]?.available) : [];
  const bridge = s?.bridge?.connected ? ['claude', 'codex', 'gemini'].filter((p) => s.bridge.clis?.[p]?.available) : [];
  const all = [...new Set([...local, ...bridge])];
  dot.className = `dot ${all.length ? 'ok' : 'warn'}`;
  $('#connText').textContent = all.length ? `${all.map((p) => CLI_NAMES[p].replace(' CLI', '')).join(' · ')} 연결됨` : 'AI 미연결 · 기본 엔진';
  $('#histCount').textContent = s?.counts?.history || '';
  $('#libCount').textContent = s?.counts?.library || '';
}

async function refreshSession(force = false) {
  try {
    state.session = await api(`/api/session${force ? '?refresh=1' : ''}`);
    renderPill();
    renderEngines();
    if ($('#view-connect').classList.contains('active')) renderConnect();
  } catch (e) { console.warn(e); }
}

// ---------------- generation ----------------
function renderResults(box, entry) {
  const head = `<div class="analysis"><span>💡</span><div>${esc(entry.analysis || '프롬프트를 생성했습니다.')}</div><span class="meta">${esc(CLI_NAMES[entry.engine] || entry.engine)}</span></div>`;
  box.innerHTML = head + entry.prompts.map((p, i) => promptCard(p, i, entry.id)).join('');
  box.dataset.historyId = entry.id;
  box._entry = entry;
}

function promptCard(p, i, historyId) {
  return `<article class="result" data-index="${i}" data-history="${historyId || ''}">
    <div class="result-head">
      <span class="badge">${esc(targetName(p.target))}</span>${p.variant ? `<span class="badge alt">${esc(p.variant)}</span>` : ''}
      <h3>${esc(p.title)}</h3>
      <div class="actions"><button class="icon-btn" data-act="copy" type="button">복사</button><button class="icon-btn" data-act="save" type="button">☆ 저장</button></div>
    </div>
    <pre>${esc(p.prompt)}</pre>
    ${p.why ? `<div class="why">${esc(p.why)}</div>` : ''}
  </article>`;
}

function findPrompt(card) {
  const box = card.closest('[data-results]') || card.closest('.h-item');
  const entry = box?._entry;
  return entry?.prompts[Number(card.dataset.index)];
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.result [data-act]');
  if (!btn) return;
  const card = btn.closest('.result');
  const p = findPrompt(card);
  if (!p) return;
  if (btn.dataset.act === 'copy') copyText(p.prompt);
  if (btn.dataset.act === 'save') {
    await api('/api/library', { method: 'POST', body: { title: p.title, target: p.target, prompt: p.prompt, historyId: card.dataset.history || null } });
    btn.textContent = '★ 저장됨';
    btn.classList.add('on');
    toast('⭐ 저장함에 추가했습니다');
    refreshSession();
  }
});

async function waitJob(id, onTick) {
  let since = 0;
  for (;;) {
    const job = await api(`/api/jobs/${id}?since=${since}`);
    since = job.updatedAt;
    onTick?.(job);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.error || '생성에 실패했습니다.');
  }
}

async function submit(form, kind) {
  const box = $(`#view-${kind} [data-results]`);
  const btn = $('button[type=submit]', form);
  const req = collect(form, kind);
  if (kind === 'enhance' && !req.input.trim()) { toast('원본 프롬프트를 입력하세요'); return; }
  const engine = state.engine[kind] || 'template';
  const via = engine === 'template' ? 'template' : engineAvailability(engine)?.via;
  btn.disabled = true;
  const started = Date.now();
  box.innerHTML = `<div class="loading"><div class="spinner"></div><b id="loadMsg">${engine === 'template' ? '템플릿으로 생성 중…' : `${CLI_NAMES[engine]}에 요청하는 중…`}</b><p class="muted"><span id="loadSec">0</span>초 경과 · ${engine === 'template' ? '' : '내 계정으로 실행되며 보통 1~3분 걸립니다'}</p></div>`;
  // In the one-column layout the results sit under the long form; bring them into view.
  if (matchMedia('(max-width: 900px)').matches) box.scrollIntoView({ block: 'start' });
  const timer = setInterval(() => { const el = $('#loadSec', box); if (el) el.textContent = Math.round((Date.now() - started) / 1000); }, 500);
  try {
    const { jobId } = await api('/api/generate', { method: 'POST', body: { ...req, engine, via } });
    const entry = await waitJob(jobId, (job) => {
      const msg = $('#loadMsg', box);
      if (msg && job.status === 'running') msg.textContent = job.via === 'bridge' ? `내 PC의 ${CLI_NAMES[engine]}가 작성 중…` : `${CLI_NAMES[engine]}가 작성 중…`;
      if (msg && job.status === 'queued' && job.via === 'bridge') msg.textContent = '내 PC 브리지로 전송하는 중…';
    });
    renderResults(box, entry);
    try { localStorage.setItem('spm_engine', engine); } catch { /* storage blocked */ }
    toast('✨ 프롬프트 생성 완료 · 히스토리에 저장됨');
    refreshSession();
  } catch (err) {
    const others = ['claude', 'codex', 'gemini', 'template'].filter((p) => p !== engine && (p === 'template' || engineAvailability(p)));
    const loginHint = /auth|login|oauth|401|로그인/i.test(err.message) ? `<p class="muted">로그인이 만료된 것 같습니다. 터미널에서 <code>${esc(engine)}</code>를 실행해 다시 로그인한 뒤 시도하세요.</p>` : '';
    box.innerHTML = `<div class="error-box"><b>생성하지 못했습니다</b><p>${esc(err.message)}</p>${loginHint}
      <div class="actions">${others.map((p) => `<button class="ghost small" type="button" data-retry="${p}">${CLI_NAMES[p]}로 다시 시도</button>`).join('')}</div></div>`;
    box.querySelector('.actions').onclick = (e) => {
      const b = e.target.closest('[data-retry]');
      if (!b) return;
      state.engine[kind] = b.dataset.retry;
      renderEngines();
      submit(form, kind);
    };
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
}

// ---------------- history ----------------
async function loadHistory() {
  const q = encodeURIComponent($('#histSearch').value.trim());
  const mode = $('#histMode').value;
  const fav = $('#histFav').checked ? '1' : '';
  const { items } = await api(`/api/history?q=${q}&mode=${mode}&fav=${fav}`);
  const list = $('#historyList');
  if (!items.length) { list.innerHTML = '<div class="empty"><div class="empty-icon">🕘</div><p>아직 기록이 없습니다. 프롬프트를 생성하면 자동으로 저장됩니다.</p></div>'; return; }
  list.innerHTML = items.map((h) => `<details class="h-item" data-id="${h.id}">
    <summary>
      <button class="icon-btn ${h.favorite ? 'on' : ''}" data-hact="fav" type="button" title="즐겨찾기">${h.favorite ? '★' : '☆'}</button>
      <span class="badge ${h.mode === 'build' ? 'alt' : ''}">${h.mode === 'build' ? '옵션' : '강화'}</span>
      <span class="h-title">${esc(h.title)}</span>
      <span class="badge alt">${esc(CLI_NAMES[h.engine] || h.engine)}</span>
      <span class="h-date">${timeText(h.createdAt)}</span>
    </summary>
    <div class="h-body">
      <div class="actions"><button class="ghost small" data-hact="reuse" type="button">↺ 이 설정으로 다시 만들기</button><button class="ghost small danger" data-hact="del" type="button">삭제</button></div>
      ${h.analysis ? `<div class="analysis"><span>💡</span><div>${esc(h.analysis)}</div></div>` : ''}
      ${h.prompts.map((p, i) => promptCard(p, i, h.id)).join('')}
    </div>
  </details>`).join('');
  $$('.h-item', list).forEach((el, i) => { el._entry = items[i]; });
}

$('#historyList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-hact]');
  if (!b) return;
  e.preventDefault();
  const item = b.closest('.h-item');
  const entry = item._entry;
  if (b.dataset.hact === 'fav') {
    const upd = await api(`/api/history/${entry.id}`, { method: 'PATCH', body: { favorite: !entry.favorite } });
    entry.favorite = upd.favorite;
    b.classList.toggle('on', upd.favorite);
    b.textContent = upd.favorite ? '★' : '☆';
  } else if (b.dataset.hact === 'del') {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await api(`/api/history/${entry.id}`, { method: 'DELETE' });
    item.remove();
    refreshSession();
  } else if (b.dataset.hact === 'reuse') {
    const kind = entry.mode;
    fillForm($(`#${kind}Form`), kind, entry.request);
    renderResults($(`#view-${kind} [data-results]`), entry);
    go(kind);
  }
});
let histTimer;
$('#histSearch').addEventListener('input', () => { clearTimeout(histTimer); histTimer = setTimeout(loadHistory, 250); });
$('#histMode').addEventListener('change', loadHistory);
$('#histFav').addEventListener('change', loadHistory);
$('#histClear').addEventListener('click', async () => {
  if (!confirm('즐겨찾기(★)를 제외한 모든 기록을 삭제할까요?')) return;
  await api('/api/history', { method: 'DELETE' });
  loadHistory();
  refreshSession();
});

// ---------------- library ----------------
let libItems = [];
async function loadLibrary() {
  libItems = (await api('/api/library')).items;
  renderLibrary();
}
function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const items = libItems.filter((l) => !q || `${l.title} ${l.prompt} ${l.memo}`.toLowerCase().includes(q));
  const list = $('#libraryList');
  if (!items.length) { list.innerHTML = '<div class="empty"><div class="empty-icon">⭐</div><p>결과 카드의 \'☆ 저장\'을 누르면 자주 쓰는 프롬프트를 이곳에 모아둘 수 있습니다.</p></div>'; return; }
  list.innerHTML = items.map((l) => `<article class="lib-item" data-id="${l.id}">
    <div class="result-head"><span class="badge">${esc(targetName(l.target))}</span><h3>${esc(l.title)}</h3>
      <div class="actions"><button class="icon-btn" data-lact="copy" type="button">복사</button><button class="icon-btn" data-lact="edit" type="button">편집</button><button class="icon-btn" data-lact="del" type="button">삭제</button></div></div>
    ${l.memo ? `<div class="lib-memo" style="padding-top:10px">📝 ${esc(l.memo)}</div>` : ''}
    <pre style="padding-top:12px">${esc(l.prompt)}</pre>
  </article>`).join('');
}
$('#libSearch').addEventListener('input', renderLibrary);

function editDialog(item = {}) {
  const dlg = $('#editDialog');
  const f = $('form', dlg);
  f.title.value = item.title || '';
  f.prompt.value = item.prompt || '';
  f.memo.value = item.memo || '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? { title: f.title.value, prompt: f.prompt.value, memo: f.memo.value } : null), { once: true });
  });
}
$('#libraryList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-lact]');
  if (!b) return;
  const item = libItems.find((l) => l.id === b.closest('.lib-item').dataset.id);
  if (b.dataset.lact === 'copy') copyText(item.prompt);
  if (b.dataset.lact === 'del') {
    if (!confirm('저장한 프롬프트를 삭제할까요?')) return;
    await api(`/api/library/${item.id}`, { method: 'DELETE' });
    loadLibrary(); refreshSession();
  }
  if (b.dataset.lact === 'edit') {
    const v = await editDialog(item);
    if (!v) return;
    await api(`/api/library/${item.id}`, { method: 'PATCH', body: v });
    toast('저장했습니다'); loadLibrary();
  }
});
$('#libNew').addEventListener('click', async () => {
  const v = await editDialog({ title: '새 프롬프트' });
  if (!v) return;
  await api('/api/library', { method: 'POST', body: { ...v, target: 'universal' } });
  toast('⭐ 저장함에 추가했습니다'); loadLibrary(); refreshSession();
});

// ---------------- connect ----------------
function renderConnect() {
  const s = state.session;
  if (!s) return;
  $('#localDesc').innerHTML = s.isLocal
    ? '서버를 실행 중인 이 PC에서 접속했습니다. 이 PC에 로그인된 CLI 계정을 바로 사용합니다.'
    : '다른 PC에서 접속했기 때문에 서버 PC의 계정은 사용할 수 없습니다. 오른쪽에서 <b>내 PC</b>를 연결하세요.';
  $('#localList').innerHTML = s.isLocal
    ? ['claude', 'codex', 'gemini'].map((p) => `<li>${s.local?.[p]?.available ? '✅' : '❌'} <b>${CLI_NAMES[p]}</b><small>${esc(s.local?.[p]?.version || '설치/로그인 필요')}</small></li>`).join('')
    : '';
  $('#localRefresh').hidden = !s.isLocal;
  const b = s.bridge || {};
  $('#bridgeStatus').innerHTML = b.connected
    ? `<div class="analysis"><span>🟢</span><div><b>${esc(b.hostname || '내 PC')}</b> 연결됨 · ${['claude', 'codex', 'gemini'].map((p) => `${b.clis?.[p]?.available ? '✅' : '❌'} ${p}`).join('  ')}</div></div>`
    : `<div class="analysis"><span>⚪</span><div>연결된 PC가 없습니다.</div></div>`;
  $('#unpairBtn').hidden = !b.connected;
  if (b.connected) { $('#pairBox').hidden = true; clearInterval(state.pairTimer); }
}
$('#localRefresh').addEventListener('click', async () => { toast('CLI를 다시 확인하는 중…'); await refreshSession(true); toast('확인 완료'); });
$('#pairBtn').addEventListener('click', async () => {
  const { code } = await api('/api/bridge/code', { method: 'POST', body: {} });
  const origin = location.origin;
  const ps = `irm ${origin}/spm-bridge.mjs -OutFile spm-bridge.mjs; node spm-bridge.mjs --server ${origin} --code ${code}`;
  const sh = `curl -fsSo spm-bridge.mjs ${origin}/spm-bridge.mjs && node spm-bridge.mjs --server ${origin} --code ${code}`;
  const box = $('#pairBox');
  box.hidden = false;
  box.innerHTML = `<div>연결 코드 <span class="muted">(10분간 유효)</span></div><div class="pair-code">${code}</div>
    <div class="muted">Windows PowerShell</div><div class="cmd"><code>${esc(ps)}</code><button class="icon-btn" type="button" data-copy="${esc(ps)}">복사</button></div>
    <div class="muted">macOS / Linux 터미널</div><div class="cmd"><code>${esc(sh)}</code><button class="icon-btn" type="button" data-copy="${esc(sh)}">복사</button></div>
    <div class="muted">실행하면 이 화면이 자동으로 '연결됨'으로 바뀝니다.</div>`;
  clearInterval(state.pairTimer);
  state.pairTimer = setInterval(refreshSession, 3000);
});
$('#pairBox').addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); });
$('#unpairBtn').addEventListener('click', async () => { await api('/api/bridge', { method: 'DELETE' }); toast('연결을 해제했습니다'); refreshSession(); });

// ---------------- boot ----------------
(async function boot() {
  state.catalog = await api('/api/catalog');
  setupForm($('#enhanceForm'), 'enhance');
  setupForm($('#buildForm'), 'build');
  $('#enhanceForm').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, 'enhance'); });
  $('#buildForm').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, 'build'); });
  renderEngines();
  await refreshSession();
  setInterval(refreshSession, 15000);
  const fromHash = () => {
    const tab = location.hash.slice(1);
    if (['enhance', 'build', 'history', 'library', 'connect'].includes(tab)) go(tab);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
