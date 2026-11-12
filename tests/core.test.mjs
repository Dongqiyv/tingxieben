import test from 'node:test';
import assert from 'node:assert/strict';
import { isCorrect, makeBatch, newReview, advanceReview, emptyState, validateState, mergeBackup } from '../app/core.mjs';

const variants = { colour: 'color', color: 'color', theatre: 'theater', theater: 'theater' };
const section = { id: 'demo', chapter: 1, title: 'Demo' };
const words = [
  { id: 'demo:1', word: 'colour', meaning: '颜色' },
  { id: 'demo:2', word: 'theatre', meaning: '剧院' },
];

test('grades exact words, accepted variants, blanks, and plurals', () => {
  assert.equal(isCorrect(' COLOR ', words[0], variants), true);
  assert.equal(isCorrect('theater', words[1], variants), true);
  assert.equal(isCorrect('colours', words[0], variants), false);
  assert.equal(isCorrect('', words[0], variants), false);
});

test('records each attempt as a separate dated batch', () => {
  const first = makeBatch(section, words, ['color', ''], variants, '2026-11-12T16:01:00Z', 'first');
  const second = makeBatch(section, words, ['', 'theater'], variants, '2026-11-12T16:01:00Z', 'second');
  assert.equal(first.date, '2026-11-13');
  assert.equal(first.accuracy, .5);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.items.map(item => item.correct), [true, false]);
});

test('moves to the next wrong word after seven consecutive correct entries', () => {
  const batch = makeBatch(section, words, ['', ''], variants, undefined, 'batch');
  let review = newReview(batch);
  for (let n = 0; n < 6; n++) review = advanceReview(review, true);
  assert.equal(review.index, 0);
  assert.equal(review.streak, 6);
  review = advanceReview(review, false);
  assert.equal(review.streak, 0);
  for (let n = 0; n < 7; n++) review = advanceReview(review, true);
  assert.equal(review.index, 1);
  assert.equal(newReview(batch).index, 0);
});

test('validates and deduplicates imported batches', () => {
  const batch = makeBatch(section, words, ['color', 'theater'], variants, undefined, 'batch');
  const state = emptyState();
  state.batches.push(batch);
  assert.equal(validateState(state).batches.length, 1);
  assert.equal(mergeBackup(state, state).added, 0);
  assert.throws(() => validateState({ ...state, batches: [{ ...batch, correct: 0 }] }));
});
