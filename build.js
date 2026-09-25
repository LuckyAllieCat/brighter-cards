// Brighter Cards build: turns the Brighter Path content (../quest-path/content) into flashcard decks
// and bakes them into index.html from template.html. Run: node build.js
// Vocab card ids are the deck + normalized word, dictation ids are the Brighter Path question ids, so review history survives rebuilds.
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'quest-path', 'content');
global.window = global;
require(path.join(SRC, '_base.js'));

const SUBJECTS = [   // deck order in the app
  ['turkish', 'Turkish', 'tr-TR'], ['russian', 'Russian', 'ru-RU'], ['italian', 'Italian', 'it-IT'],
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const txt = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
const note = s => s ? `<div class="note">${txt(s)}</div>` : '';

// Vocab only: each card is one target-language word/short phrase with its meaning, harvested from
// lesson examples and from the lesson questions that are really vocab pairs. Dictation stays as audio cards.
const MAX_WORDS = 3;
const TARGET_CHARS = { 'tr-TR': /[çğıİöşüÇĞÖŞÜ]/, 'ru-RU': /[Ѐ-ӿ]/, 'it-IT': /[àèéìòù]/ };
const words = s => s.trim().split(/\s+/).length;
let LOC = 'en';   // locale for case changes: Turkish needs i/İ and ı/I
const norm = s => s.toLocaleLowerCase(LOC).normalize('NFC').replace(/[.!?¿¡,;:"'«»]/g, '').replace(/\s+/g, ' ').trim();
const cap = s => s.charAt(0).toLocaleUpperCase(LOC) + s.slice(1);

function vocabPairs(q, lang) {         // -> [[target, meaning, note?], ...]
  const ans = q.t === 'mc' ? q.opts[q.a] : q.t === 'type' ? q.a[0] : null;
  if (ans == null || /_{2,}/.test(q.q) || /_{2,}/.test(ans)) return [];
  const out = [], Q = q.q.trim();
  let m;
  // "Merhaba" means:   /   "девять" =   (quote is the target word)
  if ((m = Q.match(/^"([^"]+)"\s*(?:means:?|means…|=)$/))) {
    const [a, b] = [m[1], ans];
    const aIsTarget = TARGET_CHARS[lang].test(a) || !TARGET_CHARS[lang].test(b);
    out.push(aIsTarget ? [a, b] : [b, a]);
  }
  // "Good night":   /   "Goodbye" (said to someone who is leaving):   (quote is the English meaning)
  else if (q.t === 'mc' && (m = Q.match(/^"([^"]+)"\s*(?:in (?:Turkish|Russian|Italian))?\s*(?:\(([^)]*)\))?:?$/)))
    out.push([ans, m[1], m[2]]);
  // Type "please" in Turkish.   /   Type the word for "cat" (…).
  else if (q.t === 'type' && (m = Q.match(/^(?:Type|Write|Say)(?: the word for)? "([^"]+)"(?: \(([^)]*)\))?(?: in (?:Turkish|Russian|Italian))?(?: \(([^)]*)\))?\.?$/)))
    out.push([ans, m[1], /=|→/.test(m[2] || m[3] || '') ? '' : (m[2] || m[3])]);
  // Cyrillic "Ж" sounds like…
  else if ((m = Q.match(/^Cyrillic "([^"]+)" sounds like/))) out.push([m[1], `sounds like ${ans}`]);
  // hints written into questions: (bread = ekmek)
  for (const h of Q.matchAll(/\(([A-Za-z][A-Za-z ]*?) = ([^()=,]+?)\)/g)) out.push([h[2].trim(), h[1].trim()]);
  return out.filter(([t, mn]) => t && mn && words(t) <= MAX_WORDS && !/[→=_]/.test(t));
}

// Categories: the hand-written core lists in vocab.js first, then groups for the phrases that come from the lessons.
const VOCAB = require('./vocab.js');
const LESSON_CATS = ['Everyday phrases', 'There is & have', 'Where things are', 'Plurals', 'Asking questions', 'Past tense', 'Future', 'Want, like & can', 'Commands', 'Pronoun phrases', 'More words', 'Listening'];
const ENG = /\b(are|you|is|the|did|he|she|we|they|it|what|where|do|does|am|i|was|will|my|your|an|to)\b/i;
function lessonCategory(t, m, lang) {
  if (/\b(o'clock|half past|what time|at seven|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|week|day)\b|\d:\d\d/i.test(m)) return 'Time & Days';
  if (/\b(hello|hi|bye|goodbye|thank|thanks|please|nice to meet|excuse me|sorry|my name is|your name)\b/i.test(m)) return 'Greetings';
  if (/^\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)\b/i.test(m)) return 'Numbers';
  if (/\b(red|blue|green|white|black|yellow|colou?r)\b/i.test(m)) return 'Colors';
  if (lang === 'it-IT' && /!$/.test(t)) return 'Commands';
  if (lang === 'it-IT' && /\b(it|them)\b/i.test(m)) return 'Pronoun phrases';
  if (/\b(will|'ll)\b/i.test(m)) return 'Future';
  if (/\b(did|didn't|was|were|came|saw|ate|drank|looked|went|slept|heard|arrived)\b/i.test(m)) return 'Past tense';
  if (/\b(want|wants|can|can't|could|like|likes|love|loves|would|should)\b/i.test(m)) return 'Want, like & can';
  if (/\?$/.test(t.trim())) return 'Asking questions';
  if (/→/.test(t)) return 'Plurals';
  if (/\b(there is|there's|there isn't|there are|have|has)\b/i.test(m)) return 'There is & have';
  if (/\b(is|am|are)\b.*\b(in|at|on)\b/i.test(m)) return 'Where things are';
  if (words(t) === 1 && !/^(I|you|he|she|we|they)\b/i.test(m)) return 'More words';
  return 'Everyday phrases';
}

const decks = [], cards = [];
for (const [key, name, lang] of SUBJECTS) {
  LOC = lang.slice(0, 2);
  require(path.join(SRC, key + '.js'));
  const c = window.CONTENT[key];
  const byKey = new Map(), mine = [];
  const card = (id, cat, target, meaning, note) => { const x = { id, d: key, cat, target: cap(target.trim()), means: [meaning], note }; mine.push(x); return x; };
  // 1. core lists
  for (const [cat, list] of Object.entries(VOCAB[key])) for (const [t, m] of list) {
    const k = cat === 'Alphabet' ? 'abc.' + t : norm(t);
    if (byKey.has(k)) throw new Error(`${key}: "${t}" is listed twice`);
    byKey.set(k, card(`${key}.${cat === 'Alphabet' ? 'abc.' + t : 'v.' + norm(t)}`, cat, t, m, ''));
  }
  const core = new Set(byKey.keys());
  // 2. lesson words and short phrases
  const addLesson = (t, m, n) => {
    const letter = /^Sounds like /i.test(m) && t.length === 1;
    if (!letter && !TARGET_CHARS[lang].test(t) && ENG.test(t) && !ENG.test(m)) [t, m] = [m, t];   // stored the wrong way round
    const k = letter ? 'abc.' + t : norm(t);
    if (!k) return;
    if (core.has(k)) return;                                    // the core list's wording wins
    const old = byKey.get(k);
    if (old) { if (!old.means.some(x => norm(x) === norm(m))) old.means.push(m); return; }
    byKey.set(k, card(`${key}.${letter ? k : 'v.' + k}`, letter ? 'Alphabet' : lessonCategory(t, m, lang), t, m, n));
  };
  c.units.forEach(u => u.lessons.forEach(l => {
    ((l.teach && l.teach.examples) || []).forEach(([t, m]) => { if (words(t) <= MAX_WORDS) addLesson(t, m, ''); });
    l.qs.flatMap(q => [q, ...(q.v || [])]).forEach(q => vocabPairs(q, lang).forEach(([t, m, n]) => addLesson(t, m, n)));
    l.qs.filter(q => q.t === 'dictation').forEach(q => mine.push({ id: q.id, d: key, cat: 'Listening',
      f: '<div class="listen">Listen. What was said?</div>', b: `<div class="ans">${txt(q.say)}</div>` + note(q.tr), say: q.say, auto: 1 }));
  }));
  // fold lesson groups with only one or two cards into Everyday phrases
  for (const g of LESSON_CATS) { const n = mine.filter(cd => cd.cat === g); if (g !== 'Listening' && n.length < 3) n.forEach(cd => cd.cat = 'Everyday phrases'); }
  const subs = Object.keys(VOCAB[key]).concat(LESSON_CATS).filter((x, i, a) => a.indexOf(x) === i && mine.some(cd => cd.cat === x));
  if (key === 'russian') subs.sort((a, b) => (b === 'Alphabet') - (a === 'Alphabet'));
  const ABC = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', pos = cd => cd.cat === 'Alphabet' ? ABC.indexOf(cd.target) : 0;
  mine.sort((a, b) => subs.indexOf(a.cat) - subs.indexOf(b.cat) || pos(a) - pos(b));
  mine.forEach(cd => { cd.u = subs.indexOf(cd.cat); delete cd.cat; });
  decks.push({ key, name, lang, subs });
  cards.push(...mine);
}
for (const c of cards) if (c.target) {
  c.f = `<div class="ans big">${txt(c.target)}</div>`;
  c.b = `<div class="ans">${txt(c.means.map(cap).join(' · '))}</div>` + note(c.note);
  c.say = c.target; c.auto = 1;
  delete c.target; delete c.means; delete c.note;
}
const counts = {}; cards.forEach(c => counts[c.d] = (counts[c.d] || 0) + 1);
console.log(cards.length, 'cards', counts);

const data = JSON.stringify({ decks, cards }).replace(/</g, '\\u003c');
const html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8').replace('/*DATA*/null', () => data);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('wrote index.html', Math.round(html.length / 1024), 'KB');
