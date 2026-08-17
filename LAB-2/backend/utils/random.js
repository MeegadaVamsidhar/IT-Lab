/**
 * utils/random.js - randomness helpers for building the per-student paper.
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Builds a random question paper.
 * 1. Shuffle all questions.
 * 2. Pick `count` questions.
 * 3. Shuffle the 4 options of each question and remap the correct letter.
 *
 * Returns an array of { id, category, question, options:{A..D}, correct }
 * where `correct` is the letter in the NEW shuffled arrangement.
 */
function generateQuestionSet(questions, count) {
  const picked = shuffle(questions).slice(0, count);

  return picked.map((q) => {
    const options = [
      { orig: 'A', text: q.option_a },
      { orig: 'B', text: q.option_b },
      { orig: 'C', text: q.option_c },
      { orig: 'D', text: q.option_d }
    ];

    // original correct answer text
    const correctText = q['option_' + q.correct_answer.toLowerCase()];

    const shuffled = shuffle(options);

    // map to A..D positions and compute new correct letter based on position
    const mapped = {
      A: shuffled[0].text,
      B: shuffled[1].text,
      C: shuffled[2].text,
      D: shuffled[3].text
    };

    const idx = shuffled.findIndex((o) => o.text === correctText);
    const letters = ['A', 'B', 'C', 'D'];
    const correct = idx >= 0 ? letters[idx] : 'A';

    return {
      id: q.id,
      category: q.category,
      question: q.question,
      options: mapped,
      correct
    };
  });
}

module.exports = { shuffle, generateQuestionSet };
