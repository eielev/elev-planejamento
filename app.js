(() => {
/* Planejamento Elev — painel de planejamentos de conteúdo.
   Dados e login: Supabase (config.js). Hospedagem: Vercel. */
const cfg = window.ELEV_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
const BUCKET = 'media';

const ELEV_PATH = "M65590.56 11845.83l-14230.17 0 -4963.13 17780.11 21556.14 0 -788.72 -5934.5 -12902.62 0 1650.03 -5911.12 10466.97 0 -788.5 -5934.5zm-63078.59 31189.09l2585.21 -9431.48c58.74,-213.88 246.36,-356.82 468.09,-356.82l62869.25 0 788.51 5934.5 -55407.8 0c-466.24,0 -865.25,84.6 -1291.36,273.87l-9346.87 4151.87c-175.41,77.77 -367.79,49.64 -513.4,-75.71 -145.63,-124.94 -202.51,-311.1 -151.62,-496.23zm24375.7 -13408.98l1656.45 -5934.5 -20679.31 0 1650.25 -5911.12 17834.1 0 1656.65 -5934.5 -17834.31 0 1650.04 -5911.33 20679.3 0 1656.65 -5934.5 -26519.27 0c-220.92,0 -407.91,141.9 -467.48,354.75l-8170.73 29271.19 26887.67 0zm11114.82 -29625.94l-8269.83 29625.94 13790.21 0 1656.65 -5934.5 -7582.05 0 6613.37 -23691.44 -6208.35 0zm57495.1 0l-20438.33 39181.12 -2593.67 0c-244.91,0 -448.87,-178.72 -481.13,-421.35l-4306.18 -32403.92c-32.27,-242.64 -236.22,-421.35 -480.93,-421.35l-21500.9 0 1656.65 -5934.5 22619.75 0c1604.94,0 2942.43,1171.39 3153.83,2762.26l2955.67 22241.43 13043.06 -25003.69 6372.19 0z";

const elevSvg = cls => `<svg class="elev ${cls||''}" viewBox="0 0 95497.59 43650.14" role="img" aria-label="Elev"><path fill="currentColor" d="${ELEV_PATH}"/></svg>`;

const TYPES = { post:'Post', carrossel:'Carrossel', reels:'Reels', story:'Story' };
const MEDIA_BASE = (cfg.MEDIA_BASE || '').replace(/\/+$/, '');   // Cloudflare R2 (via Worker); vazio = Supabase Storage
const MAX_VIDEO = MEDIA_BASE ? 2 * 1024 * 1024 * 1024 : 50 * 1024 * 1024;
const MAX_VIDEO_LABEL = MEDIA_BASE ? '2 GB' : '50 MB';
const CAP_BYTES = (cfg.STORAGE_GB || (MEDIA_BASE ? 10 : 1)) * 1024 * 1024 * 1024;
const KEEP_PER_CLIENT = 3;
const RESERVED = new Set(['p', 'editar', 'novo', 'planejamentos', 'clientes', 'login', 'sair', 'api', 'assets']);

/* ---------- estado ---------- */
let view = 'boot';            // boot | login | none | client | home | list | edit
let cur = null;               // planejamento aberto
let isNew = false;
let preview = false;
let leaveAsk = false;
let index = [];               // lista resumida, mais recentes primeiro
let indexReady = false;
let session = null;
let loginErr = '', loginBusy = false;
const pending = new Map();    // caminho no storage -> Blob ainda não enviado
const removed = new Set();    // caminhos já enviados que foram tirados
const blobUrls = new Map();   // caminho -> URL local para pré-visualizar
let dirty = false, saving = false, activeId = null;
const app = document.getElementById('app');

/* ---------- utilidades ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
const uid = () => rand(10);
const newPlanId = () => 'p' + rand(21);

const publicUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
const isR2 = p => typeof p === 'string' && p.startsWith('r2:');
const src = p => !p ? '' : (blobUrls.get(p) || (isR2(p) ? `${MEDIA_BASE}/m/${p.slice(3)}` : /^(https?:|data:|blob:)/.test(p) ? p : publicUrl(p)));
const pad = n => String(n).padStart(2, '0');
const mb = b => (b / 1024 / 1024).toFixed(1).replace('.', ',');
const clientKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const isVideo = p => /\.(mp4|webm|mov)$/i.test(p || '');
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const clientSlug = name => { let s = slugify(name) || 'cliente'; if(RESERVED.has(s)) s += '-cliente'; return s; };
const linkFor = id => `${location.origin}/p/${id}`;
const fixedLinkFor = slug => `${location.origin}/${slug}`;
const sameClient = (a, b) => (a.clientId && b.clientId) ? a.clientId === b.clientId : (!!a.clientKey && a.clientKey === b.clientKey);
const isLatestOfClient = r => !index.some(x => x.id !== r.id && sameClient(x, r) && (x.createdAt || '') > (r.createdAt || ''));
const slugOf = r => clientById(r.clientId)?.slug || r.slug;
const bestLink = r => (slugOf(r) && isLatestOfClient(r)) ? fixedLinkFor(slugOf(r)) : linkFor(r.id);
function fmtDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  if(!y || !m || !d) return '';
  const wd = new Date(y, m-1, d).toLocaleDateString('pt-BR', { weekday:'short' }).replace('.', '');
  return `${wd} · ${pad(d)}/${pad(m)}`;
}
function fmtCreated(iso){
  const d = new Date(iso); if(isNaN(d)) return '–';
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function firstLine(t){ return (t || '').split('\n').map(s => s.trim()).find(Boolean) || ''; }
function richCaption(t){ return esc(t).replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="tag">$2</span>'); }
function getPost(id){ return cur?.posts.find(p => p.id === id); }
function normPost(x){
  if(x && x.videoMode === 'link' && !x.videoUrl && !x.video) x = Object.assign({}, x, { videoMode:'file' });
  return normPost0(x);
}
function normPost0(x){ return Object.assign({ id:uid(), num:'', date:'', type:'post', images:[], caption:'', script:'', cover:null, video:null, videoUrl:'', videoMode:'file' }, x); }
function normalize(d){
  const p = Object.assign({ id:newPlanId(), createdAt:new Date().toISOString(), client:'', period:'', logo:null, posts:[], sizes:{} }, d || {});
  p.posts = (p.posts || []).map(normPost);
  p.sizes = p.sizes || {};
  return p;
}
function mediaOf(p){
  const out = [];
  if(p.logo) out.push(p.logo);
  p.posts.forEach(x => { out.push(...x.images); if(x.cover) out.push(x.cover); if(x.video) out.push(x.video); });
  return out;
}
let toastT;
function toast(msg, err, ms){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || (err ? 6500 : 3000));
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function periodExample(){ const m = new Date().getMonth(); return `Ex.: ${MONTHS[m]} / ${MONTHS[(m + 1) % 12]}`; }
function isoToBr(iso){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
// Aceita 13/10, 13-10, 13.10, 1310, 13/10/27, 13/10/2027. Sem ano: ano atual
// (ou o seguinte, se a data já tiver passado há mais de 60 dias, ex.: janeiro digitado em dezembro).
function parseBrDate(raw){
  let d, mo, y;
  const t = raw.replace(/\s+/g, '');
  let m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/.exec(t);
  if(m){ d = +m[1]; mo = +m[2]; y = m[3]; }
  else if((m = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(t))){ d = +m[1]; mo = +m[2]; y = m[3]; }
  else return null;
  const now = new Date();
  if(y) y = y.length === 2 ? 2000 + +y : +y;
  else {
    y = now.getFullYear();
    const cand = new Date(y, mo - 1, d), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if((today - cand) / 86400000 > 60) y += 1;
  }
  const dt = new Date(y, mo - 1, d);
  if(dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function markDirty(){ dirty = true; leaveAsk = false; paintStatus(); updatePruneHint(); }
const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';
const OK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

async function copyText(text, btn){
  try {
    await navigator.clipboard.writeText(text);
    if(btn && btn.classList.contains('cbtn')){ btn.innerHTML = OK_ICON; btn.classList.add('ok'); setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('ok'); }, 1500); }
    else toast('Link copiado.');
    return true;
  } catch(e){
    toast('Não consegui copiar automaticamente: ' + text, false, 12000);
    return false;
  }
}

/* ---------- limite de planejamentos por cliente ---------- */
// Outros planejamentos do mesmo cliente, mais recentes primeiro, e quantos precisam sair para caber no limite.
function clientSiblings(plan){
  const me = { id: plan.id, clientId: plan.clientId, clientKey: clientKey(plan.client) };
  if(!me.clientId && !me.clientKey) return [];
  return index.filter(r => r.id !== plan.id && sameClient(r, me)).sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
function excessFor(plan){ return Math.max(0, clientSiblings(plan).length + 1 - KEEP_PER_CLIENT); }
function pruneHintHtml(){
  if(!cur) return '';
  const n = excessFor(cur);
  if(!n) return '';
  return `Este cliente já tem ${clientSiblings(cur).length} planejamentos salvos (o limite é ${KEEP_PER_CLIENT}). Ao salvar, você vai escolher ${n > 1 ? `quais ${n} apagar` : 'qual apagar'}.`;
}
let pruneAsk = null;      // { need, options, selected:Set } enquanto a janela de escolha está aberta
let pruneChoice = null;   // ids escolhidos para apagar no próximo salvamento
function pruneModal(){
  const { need, options, selected } = pruneAsk;
  const ok = selected.size >= need;
  return `<div class="modal-bg" data-a="prune-bg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="pm-t">
    <div class="mhead"><div><p class="lbl">${esc(cur.client)}</p><h3 id="pm-t">${need > 1 ? `Escolha ${need} planejamentos para apagar` : 'Escolha qual planejamento apagar'}</h3></div><button class="ibtn" data-a="prune-cancel" aria-label="Fechar">✕</button></div>
    <p class="hint" style="margin:0">Cada cliente guarda até ${KEEP_PER_CLIENT} planejamentos. Para salvar este, ${need > 1 ? `${need} dos anteriores precisam` : 'um dos anteriores precisa'} sair. O que for apagado some junto com as imagens e vídeos dele.</p>
    <div class="rows">${options.map(r => `<label class="prow pick ${selected.has(r.id) ? 'on' : ''}">
        <input type="checkbox" data-a="prune-pick" value="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}>
        <span class="cl">${esc(r.period || 'Sem período')}</span>
        <span class="pe">${r.count || 0} conteúdo${r.count === 1 ? '' : 's'}</span>
        <span class="cr">criado em ${esc(fmtCreated(r.createdAt))}</span>
      </label>`).join('')}</div>
    <div class="mfoot" style="justify-content:flex-end">
      <button class="sbtn" data-a="prune-cancel">Cancelar</button>
      <button class="sbtn dark" data-a="prune-confirm" ${ok ? '' : 'disabled'}>${selected.size > 1 ? `Apagar ${selected.size} e salvar` : 'Apagar e salvar'}</button>
    </div>
  </div></div>`;
}
function updatePruneHint(){ const el = document.getElementById('prune'); if(el){ const h = pruneHintHtml(); el.innerHTML = h; el.hidden = !h; } }



/* ---------- navegação ---------- */
function setPath(path, replace){
  if(location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
}
function go(v, path){ view = v; preview = false; leaveAsk = false; if(path) setPath(path); render(false); }
window.addEventListener('popstate', () => {
  if(view === 'edit' && dirty){ setPath(cur && !isNew ? `/editar/${cur.id}` : '/novo'); leaveAsk = true; render(true); return; }
  route();
});

/* ---------- render ---------- */
function render(keepScroll){
  const y = window.scrollY;
  let html = '';
  if(view === 'boot') html = topBar(false) + `<div class="wrap center-msg"><span>Carregando…</span></div>`;
  else if(view === 'login') html = topBar(false) + loginPage() + footer(null);
  else if(view === 'none') html = (session ? clientBar() : '') + topBar(false) + `<div class="wrap center-msg"><b>Planejamento não encontrado</b><span>Confira se o link está completo ou peça um novo link à equipe da Elev.</span></div>` + footer(null);
  else if(view === 'client') html = (session ? clientBar() : '') + topBar(false) + planViewBranded(cur) + footer(cur);
  else if(view === 'home') html = topBar(true) + homePage() + footer(null);
  else if(view === 'list') html = topBar(true) + listPage() + footer(null);
  else if(view === 'clients') html = topBar(true) + clientsPage() + footer(null);
  else if(view === 'edit') html = editBar() + topBar(false) + (preview ? planViewBranded(cur) : editPage()) + footer(cur);
  if(view === 'edit' && pruneAsk) html += pruneModal();
  if(clientEdit && (view === 'clients' || view === 'edit')) html += clientModal();
  app.innerHTML = html;
  wireCarousels();
  autosizeAll();
  window.scrollTo(0, keepScroll ? y : 0);
  paintStatus();
  document.title = (view === 'client' && cur?.client) ? `Planejamento · ${cur.client}` : 'Planejamento Elev';
}
function topBar(nav){
  return `<header class="top"><div class="wrap">${elevSvg()}<span class="sep"></span><span class="t">${nav ? 'Painel de planejamentos' : 'Planejamento de conteúdo'}</span>
    ${nav ? `<nav class="nav"><button class="${view==='home'?'on':''}" data-a="go-home">Início</button><button class="${view==='list'?'on':''}" data-a="go-list">Planejamentos</button><button class="${view==='clients'?'on':''}" data-a="go-clients">Clientes</button><button data-a="logout" title="${esc(session?.user?.email || '')}">Sair</button></nav>` : ''}
  </div></header>`;
}
function clientBar(){
  return `<div class="ebar"><div class="wrap"><div class="st"><span class="dot"></span><span>Você está vendo o link do cliente</span></div>
    <button class="ebtn" data-a="go-home">← Voltar ao painel</button></div></div>`;
}
function editBar(){
  if(leaveAsk){
    return `<div class="ebar"><div class="wrap"><div class="st dirty"><span class="dot"></span><span>${isNew ? 'Descartar este planejamento novo?' : 'Há alterações não salvas.'}</span></div>
      <button class="ebtn" data-a="leave-discard">${isNew ? 'Descartar' : 'Sair sem salvar'}</button><button class="ebtn primary" data-a="leave-stay">Continuar editando</button></div></div>`;
  }
  return `<div class="ebar"><div class="wrap">
    <button class="ebtn" data-a="leave">← ${isNew ? 'Cancelar' : 'Voltar'}</button>
    <div class="st" id="st"><span class="dot"></span><span id="st-t"></span></div>
    ${preview ? `<button class="ebtn" data-a="preview-off">Voltar a editar</button>` : `<button class="ebtn" data-a="preview-on">Ver como o cliente</button>`}
    <button class="ebtn primary" data-a="save" id="save-btn">Salvar</button>
  </div></div>`;
}

function paintStatus(){
  const st = document.getElementById('st'), tx = document.getElementById('st-t'), b = document.getElementById('save-btn');
  if(!st || !tx) return;
  st.className = 'st' + (saving ? ' saving' : dirty ? ' dirty' : '');
  const n = pending.size;
  tx.textContent = saving ? 'Salvando…' : dirty ? `Alterações não salvas${n ? ` · ${n} arquivo${n>1?'s':''} novo${n>1?'s':''}` : ''}` : isNew ? 'Ainda não salvo' : 'Tudo salvo · os links do cliente mostram esta versão';
  if(b) b.disabled = saving || !dirty;
}



/* ---------- login ---------- */
function loginPage(){
  return `<section class="login"><div class="wrap"><form class="login-card" id="login-form" novalidate>
    <p class="lbl">Painel de planejamentos</p>
    <h1>Entrar</h1>
    <div class="fld"><label class="lbl" for="l-email">E-mail</label><input class="inp" id="l-email" type="email" autocomplete="username" required></div>
    <div class="fld"><label class="lbl" for="l-pass">Senha</label><input class="inp" id="l-pass" type="password" autocomplete="current-password" required></div>
    ${loginErr ? `<p class="hint err">${esc(loginErr)}</p>` : ''}
    <button class="ebtn primary login-btn" type="submit" ${loginBusy ? 'disabled' : ''}>${loginBusy ? 'Entrando…' : 'Entrar'}</button>
    <p class="hint">Acesso só para a equipe da Elev. Clientes abrem o planejamento direto pelo link que receberem.</p>
  </form></div></section>`;
}
app.addEventListener('submit', async e => {
  if(e.target.id !== 'login-form') return;
  e.preventDefault();
  const email = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-pass').value;
  if(!email || !password){ loginErr = 'Preencha o e-mail e a senha.'; render(true); return; }
  loginBusy = true; loginErr = ''; render(true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  loginBusy = false;
  if(error){
    loginErr = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar agora. Tente de novo em instantes.';
    render(true);
    document.getElementById('l-email').value = email;
    document.getElementById('l-pass').focus();
  }
});

/* ---------- início ---------- */
function homePage(){
  const recent = index.slice(0, 3);
  return `<section class="home"><div class="wrap">
    <p class="lbl">Elev · Planejamento de conteúdo</p>
    <h1>O que vamos fazer hoje?</h1>
    <div class="tiles">
      <button class="tile primary" data-a="new"><span class="ico">+</span><b>Novo planejamento</b><span>Monte os posts, carrosséis, reels e stories de um cliente.</span></button>
      <button class="tile" data-a="go-list"><span class="ico">≡</span><b>Planejamentos anteriores</b><span>${indexReady ? `${index.length} salvo${index.length === 1 ? '' : 's'} · os mais recentes primeiro` : 'Carregando a lista…'}</span></button>
    </div>
    ${recent.length ? `<div class="recent"><h2>Recentes</h2><div class="rows">${recent.map(prow).join('')}</div></div>` : ''}
  </div></section>`;
}
function prow(r){
  return `<div class="prow" data-plan="${esc(r.id)}">
    <span class="cl">${esc(r.client || 'Sem nome')}</span>
    <span class="pe">${esc(r.period || '–')} · ${r.count || 0} conteúdo${r.count === 1 ? '' : 's'}</span>
    <span class="cr" title="Criado em">${esc(fmtCreated(r.createdAt))}</span>
    <span class="acts">
      <button class="sbtn dark" data-a="open">Abrir</button>
      <button class="sbtn" data-a="copy" title="${esc(bestLink(r))}">Copiar link</button>
      <button class="sbtn" data-a="del-plan">Excluir</button>
    </span>
  </div>`;
}
function listPage(){
  const bytes = index.reduce((s,r) => s + (r.bytes || 0), 0);
  const pct = bytes / CAP_BYTES;
  const capLabel = CAP_BYTES >= 1024**3 ? `${(CAP_BYTES / 1024**3).toFixed(0)} GB` : `${mb(CAP_BYTES)} MB`;
  return `<section class="list"><div class="wrap">
    <div class="backrow"><button class="backbtn" data-a="go-home">← Início</button></div>
    <div class="list-head">
      <div><p class="lbl">Planejamentos anteriores</p><h1>${indexReady ? `${index.length} planejamento${index.length === 1 ? '' : 's'}` : 'Carregando…'}</h1></div>
      <div class="meter"><span class="lbl">Espaço usado</span><div class="bar"><i class="${pct > .8 ? 'warn' : ''}" style="width:${Math.min(100, Math.max(pct > 0 ? 1 : 0, Math.round(pct*100)))}%"></i></div>
        <small>${mb(bytes)} MB de ${capLabel}</small></div>
    </div>
    ${index.length ? `<div class="rows">${index.map(prow).join('')}</div>`
      : `<div class="empty-list"><span>${indexReady ? 'Nenhum planejamento salvo ainda.' : 'Carregando a lista…'}</span>${indexReady ? '<button class="abtn" data-a="new"><span class="plus">+</span>Novo planejamento</button>' : ''}</div>`}
    <div style="margin-top:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap">
      <label class="sbtn" style="position:relative; overflow:hidden">Importar planejamento<input type="file" accept="application/json,.json" data-up="import" id="up-import" style="position:absolute; inset:0; opacity:0; cursor:pointer"></label>
      <span class="hint">Para trazer um arquivo de planejamento exportado (.json).</span>
    </div>
    <p class="hint" style="margin-top:14px">Cada cliente guarda até 3 planejamentos. Ao salvar o quarto, o painel pergunta qual apagar. O “Copiar link” do mais recente copia o link fixo do cliente.</p>
  </div></section>`;
}

/* ---------- visualização do cliente ---------- */
function counts(P){
  const c = { post:0, carrossel:0, reels:0, story:0 };
  P.posts.forEach(p => c[p.type] = (c[p.type] || 0) + 1);
  return c;
}
function sorted(P){
  return [...P.posts].sort((a,b) => (parseInt(a.num)||999) - (parseInt(b.num)||999) || (a.date||'').localeCompare(b.date||''));
}
function chip(type){ return `<span class="chip ${type}"><i></i>${TYPES[type]}</span>`; }
function isToRecord(p){ return p.type === 'reels' && !p.video && !p.videoUrl; }

function planViewBranded(P){ const st = brandStyle(P); return st ? `<div class="branded" style="${st}">${planView(P)}</div>` : planView(P); }
function planView(P){
  const c = counts(P), posts = sorted(P);
  const hero = `<section class="hero"><div class="wrap">
    <div class="hero-row">
      ${brandOf(P).logo ? `<div class="clogo"><img src="${esc(src(brandOf(P).logo))}" alt="Logo ${esc(P.client)}"></div>` : ''}
      <div style="min-width:0">
        <p class="lbl">Planejamento de conteúdo</p>
        <h1 class="${P.client ? '' : 'ph'}">${esc(P.client || 'Nome do cliente')}</h1>
        ${P.period ? `<p class="period">${esc(P.period)}</p>` : ''}
      </div>
    </div>
    <dl class="stats">
      <div><dt>Conteúdos</dt><dd>${P.posts.length}</dd></div>
      <div><dt>Posts</dt><dd>${c.post}</dd></div>
      <div><dt>Carrosséis</dt><dd>${c.carrossel}</dd></div>
      <div><dt>Reels</dt><dd>${c.reels}</dd></div>
      <div><dt>Stories</dt><dd>${c.story}</dd></div>
    </dl>
  </div></section>`;
  if(!posts.length){
    return hero + `<section class="feed"><div class="wrap"><div class="feed-empty">Os conteúdos deste planejamento aparecem aqui.</div></div></section>`;
  }
  const idx = `<section class="idx"><div class="wrap"><h2>Sumário</h2><div class="tbl-wrap"><table>
    <thead><tr><th>Nº</th><th>Data</th><th>Formato</th><th>Tema</th></tr></thead>
    <tbody>${posts.map(p => `<tr data-a="goto" data-id="${p.id}"><td class="n">${esc(p.num ? pad(p.num) : '–')}</td><td class="d">${esc(fmtDate(p.date) || '–')}</td><td class="f">${chip(p.type)}</td><td class="tm">${esc(firstLine(p.caption) || firstLine(p.script) || '')}</td></tr>`).join('')}</tbody>
  </table></div></div></section>`;
  return hero + idx + `<section class="feed"><div class="wrap">${posts.map(vcard).join('')}</div></section>`;
}
function vcard(p){
  return `<article class="vcard" id="c-${p.id}">
    <div class="vmeta"><span class="vnum">Nº ${esc(p.num ? pad(p.num) : '–')}</span>${chip(p.type)}${p.date ? `<span class="vdate">${esc(fmtDate(p.date))}</span>` : ''}${isToRecord(p) ? '<span class="badge-rec">Para gravar</span>' : ''}</div>
    <div class="vbody ${p.type === 'reels' || p.type === 'story' ? p.type : ''}">
      <div class="vmedia">${vmedia(p)}</div>
      <div class="vtext">
        ${p.type === 'story'
          ? (p.caption ? `<section><p class="lbl">Texto do story</p><p class="caption">${richCaption(p.caption)}</p></section>` : '')
          : `<section><p class="lbl">Legenda</p>${p.caption ? `<p class="caption">${richCaption(p.caption)}</p>` : '<p class="nocap">Legenda ainda não adicionada.</p>'}</section>`}
        ${p.type === 'reels' && p.script ? `<section><p class="lbl">Roteiro</p><p class="script">${esc(p.script)}</p></section>` : ''}
      </div>
    </div>
  </article>`;
}
function vmedia(p){
  if(p.type === 'post'){
    const im = p.images[0];
    return `<div class="frame">${im ? `<img src="${esc(src(im))}" alt="Arte do conteúdo ${esc(p.num)}" loading="lazy">` : '<div class="empty">Arte ainda não adicionada</div>'}</div>`;
  }
  if(p.type === 'carrossel'){
    if(!p.images.length) return `<div class="frame"><div class="empty">Slides ainda não adicionados</div></div>`;
    const n = p.images.length;
    return `<div class="car" data-car>
      <div class="frame"><div class="car-track">${p.images.map((im,i) => `<img src="${esc(src(im))}" alt="Slide ${i+1} de ${n}" loading="lazy">`).join('')}</div>
      ${n > 1 ? `<button class="car-nav p" aria-label="Slide anterior" data-dir="-1" disabled>‹</button><button class="car-nav n" aria-label="Próximo slide" data-dir="1">›</button><span class="car-count mono">1 / ${n}</span>` : ''}</div>
      ${n > 1 ? `<div class="car-dots">${p.images.map((_,i) => `<span class="${i===0?'on':''}"></span>`).join('')}</div>` : ''}
    </div>`;
  }
  if(p.type === 'story'){
    const hasUrl = p.videoUrl && /^https?:\/\//i.test(p.videoUrl);
    const items = [
      ...(p.video ? [`<video src="${esc(src(p.video))}" controls playsinline preload="metadata"></video>`] : []),
      ...p.images.map((im,i) => `<img src="${esc(src(im))}" alt="Tela ${i+1} do story" loading="lazy">`)
    ];
    const watch = hasUrl ? `<a class="watch-inline" href="${esc(p.videoUrl)}" target="_blank" rel="noopener"><span class="play"></span>Assistir vídeo do story</a>` : '';
    if(!items.length) return `<div class="frame tall"><div class="empty">${hasUrl ? 'Vídeo no Google Drive' : 'Telas ainda não adicionadas'}</div></div>${watch}`;
    const n = items.length;
    return `<div class="car" data-car>
      <div class="frame tall"><div class="car-track">${items.join('')}</div>
      ${n > 1 ? `<button class="car-nav p" aria-label="Tela anterior" data-dir="-1" disabled>‹</button><button class="car-nav n" aria-label="Próxima tela" data-dir="1">›</button><span class="car-count mono">1 / ${n}</span>` : ''}</div>
      ${n > 1 ? `<div class="car-dots">${items.map((_,i) => `<span class="${i===0?'on':''}"></span>`).join('')}</div>` : ''}
    </div>${watch}`;
  }
  const cover = p.cover ? esc(src(p.cover)) : '';
  if(p.video){
    return `<div class="frame tall"><video src="${esc(src(p.video))}" ${cover ? `poster="${cover}"` : ''} controls playsinline preload="${cover ? 'none' : 'metadata'}"></video></div>`;
  }
  const img = cover ? `<img src="${cover}" alt="Capa do reels ${esc(p.num)}" loading="lazy">` : `<div class="empty">${p.videoUrl ? 'Vídeo no Google Drive' : 'Capa ainda não adicionada'}</div>`;
  if(p.videoUrl && /^https?:\/\//i.test(p.videoUrl)){
    return `<div class="frame tall">${img}<a class="watch" href="${esc(p.videoUrl)}" target="_blank" rel="noopener"><span class="play"></span>Assistir vídeo</a></div>`;
  }
  return `<div class="frame tall">${img}</div>`;
}
function wireCarousels(){
  app.querySelectorAll('[data-car]').forEach(car => {
    const track = car.querySelector('.car-track');
    const n = track.children.length;
    if(n < 2) return;
    const prev = car.querySelector('.car-nav.p'), next = car.querySelector('.car-nav.n');
    const count = car.querySelector('.car-count'), dots = [...car.querySelectorAll('.car-dots span')];
    const update = () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      count.textContent = `${i+1} / ${n}`;
      dots.forEach((d,j) => d.classList.toggle('on', j === i));
      prev.disabled = i === 0; next.disabled = i === n-1;
    };
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive:true });
    car.querySelectorAll('.car-nav').forEach(b => b.addEventListener('click', () => {
      track.scrollBy({ left: track.clientWidth * Number(b.dataset.dir), behavior:'smooth' });
    }));
  });
}
function footer(P){
  const who = P?.client ? esc(P.client) : '';
  return `<footer class="foot"><div class="wrap foot-in">
    <div>${elevSvg()}<p>${who ? `Este planejamento foi desenvolvido pela Elev para ${who}.` : 'Planejamentos de conteúdo desenvolvidos pela Elev.'}</p></div>
    <div class="foot-cols">
      <div class="fcol"><span class="ft">Elev Marketing Digital</span><a href="https://www.eielev.com.br/" target="_blank" rel="noopener">eielev.com.br</a><a href="https://www.instagram.com/ei.elev" target="_blank" rel="noopener">@ei.elev</a></div>
      <div class="fcol"><span class="ft">Fale com a equipe</span><a href="https://api.whatsapp.com/send/?phone=18981181229" target="_blank" rel="noopener">Paloma · WhatsApp</a><a href="https://api.whatsapp.com/send/?phone=18981557058" target="_blank" rel="noopener">Fernando · WhatsApp</a></div>
    </div>
  </div><div class="foot-bot"><div class="wrap">${[P?.client, P?.period, 'Planejamento de conteúdo'].filter(Boolean).map(esc).join(' · ')}</div></div></footer>`;
}



/* ---------- edição ---------- */
function editPage(){
  const P = cur, posts = sorted(P);
  const ph = pruneHintHtml();
  const cl = clientById(P.clientId);
  const slug = cl?.slug || clientSlug(P.client);
  const latest = !isNew && isLatestOfClient({ id:P.id, clientId:P.clientId, clientKey:clientKey(P.client), createdAt:P.createdAt });
  const cf = (text, label) => `<div class="copyfield"><code>${esc(text)}</code><button class="cbtn" data-a="copytext" data-text="${esc(text)}" aria-label="Copiar ${label}" title="Copiar">${COPY_ICON}</button></div>`;
  const setup = `<section><div class="wrap"><div class="setup">
    <div class="fld combo"><label class="lbl" for="f-client">Cliente</label>
      <div class="combo-wrap">${cl?.logo ? `<span class="ccard-logo sm in">${`<img src="${esc(src(cl.logo))}" alt="">`}</span>` : ''}<input class="inp big ${cl?.logo ? 'with-logo' : ''}" id="f-client" value="${esc(P.client)}" autocomplete="off" placeholder="Busque ou cadastre" role="combobox" aria-expanded="false"></div>
      <div class="combo-list" id="combo-list" hidden></div>
      ${cl ? `<button class="lnk" data-a="edit-client" style="align-self:flex-start">Editar cliente (logo e cores)</button>` : ''}
    </div>
    <div class="fld"><label class="lbl" for="f-period">Mês ou período</label><input class="inp big" id="f-period" data-g="period" value="${esc(P.period)}" placeholder="${esc(periodExample())}" autocomplete="off"></div>
    <div class="fld"><span class="lbl">Cores da página</span>
      ${cl && (cl.colors || []).length
        ? `<label class="brand-toggle"><input type="checkbox" id="f-usebrand" ${P.useBrand !== false ? 'checked' : ''}><span class="sw">${cl.colors.slice(0,2).map(x => `<i style="background:${esc(normHex(x))}"></i>`).join('')}</span>Usar as cores do cliente</label>`
        : `<p class="hint" style="margin:0">${cl ? 'Este cliente não tem cores cadastradas: a página usa o padrão Elev.' : 'Escolha o cliente para ver as opções.'}</p>`}
    </div>
  </div>
  <p class="prune" id="prune" ${ph ? '' : 'hidden'}>${ph}</p>
  <div style="margin-top:16px">
    ${isNew ? `<p class="hint">Os links do cliente aparecem aqui depois do primeiro salvamento.</p>`
      : `<div class="links">
          <div class="fld"><span class="lbl">Link fixo do cliente${latest ? '' : ' · mostra o planejamento mais recente'}</span>${cf(fixedLinkFor(slug), 'link fixo')}</div>
          <div class="fld"><span class="lbl">Link só deste planejamento</span>${cf(linkFor(P.id), 'link deste planejamento')}</div>
        </div>
        <p class="hint">O link fixo sempre abre o planejamento mais recente deste cliente. Mande ele uma vez e o cliente pode salvar nos favoritos.</p>
        ${MEDIA_BASE ? trelloBox(P) : ''}`}
  </div></div></section>`;
  const add = extra => `<div class="addbar" ${extra||''}><span class="lbl">Novo conteúdo</span>
      <button class="abtn" data-a="add" data-type="post"><span class="plus">+</span>Post</button>
      <button class="abtn" data-a="add" data-type="carrossel"><span class="plus">+</span>Carrossel</button>
      <button class="abtn" data-a="add" data-type="reels"><span class="plus">+</span>Reels</button>
      <button class="abtn" data-a="add" data-type="story"><span class="plus">+</span>Story</button>
      ${posts.length > 1 ? `<span class="hint" style="margin-left:auto">Os conteúdos se organizam pela data automaticamente.</span>` : ''}
    </div>`;
  const list = posts.length ? posts.map((p,i) => ecard(p, i, posts.length)).join('') : `<div class="empty-edit">
      <span>Nenhum conteúdo ainda. Escolha o formato do primeiro:</span>
      <div class="row">
        <button class="abtn" data-a="add" data-type="post"><span class="plus">+</span>Post</button>
        <button class="abtn" data-a="add" data-type="carrossel"><span class="plus">+</span>Carrossel</button>
        <button class="abtn" data-a="add" data-type="reels"><span class="plus">+</span>Reels</button>
      <button class="abtn" data-a="add" data-type="story"><span class="plus">+</span>Story</button>
      </div>
      <span class="hint">Dica: com um conteúdo selecionado, você também pode colar imagens com Ctrl+V / ⌘V.</span>
    </div>`;
  return setup + `<section style="padding-block:8px 56px"><div class="wrap">${add()}${list}${posts.length ? add('style="border-top:0"') : ''}</div></section>`;
}

function ecard(p, i, total){
  const id = p.id;
  return `<article class="ecard ${activeId === id ? 'active' : ''}" id="c-${id}" data-card="${id}">
    <div class="ehead">
      <label><span class="lbl">Nº</span><input class="inp in-num" id="num-${id}" data-f="num" value="${esc(p.num)}" inputmode="numeric" aria-label="Número do conteúdo"></label>
      <label><span class="lbl">Data</span><input class="inp in-date" type="text" inputmode="numeric" id="date-${id}" data-f="dateTxt" value="${esc(isoToBr(p.date))}" placeholder="dd/mm" aria-label="Data (dia/mês, ano opcional)" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Formato">${Object.entries(TYPES).map(([k,v]) => `<button class="${p.type===k?'on':''}" data-a="type" data-type="${k}">${v}</button>`).join('')}</div>
      <div class="etools">
        <button class="ibtn" data-a="up" title="Mover para cima" aria-label="Mover para cima" ${i===0?'disabled':''}>↑</button>
        <button class="ibtn" data-a="down" title="Mover para baixo" aria-label="Mover para baixo" ${i===total-1?'disabled':''}>↓</button>
        <button class="ibtn" data-a="del" title="Excluir conteúdo" aria-label="Excluir conteúdo">✕</button>
      </div>
    </div>
    <div class="ebody">
      <div class="emedia">${emedia(p)}</div>
      <div class="etext">
        ${p.type === 'story'
          ? `<div class="fld"><label class="lbl" for="cap-${id}">Texto do story (opcional)</label><textarea class="inp" id="cap-${id}" data-f="caption" placeholder="Texto, enquete, link ou observação para o cliente. Se ficar vazio, não aparece.">${esc(p.caption)}</textarea></div>`
          : `<div class="fld"><label class="lbl" for="cap-${id}">Legenda</label><textarea class="inp" id="cap-${id}" data-f="caption" placeholder="Cole aqui a legenda do post, com emojis e hashtags.">${esc(p.caption)}</textarea></div>`}
        ${p.type === 'reels' ? `<div class="fld"><label class="lbl" for="scr-${id}">Roteiro (opcional)</label><textarea class="inp" id="scr-${id}" data-f="script" placeholder="Roteiro para gravação. Aparece para o cliente abaixo da legenda.">${esc(p.script)}</textarea></div>` : ''}
      </div>
    </div>
  </article>`;
}
function emedia(p){
  const id = p.id;
  if(p.type === 'post'){
    const im = p.images[0];
    return `<span class="lbl">Arte</span>
      <label class="drop single" data-up="img" data-id="${id}">${im ? `<img src="${esc(src(im))}" alt="">` : '<span>Arraste a arte aqui<br>ou <strong>escolha um arquivo</strong></span>'}<input type="file" accept="image/*" data-up="img" data-id="${id}" id="up-img-${id}"></label>
      ${im ? `<div class="mini-actions"><button class="lnk danger" data-a="rm-img" data-i="0">Remover arte</button></div>` : ''}`;
  }
  if(p.type === 'carrossel'){
    const n = p.images.length;
    return `<span class="lbl">Slides${n ? ` · ${n}` : ''}</span>
      <div class="thumbs">
        ${p.images.map((im,i) => `<div class="thumb"><img src="${esc(src(im))}" alt="Slide ${i+1}"><span class="ti">${i+1}</span>
          <div class="tb"><button data-a="mv-img" data-i="${i}" data-d="-1" aria-label="Mover slide para a esquerda" ${i===0?'disabled':''}>←</button><button data-a="rm-img" data-i="${i}" aria-label="Remover slide">✕</button><button data-a="mv-img" data-i="${i}" data-d="1" aria-label="Mover slide para a direita" ${i===n-1?'disabled':''}>→</button></div></div>`).join('')}
        <label class="drop" data-up="imgs" data-id="${id}"><span>+ Slides</span><input type="file" accept="image/*" multiple data-up="imgs" data-id="${id}" id="up-imgs-${id}"></label>
      </div>
      <p class="hint">Pode selecionar vários de uma vez. A ordem segue o nome dos arquivos.</p>`;
  }
  if(p.type === 'story'){
    const n = p.images.length;
    return `<span class="lbl">Telas do story${n ? ` · ${n}` : ''}</span>
      <div class="thumbs tall">
        ${p.images.map((im,i) => `<div class="thumb"><img src="${esc(src(im))}" alt="Tela ${i+1}"><span class="ti">${i+1}</span>
          <div class="tb"><button data-a="mv-img" data-i="${i}" data-d="-1" aria-label="Mover tela para a esquerda" ${i===0?'disabled':''}>←</button><button data-a="rm-img" data-i="${i}" aria-label="Remover tela">✕</button><button data-a="mv-img" data-i="${i}" data-d="1" aria-label="Mover tela para a direita" ${i===n-1?'disabled':''}>→</button></div></div>`).join('')}
        <label class="drop" data-up="imgs" data-id="${id}"><span>+ Telas</span><input type="file" accept="image/*" multiple data-up="imgs" data-id="${id}" id="up-imgs-${id}"></label>
      </div>
      <p class="hint">Uma imagem por tela, na ordem em que vão ao ar. Pode selecionar várias de uma vez.</p>
      ${vidBlock(p)}`;
  }
  return `${vidBlock(p)}
    <span class="lbl" style="margin-top:6px">Capa</span>
    <label class="drop single tall cover-drop" data-up="cover" data-id="${id}">${p.cover ? `<img src="${esc(src(p.cover))}" alt="">` : '<span>Arraste a capa aqui<br>ou <strong>escolha</strong></span>'}<input type="file" accept="image/*" data-up="cover" data-id="${id}" id="up-cover-${id}"></label>
    ${p.cover ? `<div class="mini-actions"><button class="lnk danger" data-a="rm-cover">Remover capa</button></div>` : ''}`;
}
function vidBlock(p){
  const id = p.id, vm = p.videoMode || 'file', story = p.type === 'story';
  return `<div class="vid ${story ? '' : 'main'}">
      <span class="lbl">Vídeo${story ? ' (opcional)' : ''}</span>
      <div class="seg" role="group" aria-label="Origem do vídeo"><button class="${vm==='file'?'on':''}" data-a="vmode" data-m="file">Arquivo até ${MAX_VIDEO_LABEL}</button><button class="${vm==='link'?'on':''}" data-a="vmode" data-m="link">Link do Drive</button></div>
      ${vm === 'link'
        ? `<input class="inp" id="vurl-${id}" data-f="videoUrl" value="${esc(p.videoUrl)}" placeholder="https://drive.google.com/file/d/…" inputmode="url" autocomplete="off">
           <p class="hint" id="vhint-${id}">${linkHint(p.videoUrl)}</p>`
        : (p.video
            ? `<div class="vid-file"><span>✓ Vídeo ${pending.has(p.video) ? 'pronto para enviar ao salvar' : 'enviado'}</span><button class="lnk danger" data-a="rm-video">Remover vídeo</button></div>`
            : `<label class="drop video-drop" data-up="video" data-id="${id}"><span><strong>Arraste o vídeo aqui</strong>ou escolha um MP4 de até ${MAX_VIDEO_LABEL}</span><input type="file" accept="video/mp4,video/webm,video/quicktime" data-up="video" data-id="${id}" id="up-video-${id}"></label>`)}
      ${!story && !p.video && !p.videoUrl ? `<p class="hint">Sem vídeo, o conteúdo aparece como <strong>Para gravar</strong>, com a capa e o roteiro.</p>` : ''}
      ${story ? `<p class="hint">Para stories em vídeo. O vídeo enviado aparece como a primeira tela; o link do Drive vira um botão abaixo das telas.</p>` : ''}
    </div>`;
}
function linkHint(url){
  if(!url) return 'No Drive, deixe o arquivo em “Qualquer pessoa com o link” para o cliente conseguir abrir.';
  if(!/^https?:\/\//i.test(url)) return '<span style="color:var(--danger)">O link precisa começar com https://</span>';
  if(/drive\.google\.com|docs\.google\.com/i.test(url)) return 'Confira se o arquivo está em “Qualquer pessoa com o link”. O cliente verá a capa com o botão Assistir vídeo.';
  return 'O cliente verá a capa com o botão Assistir vídeo, que abre este link.';
}


/* ---------- imagens e arquivos ---------- */
async function loadBitmap(file){
  try { return await createImageBitmap(file); } catch(e){}
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = u;
  });
}
async function encode(canvas, type, q){
  const b = await new Promise(r => canvas.toBlob(r, type, q));
  return b && b.type === type ? b : null;
}
async function processImage(file, { max = 1350, keepAlpha = false } = {}){
  if(keepAlpha && file.type === 'image/svg+xml') return { blob:file, ext:'svg' };
  const bmp = await loadBitmap(file);
  const w = bmp.width, h = bmp.height, s = Math.min(1, max / Math.max(w, h));
  const alpha = keepAlpha && file.type !== 'image/jpeg';
  if(s === 1 && file.size < 220 * 1024 && /^image\/(jpeg|webp)$/.test(file.type) && !alpha){
    return { blob:file, ext: file.type === 'image/webp' ? 'webp' : 'jpg' };
  }
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d');
  if(!alpha){ ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await encode(c, 'image/webp', alpha ? 0.9 : 0.8), ext = 'webp';
  if(!blob){ blob = await encode(c, alpha ? 'image/png' : 'image/jpeg', 0.82); ext = alpha ? 'png' : 'jpg'; }
  if(!blob) throw new Error('img');
  return { blob, ext };
}

function addFile(blob, ext){
  const path = (MEDIA_BASE ? 'r2:' : '') + `${cur.id}/${uid()}.${ext}`;
  pending.set(path, blob);
  cur.sizes[path] = blob.size;
  blobUrls.set(path, URL.createObjectURL(blob));
  return path;
}
function dropPath(path){
  if(!path) return;
  if(pending.has(path)) pending.delete(path); else removed.add(path);
  delete cur.sizes[path];
}
async function handleFiles(kind, id, fileList){
  const files = [...fileList].filter(Boolean);
  if(kind === 'clogo'){
    const img = files.find(f => f.type.startsWith('image/'));
    if(!img || !clientEdit) return toast('Escolha um arquivo de imagem para a logo.', true);
    try {
      const { blob, ext } = await processImage(img, { max:600, keepAlpha:true });
      clientEdit.logoPending = { blob, ext }; clientEdit.logoUrl = URL.createObjectURL(blob);
      clientEdit.name = document.getElementById('c-name')?.value ?? clientEdit.name;
      render(true);
    } catch(e){ toast('Não consegui ler essa imagem. Tente PNG ou JPG.', true); }
    return;
  }
  if(!files.length || !cur) return;
  const p = id ? getPost(id) : null;
  try {
    if(kind === 'logo'){
      const img = files.find(f => f.type.startsWith('image/'));
      if(!img) return toast('Escolha um arquivo de imagem para a logo.', true);
      const { blob, ext } = await processImage(img, { max:600, keepAlpha:true });
      dropPath(cur.logo); cur.logo = addFile(blob, ext);
    } else if(kind === 'video'){
      const v = files[0];
      if(!/^video\/(mp4|webm|quicktime)$/.test(v.type)) return toast('Use um vídeo MP4. Para outros formatos, suba no Drive e cole o link.', true);
      if(v.size > MAX_VIDEO) return toast(`Esse vídeo tem ${mb(v.size)} MB e o limite é ${MAX_VIDEO_LABEL}. Suba no Google Drive e cole o link.`, true);
      dropPath(p.video); p.video = addFile(v, v.type === 'video/webm' ? 'webm' : v.type === 'video/quicktime' ? 'mov' : 'mp4'); p.videoUrl = '';
    } else {
      const imgs = files.filter(f => f.type.startsWith('image/')).sort((a,b) => (a.name||'').localeCompare(b.name||'', 'pt', { numeric:true }));
      if(!imgs.length) return toast('Esses arquivos não são imagens.', true);
      toast(imgs.length > 1 ? `Preparando ${imgs.length} imagens…` : 'Preparando imagem…');
      const out = [];
      for(const f of imgs){ const { blob, ext } = await processImage(f); out.push(addFile(blob, ext)); }
      if(kind === 'cover'){ dropPath(p.cover); p.cover = out[0]; out.slice(1).forEach(dropPath); }
      else if(p.type === 'carrossel' || kind === 'imgs'){ p.images.push(...out); }
      else { p.images.forEach(dropPath); p.images = [out[0]]; out.slice(1).forEach(dropPath); }
      document.getElementById('toast').hidden = true;
    }
    markDirty(); render(true);
  } catch(e){
    toast('Não consegui ler esse arquivo. Tente exportar como JPG ou PNG.', true);
  }
}



/* ---------- abrir, criar, sair ---------- */
function resetWork(){
  trelloArm = false; trelloBusy = false;
  pending.clear(); removed.clear(); dirty = false; saving = false; activeId = null; preview = false; leaveAsk = false;
}
function startNew(){
  resetWork();
  cur = normalize({}); isNew = true;
  go('edit', '/novo');
  requestAnimationFrame(() => document.getElementById('f-client')?.focus());
}
function rowToPlan(row){
  const plan = normalize(Object.assign({}, row.data || {}, { id: row.id, client: row.client, period: row.period, createdAt: row.created_at, clientId: row.client_id || null, brandInfo: row.client_info || null }));
  plan.posts = sortPosts(plan.posts);
  return plan;
}
async function openPlan(id, replace){
  resetWork();
  const { data, error } = await sb.from('plans').select('*').eq('id', id).maybeSingle();
  if(error || !data){ toast('Não consegui abrir esse planejamento. Recarregue a página e tente de novo.', true); if(replace) go('home', '/'); return; }
  cur = rowToPlan(data); isNew = false;
  view = 'edit'; preview = false; leaveAsk = false;
  setPath(`/editar/${id}`, replace);
  render(false);
}
function leaveEdit(){
  if(dirty){ leaveAsk = true; render(true); return; }
  resetWork(); cur = null; go('home', '/');
}

/* ---------- ações dos conteúdos ---------- */
function nextNum(){ return cur.posts.reduce((m,p) => Math.max(m, parseInt(p.num) || 0), 0) + 1; }
function addPost(type){
  const p = normPost({ type, num:String(nextNum()) });
  cur.posts.push(p); activeId = p.id; markDirty(); render(true);
  requestAnimationFrame(() => {
    document.getElementById('c-' + p.id)?.scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('date-' + p.id)?.focus({ preventScroll:true });
  });
}
function swap(id, dir){
  const list = sorted(cur), i = list.findIndex(p => p.id === id), j = i + dir;
  if(j < 0 || j >= list.length) return;
  const a = list[i], b = list[j], na = a.num, nb = b.num;
  if(na && nb && na !== nb){ a.num = nb; b.num = na; }
  else { list.splice(j, 0, list.splice(i, 1)[0]); list.forEach((p,k) => p.num = String(k+1)); }
  markDirty(); render(true);
}

let delArm = null, delPlanArm = null;

app.addEventListener('click', e => {
  const t = e.target.closest('[data-a]');
  const card = e.target.closest('[data-card]');
  if(card && activeId !== card.dataset.card){
    activeId = card.dataset.card;
    app.querySelectorAll('.ecard').forEach(c => c.classList.toggle('active', c.dataset.card === activeId));
  }
  if(!t) return;
  const a = t.dataset.a, id = card?.dataset.card, p = id ? getPost(id) : null;
  const planId = t.closest('[data-plan]')?.dataset.plan;
  switch(a){
    case 'go-home': resetWork(); cur = null; go('home', '/'); break;
    case 'go-list': go('list', '/planejamentos'); break;
    case 'go-clients': if(!clientsReady) loadClients(); go('clients', '/clientes'); break;
    case 'client-new': openClientModal(null); break;
    case 'client-edit': openClientModal(clientById(t.dataset.id)); break;
    case 'edit-client': openClientModal(clientById(cur?.clientId), { fromPlan:true }); break;
    case 'pick-client': { const c = clientById(t.dataset.id); if(c && cur){ cur.clientId = c.id; cur.client = c.name; markDirty(); render(true); } break; }
    case 'new-client-from': openClientModal(null, { name: document.getElementById('f-client')?.value.trim() || '', fromPlan:true }); break;
    case 'cm-close': clientEdit = null; render(true); break;
    case 'cm-bg': if(e.target === t){ clientEdit = null; render(true); } break;
    case 'cm-save': saveClient(); break;
    case 'cm-delete': if(clientEdit.delArm) deleteClient(); else { clientEdit.delArm = true; render(true); } break;
    case 'cm-addcolor': if(clientEdit.colors.length < 5){ clientEdit.name = document.getElementById('c-name')?.value ?? clientEdit.name; clientEdit.colors.push(clientEdit.colors.length ? '#888888' : '#1e5bb8'); render(true); } break;
    case 'cm-rmcolor': clientEdit.name = document.getElementById('c-name')?.value ?? clientEdit.name; clientEdit.colors.splice(+t.dataset.i, 1); render(true); break;
    case 'cm-rmlogo': clientEdit.name = document.getElementById('c-name')?.value ?? clientEdit.name; clientEdit.logo = null; clientEdit.logoPending = null; clientEdit.logoUrl = null; render(true); break;
    case 'logout': sb.auth.signOut(); break;
    case 'new': startNew(); break;
    case 'open': openPlan(planId); break;
    case 'copy': { const r = index.find(x => x.id === planId); if(r) copyText(bestLink(r)); break; }
    case 'copytext': copyText(t.dataset.text, t); break;
    case 'trello-arm': if(dirty){ toast('Salve as alterações antes de mandar para o Trello.', true); break; } trelloArm = true; render(true); break;
    case 'trello-cancel': trelloArm = false; render(true); break;
    case 'trello-go': sendToTrello(); break;
    case 'prune-pick': {
      if(t.checked) pruneAsk.selected.add(t.value); else pruneAsk.selected.delete(t.value);
      render(true); break;
    }
    case 'prune-cancel': pruneAsk = null; pruneChoice = null; render(true); break;
    case 'prune-bg': if(e.target === t){ pruneAsk = null; render(true); } break;
    case 'prune-confirm': {
      if(!pruneAsk || pruneAsk.selected.size < pruneAsk.need) break;
      pruneChoice = [...pruneAsk.selected]; pruneAsk = null; render(true); save(); break;
    }
    case 'del-plan': {
      if(delPlanArm === planId){ delPlanArm = null; deletePlan(planId); }
      else {
        delPlanArm = planId;
        t.textContent = 'Confirmar exclusão'; t.classList.add('dark');
        setTimeout(() => { if(delPlanArm === planId){ delPlanArm = null; render(true); } }, 4000);
      }
      break;
    }
    case 'leave-discard': resetWork(); cur = null; go('home', '/'); break;
    case 'leave': leaveEdit(); break;
    case 'leave-stay': leaveAsk = false; render(true); break;
    case 'preview-on': preview = true; render(false); break;
    case 'preview-off': preview = false; render(false); break;
    case 'goto': document.getElementById('c-' + t.dataset.id)?.scrollIntoView({ behavior:'smooth', block:'start' }); break;
    case 'save': save(); break;
    case 'add': addPost(t.dataset.type); break;
    case 'sortdate': {
      const list = [...cur.posts].sort((x,y) => (x.date || '9999').localeCompare(y.date || '9999') || (parseInt(x.num)||999) - (parseInt(y.num)||999));
      list.forEach((q,k) => q.num = String(k+1)); markDirty(); render(true); toast('Conteúdos renumerados pela data.'); break;
    }
    case 'type': if(p && p.type !== t.dataset.type){ p.type = t.dataset.type; markDirty(); render(true); } break;
    case 'up': swap(id, -1); break;
    case 'down': swap(id, 1); break;
    case 'del': {
      if(delArm === id){
        p.images.forEach(dropPath); dropPath(p.cover); dropPath(p.video);
        cur.posts = cur.posts.filter(x => x.id !== id); delArm = null; markDirty(); render(true); toast('Conteúdo excluído.');
      } else {
        delArm = id;
        t.outerHTML = `<button class="del-confirm" data-a="del">Excluir?</button>`;
        setTimeout(() => { if(delArm === id){ delArm = null; const b = document.querySelector(`[data-card="${id}"] .del-confirm`); if(b) b.outerHTML = '<button class="ibtn" data-a="del" title="Excluir conteúdo" aria-label="Excluir conteúdo">✕</button>'; } }, 3500);
      }
      break;
    }
    case 'rm-img': { const i = +t.dataset.i; dropPath(p.images[i]); p.images.splice(i, 1); markDirty(); render(true); break; }
    case 'mv-img': { const i = +t.dataset.i, j = i + Number(t.dataset.d); if(j >= 0 && j < p.images.length){ [p.images[i], p.images[j]] = [p.images[j], p.images[i]]; markDirty(); render(true); } break; }
    case 'rm-cover': dropPath(p.cover); p.cover = null; markDirty(); render(true); break;
    case 'rm-video': dropPath(p.video); p.video = null; markDirty(); render(true); break;
    case 'rm-logo': dropPath(cur.logo); cur.logo = null; markDirty(); render(true); break;
    case 'vmode': if(p){ p.videoMode = t.dataset.m; render(true); } break;

  }
});
app.addEventListener('input', e => {
  const el = e.target;
  if(clientEdit){
    if(el.id === 'c-name'){ clientEdit.name = el.value; const h = document.getElementById('cm-t'); if(h) h.textContent = el.value || 'Cliente'; refreshPreview(); return; }
    if(el.dataset.ci != null){ const i = +el.dataset.ci; clientEdit.colors[i] = normHex(el.value); const hx = document.querySelector(`[data-ch="${i}"]`); if(hx) hx.value = normHex(el.value).toUpperCase(); refreshPreview(); return; }
    if(el.dataset.ch != null){ const i = +el.dataset.ch; el.classList.toggle('bad', !HEX_RE.test(el.value)); if(HEX_RE.test(el.value)){ clientEdit.colors[i] = normHex(el.value); const pk = document.querySelector(`[data-ci="${i}"]`); if(pk) pk.value = normHex(el.value); refreshPreview(); } return; }
  }
  if(el.id === 'f-client' && cur){
    cur.client = el.value; const m = clientByKey(clientKey(el.value)); cur.clientId = m ? m.id : null;
    markDirty(); showCombo(); return;
  }
  if(!cur) return;
  if(el.dataset.g){ cur[el.dataset.g] = el.value; markDirty(); return; }
  const f = el.dataset.f; if(!f) return;
  if(f === 'dateTxt'){ el.classList.remove('bad'); markDirty(); return; }
  const p = getPost(el.closest('[data-card]')?.dataset.card); if(!p) return;
  p[f] = el.value;
  if(f === 'videoUrl'){ const h = document.getElementById('vhint-' + p.id); if(h) h.innerHTML = linkHint(el.value.trim()); }
  if(el.tagName === 'TEXTAREA') autosize(el);
  markDirty();
});
app.addEventListener('change', e => {
  const el = e.target;
  if(el.id === 'f-usebrand' && cur){ cur.useBrand = el.checked; markDirty(); return; }
  if(el.type === 'file' && el.dataset.up === 'import'){ importPlan(el.files[0]); el.value = ''; return; }
  if(el.type === 'file' && el.dataset.up){ handleFiles(el.dataset.up, el.dataset.id, el.files); el.value = ''; return; }
  if(el.dataset.f === 'num'){ render(true); }
  if(el.dataset.f === 'dateTxt'){
    const p = getPost(el.closest('[data-card]')?.dataset.card); if(!p) return;
    const raw = el.value.trim();
    if(!raw){ p.date = ''; el.classList.remove('bad'); markDirty(); reorderLive(p.id); return; }
    const iso = parseBrDate(raw);
    if(!iso){ el.classList.add('bad'); toast('Data não reconhecida. Use dia/mês, por exemplo 13/10 ou 13/10/27.', true); return; }
    p.date = iso; el.value = isoToBr(iso); el.classList.remove('bad'); markDirty();
    reorderLive(p.id);
  }
  if(el.dataset.f === 'videoUrl'){ const p = getPost(el.closest('[data-card]')?.dataset.card); if(p){ p.videoUrl = el.value.trim(); if(p.videoUrl && p.video){ dropPath(p.video); p.video = null; } render(true); } }
});
app.addEventListener('focusin', e => {
  if(e.target.id === 'f-client') showCombo();
  const card = e.target.closest('[data-card]');
  if(card && activeId !== card.dataset.card){ activeId = card.dataset.card; app.querySelectorAll('.ecard').forEach(c => c.classList.toggle('active', c.dataset.card === activeId)); }
});
['dragenter','dragover'].forEach(ev => app.addEventListener(ev, e => {
  const d = e.target.closest('.drop[data-up]'); if(!d) return;
  e.preventDefault(); d.classList.add('over');
}));
['dragleave','drop'].forEach(ev => app.addEventListener(ev, e => {
  const d = e.target.closest('.drop[data-up]'); if(!d) return;
  d.classList.remove('over');
  if(ev === 'drop'){ e.preventDefault(); handleFiles(d.dataset.up, d.dataset.id, e.dataTransfer.files); }
}));
document.addEventListener('paste', e => {
  if(view !== 'edit' || preview) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if(!files.length) return;
  const p = activeId && getPost(activeId);
  if(!p) return toast('Clique em um conteúdo antes de colar a imagem.', true);
  e.preventDefault();
  handleFiles(p.type === 'reels' ? 'cover' : (p.type === 'carrossel' || p.type === 'story') ? 'imgs' : 'img', p.id, files);
});
function autosize(t){ t.style.height = 'auto'; t.style.height = Math.max(140, t.scrollHeight + 2) + 'px'; }
function autosizeAll(){ app.querySelectorAll('textarea').forEach(autosize); }

document.addEventListener('mousedown', e => { if(!e.target.closest('.combo')) hideCombo(); });
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(clientEdit){ clientEdit = null; render(true); } else if(pruneAsk){ pruneAsk = null; render(true); } else hideCombo();
});
window.addEventListener('beforeunload', e => { if(dirty){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- dados ---------- */
function errMsg(err){
  const m = String(err?.message || err || '');
  if(/jwt|auth|not authorized|permission|row-level|sessão/i.test(m)) return 'Sua sessão expirou. Entre de novo e salve outra vez.';
  if(/payload too large|exceeded the maximum|too large/i.test(m)) return 'Algum arquivo passou do limite de tamanho. Para vídeos grandes, use o link do Drive.';
  if(/fetch|network|failed to/i.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return 'Não foi possível salvar agora. Suas alterações continuam aqui; tente de novo.';
}
function summarize(row){
  return { id: row.id, clientId: row.client_id || null, client: row.client, clientKey: row.client_key, slug: row.client_slug, period: row.period, createdAt: row.created_at, count: row.post_count, bytes: Number(row.media_bytes) || 0 };
}
async function loadIndex(skipMigrate){
  const { data, error } = await sb.from('plans').select('id, client, client_key, client_slug, client_id, period, created_at, post_count, media_bytes').order('created_at', { ascending:false });
  if(!error){ index = (data || []).map(summarize); }
  indexReady = true;
  if(view === 'home' || view === 'list' || view === 'clients') render(true); else updatePruneHint();
  if(!skipMigrate) migrateClients();
}
async function authHeader(){
  const { data } = await sb.auth.getSession();
  if(!data.session) throw new Error('auth: sessão expirada');
  return 'Bearer ' + data.session.access_token;
}
async function mediaApi(path, body){
  const r = await fetch(MEDIA_BASE + path, { method:'POST', headers:{ 'content-type':'application/json', authorization: await authHeader() }, body: JSON.stringify(body) });
  if(r.status === 401) throw new Error('auth: sessão expirada');
  if(!r.ok){ let m = ''; try { m = (await r.json()).error || ''; } catch(e){} throw new Error('servidor de arquivos respondeu ' + r.status + (m ? ': ' + m : '')); }
  return r.json();
}
function putWithProgress(url, blob, onProgress){
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    if(blob.type) x.setRequestHeader('Content-Type', blob.type);
    x.upload.onprogress = e => { if(e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => x.status >= 200 && x.status < 300 ? res() : rej(new Error('envio falhou (' + x.status + ')'));
    x.onerror = () => rej(new Error('network: envio interrompido'));
    x.send(blob);
  });
}
// Envia um arquivo para onde a chave indica (R2 se começa com "r2:", senão Supabase Storage).
async function uploadBlob(path, blob, onProgress){
  if(isR2(path)){
    const { url } = await mediaApi('/sign', { key: path.slice(3) });
    await putWithProgress(url, blob, onProgress);
    return;
  }
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || undefined, cacheControl: '31536000', upsert: true });
  if(error) throw error;
}
async function removeFiles(paths){
  const list = [...new Set(paths)].filter(p => p && !/^(https?:|data:|blob:)/.test(p));
  const r2 = list.filter(isR2).map(p => p.slice(3)), sup = list.filter(p => !isR2(p));
  for(let i = 0; i < sup.length; i += 100) await sb.storage.from(BUCKET).remove(sup.slice(i, i + 100));
  if(r2.length && MEDIA_BASE) await mediaApi('/delete', { keys: r2 });
}
async function removePlanFolder(id){
  const { data } = await sb.storage.from(BUCKET).list(id, { limit: 1000 });
  const sup = (data || []).map(f => `${id}/${f.name}`);
  if(sup.length) await sb.storage.from(BUCKET).remove(sup);
  if(MEDIA_BASE) await mediaApi('/delete', { prefix: `${id}/` });
}
function sortPosts(posts){
  // Data mais próxima primeiro; sem data vai para o fim, na ordem em que estava.
  const list = [...posts].sort((x,y) => (x.date || '9999-99-99').localeCompare(y.date || '9999-99-99') || (parseInt(x.num)||999) - (parseInt(y.num)||999));
  list.forEach((q,k) => q.num = String(k + 1));
  return list;
}
function sortByDate(){ cur.posts = sortPosts(cur.posts); }
function reorderLive(id){
  const sig = () => cur.posts.map(p => p.id + ':' + p.num).join(',');
  const before = sig();
  sortByDate();
  if(sig() === before) return;
  render(true);
  const card = document.querySelector(`[data-card="${id}"]`);
  if(card){
    card.classList.add('moved');
    card.scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(() => card.classList.remove('moved'), 1600);
    document.getElementById('cap-' + id)?.focus({ preventScroll:true });
  }
}
async function save(){
  if(saving || !dirty || !cur) return;
  cur.posts.forEach(p => { p.num = String(p.num || '').trim(); p.videoUrl = (p.videoUrl || '').trim(); });
  sortByDate();
  cur.client = cur.client.replace(/\s+/g, ' ').trim(); cur.period = cur.period.trim();
  if(!cur.clientId){ const m = clientByKey(clientKey(cur.client)); if(m){ cur.clientId = m.id; cur.client = m.name; } }
  if(!cur.clientId){ toast(cur.client ? 'Escolha o cliente na lista ou clique em “Cadastrar”.' : 'Escolha o cliente antes de salvar.', true); document.getElementById('f-client')?.focus(); showCombo(); return; }
  const cli = clientById(cur.clientId); if(cli) cur.client = cli.name;
  const need = excessFor(cur);
  if(need && !pruneChoice){
    const options = clientSiblings(cur);
    pruneAsk = { need, options, selected: new Set(options.slice(-need).map(r => r.id)) };
    render(true);
    return;
  }
  saving = true; paintStatus();
  try {
    const prune = need ? (pruneChoice || []).map(id => index.find(r => r.id === id)).filter(Boolean) : [];
    pruneChoice = null;
    const uploads = [...pending.entries()];
    let done = 0;
    for(const [path, blob] of uploads){
      done++;
      const label = pct => { const st = document.getElementById('st-t'); if(st) st.textContent = `Enviando arquivos… ${done} de ${uploads.length}${pct != null && blob.size > 2e6 ? ` · ${Math.round(pct * 100)}%` : ''}`; };
      label(null);
      await uploadBlob(path, blob, label);
      pending.delete(path);
    }
    const media = mediaOf(cur);
    const body = structuredClone(cur);
    delete body.id; delete body.client; delete body.period; delete body.createdAt; delete body.clientId; delete body.brandInfo;
    const row = {
      id: cur.id, client: cur.client, client_key: clientKey(cur.client), client_slug: cli?.slug || clientSlug(cur.client), client_id: cur.clientId,
      period: cur.period, created_at: cur.createdAt, updated_at: new Date().toISOString(),
      post_count: cur.posts.length, media_bytes: media.reduce((s,m) => s + (cur.sizes[m] || 0), 0), data: body
    };
    const { error: upErr } = await sb.from('plans').upsert(row);
    if(upErr) throw upErr;
    if(removed.size){ await removeFiles([...removed]); removed.clear(); }
    for(const r of prune){
      await sb.from('plans').delete().eq('id', r.id);
      await removePlanFolder(r.id).catch(() => {});
    }
    const wasNew = isNew;
    dirty = false; isNew = false;
    if(wasNew) setPath(`/editar/${cur.id}`, true);
    await loadIndex();
    toast(prune.length ? `Salvo. ${prune.length > 1 ? 'Apagados' : 'Apagado'}: ${prune.map(r => r.period || fmtCreated(r.createdAt)).join(', ')}.` : 'Salvo. Os links do cliente já mostram esta versão.', false, prune.length ? 6000 : 3000);
    saving = false; render(true);
  } catch(err){
    toast(errMsg(err), true);
  } finally {
    saving = false; paintStatus();
  }
}
async function importPlan(file){
  if(!file) return;
  try {
    toast('Importando planejamento…', false, 60000);
    const pack = JSON.parse(await file.text());
    const plan = normalize(pack.plan || {});
    const media = pack.media || {};
    if(!plan.client) throw new Error('arquivo');
    const map = {}; plan.sizes = {};
    for(const [oldPath, dataUrl] of Object.entries(media)){
      const blob = await (await fetch(dataUrl)).blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = (MEDIA_BASE ? 'r2:' : '') + `${plan.id}/${uid()}.${ext}`;
      await uploadBlob(path, blob);
      map[oldPath] = path; plan.sizes[path] = blob.size;
    }
    const fix = p => (p && map[p]) || p;
    plan.logo = fix(plan.logo);
    plan.posts.forEach(x => { x.images = x.images.map(fix); x.cover = fix(x.cover); x.video = fix(x.video); });
    delete plan.bundled; delete plan.bundleBytes; delete plan.shortLink;
    const m = mediaOf(plan);
    const body = structuredClone(plan); delete body.id; delete body.client; delete body.period; delete body.createdAt;
    const { error } = await sb.from('plans').upsert({
      id: plan.id, client: plan.client, client_key: clientKey(plan.client), client_slug: clientSlug(plan.client),
      period: plan.period, created_at: plan.createdAt, updated_at: new Date().toISOString(),
      post_count: plan.posts.length, media_bytes: m.reduce((s,k) => s + (plan.sizes[k] || 0), 0), data: body
    });
    if(error) throw error;
    await loadIndex();
    toast(`Planejamento de ${plan.client} importado.`);
  } catch(err){
    toast(err?.message === 'arquivo' ? 'Esse arquivo não é um planejamento exportado.' : errMsg(err), true);
  }
}
async function deletePlan(id){
  const r = index.find(x => x.id === id); if(!r) return;
  try {
    const { error } = await sb.from('plans').delete().eq('id', id);
    if(error) throw error;
    await removePlanFolder(id).catch(() => {});
    toast(`Planejamento de ${r.client || 'cliente sem nome'} excluído.`);
    await loadIndex();
  } catch(err){ toast(errMsg(err), true); }
}
async function showClientPlan(fn, arg){
  const { data, error } = await sb.rpc(fn, fn === 'get_plan' ? { p_id: arg } : { p_slug: arg });
  if(error || !data){ cur = null; view = 'none'; render(false); return; }
  cur = rowToPlan(data); view = 'client'; render(false);
}

/* ---------- Trello ---------- */
let trelloArm = false, trelloBusy = false, trelloProgress = null;
function paintTrelloProgress(){
  const el = document.getElementById('trello-prog'); if(!el || !trelloProgress) return;
  const { done, total } = trelloProgress;
  el.querySelector('i').style.width = Math.round(done / total * 100) + '%';
  el.querySelector('span').textContent = `Enviando para o Trello… ${done} de ${total}`;
}
function trelloCardsOf(P){ return P.trello?.cards || {}; }
function trelloBox(P){
  const cards = trelloCardsOf(P);
  const linked = P.posts.filter(p => cards[p.id]).length;
  const approved = P.trello?.approvedAt;
  const n = P.posts.length;
  let action;
  if(trelloBusy) action = `<div class="tprog" id="trello-prog"><span>Enviando para o Trello… ${trelloProgress?.done || 0} de ${trelloProgress?.total || n}</span><div class="bar"><i style="width:${trelloProgress ? Math.round(trelloProgress.done / trelloProgress.total * 100) : 0}%"></i></div></div>`;
  else if(trelloArm) action = `<button class="sbtn dark" data-a="trello-go">${approved ? `Atualizar ${n} card${n === 1 ? '' : 's'}` : `Criar ${n} card${n === 1 ? '' : 's'} em PUBLICAR/AGENDAR`}</button><button class="lnk" data-a="trello-cancel">Cancelar</button>`;
  else action = `<button class="sbtn ${approved ? '' : 'dark'}" data-a="trello-arm" ${n ? '' : 'disabled'}>${approved ? 'Atualizar cards no Trello' : 'Cliente aprovou → criar cards no Trello'}</button>`;
  return `<div class="trello-box">
    <div class="trello-txt">${approved
      ? `<b>✓ Aprovado em ${esc(fmtCreated(approved).split(' · ')[0])}</b><span>${linked} de ${n} conteúdo${n === 1 ? '' : 's'} com card no Trello${linked < n ? ' · os que faltam são criados ao atualizar' : ''}.</span>`
      : `<b>Aprovação</b><span>Quando o cliente aprovar, crie um card por conteúdo no quadro Elev, com a data de publicação como entrega.</span>`}</div>
    <div class="trello-act">${action}</div>
  </div>`;
}
function trelloCardName(P, p){ return `${(P.client || '').toUpperCase()} ${p.num ? pad(p.num) : '–'} ${TYPES[p.type].toUpperCase()}`; }
function trelloDesc(P, p){
  const parts = [];
  if(p.caption) parts.push(p.caption.trim());
  if(p.script) parts.push('**Roteiro**\n' + p.script.trim());
  if(p.videoUrl) parts.push('Vídeo: ' + p.videoUrl);
  parts.push('---\nPlanejamento: ' + linkFor(P.id));
  return parts.join('\n\n');
}
function absUrl(path){ const u = src(path); return /^https:\/\//.test(u) ? u : ''; }
async function sendToTrello(){
  if(!cur || trelloBusy) return;
  if(dirty){ toast('Salve as alterações antes de mandar para o Trello.', true); return; }
  trelloBusy = true; trelloArm = false; render(true);
  try {
    const known = trelloCardsOf(cur);
    const cards = sortPosts(cur.posts).map(p => ({
      postId: p.id, cardId: known[p.id]?.id || null,
      name: trelloCardName(cur, p), desc: trelloDesc(cur, p),
      due: p.date ? `${p.date}T15:00:00.000Z` : null
    }));
    // Lotes de 5; do último para o primeiro, para os cards novos ficarem no topo na ordem certa.
    const batches = [];
    for(let i = 0; i < cards.length; i += 5) batches.push(cards.slice(i, i + 5));
    const map = Object.assign({}, known);
    let ok = 0, created = 0, listName = 'PUBLICAR/AGENDAR', stopErr = null; const fails = [];
    trelloProgress = { done: 0, total: cards.length }; render(true);
    for(const b of batches.reverse()){
      try {
        const res = await mediaApi('/trello/cards', { cards: b });
        if(res.error) throw new Error(res.error);
        listName = res.list || listName;
        for(const r of res.results || []){ if(r.ok){ map[r.postId] = { id: r.cardId, url: r.url }; ok++; if(r.created) created++; } else fails.push(r.error); }
      } catch(e){ stopErr = e; break; }
      trelloProgress.done += b.length; paintTrelloProgress();
    }
    trelloProgress = null;
    const res = { list: listName };
    const first = !cur.trello?.approvedAt;
    cur.trello = { approvedAt: cur.trello?.approvedAt || new Date().toISOString(), cards: map };
    dirty = true; trelloBusy = false;
    await save();
    if(stopErr) toast(`${ok} card${ok === 1 ? '' : 's'} enviado${ok === 1 ? '' : 's'}, mas o envio parou. Clique em Atualizar para continuar. Detalhe: ${String(stopErr.message || stopErr).slice(0, 140)}`, true, 12000);
    else if(fails.length) toast(`${ok} card${ok === 1 ? '' : 's'} ok, ${fails.length} com erro. Detalhe: ${fails[0]}`, true, 12000);
    else { const upd = ok - created; toast(`Pronto no Trello (${res.list}): ${[created ? `${created} criado${created === 1 ? '' : 's'}` : '', upd ? `${upd} atualizado${upd === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.`, false, 6000); }
  } catch(err){
    trelloBusy = false; render(true);
    toast('Não foi possível falar com o Trello. Detalhe: ' + String(err?.message || err).slice(0, 160), true, 12000);
  }
}

/* ---------- clientes ---------- */
let clients = [], clientsReady = false, migrating = false;
let clientEdit = null;   // estado da janela de cadastro/edição de cliente
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = h => { h = String(h || '').trim().replace(/^#/, ''); if(h.length === 3) h = h.split('').map(c => c + c).join(''); return '#' + h.toLowerCase(); };
const clientById = id => clients.find(c => c.id === id) || null;
const clientByKey = key => clients.find(c => c.name_key === key) || null;
function inkOn(hex){
  const n = parseInt(normHex(hex).slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  return (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) > 0.45 ? '#141413' : '#ffffff';
}
function brandVars(colors){
  const c = (colors || []).filter(x => HEX_RE.test(x)).map(normHex);
  if(!c.length) return '';
  return `--brand:${c[0]};--brand2:${c[1] || c[0]};--brand-ink:${inkOn(c[0])};`;
}
// Logo e cores que valem para um planejamento (na página do cliente vêm junto do planejamento).
function brandOf(P){
  const info = P.brandInfo || clientById(P.clientId) || null;
  return { logo: info?.logo || P.logo || null, colors: (info?.colors || []), name: info?.name || P.client };
}
function brandStyle(P){
  if(P.useBrand === false) return '';
  return brandVars(brandOf(P).colors);
}
function uniqueSlug(name, exceptId){
  const base = clientSlug(name); let s = base, i = 2;
  while(clients.some(c => c.slug === s && c.id !== exceptId)) s = `${base}-${i++}`;
  return s;
}
async function loadClients(){
  const { data, error } = await sb.from('clients').select('*').order('name');
  if(!error) clients = data || [];
  clientsReady = !error;
  if(view === 'clients') render(true);
}
// Cadastra automaticamente os clientes dos planejamentos antigos (feitos antes do cadastro existir).
async function migrateClients(){
  if(migrating || !clientsReady || !indexReady) return;
  const orphans = index.filter(r => !r.clientId && r.clientKey);
  if(!orphans.length) return;
  migrating = true;
  try {
    const groups = {};
    orphans.forEach(r => (groups[r.clientKey] = groups[r.clientKey] || []).push(r));
    for(const [key, rows] of Object.entries(groups)){
      let c = clientByKey(key);
      if(!c){
        const latest = rows[0];
        c = { id: 'c' + rand(21), name: latest.client, name_key: key, slug: uniqueSlug(latest.client), logo: null, colors: [] };
        try {
          const { data } = await sb.from('plans').select('data').eq('id', latest.id).maybeSingle();
          const old = data?.data?.logo;
          if(old){
            const blob = await (await fetch(src(old))).blob();
            const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
            const path = (MEDIA_BASE ? 'r2:' : '') + `${c.id}/${uid()}.${ext}`;
            await uploadBlob(path, blob); c.logo = path;
          }
        } catch(e){}
        const { error } = await sb.from('clients').insert(c);
        if(error) continue;
        clients.push(c);
      }
      await sb.from('plans').update({ client_id: c.id, client_slug: c.slug }).in('id', rows.map(r => r.id));
    }
    await loadClients();
    await loadIndex(true);
  } finally { migrating = false; }
}
function planCountOf(clientId){ return index.filter(r => r.clientId === clientId).length; }

/* tela de clientes */
function clientsPage(){
  return `<section class="list"><div class="wrap">
    <div class="backrow"><button class="backbtn" data-a="go-home">← Início</button></div>
    <div class="list-head">
      <div><p class="lbl">Cadastro</p><h1>${clientsReady ? `${clients.length} cliente${clients.length === 1 ? '' : 's'}` : 'Carregando…'}</h1></div>
      <button class="abtn" data-a="client-new"><span class="plus">+</span>Novo cliente</button>
    </div>
    ${clients.length ? `<div class="cgrid">${clients.map(c => `<button class="ccard" data-a="client-edit" data-id="${esc(c.id)}">
        <span class="ccard-logo">${c.logo ? `<img src="${esc(src(c.logo))}" alt="">` : `<b>${esc((c.name || '?').slice(0,1).toUpperCase())}</b>`}</span>
        <span class="ccard-txt"><b>${esc(c.name)}</b><small>${planCountOf(c.id)} planejamento${planCountOf(c.id) === 1 ? '' : 's'} · /${esc(c.slug)}</small></span>
        <span class="sw">${(c.colors || []).map(x => `<i style="background:${esc(normHex(x))}"></i>`).join('')}</span>
      </button>`).join('')}</div>`
      : `<div class="empty-list"><span>${clientsReady ? 'Nenhum cliente cadastrado ainda.' : 'Carregando…'}</span></div>`}
  </div></section>`;
}

/* janela de cadastro */
function openClientModal(c, opts = {}){
  clientEdit = {
    id: c?.id || null, name: c?.name || opts.name || '', logo: c?.logo || null, logoPending: null, logoUrl: null,
    colors: [...(c?.colors || [])].map(normHex), slug: c?.slug || '', fromPlan: !!opts.fromPlan, delArm: false, saving: false
  };
  render(true);
  requestAnimationFrame(() => document.getElementById('c-name')?.focus());
}
const COLOR_ROLES = ['Detalhes, etiquetas e botões', 'Fundo do cabeçalho', 'Referência', 'Referência', 'Referência'];
function clientModal(){
  const e = clientEdit;
  const n = e.id ? planCountOf(e.id) : 0;
  const slug = e.id ? e.slug : (e.name ? uniqueSlug(e.name) : '');
  return `<div class="modal-bg" data-a="cm-bg"><div class="modal cmodal" role="dialog" aria-modal="true" aria-labelledby="cm-t">
    <div class="mhead"><div><p class="lbl">${e.id ? 'Editar cliente' : 'Novo cliente'}</p><h3 id="cm-t">${esc(e.name || 'Cliente')}</h3></div><button class="ibtn" data-a="cm-close" aria-label="Fechar">✕</button></div>
    <div class="cm-grid">
      <div class="cm-form">
        <div class="fld"><label class="lbl" for="c-name">Nome</label><input class="inp" id="c-name" value="${esc(e.name)}" autocomplete="off"></div>
        <div class="fld"><span class="lbl">Logo ou ícone</span>
          <div class="cm-logo-row">
            <label class="drop cm-logo">${e.logoUrl || e.logo ? `<img src="${esc(e.logoUrl || src(e.logo))}" alt="">` : '<span>Arraste ou <strong>escolha</strong></span>'}<input type="file" accept="image/*" data-up="clogo" id="up-clogo"></label>
            ${e.logoUrl || e.logo ? `<button class="lnk danger" data-a="cm-rmlogo">Remover</button>` : '<span class="hint">PNG com fundo transparente fica melhor.</span>'}
          </div>
        </div>
        <div class="fld"><span class="lbl">Cores (até 5)</span>
          <div class="crows" id="crows">${e.colors.map((x,i) => colorRow(x,i)).join('')}</div>
          ${e.colors.length < 5 ? `<button class="sbtn" data-a="cm-addcolor" style="align-self:flex-start">+ Adicionar cor</button>` : ''}
          <p class="hint">Clique no quadrado para escolher na roda de cores, ou digite o código (ex.: #1E5BB8).</p>
        </div>
        ${slug ? `<p class="hint">Link fixo: <code>${esc(location.host)}/${esc(slug)}</code>${e.id ? '' : ' (criado ao salvar)'}</p>` : ''}
      </div>
      <div class="cm-prev"><span class="lbl">Como o cliente vai ver</span><div id="bp">${brandPreview()}</div></div>
    </div>
    <div class="mfoot">
      ${e.id ? (n ? `<span class="hint">Tem ${n} planejamento${n === 1 ? '' : 's'}; para excluir o cliente, apague os planejamentos antes.</span>` : `<button class="sbtn" data-a="cm-delete">${e.delArm ? 'Confirmar exclusão' : 'Excluir cliente'}</button>`) : ''}
      <span style="flex:1"></span>
      <button class="sbtn" data-a="cm-close">Cancelar</button>
      <button class="sbtn dark" data-a="cm-save" ${e.saving ? 'disabled' : ''}>${e.saving ? 'Salvando…' : 'Salvar cliente'}</button>
    </div>
  </div></div>`;
}
function colorRow(x, i){
  return `<div class="crow">
    <input type="color" class="cpick" data-ci="${i}" value="${esc(normHex(x))}" aria-label="Escolher cor ${i + 1}">
    <input class="inp chex" data-ch="${i}" value="${esc(normHex(x).toUpperCase())}" maxlength="7" aria-label="Código da cor ${i + 1}">
    <span class="crole"><b>Cor ${i + 1}</b>${COLOR_ROLES[i]}</span>
    <button class="ibtn" data-a="cm-rmcolor" data-i="${i}" aria-label="Remover cor ${i + 1}">✕</button>
  </div>`;
}
function brandPreview(){
  const e = clientEdit;
  const vars = brandVars(e.colors);
  const logo = e.logoUrl || (e.logo ? src(e.logo) : '');
  return `<div class="bp ${vars ? 'branded' : ''}" style="${vars}">
    <div class="bp-hero"><span class="bp-logo">${logo ? `<img src="${esc(logo)}" alt="">` : ''}</span><span><small>PLANEJAMENTO DE CONTEÚDO</small><b>${esc(e.name || 'Nome do cliente')}</b><em>${esc(MONTHS[new Date().getMonth()])}</em></span></div>
    <div class="bp-body">
      <div class="bp-meta"><span class="bp-num">Nº 01</span><span class="chip reels"><i></i>Reels</span></div>
      <div class="bp-card"><div class="bp-img"></div><div class="bp-lines"><i></i><i></i><i style="width:60%"></i></div></div>
      <div class="bp-watch"><span class="play"></span>Assistir vídeo</div>
    </div>
    <div class="bp-legend">${e.colors.length ? e.colors.map((x,i) => `<span><i style="background:${esc(normHex(x))}"></i>${i < 2 ? COLOR_ROLES[i] : 'Guardada para referência'}</span>`).join('') : '<span>Sem cores: a página usa o padrão Elev.</span>'}</div>
  </div>`;
}
function refreshPreview(){ const el = document.getElementById('bp'); if(el) el.innerHTML = brandPreview(); }
async function saveClient(){
  const e = clientEdit; if(!e || e.saving) return;
  e.name = (document.getElementById('c-name')?.value || e.name).replace(/\s+/g, ' ').trim();
  if(!e.name){ toast('Preencha o nome do cliente.', true); return; }
  const key = clientKey(e.name);
  const dup = clients.find(c => c.name_key === key && c.id !== e.id);
  if(dup){ toast(`Já existe um cliente chamado ${dup.name}.`, true); return; }
  e.saving = true; render(true);
  try {
    const id = e.id || ('c' + rand(21));
    const old = e.id ? clientById(e.id) : null;
    let logo = e.logo;
    if(e.logoPending){
      const path = (MEDIA_BASE ? 'r2:' : '') + `${id}/${uid()}.${e.logoPending.ext}`;
      try { await uploadBlob(path, e.logoPending.blob); }
      catch(err){ err.step = 'ao enviar a logo'; throw err; }
      logo = path;
    }
    const row = { id, name: e.name, name_key: key, slug: e.id ? e.slug : uniqueSlug(e.name), logo, colors: e.colors.filter(x => HEX_RE.test(x)).map(normHex), updated_at: new Date().toISOString() };
    const { error } = await sb.from('clients').upsert(row);
    if(error){ error.step = 'ao gravar no banco de dados'; throw error; }
    if(old?.logo && old.logo !== logo) removeFiles([old.logo]).catch(() => {});
    if(old && old.name !== row.name) await sb.from('plans').update({ client: row.name, client_key: key }).eq('client_id', id);
    await loadClients();
    if(e.fromPlan && cur){ cur.clientId = id; cur.client = row.name; markDirty(); }
    clientEdit = null;
    if(old && old.name !== row.name) await loadIndex();
    toast(`Cliente ${row.name} salvo.`);
    render(true);
  } catch(err){
    e.saving = false; render(true);
    const detail = String(err?.message || err || '').slice(0, 120);
    toast(/duplicate|unique/i.test(detail) ? 'Já existe um cliente com esse nome ou link.' : `Não foi possível salvar o cliente${err?.step ? ' ' + err.step : ''}. Detalhe: ${detail}`, true, 15000);
    console.error('saveClient', err);
  }
}
async function deleteClient(){
  const e = clientEdit; if(!e?.id || planCountOf(e.id)) return;
  try {
    const { error } = await sb.from('clients').delete().eq('id', e.id);
    if(error) throw error;
    await removePlanFolder(e.id).catch(() => {});
    clientEdit = null; await loadClients(); toast('Cliente excluído.'); render(true);
  } catch(err){ toast(errMsg(err), true); }
}

/* seletor de cliente no planejamento */
function comboItems(q){
  const k = clientKey(q);
  const list = clients.filter(c => !k || c.name_key.includes(k)).slice(0, 8);
  const exact = clients.some(c => c.name_key === k);
  return list.map(c => `<button class="combo-opt" data-a="pick-client" data-id="${esc(c.id)}"><span class="ccard-logo sm">${c.logo ? `<img src="${esc(src(c.logo))}" alt="">` : `<b>${esc(c.name.slice(0,1).toUpperCase())}</b>`}</span>${esc(c.name)}<span class="sw">${(c.colors || []).slice(0,5).map(x => `<i style="background:${esc(normHex(x))}"></i>`).join('')}</span></button>`).join('')
    + (q.trim() && !exact ? `<button class="combo-opt add" data-a="new-client-from">+ Cadastrar “${esc(q.trim())}”</button>` : '')
    + (!list.length && !q.trim() ? `<div class="combo-empty">Nenhum cliente cadastrado. Digite o nome para cadastrar.</div>` : '');
}
function showCombo(){
  const box = document.getElementById('combo-list'), inp = document.getElementById('f-client');
  if(!box || !inp) return;
  box.innerHTML = comboItems(inp.value); box.hidden = false;
}
function hideCombo(){ const box = document.getElementById('combo-list'); if(box) box.hidden = true; }

/* ---------- rotas ---------- */
async function route(){
  const parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if(parts[0] === 'p' && parts[1]) return showClientPlan('get_plan', parts[1]);
  if(parts.length === 1 && !RESERVED.has(parts[0])) return showClientPlan('get_latest_plan', parts[0].toLowerCase());
  if(!session){ view = 'login'; loginErr = ''; render(false); requestAnimationFrame(() => document.getElementById('l-email')?.focus()); return; }
  if(!indexReady) loadIndex();
  if(!clientsReady) loadClients().then(() => migrateClients());
  if(parts[0] === 'novo') return startNew();
  if(parts[0] === 'editar' && parts[1]) return openPlan(parts[1], true);
  if(parts[0] === 'planejamentos'){ view = 'list'; return render(false); }
  if(parts[0] === 'clientes'){ view = 'clients'; return render(false); }
  setPath('/', true); view = 'home'; render(false);
}
async function boot(){
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /COLE_AQUI/.test(cfg.SUPABASE_ANON_KEY)){
    app.innerHTML = topBar(false) + `<div class="wrap center-msg"><b>Falta configurar o Supabase</b><span>Preencha o arquivo config.js com a URL e a chave pública do projeto.</span></div>`;
    return;
  }
  render(false);
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((event, s) => {
    const was = !!session; session = s;
    if(event === 'SIGNED_IN' && !was){ indexReady = false; route(); }
    if(event === 'SIGNED_OUT'){ index = []; indexReady = false; clients = []; clientsReady = false; resetWork(); cur = null; setPath('/', true); route(); }
  });
  route();
}
boot();
})();
