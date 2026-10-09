'use strict';
/* アイデアの種 — 思いつきの段階で出せるアイデア共有の場
   データは Supabase に保存。誰が何をできるかはデータベース側（行レベルセキュリティ）で守っている。
   下のキーは公開用（publishable）で、ページに含めてよい種類のもの。 */
const VERSION = 2;
const SB_URL = 'https://lotmxestisnibdyfemdk.supabase.co';
const SB_KEY = 'sb_publishable_Y0Vyfl28HOGzRdj_t5dr4g_b_xIrP3K';
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const STAMPS = [
  { kind: 'like', ico: '👍', label: 'いいね' },
  { kind: 'join', ico: '🙌', label: '一緒にやりたい' },
  { kind: 'help', ico: '🤝', label: '手伝えるよ' },
  { kind: 'more', ico: '👂', label: 'もっと聞きたい' },
];
/* 成長の段階と、その段階になるのに必要な [水, 日光, 肥料]
   水＝自分が達成した一歩／日光＝いいね・もっと聞きたい／肥料＝一緒にやりたい・手伝えるよ（どちらも自分以外から） */
const STAGES = ['種', '発芽', '双葉', '若木', 'つぼみ', '開花', '実'];
const NEED = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 2, 0], [3, 3, 1], [4, 5, 2], [5, 8, 3]];
const PLANTS = {
  himawari: { name: 'ひまわり', petal: '#f5b921', center: '#7a4a1c', n: 14, pl: 15, pw: 5, cr: 9, fruit: '#5c3b1a', leaf: '#4f9a4f' },
  tulip:    { name: 'チューリップ', petal: '#e8506a', center: '#e8506a', shape: 'tulip', fruit: '#c9a23a', leaf: '#5aa862' },
  sakura:   { name: 'さくら', petal: '#f7b3c8', center: '#e0708f', n: 5, pl: 13, pw: 8, cr: 4, fruit: '#c8263c', leaf: '#6aa76a' },
  asagao:   { name: 'あさがお', petal: '#5b7fe0', center: '#f4f0ff', n: 5, pl: 14, pw: 11, cr: 5, fruit: '#3a4a8a', leaf: '#4c9c6a' },
  tanpopo:  { name: 'たんぽぽ', petal: '#f3d21f', center: '#e0a800', n: 20, pl: 13, pw: 3, cr: 5, fruit: '#f4f4ee', leaf: '#5f9f3f' },
};
const REASONS = ['悪口・いやがらせ', '個人が分かる情報', '不適切な内容', 'その他'];
const IDEA_SELECT = 'id, what, for_whom, plant, hidden, created_at, author_id, author:profiles!ideas_author_id_fkey(nickname), reactions(kind, user_id), steps(id, body, done_at, created_at)';

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
/* いまの水・日光・肥料と、成長の段階を計算する */
function growth(i) {
  const others = (i.reactions || []).filter((r) => r.user_id !== i.author_id); // 自分で押した分は数えない
  const water = doneCount(i);
  const sun = others.filter((r) => r.kind === 'like' || r.kind === 'more').length;
  const fert = others.filter((r) => r.kind === 'join' || r.kind === 'help').length;
  let stage = 0;
  for (let s = 1; s < NEED.length; s++) {
    if (water >= NEED[s][0] && sun >= NEED[s][1] && fert >= NEED[s][2]) stage = s; else break;
  }
  return { water, sun, fert, stage, next: NEED[stage + 1] || null };
}
/* 植物の絵（SVG）。種類と段階で姿が変わる */
function plantSVG(kind, stage, size = 96) {
  const p = PLANTS[kind] || PLANTS.himawari, L = p.leaf;
  const H = [0, 14, 28, 48, 60, 68, 68][stage], base = 118, top = base - H;
  let s = `<svg class="plant" viewBox="0 0 120 130" width="${size}" height="${Math.round(size * 130 / 120)}" role="img" aria-label="${p.name}（${STAGES[stage]}）">`
    + '<ellipse cx="60" cy="120" rx="44" ry="9" fill="#b89a6a"/><ellipse cx="60" cy="118" rx="36" ry="6" fill="#a58555"/>';
  if (stage === 0) {
    return s + '<ellipse cx="60" cy="113" rx="9" ry="6.5" fill="#6b4a2a" transform="rotate(-18 60 113)"/><path d="M55 111q5-3 9 0" stroke="#9a7a54" stroke-width="1.5" fill="none"/></svg>';
  }
  const leaf = (y, dir, len) => `<path d="M60 ${y} q${dir * len * 0.5} ${-len * 0.7} ${dir * len} ${-len * 0.2} q${-dir * len * 0.4} ${len * 0.55} ${-dir * len} ${len * 0.2}z" fill="${L}"/>`;
  s += `<path d="M60 ${base} Q${stage > 2 ? 57 : 60} ${base - H / 2} 60 ${top}" stroke="${L}" stroke-width="${stage > 2 ? 5 : 4}" fill="none" stroke-linecap="round"/>`;
  if (stage === 1) s += leaf(top + 2, 1, 12);
  if (stage >= 2) s += leaf(base - 14, 1, 17) + leaf(base - 14, -1, 17);
  if (stage >= 3) s += leaf(base - 32, 1, 21) + leaf(base - 32, -1, 21);
  if (stage === 3) s += leaf(top + 3, 1, 11) + leaf(top + 3, -1, 11);
  const cx = 60, cy = top - 8;
  if (stage === 4) { // つぼみ
    s += `<ellipse cx="${cx}" cy="${top - 5}" rx="7.5" ry="12" fill="${p.petal}"/><path d="M51 ${top + 3} q9 -15 18 0 q-9 7 -18 0z" fill="${L}"/>`;
  }
  if (stage >= 5) { // 花
    if (p.shape === 'tulip') {
      s += `<path d="M${cx - 14} ${cy - 6} q2 22 14 22 q12 0 14 -22 l-7 9 l-7 -12 l-7 12z" fill="${p.petal}"/><path d="M${cx - 5} ${cy + 15} q5 -18 5 -24 q0 6 5 24z" fill="#f47d92"/>`;
    } else {
      for (let k = 0; k < p.n; k++) {
        const a = (360 / p.n) * k;
        s += `<ellipse cx="${cx}" cy="${cy - p.pl * 0.75}" rx="${p.pw}" ry="${p.pl * 0.75}" fill="${p.petal}" transform="rotate(${a} ${cx} ${cy})"/>`;
      }
      s += `<circle cx="${cx}" cy="${cy}" r="${p.cr}" fill="${p.center}"/>`;
    }
  }
  if (stage === 6) { // 実
    s += `<path d="M60 ${base - 40} q14 -4 20 -14 M60 ${base - 46} q-14 -4 -20 -12" stroke="${L}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      + `<circle cx="81" cy="${base - 57}" r="6.5" fill="${p.fruit}" stroke="#00000022"/><circle cx="39" cy="${base - 61}" r="6.5" fill="${p.fruit}" stroke="#00000022"/>`
      + `<circle cx="79" cy="${base - 59}" r="1.6" fill="#ffffffaa"/><circle cx="37" cy="${base - 63}" r="1.6" fill="#ffffffaa"/>`
      + '<path d="M100 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM18 38l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="#f5b921"/>';
  }
  return s + '</svg>';
}
/* 水・日光・肥料のメーターと、次の段階までに足りないもの */
function meters(g) {
  const n = g.next;
  const one = (ico, label, v, need) => `<div class="meter ${n && v < need ? 'lack' : ''}"><span>${ico} ${label}</span>
    <div class="bar"><i style="width:${n && need ? Math.min(100, (v / need) * 100) : 100}%"></i></div><b>${v}${n && need ? '/' + need : ''}</b></div>`;
  let html = '<div class="meters">' + one('💧', '水', g.water, n && n[0]) + one('☀️', '日光', g.sun, n && n[1]) + one('🌿', '肥料', g.fert, n && n[2]) + '</div>';
  if (!n) return html + '<p class="grow-hint">🎉 実がなりました。ここまで育てたのは、あなたの一歩と仲間の応援です。</p>';
  const lack = [];
  if (g.water < n[0]) lack.push(`💧 一歩をあと${n[0] - g.water}つ達成`);
  if (g.sun < n[1]) lack.push(`☀️ 「いいね」「もっと聞きたい」があと${n[1] - g.sun}つ`);
  if (g.fert < n[2]) lack.push(`🌿 「一緒にやりたい」「手伝えるよ」があと${n[2] - g.fert}つ`);
  return html + `<p class="grow-hint">次の「${STAGES[g.stage + 1]}」まで：${lack.join('　')}</p>`;
}
const mini = (g) => `<span class="mini">💧${g.water} ☀️${g.sun} 🌿${g.fert}</span>`;
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
    const garden = '<div class="garden">' + list.map((i) => { const g = growth(i); return `<button class="plot" data-go="${i.id}">${plantSVG(i.plant, g.stage, 84)}<span>${STAGES[g.stage]}</span></button>`; }).join('') + '</div>';
    $('#mine').innerHTML = list.length ? garden + list.map((i) => mineCard(i)).join('')
      : '<p class="empty">まだ自分の種がありません。<br>「種をまく」から始められます。</p>';
  }
}

/* ---------- みんなの種 ---------- */
function ideaCard(i) {
  const mine = i.author_id === user.id;
  const g = growth(i);
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
    <div class="idea-top"><span class="stage">${STAGES[g.stage]}</span><span>${esc(i.author ? i.author.nickname : '')}${mine ? '（自分）' : ''}</span><span class="sp"></span><span>${ago(i.created_at)}</span></div>
    <div class="idea-body">${plantSVG(i.plant, g.stage, 68)}<div>
      <p class="what">${esc(i.what)}</p>
      <p class="whom"><b>だれのために：</b>${esc(i.for_whom)}</p>
      ${mini(g)}
    </div></div>
    ${next ? `<p class="step-now">👣 いまの一歩：${esc(next.body)}</p>` : ''}
    <div class="stamps">${stamps}</div>
    <p class="legend">${mine ? '自分で押した分では育ちません。' : ''}☀️ いいね・もっと聞きたい＝日光　🌿 一緒にやりたい・手伝えるよ＝肥料</p>
    <button class="more" data-act="menu">${mine ? 'この種を消す…' : '通報する…'}</button>
    ${menu}
  </article>`;
}

/* ---------- じぶんの畑 ---------- */
function mineCard(i) {
  const g = growth(i);
  const steps = sortedSteps(i).map((s) => `<li class="${s.done_at ? 'done' : ''}" data-step="${s.id}">
      <button class="check" data-act="toggle" aria-label="${s.done_at ? '未達成に戻す' : '達成にする'}">✓</button>
      <span>${esc(s.body)}</span><button class="x" data-act="delstep" aria-label="この一歩を消す">×</button></li>`).join('');
  const body = editing === i.id
    ? `<label>なにを？</label><textarea class="e-what" maxlength="140" rows="3">${esc(i.what)}</textarea>
       <label>だれのために？</label><textarea class="e-whom" maxlength="140" rows="2">${esc(i.for_whom)}</textarea>
       <div class="row"><button class="ghost" data-act="save">保存</button><button class="ghost" data-act="cancel">やめる</button></div>`
    : `<p class="what">${esc(i.what)}</p><p class="whom"><b>だれのために：</b>${esc(i.for_whom)}</p>`;
  return `<article class="card ${i.hidden ? 'dim' : ''}" data-id="${i.id}" id="idea-${i.id}">
    <div class="idea-top"><span class="stage">${(PLANTS[i.plant] || PLANTS.himawari).name}・${STAGES[g.stage]}</span>${i.hidden ? '<span class="badge">確認中のため非表示</span>' : ''}<span class="sp"></span>${g.fert ? `<span>仲間候補 ${g.fert}</span>` : ''}</div>
    <div class="grow">${plantSVG(i.plant, g.stage, 120)}<div>${meters(g)}</div></div>
    ${body}
    <ul class="steps">${steps}</ul>
    <div class="row"><input class="step-input" maxlength="100" placeholder="小さな一歩（例：先生に1人だけ聞いてみる）"><button class="ghost" data-act="addstep">追加</button></div>
    ${editing === i.id ? '' : '<div class="menu"><button class="ghost" data-act="edit">書き直す</button><button class="ghost warn" data-act="delete">消す</button></div>'}
  </article>`;
}

/* ---------- カード内の操作 ---------- */
async function onCardClick(e) {
  const plot = e.target.closest('[data-go]');
  if (plot) { const el = document.getElementById('idea-' + plot.dataset.go); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('[data-id]'); const id = card.dataset.id;
  const idea = ideas.find((i) => i.id === id);
  const act = btn.dataset.act;
  const before = idea.author_id === user.id ? growth(idea).stage : null;
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
      if (!res.error && !step.done_at) toast('一歩すすみました。💧 水が増えました');
    }
  }
  if (res && res.error) toast(explain(res.error));
  await refresh();
  const after = ideas.find((i) => i.id === id);
  if (before !== null && after && growth(after).stage > before) toast(`🌱「${STAGES[growth(after).stage]}」に育ちました！`);
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
  const { error } = await sb.from('ideas').insert({ what, for_whom, plant: pickedPlant });
  $('#post-btn').disabled = false;
  if (error) return toast(explain(error));
  $('#f-what').value = ''; $('#f-whom').value = ''; $('#c-what').textContent = '0'; $('#c-whom').textContent = '0';
  toast('種をまきました。次は小さな一歩を決めよう');
  pickedPlant = randomPlant(); renderPicker();
  show('mine');
});
/* 育てる植物を選ぶ */
const randomPlant = () => { const k = Object.keys(PLANTS); return k[Math.floor(Math.random() * k.length)]; };
let pickedPlant = randomPlant();
function renderPicker() {
  $('#plant-picker').innerHTML = Object.entries(PLANTS).map(([k, p]) =>
    `<button class="pick ${k === pickedPlant ? 'on' : ''}" data-plant="${k}" aria-pressed="${k === pickedPlant}">${plantSVG(k, 5, 54)}<span>${p.name}</span></button>`).join('');
}
$('#plant-picker').addEventListener('click', (e) => { const b = e.target.closest('[data-plant]'); if (b) { pickedPlant = b.dataset.plant; renderPicker(); } });
renderPicker();

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
