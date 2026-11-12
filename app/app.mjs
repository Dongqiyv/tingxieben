import { normalize, isCorrect, makeBatch, newReview, advanceReview, emptyState, validateState, mergeBackup } from './core.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ play:'<path fill="currentColor" stroke="none" d="M9 5.5 19 12 9 18.5z"/>', pause:'<path d="M9 6v12M15 6v12" stroke-width="3"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', back:'<path d="m14 6-6 6 6 6"/>', book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z"/>', clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', check:'<path d="m5 12 4 4L19 6"/>', calendar:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/>', sound:'<path d="m4 9 4 0 5-5v16l-5-5H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>', save:'<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>', diamond:'<path d="m12 3 9 9-9 9-9-9z"/>' })[name] || ''}</svg>`;
const audio = $('#audio');
let catalog, alignment, variants, state, info;
let page = 'library', filterChapter = 'all', historyChapter = 'all', historyDate = '', resultId = null, resultWrong = true;
let sectionId = null, reviewChapter = 'all', reviewBatch = '', completedReview = null, reviewSelecting = false;
let sections, entries, saveTimer, toastTimer, saveQueue = Promise.resolve(), saveError = null;
let mediaMode = null, loopIntent = false, loopSpan = null, loopTimer = null, loopTicker = null, generation = 0, submitting = false;
const pending = new Map();

function rpc(method, args = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('本地保存服务未响应，请重试。')); }, 30000);
    pending.set(id, { resolve, reject, timeout });
    window.chrome.webview.postMessage({ id, method, args });
  });
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
  toastTimer = setTimeout(() => node.hidden = true, error ? 7000 : 3200);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush().catch(error => toast('保存失败：' + error.message, true)), 450);
}

async function flush() {
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(state);
  const next = saveQueue.catch(() => {}).then(() => rpc('save', { state: snapshot }));
  saveQueue = next;
  try { await next; saveError = null; if ($('#save-status')) $('#save-status').textContent = '已自动保存到本机'; }
  catch (error) { saveError = error; if ($('#save-status')) $('#save-status').textContent = '保存失败，请按 Ctrl+S 重试'; throw error; }
}

function stamp(iso) { return new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Singapore', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date(iso)); }
function percent(value) { return (value * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
function time(value) { const s = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function chapterName(chapter) { return catalog.chapters.find(item => item.id === Number(chapter))?.name ?? ''; }
function available(section) { return section.entries.filter(entry => alignment.entries[entry.id]?.status !== 'missing' && Number.isFinite(alignment.entries[entry.id]?.start)).sort((a,b) => alignment.entries[a.id].start - alignment.entries[b.id].start); }
function batchById(id) { return state.batches.find(batch => batch.id === id); }
function batchOrdinal(batch) { const peers=state.batches.filter(item=>item.sectionId===batch.sectionId);return peers.length-peers.findIndex(item=>item.id===batch.id); }
function chapterOptions(value = 'all') { return `<option value="all" ${String(value)==='all'?'selected':''}>全部章节</option>` + catalog.chapters.map(chapter => `<option value="${chapter.id}" ${String(value)===String(chapter.id)?'selected':''}>第 ${chapter.id} 章 · ${escape(chapter.name)}</option>`).join(''); }
function header(title, subtitle, right = '', eyebrow = 'MY CORPUS') { return `<header class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${escape(title)}</h1>${subtitle?`<p class="subtitle">${subtitle}</p>`:''}</div>${right}</header>`; }
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-icon">${icon('book',27)}</div><h2>${escape(title)}</h2><p>${description}</p>${action}</div>`; }

async function confirm(title, message, label = '确定') {
  const dialog = $('#modal');
  $('#modal-content').innerHTML = `<h2>${escape(title)}</h2><p>${message}</p><div class="dialog-actions"><button class="button secondary" id="dialog-cancel">取消</button><button class="button" id="dialog-ok">${escape(label)}</button></div>`;
  return new Promise(resolve => {
    let done = false;
    const finish = value => { if(done)return; done=true; dialog.close(); dialog.oncancel = null; resolve(value); };
    $('#dialog-cancel').onclick = () => finish(false); $('#dialog-ok').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.showModal(); $('#dialog-ok').focus();
  });
}

function updateNav() {
  document.querySelectorAll('[data-page]').forEach(node => node.classList.toggle('active', node.dataset.page === (page === 'study' ? 'library' : page === 'result' ? 'history' : page)));
  $('#batch-count').textContent = state.batches.length;
  $('#review-dot').hidden = !state.review || !!state.review.completedAt;
}

function rememberAudio() {
  if (mediaMode === 'dictation' && sectionId && state.drafts[sectionId]) {
    state.drafts[sectionId].position = audio.currentTime || 0;
    state.drafts[sectionId].speed = audio.playbackRate;
    scheduleSave();
  }
}

function stopAudio() {
  generation++; loopIntent = false; clearTimeout(loopTimer); clearInterval(loopTicker); audio.pause(); mediaMode = null; loopSpan = null;
}

function navigate(next, data = {}) {
  rememberAudio(); stopAudio(); page = next;
  if (data.resultId) resultId = data.resultId;
  if (data.sectionId) sectionId = data.sectionId;
  render(); window.scrollTo(0,0);
}

function render() {
  updateNav();
  if (page === 'library') renderLibrary();
  else if (page === 'study') renderStudy();
  else if (page === 'history') renderHistory();
  else if (page === 'result') renderResult();
  else if (page === 'review') renderReview();
  else renderSettings();
}

function renderLibrary() {
  const latest = state.batches[0];
  const drafts = Object.values(state.drafts).filter(draft => sections.has(draft.sectionId)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const draft = drafts[0], recent = draft ? sections.get(draft.sectionId) : null;
  const today = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Singapore', month:'long',day:'numeric',weekday:'long' }).format(new Date());
  const wrong = state.batches.reduce((sum,batch) => sum + batch.total - batch.correct,0);
  const shown = catalog.sections.filter(section => filterChapter === 'all' || section.chapter === Number(filterChapter));
  $('#main').innerHTML = header('听写练习','选一小节，听写、核对，再练习本次错词。',`<div class="today">${icon('calendar',16)}${today}</div>`, 'LISTEN & WRITE') +
    `<div class="stats"><div class="stat"><div class="stat-icon">${icon('book',23)}</div><div><div class="stat-label">已完成听写</div><div class="stat-value">${state.batches.length}<small>次</small></div></div></div><div class="stat"><div class="stat-icon">${icon('check',23)}</div><div><div class="stat-label">最近一次正确率</div><div class="stat-value">${latest?percent(latest.accuracy):'—'}</div></div></div><div class="stat"><div class="stat-icon">${icon('diamond',23)}</div><div><div class="stat-label">累计错词记录</div><div class="stat-value">${wrong}<small>条</small></div></div></div></div>` +
    `<div class="resume-banner"><div><div class="eyebrow">${draft?'YOUR LAST SESSION':'READY WHEN YOU ARE'}</div><h2>${draft?'继续上次的听写':'从下面选择一节，开始听写'}</h2><p>${draft?`第 ${recent.chapter} 章 · ${escape(recent.title)}　已填写 ${draft.answers.filter(normalize).length} / ${available(recent).length} 个词条`:'支持三档倍速，每次练习独立保存，错词按批次归档。'}</p></div>${draft?`<button class="button" data-action="start" data-id="${draft.sectionId}">继续听写 ${icon('arrow',16)}</button>`:`<button class="button" data-action="scroll-sections">选择小节 ${icon('arrow',16)}</button>`}</div>` +
    `${!info.audioReady?'<div class="notice">尚未找到原音频目录，请在设置中选择音频文件夹。<button class="text-button" data-page="settings">打开设置</button></div>':''}` +
    `<div id="section-heading" class="section-head"><h2>章节与小节</h2><span>${catalog.sections.length} 个小节 · 原音频练习</span></div><div class="chapter-tabs"><button class="chapter-tab ${filterChapter==='all'?'active':''}" data-chapter="all">全部章节</button>${catalog.chapters.map(chapter=>`<button class="chapter-tab ${String(filterChapter)===String(chapter.id)?'active':''}" data-chapter="${chapter.id}">第 ${chapter.id} 章 · ${escape(chapter.name)}</button>`).join('')}</div>` +
    `<div class="section-grid">${shown.map(section=>{
      const count=available(section).length, last=state.batches.find(batch=>batch.sectionId===section.id), draft=state.drafts[section.id];
      return `<article class="section-card"><div class="card-top"><span class="chapter-label">CHAPTER ${String(section.chapter).padStart(2,'0')} · ${escape(section.chapterName)}</span><span class="card-symbol">▂▆▃▅</span></div><h3>${escape(section.title)}</h3><div class="card-meta"><span>${count} 个词条</span><span>${time(section.duration)}</span></div><div class="card-bottom"><span class="card-history">${draft?'有未完成的听写':last?`上次 <b>${percent(last.accuracy)}</b>`:'尚未练习'}</span><button class="start-link" data-action="start" data-id="${section.id}">${draft?'继续练习':'开始听写'}${icon('arrow',14)}</button></div></article>`;
    }).join('')}</div><p class="footer-note">当前内容：第 3、4、5 章横向测试与第 11 章综合测试。纵向测试与预测试后续扩展。</p>`;
}

function startDictation(id) {
  const section = sections.get(id); if(!section)return;
  if (!available(section).length) return toast('这一小节尚无可用原声词条。',true);
  if (!state.drafts[id]) state.drafts[id] = { sectionId:id, answers:available(section).map(()=>''), position:0, speed:1, updatedAt:new Date().toISOString() };
  scheduleSave(); navigate('study',{sectionId:id});
}

function renderStudy() {
  const section=sections.get(sectionId), draft=state.drafts[sectionId], list=available(section);
  if(!draft)return navigate('library');
  $('#main').innerHTML=`<button class="back-button" data-page="library">${icon('back',13)} 返回小节列表</button>` + header(`第 ${section.chapter} 章 · ${section.title}`,`${escape(section.chapterName)}　/　${list.length} 个词条`,`<button class="button" data-action="submit-dictation">提交并批改 ${icon('check',16)}</button>`,'DICTATION') +
    `<div class="player"><button class="play-button" data-action="toggle-dictation" aria-label="播放或暂停音频">${icon('play',21)}</button><div class="player-track"><div class="player-meta"><strong>整节原音频</strong><span id="audio-time">${time(draft.position)} / ${time(section.duration)}</span></div><input class="range" id="audio-seek" type="range" min="0" max="${section.duration||1}" value="${draft.position}" step=".1" aria-label="音频播放进度"></div><div class="speed-options">${[1,1.4,1.6].map(speed=>`<button class="${draft.speed===speed?'active':''}" data-speed="${speed}">${speed}×</button>`).join('')}</div></div>` +
    `<div class="dictation-head"><span>按音频顺序填写，提交后查看答案</span><span>已填写 <b id="filled-count">${draft.answers.filter(normalize).length}</b> / ${list.length}</span></div><div class="dictation-sheet">${list.map((entry,index)=>`<div class="answer-row"><label class="answer-number" for="answer-${index}">${String(index+1).padStart(2,'0')}</label><input class="answer-input" id="answer-${index}" data-index="${index}" value="${escape(draft.answers[index]||'')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="第 ${index+1} 个词条" enterkeyhint="next"></div>`).join('')}</div><div class="bottom-bar"><span class="save-status" id="save-status">Enter 下一行 · Shift+Enter 上一行 · Ctrl+S 保存</span><button class="button" data-action="submit-dictation">完成听写，查看批改</button></div>`;
  mediaMode='dictation'; audio.playbackRate=draft.speed; audio.volume=state.preferences.volume;
  loadMedia(section,draft.position).catch(error=>toast(error.message,true));
  setTimeout(()=>$('#answer-0')?.focus({preventScroll:true}),0);
}

async function loadMedia(section,position=0) {
  const source='https://corpus-audio.test/'+section.audio.split('/').map(encodeURIComponent).join('/');
  if(audio.src!==source) {
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timeout);audio.removeEventListener('loadedmetadata',loaded);audio.removeEventListener('error',failed);};
      const loaded=()=>{cleanup();resolve();}, failed=()=>{cleanup();reject(new Error('无法读取原音频，请在设置中检查音频目录。'));};
      const timeout=setTimeout(()=>{cleanup();reject(new Error('音频读取超时，请确认所选音频已下载到本机。'));},15000);
      audio.addEventListener('loadedmetadata',loaded);audio.addEventListener('error',failed);audio.src=source;audio.load();
    });
  }
  audio.currentTime=Math.min(Math.max(0,position),Number.isFinite(audio.duration)?audio.duration:position);
}

async function toggleDictation() {
  if(!audio.src)return;
  if(audio.paused) { await audio.play(); } else { audio.pause();rememberAudio(); }
  updateAudioUI();
}

function updateAudioUI() {
  if(page==='study') {
    const node=$('[data-action="toggle-dictation"]');if(node)node.innerHTML=icon(audio.paused?'play':'pause',21);
    if($('#audio-time'))$('#audio-time').textContent=`${time(audio.currentTime)} / ${time(audio.duration||sections.get(sectionId).duration)}`;
    if($('#audio-seek'))$('#audio-seek').value=audio.currentTime;
  }
  if(page==='review') {
    const node=$('#loop-label');if(node)node.textContent=loopIntent?'原声循环播放中':'原声已暂停';
    $('.sound-bars')?.classList.toggle('playing',loopIntent);
  }
}

async function submitDictation() {
  if(submitting)return;
  const section=sections.get(sectionId), draft=state.drafts[sectionId], list=available(section);
  const blank=list.length-draft.answers.filter(normalize).length;
  if(blank && !await confirm('提交本次听写？',`还有 <b>${blank}</b> 个词条未填写，提交后将按错词计入本次成绩。`,'提交并批改'))return;
  submitting=true;rememberAudio();stopAudio();
  const batch=makeBatch(section,list,draft.answers,variants);
  state.batches.unshift(batch);delete state.drafts[sectionId];
  try { await flush();resultWrong=true;navigate('result',{resultId:batch.id}); }
  catch(error){state.batches=state.batches.filter(item=>item.id!==batch.id);state.drafts[sectionId]=draft;toast('本次未能保存，请重试：'+error.message,true);}
  finally{submitting=false;}
}

function renderHistory() {
  const shown=state.batches.filter(batch=>(historyChapter==='all'||batch.chapter===Number(historyChapter))&&(!historyDate||batch.date===historyDate));
  $('#main').innerHTML=header('听写记录','每次听写独立归档，同一天重复练习也会分别保留。','', 'YOUR SESSIONS')+
    `<div class="filters"><select class="select" id="history-chapter" aria-label="按章节筛选">${chapterOptions(historyChapter)}</select><input type="date" id="history-date" value="${historyDate}" aria-label="按听写日期筛选">${historyDate?'<button class="text-button" data-action="clear-date">清除日期</button>':''}<span class="small muted" style="margin-left:auto">${shown.length} 条记录</span></div>`+
    (shown.length?`<div class="history-list">${shown.map(batch=>`<article class="history-row"><div class="history-date"><b>${batch.date}</b><br>${stamp(batch.createdAt).split(' ').pop()}</div><div class="history-name"><h3>第 ${batch.chapter} 章 · ${escape(batch.title)}</h3><small>本节第 ${batchOrdinal(batch)} 次 · ${batch.total} 个词条 · ${batch.total-batch.correct} 个错词</small></div><div class="history-rate">${percent(batch.accuracy)}<small>正确率</small></div><div class="history-actions"><button class="button secondary" data-action="result" data-id="${batch.id}">查看批改</button><button class="button soft" data-action="review-batch" data-id="${batch.id}" ${batch.correct===batch.total?'disabled':''}>背诵错词</button></div></article>`).join('')}</div>`:empty('这里还没有听写记录',historyDate?'这个日期没有符合条件的记录，可更换筛选条件。':'完成一小节听写后，成绩与错词会保存在这里。','<button class="button" data-page="library">开始听写</button>'));
}

function renderResult() {
  const batch=batchById(resultId);if(!batch)return navigate('history');
  const wrong=batch.items.filter(item=>!item.correct), shown=resultWrong?wrong:batch.items;
  $('#main').innerHTML=`<button class="back-button" data-page="history">${icon('back',13)} 返回听写记录</button>`+
    header(`第 ${batch.chapter} 章 · ${batch.title}`,`${stamp(batch.createdAt)}　·　本节第 ${batchOrdinal(batch)} 次听写`,`<button class="button" data-action="review-batch" data-id="${batch.id}" ${wrong.length?'':'disabled'}>背诵本次错词 ${icon('arrow',15)}</button>`,'DICTATION RESULTS')+
    `<div class="panel result-overview"><div><div class="big-rate">${(batch.accuracy*100).toFixed(1).replace(/\.0$/,'')}<small>%</small></div><div class="result-caption">本次听写正确率</div></div><div class="result-counts"><div><span>全部词条</span><strong>${batch.total}</strong></div><div><span>拼写正确</span><strong style="color:var(--green)">${batch.correct}</strong></div><div><span>错词与漏答</span><strong style="color:var(--red)">${wrong.length}</strong></div></div></div>`+
    `<div class="section-head"><div class="chapter-tabs" style="margin:0"><button class="filter-button ${resultWrong?'active':''}" data-result-filter="wrong">只看错词 ${wrong.length}</button><button class="filter-button ${!resultWrong?'active':''}" data-result-filter="all">全部词条 ${batch.total}</button></div><span>单复数与同音异形词严格区分 · 接受英美拼写</span></div>`+
    (shown.length?`<div class="panel table-panel"><table class="result-table"><thead><tr><th>序号</th><th>你的拼写</th><th>正确答案</th><th>中文释义</th><th>结果</th></tr></thead><tbody>${shown.map(item=>`<tr class="${item.correct?'':'row-wrong'}"><td class="muted">${batch.items.indexOf(item)+1}</td><td class="word ${item.correct?'correct-answer':'wrong-answer'}">${normalize(item.answer)?escape(item.answer):'<span class="small">未填写</span>'}</td><td class="word">${escape(item.word)}</td><td class="meaning">${escape(item.meaning)}</td><td><span class="pill ${item.correct?'':'wrong'}">${item.correct?'正确':'错词'}</span></td></tr>`).join('')}</tbody></table></div>`:empty('本次全部正确','这次没有错词，可以开始新的听写练习。','<button class="button" data-page="library">返回练习</button>'));
}

function renderReview() {
  if(state.review&&!state.review.completedAt&&!reviewSelecting)return renderActiveReview();
  if(completedReview)return renderCompletedReview();
  const eligible=state.batches.filter(batch=>reviewChapter==='all'||batch.chapter===Number(reviewChapter));
  if(!eligible.some(batch=>batch.id===reviewBatch))reviewBatch=eligible[0]?.id||'';
  const chosen=batchById(reviewBatch), wrong=chosen?chosen.total-chosen.correct:0;
  $('#main').innerHTML=header('错词背诵','选择章节与听写批次，练习这一次听写中写错的词。','', 'REMEMBER THE WORDS')+
    (state.review&&!state.review.completedAt?'<div class="notice info">有一份未完成的背诵，进度已保存。<button class="text-button" data-action="continue-review">继续背诵</button></div>':'')+
    (state.batches.length?`<div class="panel"><div class="review-select"><div><label class="label" for="review-chapter">选择章节</label><select class="select full" id="review-chapter">${chapterOptions(reviewChapter)}</select></div><div><label class="label" for="review-batch">选择听写批次</label><select class="select full" id="review-batch">${eligible.map(batch=>`<option value="${batch.id}" ${batch.id===reviewBatch?'selected':''}>${stamp(batch.createdAt)} · 第 ${batch.chapter} 章 ${escape(batch.title)} 第 ${batchOrdinal(batch)} 次 · ${batch.total-batch.correct} 个错词</option>`).join('')||'<option>这个章节还没有记录</option>'}</select></div></div><div class="review-brief"><div><strong>${wrong}</strong> <span class="small">个错词${chosen?`　·　本次听写正确率 ${percent(chosen.accuracy)}`:''}</span></div><button class="button" data-action="begin-review" ${wrong?'':'disabled'}>开始背诵 ${icon('arrow',15)}</button></div></div><div class="notice info">每个错词循环播放原声，连续拼写正确 7 次后进入下一个。以后重新复习这一批次时，全部错词从零开始。</div>`:empty('先完成一次听写','听写中出现的错词会按章节和批次归档，在这里选择后即可背诵。','<button class="button" data-page="library">前往听写练习</button>'));
}

function renderActiveReview() {
  const review=state.review, batch=batchById(review.batchId), entry=entries.get(review.entryIds[review.index]);
  if(!batch||!entry){state.review=null;scheduleSave();return renderReview();}
  $('#main').innerHTML=header('错词背诵',`第 ${batch.chapter} 章 · ${escape(batch.title)} 第 ${batchOrdinal(batch)} 次　/　${stamp(batch.createdAt)}`,`<button class="button secondary" data-action="leave-review">保存并返回</button>`,'WORD BY WORD')+
    `<div class="review-layout"><div class="review-progress"><span>本次背诵进度</span><span id="review-progress-text">${review.index+1} / ${review.entryIds.length}</span></div><div class="progress-track"><span style="width:${review.index/review.entryIds.length*100}%"></span></div><div class="word-card"><div class="word-chapter">第 ${batch.chapter} 章　·　${escape(batch.title)}</div><div class="review-word" id="review-word">${escape(entry.word)}</div><div class="review-meaning" id="review-meaning">${escape(entry.meaning)}</div><button class="loop-control" data-action="toggle-loop"><span class="sound-bars"><i></i><i></i><i></i><i></i></span><span id="loop-label">正在准备原声…</span></button><div class="streak-label">连续正确 <b id="streak-number">${review.streak}</b> / 7 次</div><div class="streak-dots">${Array.from({length:7},(_,i)=>`<span class="streak-dot ${i<review.streak?'done':''}">${i<review.streak?'✓':i+1}</span>`).join('')}</div><form class="review-form" id="review-form"><label class="visually-hidden" for="review-answer">输入当前词的完整拼写</label><input class="review-input" id="review-answer" placeholder="输入完整拼写，按 Enter 确认" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><button class="button" type="submit">确认 ${icon('check',16)}</button></form><div class="feedback" id="review-feedback">边看、边听、边输入；拼写错误会将连续次数归零。</div></div><div class="review-footer"><span>每次新复习都练习全部错词，历史听写成绩保持不变。</span><button class="text-button" data-action="adjust-audio">调整当前发音范围</button></div></div>`;
  $('#review-answer').focus({preventScroll:true});
  beginLoop(entry).catch(error=>{if($('#loop-label'))$('#loop-label').textContent='原声暂不可用';toast(error.message,true);});
}

async function startReviewForBatch(id) {
  const batch=batchById(id);if(!batch)return;
  if(batch.correct===batch.total)return toast('这一批次没有错词。');
  if(state.review&&!state.review.completedAt&&state.review.batchId!==id) {
    if(!await confirm('开始另一批错词？','当前背诵任务尚未完成。开始新任务后，原批次的错词仍会保留，再次开始时从零练习。','开始新任务'))return;
  }
  if(!state.review||state.review.completedAt||state.review.batchId!==id)state.review=newReview(batch);
  completedReview=null;reviewSelecting=false;reviewChapter=String(batch.chapter);reviewBatch=id;scheduleSave();navigate('review');
}

async function beginLoop(entry) {
  const token=++generation;
  clearTimeout(loopTimer);clearInterval(loopTicker);audio.pause();
  const section=sections.get(entry.id.split(':')[0]), span=state.audioOverrides[entry.id]||alignment.entries[entry.id];
  if(!section||!Number.isFinite(span?.start)||!Number.isFinite(span?.end))throw new Error('该词暂时没有对应的原声片段。');
  mediaMode='loop';loopSpan={start:span.start,end:span.end};loopIntent=true;
  await loadMedia(section,loopSpan.start);
  if(token!==generation)return;
  audio.playbackRate=1;audio.volume=state.preferences.volume;
  await audio.play();updateAudioUI();
  loopTicker=setInterval(()=>{
    if(!loopIntent||mediaMode!=='loop'||!loopSpan)return;
    if(!audio.paused&&audio.currentTime>=loopSpan.end){
      audio.pause();
      clearTimeout(loopTimer);loopTimer=setTimeout(()=>{
        if(!loopIntent||token!==generation)return;
        audio.currentTime=loopSpan.start;audio.play().catch(error=>toast(error.message,true));
      },state.preferences.loopGap*1000);
    }
  },20);
}

async function toggleLoop() {
  if(mediaMode!=='loop'||!loopSpan)return;
  loopIntent=!loopIntent;
  if(!loopIntent){clearTimeout(loopTimer);audio.pause();}
  else {audio.currentTime=loopSpan.start;await audio.play();}
  updateAudioUI();
}

async function submitReview(event) {
  event.preventDefault();
  if(!state.review||state.review.completedAt)return;
  const field=$('#review-answer'), answer=field.value;
  if(!normalize(answer)){field.focus();return;}
  const entry=entries.get(state.review.entryIds[state.review.index]);
  const correct=isCorrect(answer,entry,variants), previousIndex=state.review.index;
  state.review=advanceReview(state.review,correct);scheduleSave();
  if(state.review.completedAt){
    completedReview={...state.review};state.reviewHistory.push({id:completedReview.id,batchId:completedReview.batchId,completedAt:completedReview.completedAt,words:completedReview.entryIds.length,attempts:completedReview.attempts});state.review=null;stopAudio();await flush();renderCompletedReview();updateNav();return;
  }
  if(state.review.index!==previousIndex){stopAudio();renderActiveReview();toast('连续正确 7 次，进入下一个词。');return;}
  $('#streak-number').textContent=state.review.streak;
  document.querySelectorAll('.streak-dot').forEach((node,index)=>{node.classList.toggle('done',index<state.review.streak);node.textContent=index<state.review.streak?'✓':index+1;});
  field.value='';field.classList.toggle('error',!correct);
  const feedback=$('#review-feedback');feedback.className='feedback '+(correct?'good':'bad');feedback.textContent=correct?`拼写正确，已连续答对 ${state.review.streak} 次。`:'拼写有误，连续次数已归零。看清正确拼写后再输入。';field.focus();
}

function renderCompletedReview() {
  const batch=batchById(completedReview.batchId);
  $('#main').innerHTML=header('错词背诵','本次练习已完成。','', 'SESSION COMPLETE')+`<div class="panel completed"><div class="completed-icon">${icon('check',30)}</div><h2>这一批错词，练完了</h2><p>第 ${batch.chapter} 章 · ${escape(batch.title)}<br>${completedReview.entryIds.length} 个错词均已连续拼写正确 7 次。</p><div class="header-actions"><button class="button secondary" data-action="choose-review">选择其他批次</button><button class="button" data-action="repeat-review" data-id="${batch.id}">重新练习这一批</button></div></div>`;
}

function leaveReview() { rememberAudio();stopAudio();completedReview=null;reviewSelecting=true;page='review';updateNav();renderReview(); }

async function adjustAudio() {
  const review=state.review;if(!review)return;
  const entry=entries.get(review.entryIds[review.index]), original=alignment.entries[entry.id], current=state.audioOverrides[entry.id]||original;
  loopIntent=false;clearTimeout(loopTimer);audio.pause();updateAudioUI();
  const dialog=$('#modal');$('#modal-content').innerHTML=`<h2>调整当前发音范围</h2><p>${escape(entry.word)}<br>如果发音开头或结尾被截断，可以微调时间，再试听确认。</p><div class="number-fields"><div><label class="label" for="clip-start">开始位置（秒）</label><input id="clip-start" type="number" step=".05" min="0" value="${current.start}"></div><div><label class="label" for="clip-end">结束位置（秒）</label><input id="clip-end" type="number" step=".05" min="0" value="${current.end}"></div></div><div class="dialog-actions"><button class="button secondary" id="clip-cancel">取消</button><button class="button soft" id="clip-preview">试听</button><button class="button" id="clip-save">保存范围</button></div>`;
  const read=()=>{const start=Number($('#clip-start').value),end=Number($('#clip-end').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>20||end>audio.duration)throw new Error('请输入有效的开始与结束时间，片段长度应在 20 秒以内。');return {start,end};};
  const restore=()=>{dialog.close();beginLoop(entry).catch(error=>toast(error.message,true));};
  $('#clip-cancel').onclick=restore;dialog.oncancel=e=>{e.preventDefault();restore();};
  $('#clip-preview').onclick=async()=>{try{const span=read();clearInterval(loopTicker);clearTimeout(loopTimer);audio.pause();loopSpan=span;audio.currentTime=span.start;await audio.play();loopTimer=setTimeout(()=>audio.pause(),(span.end-span.start)*1000);}catch(error){toast(error.message,true);}};
  $('#clip-save').onclick=()=>{try{state.audioOverrides[entry.id]=read();scheduleSave();restore();toast('已保存该词的原声范围。');}catch(error){toast(error.message,true);}};dialog.showModal();
}

function renderSettings() {
  const issues=catalog.sections.filter(section=>section.omittedCount||section.addedCount);
  $('#main').innerHTML=header('设置与备份','音频与学习记录都在本机，日常使用无需联网。','', 'YOUR LOCAL WORKSPACE')+
    `<div class="panel"><h2>原音频与播放</h2><div class="settings-row"><div class="settings-info"><h3>原音频目录</h3><p class="path">${escape(info.audioRoot||'尚未设置')}</p><p>${info.audioReady?'目录已找到；背诵使用该目录中的原始发音。':'目录尚未找到，请选择含 Chapter 子文件夹的音频目录。'}</p></div><button class="button secondary" data-action="pick-audio">${icon('folder',16)}选择目录</button></div><div class="settings-row"><div class="settings-info"><h3>播放音量</h3><p>听写与背诵使用同一音量。</p></div><label class="range-label"><input class="range" id="volume" type="range" min="0" max="1" step=".05" value="${state.preferences.volume}"><span id="volume-label">${Math.round(state.preferences.volume*100)}%</span></label></div><div class="settings-row"><div class="settings-info"><h3>背诵循环间隔</h3><p>每次原声结束后，稍作停顿再重复。</p></div><label class="range-label"><select class="select" id="loop-gap">${[.3,.55,.8,1,1.5].map(gap=>`<option value="${gap}" ${state.preferences.loopGap===gap?'selected':''}>${gap} 秒</option>`).join('')}</select></label></div></div>`+
    `<div class="panel"><h2>学习记录</h2><div class="settings-row"><div class="settings-info"><h3>本机自动保存</h3><p class="path">${escape(info.dataDir)}</p><p>${state.batches.length} 次听写记录，${state.reviewHistory.length} 次已完成背诵。</p></div><button class="button secondary" data-action="open-data">打开记录目录</button></div><div class="settings-row"><div class="settings-info"><h3>导出备份</h3><p>将听写成绩、错词、草稿和背诵进度保存为一个备份文件。</p></div><button class="button soft" data-action="export">${icon('save',15)}导出备份</button></div><div class="settings-row"><div class="settings-info"><h3>合并备份记录</h3><p>读取其他备份中的听写批次，当前记录保留，相同批次自动去重。</p></div><button class="button secondary" data-action="import">读取备份</button></div></div>`+
    `<div class="panel"><h2>当前词库与判分</h2><p class="subtitle">第 3、4、5 章横向测试与第 11 章综合测试。单复数、同音异形词严格区分；合法英美拼写均接受。忽略大小写与多余空格，漏答按错词计分。</p>${issues.length?`<details style="margin-top:18px"><summary class="small muted" style="cursor:pointer">查看词表与现有音频的核对说明</summary><p class="subtitle">练习顺序按现有音频整理，未在音频中出现的 Excel 词条暂不计入听写。音频中的重复词按实际次数保留。</p><table class="settings-table"><thead><tr><th>小节</th><th>可练词条</th><th>资料差异</th></tr></thead><tbody>${issues.map(section=>`<tr><td>第 ${section.chapter} 章 ${escape(section.title)}</td><td>${available(section).length}</td><td>${section.omittedCount?`Excel ${section.omittedCount} 条未在该音频中对应`:''}${section.addedCount?` · 原声补齐 ${section.addedCount} 条`:''}</td></tr>`).join('')}</tbody></table></details>`:''}</div><p class="footer-note">听写本 1.0.0 · 学习数据仅保存在本机。移动软件时，请一并保留 data 文件夹。</p>`;
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');if(!target)return;
  try {
    if(target.matches('a.brand')){event.preventDefault();navigate('library');return;}
    if(target.dataset.page){navigate(target.dataset.page);return;}
    if(target.dataset.chapter){filterChapter=target.dataset.chapter;renderLibrary();return;}
    if(target.dataset.resultFilter){resultWrong=target.dataset.resultFilter==='wrong';renderResult();return;}
    if(target.dataset.speed){const speed=Number(target.dataset.speed);audio.playbackRate=speed;state.drafts[sectionId].speed=speed;scheduleSave();document.querySelectorAll('[data-speed]').forEach(node=>node.classList.toggle('active',Number(node.dataset.speed)===speed));return;}
    const action=target.dataset.action,id=target.dataset.id;
    if(action==='start')startDictation(id);
    else if(action==='scroll-sections')$('#section-heading').scrollIntoView({behavior:'smooth'});
    else if(action==='toggle-dictation')await toggleDictation();
    else if(action==='submit-dictation')await submitDictation();
    else if(action==='result'){resultWrong=true;navigate('result',{resultId:id});}
    else if(action==='clear-date'){historyDate='';renderHistory();}
    else if(action==='review-batch')await startReviewForBatch(id);
    else if(action==='begin-review')await startReviewForBatch(reviewBatch);
    else if(action==='toggle-loop')await toggleLoop();
    else if(action==='leave-review')leaveReview();
    else if(action==='continue-review'){page='review';reviewSelecting=false;renderActiveReview();}
    else if(action==='choose-review'){completedReview=null;reviewSelecting=true;renderReview();}
    else if(action==='repeat-review'){completedReview=null;await startReviewForBatch(id);}
    else if(action==='adjust-audio')await adjustAudio();
    else if(action==='pick-audio'){rememberAudio();stopAudio();const chosen=await rpc('pickAudio');if(chosen){info.audioRoot=chosen.path;info.audioReady=chosen.ready;renderSettings();toast('已更新原音频目录。');}}
    else if(action==='open-data')await rpc('openData');
    else if(action==='export'){await flush();const path=await rpc('export',{state:JSON.stringify(state,null,2)});if(path)toast('学习记录备份已导出。');}
    else if(action==='import'){const incoming=await rpc('import');if(incoming){const result=mergeBackup(state,incoming);if(await confirm('合并备份记录？',`可加入 <b>${result.added}</b> 个新听写批次。当前记录会保留，相同批次不会重复导入。`,'合并记录')){state=result.state;await flush();renderSettings();updateNav();toast(`已合并 ${result.added} 个新批次。`);}}}
  }catch(error){toast(error.message,true);}
});

document.addEventListener('input',event=>{
  const target=event.target;
  if(target.classList.contains('answer-input')&&state.drafts[sectionId]){
    const draft=state.drafts[sectionId];draft.answers[Number(target.dataset.index)]=target.value;draft.updatedAt=new Date().toISOString();$('#filled-count').textContent=draft.answers.filter(normalize).length;scheduleSave();
  }else if(target.id==='audio-seek'){audio.currentTime=Number(target.value);rememberAudio();}
  else if(target.id==='volume'){state.preferences.volume=Number(target.value);audio.volume=state.preferences.volume;$('#volume-label').textContent=Math.round(audio.volume*100)+'%';scheduleSave();}
});

document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='history-chapter'){historyChapter=target.value;renderHistory();}
  else if(target.id==='history-date'){historyDate=target.value;renderHistory();}
  else if(target.id==='review-chapter'){reviewChapter=target.value;renderReview();}
  else if(target.id==='review-batch'){reviewBatch=target.value;renderReview();}
  else if(target.id==='loop-gap'){state.preferences.loopGap=Number(target.value);scheduleSave();}
});

document.addEventListener('submit',event=>{if(event.target.id==='review-form')submitReview(event).catch(error=>toast(error.message,true));});
document.addEventListener('keydown',event=>{
  if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();rememberAudio();flush().then(()=>toast('已保存。')).catch(error=>toast(error.message,true));}
  if(event.target.classList.contains('answer-input')&&event.key==='Enter'){
    event.preventDefault();const index=Number(event.target.dataset.index)+(event.shiftKey?-1:1),next=$(`#answer-${index}`);if(next){next.focus();next.scrollIntoView({block:'center',behavior:'instant'});}
  }
});
let lastPositionSave=0;
audio.addEventListener('timeupdate',()=>{updateAudioUI();if(mediaMode==='dictation'&&Math.abs(audio.currentTime-lastPositionSave)>4){lastPositionSave=audio.currentTime;rememberAudio();}});
audio.addEventListener('play',updateAudioUI);audio.addEventListener('pause',updateAudioUI);audio.addEventListener('ended',()=>{rememberAudio();updateAudioUI();});
window.requestClose=async()=>{try{rememberAudio();stopAudio();await flush();await rpc('close');}catch(error){await rpc('cancelClose');toast('记录未能保存，请重试后再关闭：'+error.message,true);}};

async function boot() {
  if(!window.chrome?.webview)throw new Error('请通过“听写本.exe”打开软件。');
  window.chrome.webview.addEventListener('message',event=>{
    const response=event.data,waiting=pending.get(response.id);if(!waiting)return;clearTimeout(waiting.timeout);pending.delete(response.id);response.error?waiting.reject(new Error(response.error)):waiting.resolve(response.result);
  });
  [catalog,alignment,variants,info]=await Promise.all([fetch('catalog.json').then(r=>r.json()),fetch('alignment.json').then(r=>r.json()),fetch('variants.json').then(r=>r.json()),rpc('init')]);
  state=info.state?validateState(info.state):emptyState();sections=new Map(catalog.sections.map(section=>[section.id,section]));entries=new Map(catalog.sections.flatMap(section=>section.entries.map(entry=>[entry.id,entry])));
  if(!Array.isArray(state.reviewHistory))state.reviewHistory=[];
  render();if(info.recovered)toast(info.recovered,true);
  window.__app={get state(){return state;},get catalog(){return catalog;},get alignment(){return alignment;},get variants(){return variants;},get page(){return page;},navigate,startDictation,startReviewForBatch,submitDictation,flush,available,stopAudio,render,escape};
  await rpc('ready');
}
boot().catch(error=>{$('#main').innerHTML=empty('暂时无法打开听写本',escape(error.message));});
