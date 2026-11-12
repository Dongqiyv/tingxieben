export function normalize(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export function canonical(value, variants = {}) {
  return normalize(value).replace(/\p{L}+(?:'\p{L}+)?/gu, word => variants[word] ?? word);
}

export function isCorrect(answer, entry, variants = {}) {
  if (!normalize(answer)) return false;
  return [entry.word, ...(entry.accepted ?? [])].some(word => canonical(answer, variants) === canonical(word, variants));
}

export function localDate(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function makeBatch(section, entries, answers, variants = {}, now = new Date().toISOString(), id = crypto.randomUUID()) {
  const items = entries.map((entry, index) => ({ entryId: entry.id, word: entry.word, meaning: entry.meaning, answer: String(answers[index] ?? ''), correct: isCorrect(answers[index], entry, variants) }));
  const correct = items.filter(item => item.correct).length;
  return { id, sectionId: section.id, chapter: section.chapter, title: section.title, createdAt: now, date: localDate(now), total: items.length, correct, accuracy: items.length ? correct / items.length : 0, items };
}

export function newReview(batch) {
  return { id: crypto.randomUUID(), batchId: batch.id, entryIds: batch.items.filter(item => !item.correct).map(item => item.entryId), index: 0, streak: 0, attempts: 0, startedAt: new Date().toISOString(), completedAt: null };
}

export function advanceReview(review, correct) {
  if (review.completedAt) return { ...review };
  const next = { ...review, attempts: review.attempts + 1, streak: correct ? review.streak + 1 : 0 };
  if (next.streak >= 7) {
    next.index += 1;
    next.streak = 0;
    if (next.index >= next.entryIds.length) next.completedAt = new Date().toISOString();
  }
  return next;
}

export function emptyState() {
  return { schema: 1, batches: [], drafts: {}, review: null, reviewHistory: [], audioOverrides: {}, preferences: { volume: .8, loopGap: .55 } };
}

export function validateState(state) {
  if (!state || state.schema !== 1 || !Array.isArray(state.batches) || !state.drafts || typeof state.drafts !== 'object') throw new Error('这不是有效的听写本备份。');
  const ids = new Set();
  for (const batch of state.batches) {
    if (!batch || typeof batch.id !== 'string' || ids.has(batch.id) || !Array.isArray(batch.items) || !Number.isInteger(batch.total) || batch.total !== batch.items.length || !Number.isFinite(Date.parse(batch.createdAt))) throw new Error('备份中的听写记录不完整。');
    ids.add(batch.id);
    if (batch.items.some(item => typeof item.entryId !== 'string' || typeof item.word !== 'string' || typeof item.correct !== 'boolean')) throw new Error('备份中的词条记录不完整。');
    const count = batch.items.filter(item => item.correct).length;
    if (count !== batch.correct || Math.abs(batch.accuracy - (batch.total ? count / batch.total : 0)) > .000001) throw new Error('备份中的成绩与词条记录不一致。');
  }
  if (state.review) {
    const review = state.review;
    if (!ids.has(review.batchId) || !Array.isArray(review.entryIds) || !Number.isInteger(review.index) || review.index < 0 || review.index > review.entryIds.length || !Number.isInteger(review.streak) || review.streak < 0 || review.streak > 6) throw new Error('备份中的背诵进度不完整。');
  }
  return { ...emptyState(), ...state, preferences: { ...emptyState().preferences, ...state.preferences } };
}

export function mergeBackup(current, incoming) {
  const backup = validateState(incoming);
  const ids = new Set(current.batches.map(batch => batch.id));
  const added = backup.batches.filter(batch => !ids.has(batch.id));
  return { state: { ...current, batches: [...current.batches, ...added].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }, added: added.length };
}
