(() => {
  'use strict';

  const APP_VERSION = '1.4.3';
  const STORAGE_KEY = 'flashcards_v1_4';
  const OLD_STORAGE_KEYS = ['flashcards_v2'];
  const UPDATE_KEY = 'flashcards_last_seen_version';

  const state = {
    vocabulary: [],
    currentIndex: 0,
    studyFilter: 'all',
    filteredVocab: [],
    direction: 'en-ar',
    dark: false,
    currentPage: 'homePage',
    testSubMode: 'writing',
    testLocked: false,
    questionToken: null,
    selectedIds: [],
    hafazni: {
      active: false,
      sessionWords: [],      // array of session word objects with temp data
      currentIndex: 0,
      mistakes: [],
      processing: false,
      summary: { correct: 0, wrong: 0, attempts: 0, mastered: [], needsReview: [] }
    },
    search: ''
  };

  const el = {};
  let recognition = null;
  let saveTimer = null;
  let feedbackBound = false;
  let guessInputResetTimer = null;

  const $ = id => document.getElementById(id);

  function cacheElements() {
    [
      'fileInput','uploadArea','totalWords','learnedCount','difficultCount','remainingCount',
      'masteryPercent','masteryFill','saveStatus','flashcard','cardFront','cardBack','wordStatus',
      'pronounceBtn','prevBtn','nextBtn','flipBtn','shuffleBtn','focusDifficultBtn','dueReviewBtn',
      'testFlashcard','testCardFront','testWordStatus','testPronounceBtn','guessInput','optionsGrid',
      'voicePanel','recordBtn','voiceState','voiceResult','testFeedback','checkBtn','hintBtn','skipBtn',
      'markDifficultBtn','typeWritingBtn','typeChoiceBtn','typeVoiceBtn','enToArBtn','arToEnBtn',
      'darkToggleBtn','helpSettingsBtn','helpModal','closeHelpModal',
      'updateModal','closeUpdateModal','viewFeaturesBtn','wordList','searchInput','newEnglish','newArabic',
      'addWordBtn','importTextBtn','textImportInput','exportBackupBtn','importBackupBtn','backupInput',
      'selectAllBtn','clearSelectionBtn','sendToHafazniBtn','selectedWordsCount','downloadWordsBtn',
      'resetProgressBtn','resetBtn','feedbackForm','feedbackSuccess','feedbackError','hafazniSelectedCount',
      'hafazniRemainingCount','startHafazniBtn','reviewMistakesBtn','hafazniSession','hafazniProgressText',
      'hafazniProgressBar','hafazniQuestion','hafazniSpeakBtn','hafazniInput','hafazniFeedback',
      'hafazniCheckBtn','hafazniSkipBtn','hafazniStopBtn','studyFilterLabel',
      'hafazniSetupCard','hafazniSummary','summaryCorrect','summaryWrong','summaryRate','summaryAttempts',
      'summaryMastered','summaryNeedsReview','summaryMistakes','summaryReviewBtn','summaryCloseBtn',
      'hafazniQuestionTypeLabel','hafazniOptionsGrid','hafazniWordStats','hafazniAttempts','hafazniMastery'
    ].forEach(id => el[id] = $(id));
  }

  function uid() {
    return (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function now() { return Date.now(); }

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeWord(word) {
    const source = word || {};
    const english = String(source.english ?? '').trim();
    const arabic = String(source.arabic ?? '').trim();
    return {
      id: String(source.id || uid()),
      english: english || '?',
      arabic: arabic || '⚠️',
      status: ['new', 'learned', 'difficult'].includes(source.status) ? source.status : 'new',
      interval: Math.max(0, safeNumber(source.interval, 0)),
      lastReview: source.lastReview ? safeNumber(source.lastReview, null) : null,
      due: source.due ? safeNumber(source.due, now()) : now(),
      correctCount: Math.max(0, safeNumber(source.correctCount, 0)),
      wrongCount: Math.max(0, safeNumber(source.wrongCount, 0)),
      selected: Boolean(source.selected),
      createdAt: source.createdAt ? safeNumber(source.createdAt, now()) : now()
    };
  }

  function normalizeVocabulary(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const result = [];
    for (const item of list) {
      const word = normalizeWord(item);
      if (seen.has(word.id)) word.id = uid();
      seen.add(word.id);
      result.push(word);
    }
    return result;
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Storage error:', error);
      return false;
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('Storage read error:', error);
      return null;
    }
  }

  function setSaveStatus(type, text) {
    if (!el.saveStatus) return;
    el.saveStatus.textContent = text;
    el.saveStatus.className = 'save-indicator' + (type ? ' ' + type : '');
  }

  function buildPersistedState() {
    return {
      version: APP_VERSION,
      vocabulary: state.vocabulary,
      currentIndex: state.currentIndex,
      studyFilter: state.studyFilter,
      direction: state.direction,
      dark: state.dark,
      currentPage: state.currentPage,
      testSubMode: state.testSubMode,
      selectedIds: state.selectedIds
    };
  }

  function saveState(immediate = false) {
    setSaveStatus('saving', '💾 جارٍ الحفظ...');
    if (saveTimer) clearTimeout(saveTimer);

    const save = () => {
      const data = buildPersistedState();
      const ok = storageSet(STORAGE_KEY, data);
      setSaveStatus(ok ? '' : 'error', ok ? '✅ محفوظ تلقائيًا' : '⚠️ تعذر الحفظ');
    };

    if (immediate) save();
    else saveTimer = setTimeout(save, 120);
  }

  function loadState() {
    let raw = storageGet(STORAGE_KEY);
    if (!raw) {
      for (const key of OLD_STORAGE_KEYS) {
        raw = storageGet(key);
        if (raw) break;
      }
    }
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      state.vocabulary = normalizeVocabulary(data.vocabulary || []);
      state.currentIndex = Math.max(0, safeNumber(data.currentIndex, 0));
      state.studyFilter = ['all','due','difficult'].includes(data.studyFilter)
        ? data.studyFilter : 'all';
      state.direction = data.direction === 'ar-en' ? 'ar-en' : 'en-ar';
      state.dark = Boolean(data.dark);
      state.currentPage = document.getElementById(data.currentPage) ? data.currentPage : 'homePage';
      state.testSubMode = ['writing','choice','voice'].includes(data.testSubMode)
        ? data.testSubMode : 'writing';
      state.selectedIds = Array.isArray(data.selectedIds) ? data.selectedIds.map(String) : [];
      state.vocabulary.forEach(w => {
        w.selected = state.selectedIds.includes(w.id) || w.selected;
      });

      applyTheme();
      applyDirectionUI();
      updateTestModeUI();

      saveState(true);
    } catch (error) {
      console.error('Invalid saved data:', error);
      setSaveStatus('error', '⚠️ بيانات الحفظ تالفة');
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.dark);
    if (el.darkToggleBtn) {
      el.darkToggleBtn.textContent = state.dark ? '☀️ الوضع الفاتح' : '🌙 الوضع الداكن';
    }
  }

  function applyDirectionUI() {
    el.enToArBtn?.classList.toggle('active', state.direction === 'en-ar');
    el.arToEnBtn?.classList.toggle('active', state.direction === 'ar-en');
  }

  function createQuestionToken(word) {
    return word.id + '::' + state.currentIndex + '::' + Date.now().toString(36);
  }

  function lockTest() {
    state.testLocked = true;
  }

  function unlockTest() {
    state.testLocked = false;
  }

  function advanceQuestion() {
    unlockTest();
    moveStudy(1);
  }

  function navigateTo(pageId, fromUser = true) {
    const page = document.getElementById(pageId);
    if (!page) return;
    state.currentPage = pageId;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });

    if (pageId === 'wordsPage') renderWordList(state.search);
    if (pageId === 'hafazniPage') updateHafazniOverview();
    if (pageId === 'testPage') {
      resetTestUI();
      updateTestView();
    }
    if (pageId === 'studyPage') updateStudyView();

    if (fromUser) saveState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getStudyList() {
    if (state.studyFilter === 'due') {
      return state.vocabulary.filter(w => !w.due || w.due <= now());
    }
    if (state.studyFilter === 'difficult') {
      return state.vocabulary.filter(w => w.status === 'difficult');
    }
    return state.vocabulary;
  }

  function getCurrentStudyWord() {
    const list = getStudyList();
    if (!list.length) return null;
    if (state.currentIndex >= list.length) state.currentIndex = Math.max(0, list.length - 1);
    return list[state.currentIndex];
  }

  function getSourceWord(word) {
    return state.direction === 'en-ar' ? word.english : word.arabic;
  }

  function getTargetWord(word) {
    return state.direction === 'en-ar' ? word.arabic : word.english;
  }

  function getStatusLabel(status) {
    if (status === 'learned') return '✅ محفوظة';
    if (status === 'difficult') return '🔴 صعبة';
    return '📝 جديدة';
  }

  function updateStats() {
    const total = state.vocabulary.length;
    const learned = state.vocabulary.filter(w => w.status === 'learned').length;
    const difficult = state.vocabulary.filter(w => w.status === 'difficult').length;
    const remaining = Math.max(0, total - learned - difficult);

    el.totalWords.textContent = total;
    el.learnedCount.textContent = learned;
    el.difficultCount.textContent = difficult;
    el.remainingCount.textContent = remaining;

    const mastery = total ? Math.round((learned / total) * 100) : 0;
    el.masteryPercent.textContent = mastery + '%';
    el.masteryFill.style.width = mastery + '%';
  }

  function resetStudyFlip() {
    el.flashcard.classList.remove('flipped');
  }

  function updateStudyFilterLabel() {
    const labels = { all: '📚 كل الكلمات', due: '📅 الكلمات المستحقة', difficult: '🔴 الكلمات الصعبة' };
    el.studyFilterLabel.textContent = labels[state.studyFilter] || labels.all;
    el.dueReviewBtn.textContent = state.studyFilter === 'due' ? '📚 الكل' : '📅 مستحق';
  }

  function updateStudyView() {
    updateStudyFilterLabel();
    const word = getCurrentStudyWord();

    if (!word) {
      el.cardFront.textContent = '📂 لا توجد كلمات';
      el.cardBack.textContent = 'أضف أو استورد كلمات أولاً';
      el.wordStatus.style.display = 'none';
      el.pronounceBtn.style.display = 'none';
      resetStudyFlip();
      return;
    }

    el.cardFront.textContent = getSourceWord(word);
    el.cardBack.textContent = getTargetWord(word);
    el.wordStatus.textContent = getStatusLabel(word.status);
    el.wordStatus.style.display = 'block';
    el.pronounceBtn.style.display = word.english && word.english !== '?' ? 'flex' : 'none';
    resetStudyFlip();
  }

  function moveStudy(delta) {
    if (state.testLocked) return;
    const list = getStudyList();
    if (!list.length) return;
    state.currentIndex = (state.currentIndex + delta + list.length) % list.length;
    resetStudyFlip();

    if (state.currentPage === 'testPage') {
      updateTestView();
    } else {
      updateStudyView();
    }

    saveState();
  }

  function flipStudyCard() {
    if (!getCurrentStudyWord()) return;
    el.flashcard.classList.toggle('flipped');
  }

  function detectTextLanguage(text) {
    return /[\u0600-\u06FF]/.test(String(text || '')) ? 'ar' : 'en';
  }

  function getTextLanguageForWord(word) {
    return detectTextLanguage(getSourceWord(word)) === 'ar' ? 'ar-SA' : 'en-US';
  }

  function getVoiceRecognitionLanguage(word) {
    return detectTextLanguage(getTargetWord(word)) === 'ar' ? 'ar-SA' : 'en-US';
  }

  function getAnswerLanguageName(word) {
    return getVoiceRecognitionLanguage(word) === 'ar-SA' ? 'العربية' : 'English';
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      console.warn('المتصفح لا يدعم النطق الصوتي.');
      return;
    }

    const value = String(text || '').trim();
    if (!value || !/[A-Za-z]/.test(value)) {
      console.warn('English pronunciation skipped: no English text.', value);
      return;
    }

    const synth = window.speechSynthesis;

    const speakWithEnglishVoice = () => {
      try {
        synth.cancel();
        const voices = synth.getVoices ? synth.getVoices() : [];
        const englishVoice = voices.find(v =>
          /^en(?:-|_)/i.test(String(v.lang || ''))
        );

        if (!englishVoice) {
          console.warn('No English TTS voice is available yet.');
          return;
        }

        const utterance = new SpeechSynthesisUtterance(value);
        utterance.lang = String(englishVoice.lang || 'en-US');
        utterance.voice = englishVoice;
        utterance.rate = 0.86;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onerror = event => {
          console.warn('English speech synthesis error:', event.error);
        };

        synth.speak(utterance);
      } catch (error) {
        console.error('Speech synthesis error:', error);
      }
    };

    const voices = synth.getVoices ? synth.getVoices() : [];

    if (voices.some(v => /^en(?:-|_)/i.test(String(v.lang || '')))) {
      speakWithEnglishVoice();
      return;
    }

    let handled = false;
    const onVoicesChanged = () => {
      if (handled) return;
      handled = true;
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      speakWithEnglishVoice();
    };

    synth.addEventListener?.('voiceschanged', onVoicesChanged);

    window.setTimeout(() => {
      if (handled) return;
      handled = true;
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      speakWithEnglishVoice();
    }, 350);
  }

  function normalizeString(str) {
    return String(str ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/[ة]/g, 'ة')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[؟?.,!،؛:;"'`’“”()[\]{}]/g, '')
      .replace(/[-_/\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;

    let prev = new Array(n + 1);
    let cur = new Array(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(
          cur[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
      }
      [prev, cur] = [cur, prev];
    }

    return prev[n];
  }

  function tokenSimilarity(a, b) {
    const aTokens = a.split(' ').filter(Boolean);
    const bTokens = b.split(' ').filter(Boolean);
    if (!aTokens.length || !bTokens.length) return 0;

    const used = new Set();
    let matched = 0;

    for (const tokenA of aTokens) {
      let best = 0;
      let bestIndex = -1;
      bTokens.forEach((tokenB, index) => {
        if (used.has(index)) return;
        const distance = levenshtein(tokenA, tokenB);
        const similarity = 1 - distance / Math.max(tokenA.length, tokenB.length, 1);
        if (similarity > best) {
          best = similarity;
          bestIndex = index;
        }
      });

      if (bestIndex >= 0 && best >= 0.72) {
        matched += best;
        used.add(bestIndex);
      }
    }

    return matched / Math.max(aTokens.length, bTokens.length);
  }

  function speechMatchScore(spoken, target) {
    const a = normalizeString(spoken);
    const b = normalizeString(target);

    if (!a || !b) {
      return { score: 0, exact: false, distance: Infinity };
    }

    if (a === b) {
      return { score: 1, exact: true, distance: 0 };
    }

    const distance = levenshtein(a, b);
    const charScore = 1 - distance / Math.max(a.length, b.length, 1);
    const tokensScore = tokenSimilarity(a, b);

    return {
      score: Math.max(charScore, tokensScore),
      exact: false,
      distance
    };
  }

  function estimateMistakes(spoken, target) {
    const match = speechMatchScore(spoken, target);

    if (match.exact) {
      return { verdict: 'correct', exact: true, count: 0, score: 1 };
    }

    const targetLength = normalizeString(target).length;
    const strongThreshold = targetLength <= 4 ? 0.92 : targetLength <= 8 ? 0.88 : 0.84;
    const probableThreshold = targetLength <= 4 ? 0.78 : 0.74;

    if (match.score >= strongThreshold) {
      return { verdict: 'probable', exact: false, count: 1, score: match.score };
    }

    if (match.score >= probableThreshold) {
      return { verdict: 'uncertain', exact: false, count: match.distance <= 2 ? 1 : 2, score: match.score };
    }

    let count = 3;
    if (match.distance === 1 || match.score >= 0.60) count = 1;
    else if (match.distance === 2 || match.score >= 0.45) count = 2;

    return { verdict: 'wrong', exact: false, count, score: match.score };
  }

  function voiceFeedback(mistakes, target, language) {
    const arabic = language.startsWith('ar');
    if (arabic) {
      if (mistakes === 1) return '⚠️ يبدو أن هناك خطأ واحدًا في النطق أو التعرف. حاول مرة أخرى.';
      if (mistakes === 2) return '⚠️ يبدو أن هناك خطأين تقريبًا. النطق لم يطابق الإجابة بالكامل.';
      return '❌ النطق بعيد عن الإجابة المطلوبة. حاول مرة أخرى بوضوح.';
    }

    if (mistakes === 1) return '⚠️ It looks like there is one pronunciation/recognition mistake. Try again.';
    if (mistakes === 2) return '⚠️ It looks like there are about two mistakes. The answer did not fully match.';
    return '❌ The recognized speech is too different from the expected answer. Try again clearly.';
  }

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopRecognition() {
    if (!recognition) return;
    try { recognition.stop(); } catch (_) {}
    recognition = null;
    el.recordBtn?.classList.remove('recording');
    if (el.recordBtn) el.recordBtn.textContent = '🎙️ ابدأ التسجيل';
  }

  function startVoiceTest() {
    if (state.testLocked) return;
    const SpeechRecognition = getSpeechRecognition();
    const word = getCurrentStudyWord();

    if (!word) {
      alert('لا توجد كلمات للاختبار.');
      return;
    }

    if (!SpeechRecognition) {
      el.voiceState.textContent = '❌ المتصفح لا يدعم التعرف على الكلام. استخدم Chrome أو Edge.';
      return;
    }

    stopRecognition();

    recognition = new SpeechRecognition();
    const language = getVoiceRecognitionLanguage(word);

    recognition.lang = language;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 5;

    const currentToken = state.questionToken;

    el.voiceState.textContent = `🎙️ أتكلم الآن للإجابة بـ ${language === 'ar-SA' ? 'العربية' : 'English'}...`;
    el.recordBtn.textContent = '⏹️ أوقف التسجيل';
    el.recordBtn.classList.add('recording');

    recognition.onresult = event => {
      if (state.questionToken !== currentToken) {
        console.warn('Voice result ignored: question changed.');
        return;
      }

      const alternatives = [];

      for (const result of Array.from(event.results || [])) {
        for (const alt of Array.from(result || [])) {
          const transcript = String(alt.transcript || '').trim();
          if (!transcript) continue;
          alternatives.push({
            transcript,
            confidence: Number.isFinite(Number(alt.confidence)) ? Number(alt.confidence) : 0
          });
        }
      }

      const tar