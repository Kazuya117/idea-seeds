'use strict';
/* アイデアの種 — 思いつきの段階で出せるアイデア共有の場
   データは Supabase に保存。誰が何をできるかはデータベース側（行レベルセキュリティ）で守っている。
   下のキーは公開用（publishable）で、ページに含めてよい種類のもの。 */
const VERSION = 1;
const SB_URL = 'https://lotmxestisnibdyfemdk.supabase.co';
const SB_KEY = 'sb_publishable_Y0Vyfl28HOGzRdj_t5dr4g_b_xIrP3K';
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const STAMPS = [
  { kind: 'like', ico: '👍', label: 'いいね' },
  { kind: 'join', ico: '🙌', label: '一緒にやりたい' },
  { kind: 'help', ico: '🤝', label: '手伝えるよ' },
  { kind: 'more', ico: '👂', label: 'もっと聞きたい' },
];
const STAGES = ['🌰 種', '🌱 芽', '🌷 つぼみ', '🌸 花'];
const REASONS = ['悪口・いやがらせ', '個人が分かる情報', '不適切な内容', 'その他'];
const IDEA_SELECT = 'id, what, for_whom, hidden, created_at, author_id, author:profiles!ideas_author_id_fkey(nickname), reactions(kind, user_id), steps(id, body, done_at, created_at)';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let user = null;      // ログイン中のアカウント
let me = null;        // 自分のプロフィール { id, nickname, role }
let ideas = [];       // 一覧に出すアイデア
let view = 'feed';
let openMenu = null;  // メニューを開いているアイデアのid
let editing = null;   // 書き直し中のアイデアのid

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}
/* データベースからのエラーを、利用者向けの言葉にする */
function explain(error) {
  const m = (error && error.message) || '';
  if (/投稿は1日5件まで|管理者だけ/.test(m)) return m;
  if (error && error.code === '23505') return 'すでに登録されています';
  if (error && error.code === '23514') return '文字数を確認してください';
  if (error && (error.code === '42501' || /row-level security/.test(m))) return 'この操作はできません';
  if (/Failed to fetch|NetworkError/i.test(m)) return '通信できませんでした。電波を確認してください';
  return 'うまくいきませんでした。少し待ってもう一度試してください';
}
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}日前`;
  const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`;
}
const doneCount = (i) => (i.steps || []).filter((s) => s.done_at).length;
const stageOf = (i) => STAGES[Math.min(doneCount(i), 3)];
const sortedSteps = (i) => [...(i.steps || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));

/* ---------- 画面の出し分け ---------- */
function screen(name) {
  ['boot', 'login', 'nick', 'app'].forEach((id) => ($('#' + id).hidden = id !== name));
}
function show(v) {
  view = v; openMenu = null; editing = null;
  $$('.view').forEach((el) => (el.hidden = el.id !== `view-${v}`));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  window.scrollTo(0, 0);
  if (v === 'feed' || v === 'mine') refresh();
  if (v === 'mod') loadMod();
  if (v === 'me') { $('#me-name').textContent = me.nickname; $('#me-nick').value = me.nickname; }
}

/* ---------- ログイン ---------- */
$('#login-btn').addEventListener('click', async () => {
  $('#login-btn').disabled = true;
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
  if (error) { $('#login-btn').disabled = false; loginError(explain(error)); }
});
function loginError(msg) { const e = $('#login-error'); e.textContent = msg; e.hidden = false; }
$('#logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); });

/* ログインに失敗して戻ってきたとき（学校以外のアカウントなど） */
function readAuthError() {
  const p = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
  const desc = p.get('error_description');
  if (!desc && !p.get('error')) return;
  history.replaceState(null, '', location.pathname);
  loginError(/Database error|学校のメール/.test(desc || '')
    ? 'このアカウントでは使えません。学校のGoogleアカウント（@mita-is.ed.jp）でログインしてください。'
    : 'ログインできませんでした。もう一度試してください。');
}

async function onSession(session) {
  user = session ? session.user : null;
  if (!user) { me = null; ideas = []; screen('login'); $('#login-btn').disabled = false; return; }
  const { data, error } = await sb.from('profiles').select('id, nickname, role').eq('id', user.id).maybeSingle();
  if (error || !data) { screen('login'); loginError('利用者情報を読み込めませんでした。もう一度ログインしてください。'); return; }
  me = data;
  $('#tab-mod').hidden = me.role !== 'moderator';
  if (!me.nickname) { screen('nick'); return; }
  screen('app'); show('feed');
}

/* ---------- ニックネーム ---------- */
async function saveNick(value, errEl) {
  const nickname = value.trim();
  if (nickname.length < 2 || nickname.length > 20) { if (errEl) { errEl.textContent = '2〜20文字で入力してください'; errEl.hidden = false; } else toast('2〜20文字で入力してください'); return false; }
  const { error } = await sb.from('profiles').update({ nickname }).eq('id', user.id);
  if (error) {
    const msg = error.code === '23505' ? 'そのニックネームは使われています' : explain(error);
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; } else toast(msg);
    return false;
  }
  me.nickname = nickname; return true;
}
$('#nick-save').addEventListener('click', async () => {
  if (await saveNick($('#nick-input').value, $('#nick-error'))) { screen('app'); show('feed'); }
});
$('#me-save').addEventListener('click', async () => {
  if (await saveNick($('#me-nick').value)) { $('#me-name').textContent = me.nickname; toast('ニックネームを変更しました'); }
});

/* ---------- 読み込み ---------- */
async function refresh() {
  const { data, error } = await sb.from('ideas').select(IDEA_SELECT).order('created_at', { ascending: false }).limit(100);
  if (error) { toast(explain(error)); return; }
  ideas = data || [];
  render();
}
function render() {
  if (view === 'feed') {
    const list = ideas.filter((i) => !i.hidden);
    $('#feed').innerHTML = list.length ? list.map((i) => ideaCard(i)).join('')
      : '<p class="empty">まだ種がありません。<br>最初のひとつを、蒔いてみませんか。</p>';
  }
  if (view === 'mine') {
    const list = ideas.filter((i) => i.author_id === user.id);
    $('#mine').innerHTML = list.length ? list.map((i) => mineCard(i)).join('')
      : '<p class="empty">まだ自分の種がありません。<br>「種をまく」から始められます。</p>';
  }
}

/* ---------- みんなの種 ---------- */
function ideaCard(i) {
  const mine = i.author_id === user.id;
  const next = sortedSteps(i).find((s) => !s.done_at);
  const stamps = STAMPS.map((s) => {
    const rs = (i.reactions || []).filter((r) => r.kind === s.kind);
    const on = rs.some((r) => r.user_id === user.id);
    return `<button class="stamp ${on ? 'on' : ''}" data-act="stamp" data-kind="${s.kind}" aria-pressed="${on}">${s.ico} ${s.label} <b>${rs.length || ''}</b></button>`;
  }).join('');
  let menu = '';
  if (openMenu === i.id) {
    menu = '<div class="menu">';
    if (!mine) menu += '<p>通報する理由を選んでください</p>' + REASONS.map((r) => `<button class="ghost warn" data-act="report" data-reason="${esc(r)}">${esc(r)}</button>`).join('');
    if (mine) menu += '<button class="ghost warn" data-act="delete">この種を消す</button>';
    if (me.role === 'moderator' && !mine) menu += '<button class="ghost warn" data-act="hide">非表示にする（管理）</button>';
    menu += '</div>';
  }
  return `<article class="card" data-id="${i.id}">
    <div class="idea-top"><span class="stage">${stageOf(i)}</span><span>${esc(i.author ? i.author.nickname : '')}${mine ? '（自分）' : ''}</span><span class="sp"></span><span>${ago(i.created_at)}</span></div>
    <p class="what">${esc(i.what)}</p>
    <p class="whom"><b>だれのために：</b>${esc(i.for_whom)}</p>
    ${next ? `<p class="step-now">👣 いまの一歩：${esc(next.body)}</p>` : ''}
    <div class="stamps">${stamps}</div>
    <button class="more" data-act="menu">${mine ? 'この種を消す…' : '通報する…'}</button>
    ${menu}
  </article>`;
}

/* ---------- じぶんの畑 ---------- */
function mineCard(i) {
  const total = (i.reactions || []).length;
  const joins = (i.reactions || []).filter((r) => r.kind === 'join' || r.kind === 'help').length;
  const steps = sortedSteps(i).map((s) => `<li class="${s.done_at ? 'done' : ''}" data-step="${s.id}">
      <button class="check" data-act="toggle" aria-label="${s.done_at ? '未達成に戻す' : '達成にする'}">✓</button>
      <span>${esc(s.body)}</span><button class="x" data-act="delstep" aria-label="この一歩を消す">×</button></li>`).join('');
  const body = editing === i.id
    ? `<label>なにを？</label><textarea class="e-what" maxlength="140" rows="3">${esc(i.what)}</textarea>
       <label>だれのために？</label><textarea class="e-whom" maxlength="140" rows="2">${esc(i.for_whom)}</textarea>
       <div class="row"><button class="ghost" data-act="save">保存</button><button class="ghost" data-act="cancel">やめる</button></div>`
    : `<p class="what">${esc(i.what)}</p><p class="whom"><b>だれのために：</b>${esc(i.for_whom)}</p>`;
  return `<article class="card ${i.hidden ? 'dim' : ''}" data-id="${i.id}">
    <div class="idea-top"><span class="stage">${stageOf(i)}</span>${i.hidden ? '<span class="badge">確認中のため非表示</span>' : ''}<span class="sp"></span><span>応援 ${total}${joins ? `（仲間候補 ${joins}）` : ''}</span></div>
    ${body}
    <ul class="steps">${steps}</ul>
    <div class="row"><input class="step-input" maxlength="100" placeholder="小さな一歩（例：先生に1人だけ聞いてみる）"><button class="ghost" data-act="addstep">追加</button></div>
    ${editing === i.id ? '' : '<div class="menu"><button class="ghost" data-act="edit">書き直す</button><button class="ghost warn" data-act="delete">消す</button></div>'}
  </article>`;
}

/* ---------- カード内の操作 ---------- */
async function onCardClick(e) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('[data-id]'); const id = card.dataset.id;
  const idea = ideas.find((i) => i.id === id);
  const act = btn.dataset.act;
  let res = null;

  if (act === 'menu') { openMenu = openMenu === id ? null : id; return render(); }
  if (act === 'edit') { editing = id; return render(); }
  if (act === 'cancel') { editing = null; return render(); }

  if (act === 'stamp') {
    const kind = btn.dataset.kind;
    const on = (idea.reactions || []).some((r) => r.kind === kind && r.user_id === user.id);
    res = on
      ? await sb.from('reactions').delete().match({ idea_id: id, user_id: user.id, kind })
      : await sb.from('reactions').insert({ idea_id: id, kind });
  } else if (act === 'report') {
    res = await sb.from('reports').insert({ idea_id: id, reason: btn.dataset.reason });
    if (res.error && res.error.code === '23505') { openMenu = null; render(); return toast('この投稿はすでに通報済みです'); }
    if (!res.error) toast('通報しました。管理チームが確認します');
    openMenu = null;
  } else if (act === 'delete') {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'もう一度押すと消えます'; return; }
    res = await sb.from('ideas').delete().eq('id', id);
    if (!res.error) toast('消しました');
  } else if (act === 'hide') {
    res = await sb.rpc('set_idea_hidden', { p_idea_id: id, p_hidden: true });
    if (!res.error) toast('非表示にしました');
  } else if (act === 'save') {
    const what = card.querySelector('.e-what').value.trim(), for_whom = card.querySelector('.e-whom').value.trim();
    if (!what || !for_whom) return toast('2つとも書いてください');
    res = await sb.from('ideas').update({ what, for_whom }).eq('id', id);
    if (!res.error) { editing = null; toast('書き直しました'); }
  } else if (act === 'addstep') {
    const input = card.querySelector('.step-input'); const body = input.value.trim();
    if (!body) return toast('一歩をひとこと書いてください');
    res = await sb.from('steps').insert({ idea_id: id, body });
    if (!res.error) toast('一歩を決めました。小さくて大丈夫');
  } else if (act === 'toggle' || act === 'delstep') {
    const stepId = btn.closest('[data-step]').dataset.step;
    const step = idea.steps.find((s) => s.id === stepId);
    if (act === 'delstep') res = await sb.from('steps').delete().eq('id', stepId);
    else {
      res = await sb.from('steps').update({ done_at: step.done_at ? null : new Date().toISOString() }).eq('id', stepId);
      if (!res.error && !step.done_at) toast(doneCount(idea) < 3 ? `一歩すすみました。${STAGES[doneCount(idea) + 1]} に育ちました` : '一歩すすみました');
    }
  }
  if (res && res.error) toast(explain(res.error));
  await refresh();
}
$('#feed').addEventListener('click', onCardClick);
$('#mine').addEventListener('click', onCardClick);

/* ---------- 種をまく ---------- */
[['#f-what', '#c-what'], ['#f-whom', '#c-whom']].forEach(([f, c]) =>
  $(f).addEventListener('input', () => ($(c).textContent = $(f).value.length)));
$('#post-btn').addEventListener('click', async () => {
  const what = $('#f-what').value.trim(), for_whom = $('#f-whom').value.trim();
  if (!what || !for_whom) return toast('2つとも、ひとことで大丈夫なので書いてください');
  $('#post-btn').disabled = true;
  const { error } = await sb.from('ideas').insert({ what, for_whom });
  $('#post-btn').disabled = false;
  if (error) return toast(explain(error));
  $('#f-what').value = ''; $('#f-whom').value = ''; $('#c-what').textContent = '0'; $('#c-whom').textContent = '0';
  toast('種をまきました。次は小さな一歩を決めよう');
  show('mine');
});

/* ---------- 管理（生徒チーム） ---------- */
async function loadMod() {
  const [rep, hid] = await Promise.all([
    sb.from('reports').select('id, reason, created_at, idea_id').eq('resolved', false).order('created_at', { ascending: false }),
    sb.from('ideas').select(IDEA_SELECT).eq('hidden', true).order('created_at', { ascending: false }),
  ]);
  if (rep.error || hid.error) return toast(explain(rep.error || hid.error));
  const byIdea = {};
  (rep.data || []).forEach((r) => (byIdea[r.idea_id] = byIdea[r.idea_id] || []).push(r));
  const ids = Object.keys(byIdea);
  let reported = [];
  if (ids.length) {
    const r = await sb.from('ideas').select(IDEA_SELECT).in('id', ids);
    reported = (r.data || []).filter((i) => !i.hidden);
  }
  const card = (i, hidden) => `<article class="card" data-id="${i.id}">
      <div class="idea-top"><span>${esc(i.author ? i.author.nickname : '')}</span><span class="sp"></span><span>${ago(i.created_at)}</span></div>
      <p class="what">${esc(i.what)}</p><p class="whom"><b>だれのために：</b>${esc(i.for_whom)}</p>
      ${(byIdea[i.id] || []).length ? `<p class="note">通報 ${byIdea[i.id].length}件：${esc([...new Set(byIdea[i.id].map((r) => r.reason))].join('、'))}</p>` : ''}
      <div class="menu">${hidden
        ? '<button class="ghost" data-mod="show">問題なし（再表示する）</button>'
        : '<button class="ghost" data-mod="show">問題なし（通報を解決）</button><button class="ghost warn" data-mod="hide">非表示にする</button>'}
        <button class="ghost warn" data-mod="delete">削除する</button></div></article>`;
  $('#mod').innerHTML =
    `<h2>通報された投稿（${reported.length}）</h2>` + (reported.map((i) => card(i, false)).join('') || '<p class="empty">ありません</p>') +
    `<h2>非表示の投稿（${(hid.data || []).length}）</h2>` + ((hid.data || []).map((i) => card(i, true)).join('') || '<p class="empty">ありません</p>');
}
$('#mod').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-mod]'); if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id; const act = btn.dataset.mod;
  let res;
  if (act === 'delete') {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'もう一度押すと削除'; return; }
    res = await sb.from('ideas').delete().eq('id', id);
  } else res = await sb.rpc('set_idea_hidden', { p_idea_id: id, p_hidden: act === 'hide' });
  toast(res.error ? explain(res.error) : '対応しました');
  loadMod();
});

/* ---------- 起動 ---------- */
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });
$('#ver').textContent = `バージョン ${VERSION}`;
readAuthError();
let lastUid;
sb.auth.onAuthStateChange((event, session) => {
  const uid = session ? session.user.id : null;
  if (event !== 'INITIAL_SESSION' && uid === lastUid) return; // トークン更新などでは描き直さない
  lastUid = uid;
  setTimeout(() => onSession(session), 0);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}
