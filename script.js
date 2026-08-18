(() => {
  'use strict';

  const APP_VERSION = '1.4.2';
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
      ids: [],
      index: 0,
      mistakes: []
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
      'hafazniCheckBtn','hafazniSkipBtn','hafazniStopBtn','studyFilterLabel'
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
      const ok = storageSet(STORAGE_KEY, buildPersistedState());
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

      // احفظ الصيغة الجديدة بعد الترحيل من النسخة السابقة.
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

  // في الاختبار الصوتي نحدد لغة الميكروفون من الإجابة المطلوبة فقط:
  // سؤال إنجليزي -> الإجابة عربية -> recognition بالعربية.
  // سؤال عربي -> الإجابة إنجليزية -> recognition بالإنجليزية.
  function getVoiceRecognitionLanguage(word) {
    return detectTextLanguage(getTargetWord(word)) === 'ar' ? 'ar-SA' : 'en-US';
  }

  function getAnswerLanguageName(word) {
    return getVoiceRecognitionLanguage(word) === 'ar-SA' ? 'العربية' : 'English';
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      alert('المتصفح لا يدعم النطق الصوتي.');
      return;
    }

    const value = String(text || '').trim();

    // النطق هنا للإنجليزية فقط.
    // لو البيانات الإنجليزية نفسها ناقصة/عربية، لا نرسلها إلى صوت النظام.
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

        // لا نسمح للمتصفح باختيار صوت عربي كبديل.
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

    // انتظر تحميل أصوات النظام مرة واحدة بدل التأخير المتكرر.
    let handled = false;
    const onVoicesChanged = () => {
      if (handled) return;
      handled = true;
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      speakWithEnglishVoice();
    };

    synth.addEventListener?.('voiceschanged', onVoicesChanged);

    // بعض المتصفحات لا تطلق voiceschanged إذا كانت الأصوات جاهزة متأخرًا.
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

    // اللغة تُحدد من الإجابة المطلوبة في الاختبار، وليس من إعدادات الحفظ أو إعداد منفصل للصوت.
    const language = getVoiceRecognitionLanguage(word);

    recognition.lang = language;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 5;

    const currentToken = state.questionToken; // حفظ token الحالي

    el.voiceState.textContent = `🎙️ أتكلم الآن للإجابة بـ ${language === 'ar-SA' ? 'العربية' : 'English'}...`; 
    el.recordBtn.textContent = '⏹️ أوقف التسجيل';
    el.recordBtn.classList.add('recording');

    recognition.onresult = event => {
      // تجاهل النتيجة إذا تغير السؤال
      if (state.questionToken !== currentToken) return;

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

      const target = getTargetWord(word);

      if (!alternatives.length) {
        el.voiceResult.textContent = 'سمعت: —';
        el.voiceState.textContent = '⚠️ لم يصلني نص واضح. أعد التسجيل.';
        return;
      }

      // نختار أفضل بديل بناءً على قربه من الإجابة، مع استخدام الثقة كعامل مساعد.
      const scored = alternatives
        .map(item => {
          const match = estimateMistakes(item.transcript, target);
          return {
            ...item,
            match,
            combined: match.score * 0.85 + item.confidence * 0.15
          };
        })
        .sort((a, b) => b.combined - a.combined);

      const best = scored[0];
      el.voiceResult.textContent = `سمعت: ${best.transcript}`;

      if (best.match.verdict === 'correct') {
        el.testFeedback.textContent = '✅ إجابة صحيحة تمامًا!';
        el.testFeedback.className = 'test-feedback correct';
        processTestAnswer(true);
        return;
      }

      // النتيجة القريبة جدًا لا تُحسب خطأً على المستخدم.
      // نطلب إعادة التسجيل لأن التعرف الصوتي قد يكون أخطأ في كلمة واحدة.
      if (best.match.verdict === 'probable' || best.match.verdict === 'uncertain') {
        el.testFeedback.textContent =
          `${voiceFeedback(best.match.count, target, language)} لم أسجلها كخطأ حتى لا أظلمك. الصحيح: ${target}`;
        el.testFeedback.className = 'test-feedback';
        el.voiceState.textContent = '🔁 النتيجة غير مؤكدة — أعد التسجيل.';
        return;
      }

      el.testFeedback.textContent =
        `${voiceFeedback(best.match.count, target, language)} الصحيح: ${target}`;
      el.testFeedback.className = 'test-feedback wrong';
      processTestAnswer(false);
    };

    recognition.onerror = event => {
      const messages = {
        'not-allowed': '❌ تم منع الوصول إلى الميكروفون. اسمح للمتصفح باستخدام الميكروفون.',
        'service-not-allowed': '❌ خدمة التعرف على الكلام غير متاحة في هذا السياق.',
        'audio-capture': '❌ لم يتم العثور على ميكروفون متاح.',
        'no-speech': '⚠️ لم يتم التقاط كلام. حاول التحدث بوضوح.',
        'network': '❌ حدثت مشكلة اتصال بخدمة التعرف على الكلام.',
        'aborted': '⚠️ تم إيقاف التسجيل.'
      };

      el.voiceState.textContent = messages[event.error] || `❌ تعذر التسجيل: ${event.error}`;
      stopRecognition();
    };

    recognition.onend = () => {
      const currentMessage = el.voiceState.textContent || '';
      stopRecognition();

      if (!currentMessage.startsWith('❌') &&
          !currentMessage.startsWith('⚠️') &&
          !currentMessage.includes('غير مؤكدة')) {
        el.voiceState.textContent = '✅ انتهى التسجيل.';
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.error(error);
      stopRecognition();
      el.voiceState.textContent = '❌ تعذر بدء التسجيل. اضغط الزر مرة أخرى.';
    }
  }

  function processTestAnswer(isCorrect) {
    if (state.testLocked) return;

    const word = getCurrentStudyWord();
    if (!word) return;

    lockTest();

    if (isCorrect) {
      word.correctCount += 1;
      word.status = 'learned';
      word.interval = word.interval > 0 ? Math.min(word.interval * 2, 720) : 1;
    } else {
      word.wrongCount += 1;
      word.status = 'difficult';
      word.interval = 0;
    }

    word.lastReview = now();
    word.due = now() + word.interval * 3600000;
    saveState(true);
    updateStats();

    window.setTimeout(() => {
      if (state.currentPage === 'testPage') {
        advanceQuestion();
      }
    }, 900);
  }

  function updateTestModeUI() {
    const modeButtons = [
      ['writing', el.typeWritingBtn],
      ['choice', el.typeChoiceBtn],
      ['voice', el.typeVoiceBtn]
    ];
    modeButtons.forEach(([mode, btn]) => btn?.classList.toggle('active', state.testSubMode === mode));

    el.guessInput.style.display = state.testSubMode === 'writing' ? '' : 'none';
    el.optionsGrid.style.display = state.testSubMode === 'choice' ? 'grid' : 'none';
    el.voicePanel.style.display = state.testSubMode === 'voice' ? 'block' : 'none';
    el.hintBtn.style.display = state.testSubMode === 'writing' ? '' : 'none';
    el.checkBtn.style.display = state.testSubMode === 'voice' ? 'none' : '';
  }

  function updateTestView() {
    const word = getCurrentStudyWord();

    // set token and unlock for this question
    if (word) {
      state.questionToken = createQuestionToken(word);
      unlockTest();
    }

    if (!word) {
      el.testCardFront.textContent = '?';
      el.testWordStatus.style.display = 'none';
      el.testPronounceBtn.style.display = 'none';
      el.optionsGrid.innerHTML = '';
      el.voiceResult.textContent = '';
      el.voiceState.textContent = 'لا توجد كلمات للاختبار.';
      return;
    }

    el.testCardFront.textContent = getSourceWord(word);
    el.testWordStatus.textContent = getStatusLabel(word.status);
    el.testWordStatus.style.display = 'block';
    el.testPronounceBtn.style.display = word.english && word.english !== '?' ? 'flex' : 'none';

    // مسح حقل الكتابة قبل عرض السؤال الجديد حتى لا تبقى إجابة السؤال السابق
    if (state.testSubMode === 'writing') {
      if (guessInputResetTimer) { clearTimeout(guessInputResetTimer); guessInputResetTimer = null; }
      el.guessInput.value = '';
      el.guessInput.className = '';
    }

    if (state.testSubMode === 'choice') generateOptions(word);
    if (state.testSubMode === 'voice') {
      el.voiceResult.textContent = '';
      el.voiceState.textContent = `🎙️ سأستمع للإجابة بـ ${getAnswerLanguageName(word)} لأن هذا هو لسان الإجابة المطلوبة.`;
    }

    // التركيز على حقل الكتابة إذا كان الوضع كتابة
    if (state.currentPage === 'testPage' && state.testSubMode === 'writing') {
      window.setTimeout(() => el.guessInput.focus(), 0);
    }
  }

  function resetTestUI() {
    stopRecognition();
    el.guessInput.value = '';
    el.guessInput.className = '';
    el.testFeedback.textContent = '';
    el.testFeedback.className = 'test-feedback';
    el.optionsGrid.innerHTML = '';
    updateTestView();
  }

  function checkWriting() {
    if (state.testLocked) return;

    const word = getCurrentStudyWord();
    if (!word) return;

    const input = normalizeString(el.guessInput.value);
    if (!input) {
      el.testFeedback.textContent = '⚠️ اكتب الإجابة أولًا.';
      el.testFeedback.className = 'test-feedback';
      return;
    }

    const correct = normalizeString(getTargetWord(word));
    const isCorrect = input === correct;
    el.guessInput.className = isCorrect ? 'correct' : 'wrong';
    el.testFeedback.textContent = isCorrect ? '✅ إجابة صحيحة!' : `❌ الصحيح: ${getTargetWord(word)}`;
    el.testFeedback.className = 'test-feedback ' + (isCorrect ? 'correct' : 'wrong');

    // إزالة class بعد فترة قصيرة دون التأثير على القفل
    if (guessInputResetTimer) clearTimeout(guessInputResetTimer);
    guessInputResetTimer = window.setTimeout(() => {
      el.guessInput.className = '';
    }, 500);

    processTestAnswer(isCorrect);
  }

  function generateOptions(correctWord) {
    const target = getTargetWord(correctWord);
    const candidates = state.vocabulary
      .filter(w => w.id !== correctWord.id && getTargetWord(w) !== target)
      .sort(() => Math.random() - .5)
      .slice(0, 3)
      .map(getTargetWord);

    while (candidates.length < 3 && state.vocabulary.length) {
      const fallback = getTargetWord(state.vocabulary[candidates.length % state.vocabulary.length]);
      if (!candidates.includes(fallback) && fallback !== target) candidates.push(fallback);
      else break;
    }

    const options = [target, ...candidates].sort(() => Math.random() - .5);
    el.optionsGrid.innerHTML = '';

    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option-btn';
      button.textContent = option;
      button.addEventListener('click', () => handleChoice(option));
      el.optionsGrid.appendChild(button);
    });
  }

  function handleChoice(selected) {
    if (state.testLocked) return;

    const word = getCurrentStudyWord();
    if (!word) return;

    const correctAnswer = getTargetWord(word);
    const isCorrect = normalizeString(selected) === normalizeString(correctAnswer);

    el.optionsGrid.querySelectorAll('.option-btn').forEach(button => {
      button.disabled = true;
      if (normalizeString(button.textContent) === normalizeString(correctAnswer)) {
        button.classList.add('correct-choice');
      }
      if (normalizeString(button.textContent) === normalizeString(selected) && !isCorrect) {
        button.classList.add('wrong-choice');
      }
    });

    el.testFeedback.textContent = isCorrect ? '✅ إجابة صحيحة!' : `❌ الصحيح: ${correctAnswer}`;
    el.testFeedback.className = 'test-feedback ' + (isCorrect ? 'correct' : 'wrong');
    processTestAnswer(isCorrect);
  }

  function markCurrentDifficult() {
    const word = getCurrentStudyWord();
    if (!word) return;
    word.status = 'difficult';
    word.interval = 0;
    word.due = now();
    word.wrongCount += 1;
    saveState(true);
    updateStats();
    updateStudyView();
    updateTestView();
    el.testFeedback.textContent = '🔴 تم وضع الكلمة في قائمة الصعبة.';
    el.testFeedback.className = 'test-feedback wrong';
  }

  function showHint() {
    const word = getCurrentStudyWord();
    if (!word) return;
    const target = getTargetWord(word);
    el.testFeedback.textContent = `💡 أول حرف: "${target.charAt(0)}..."`;
    el.testFeedback.className = 'test-feedback';
  }

  function shuffleVocabulary() {
    if (state.vocabulary.length < 2) return;
    for (let i = state.vocabulary.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.vocabulary[i], state.vocabulary[j]] = [state.vocabulary[j], state.vocabulary[i]];
    }
    state.currentIndex = 0;
    saveState(true);
    updateStats();
    updateStudyView();
    updateTestView();
  }

  function setStudyFilter(filter) {
    if (filter === 'difficult' && !state.vocabulary.some(w => w.status === 'difficult')) {
      alert('لا توجد كلمات صعبة.');
      return;
    }
    if (filter === 'due' && !state.vocabulary.some(w => !w.due || w.due <= now())) {
      alert('لا توجد كلمات مستحقة للمراجعة الآن.');
      return;
    }
    state.studyFilter = state.studyFilter === filter ? 'all' : filter;
    state.currentIndex = 0;
    updateStudyView();
    updateTestView();
    saveState();
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseFile(text) {
    const result = [];
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      let english = '';
      let arabic = '';

      const csv = parseCSVLine(line);
      if (csv.length >= 2) {
        english = csv.shift().trim();
        arabic = csv.join(',').trim();
      } else if (line.includes('=')) {
        const parts = line.split('=');
        english = parts.shift().trim();
        arabic = parts.join('=').trim();
      } else if (line.includes('→')) {
        const parts = line.split('→');
        english = parts.shift().trim();
        arabic = parts.join('→').trim();
      } else if (line.includes(' - ')) {
        const parts = line.split(' - ');
        english = parts.shift().trim();
        arabic = parts.join(' - ').trim();
      } else if (line.includes('\t')) {
        const parts = line.split('\t');
        english = parts.shift().trim();
        arabic = parts.join('\t').trim();
      } else {
        english = line;
        arabic = '⚠️';
      }

      english = english.replace(/^["']|["']$/g, '').trim();
      arabic = arabic.replace(/^["']|["']$/g, '').trim();
      arabic = arabic.replace(/\bNaN\b/gi, '').trim() || '⚠️';

      if (!english) english = '?';
      result.push(normalizeWord({
        english,
        arabic,
        status: 'new',
        interval: 0,
        lastReview: null,
        due: now(),
        selected: false
      }));
    }

    return result;
  }

  async function readFileText(file) {
    if (!file) throw new Error('No file');
    if (file.size > 8 * 1024 * 1024) throw new Error('الملف كبير جدًا. الحد 8MB.');
    return file.text();
  }

  async function importTextFile(file) {
    try {
      const text = await readFileText(file);
      const incoming = parseFile(text);
      if (!incoming.length) {
        alert('لم أجد كلمات قابلة للقراءة في الملف.');
        return;
      }

      if (state.vocabulary.length) {
        const add = confirm(`تم العثور على ${incoming.length} كلمة. اضغط موافق لإضافتها للكلمات الحالية، أو إلغاء لاستبدال القائمة.`);
        if (add) {
          const existingPairs = new Set(state.vocabulary.map(w => normalizeString(w.english) + '|' + normalizeString(w.arabic)));
          for (const word of incoming) {
            const pair = normalizeString(word.english) + '|' + normalizeString(word.arabic);
            if (!existingPairs.has(pair)) {
              state.vocabulary.push(word);
              existingPairs.add(pair);
            }
          }
        } else {
          state.vocabulary = incoming;
        }
      } else {
        state.vocabulary = incoming;
      }

      state.selectedIds = state.vocabulary.filter(w => w.selected).map(w => w.id);
      state.currentIndex = 0;
      state.studyFilter = 'all';
      state.search = '';
      el.searchInput.value = '';
      saveState(true);
      updateAllViews();
      alert(`✅ تم تحميل ${incoming.length} كلمة بنجاح.`);
      navigateTo('studyPage');
    } catch (error) {
      console.error(error);
      alert('❌ تعذر قراءة الملف. تأكد أنه TXT أو CSV نصي سليم.');
    }
  }

  function addWord() {
    const english = el.newEnglish.value.trim();
    const arabic = el.newArabic.value.trim();

    if (!english || !arabic) {
      alert('اكتب الكلمة الإنجليزية والترجمة معًا.');
      return;
    }

    const duplicate = state.vocabulary.some(w =>
      normalizeString(w.english) === normalizeString(english) &&
      normalizeString(w.arabic) === normalizeString(arabic)
    );
    if (duplicate) {
      alert('⚠️ هذه الكلمة موجودة بالفعل.');
      return;
    }

    state.vocabulary.push(normalizeWord({ english, arabic }));
    el.newEnglish.value = '';
    el.newArabic.value = '';
    saveState(true);
    updateAllViews();
    el.newEnglish.focus();
  }

  function cycleStatus(index) {
    const word = state.vocabulary[index];
    if (!word) return;
    word.status = word.status === 'new' ? 'learned' : word.status === 'learned' ? 'difficult' : 'new';
    if (word.status === 'new') {
      word.interval = 0;
      word.due = now();
    }
    saveState(true);
    updateAllViews();
  }

  function deleteWord(index) {
    const word = state.vocabulary[index];
    if (!word) return;
    if (!confirm(`حذف "${word.english}"؟`)) return;

    state.vocabulary.splice(index, 1);
    state.selectedIds = state.vocabulary.filter(w => w.selected).map(w => w.id);
    state.currentIndex = Math.min(state.currentIndex, Math.max(0, getStudyList().length - 1));
    saveState(true);
    updateAllViews();
  }

  function renderWordList(filter = '') {
    const query = normalizeString(filter);
    el.wordList.innerHTML = '';

    const items = state.vocabulary
      .map((word, index) => ({ word, index }))
      .filter(({ word }) =>
        !query ||
        normalizeString(word.english).includes(query) ||
        normalizeString(word.arabic).includes(query)
      );

    if (!items.length) {
      el.wordList.innerHTML = '<div class="empty-state">لا توجد كلمات مطابقة.</div>';
      updateSelectionUI();
      return;
    }

    const fragment = document.createDocumentFragment();

    items.forEach(({ word, index }) => {
      const item = document.createElement('div');
      item.className = 'word-item' + (word.selected ? ' selected' : '');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'word-check';
      check.checked = word.selected;
      check.title = 'اختيار لـ حفظني';
      check.addEventListener('change', () => {
        word.selected = check.checked;
        syncSelectedIds();
        item.classList.toggle('selected', word.selected);
        updateSelectionUI();
        saveState();
      });

      const pair = document.createElement('div');
      pair.className = 'word-pair';
      const strong = document.createElement('strong');
      strong.textContent = word.english;
      const arabic = document.createElement('span');
      arabic.className = 'arabic-line';
      arabic.textContent = '→ ' + word.arabic;
      pair.append(strong, arabic);

      const actions = document.createElement('div');
      actions.className = 'word-actions';

      const status = document.createElement('button');
      status.type = 'button';
      status.className = 'status-btn ' + word.status;
      status.textContent = getStatusLabel(word.status);
      status.addEventListener('click', () => cycleStatus(index));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete-btn';
      del.textContent = '🗑';
      del.title = 'حذف';
      del.addEventListener('click', () => deleteWord(index));

      actions.append(status, del);
      item.append(check, pair, actions);
      fragment.appendChild(item);
    });

    el.wordList.appendChild(fragment);
    updateSelectionUI();
  }

  function syncSelectedIds() {
    state.selectedIds = state.vocabulary.filter(w => w.selected).map(w => w.id);
  }

  function updateSelectionUI() {
    syncSelectedIds();
    const count = state.selectedIds.length;
    el.selectedWordsCount.textContent = count;
    el.hafazniSelectedCount.textContent = count;
    el.sendToHafazniBtn.disabled = count === 0;
  }

  function selectAll() {
    const query = normalizeString(state.search);
    state.vocabulary.forEach(word => {
      if (!query || normalizeString(word.english).includes(query) || normalizeString(word.arabic).includes(query)) {
        word.selected = true;
      }
    });
    saveState(true);
    renderWordList(state.search);
  }

  function clearSelection() {
    state.vocabulary.forEach(word => word.selected = false);
    state.selectedIds = [];
    saveState(true);
    renderWordList(state.search);
  }

  function goToHafazni() {
    updateSelectionUI();
    if (!state.selectedIds.length) {
      alert('حدد كلمة واحدة على الأقل أولًا.');
      return;
    }
    navigateTo('hafazniPage');
  }

  function updateHafazniOverview() {
    updateSelectionUI();
    const remaining = state.hafazni.active
      ? Math.max(0, state.hafazni.ids.length - state.hafazni.index)
      : state.selectedIds.length;
    el.hafazniRemainingCount.textContent = remaining;
  }

  function getWordsByIds(ids) {
    const set = new Set(ids);
    return state.vocabulary.filter(w => set.has(w.id));
  }

  function startHafazniSession(ids = state.selectedIds) {
    const words = getWordsByIds(ids);
    if (!words.length) {
      alert('حدد كلمات أولًا من صفحة الكلمات.');
      return;
    }

    state.hafazni.active = true;
    state.hafazni.ids = words.map(w => w.id);
    state.hafazni.index = 0;
    state.hafazni.mistakes = [];
    el.hafazniSession.style.display = 'block';
    resetHafazniQuestion();
    updateHafazniOverview();
  }

  function resetHafazniQuestion() {
    const ids = state.hafazni.ids;
    if (!ids.length) return;

    if (state.hafazni.index >= ids.length) {
      finishHafazni();
      return;
    }

    const word = state.vocabulary.find(w => w.id === ids[state.hafazni.index]);
    if (!word) {
      state.hafazni.index++;
      resetHafazniQuestion();
      return;
    }

    el.hafazniProgressText.textContent = `${state.hafazni.index + 1} / ${ids.length}`;
    el.hafazniProgressBar.style.width = `${((state.hafazni.index + 1) / ids.length) * 100}%`;
    el.hafazniQuestion.textContent = getSourceWord(word);
    el.hafazniInput.value = '';
    el.hafazniInput.className = '';
    el.hafazniFeedback.textContent = '';
    el.hafazniFeedback.className = 'test-feedback';

    // ينطق السؤال تلقائيًا، كما طلبت فكرة "حفظني".
    speak(word.english);
  }

  function checkHafazni() {
    if (!state.hafazni.active) return;
    const word = state.vocabulary.find(w => w.id === state.hafazni.ids[state.hafazni.index]);
    if (!word) return;

    const answer = normalizeString(el.hafazniInput.value);
    if (!answer) {
      el.hafazniFeedback.textContent = '⚠️ اكتب الإجابة أولًا.';
      return;
    }

    const target = normalizeString(getTargetWord(word));
    const correct = answer === target;

    el.hafazniInput.className = correct ? 'correct' : 'wrong';
    el.hafazniFeedback.textContent = correct
      ? '✅ ممتاز، إجابة صحيحة.'
      : `❌ الصحيح: ${getTargetWord(word)}`;
    el.hafazniFeedback.className = 'test-feedback ' + (correct ? 'correct' : 'wrong');

    if (correct) {
      word.status = 'learned';
      word.correctCount += 1;
      word.interval = word.interval > 0 ? Math.min(word.interval * 2, 720) : 1;
      word.due = now() + word.interval * 3600000;
    } else {
      word.status = 'difficult';
      word.wrongCount += 1;
      word.interval = 0;
      word.due = now();
      if (!state.hafazni.mistakes.includes(word.id)) state.hafazni.mistakes.push(word.id);
    }
    word.lastReview = now();

    saveState(true);
    updateStats();
    updateHafazniOverview();

    window.setTimeout(() => {
      state.hafazni.index++;
      resetHafazniQuestion();
      updateHafazniOverview();
    }, 800);
  }

  function skipHafazni() {
    if (!state.hafazni.active) return;
    state.hafazni.index++;
    resetHafazniQuestion();
    updateHafazniOverview();
  }

  function stopHafazni() {
    state.hafazni.active = false;
    el.hafazniSession.style.display = 'none';
    updateHafazniOverview();
  }

  function finishHafazni() {
    state.hafazni.active = false;
    el.hafazniSession.style.display = 'none';

    const mistakeCount = state.hafazni.mistakes.length;
    const message = mistakeCount
      ? `انتهت جلسة حفظني. عدد الكلمات التي تحتاج مراجعة: ${mistakeCount}.`
      : '🎉 انتهت جلسة حفظني بدون أخطاء.';
    alert(message);
    updateHafazniOverview();
    updateAllViews();
  }

  function reviewMistakes() {
    if (!state.hafazni.mistakes.length) {
      alert('لا توجد أخطاء في آخر جلسة.');
      return;
    }
    startHafazniSession(state.hafazni.mistakes);
  }

  function downloadTextWords() {
    if (!state.vocabulary.length) {
      alert('لا توجد كلمات لتنزيلها.');
      return;
    }
    const lines = state.vocabulary.map(w => `${w.english}, ${w.arabic}`).join('\n');
    downloadBlob(lines, 'words.txt', 'text/plain;charset=utf-8');
  }

  function exportBackup() {
    const backup = {
      app: 'Flashcards',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: buildPersistedState()
    };
    downloadBlob(JSON.stringify(backup, null, 2), 'flashcards-backup-1.4.2.json', 'application/json;charset=utf-8');
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = parsed.data || parsed;

      if (!data || !Array.isArray(data.vocabulary)) {
        throw new Error('Invalid backup');
      }

      state.vocabulary = normalizeVocabulary(data.vocabulary);
      state.currentIndex = Math.max(0, safeNumber(data.currentIndex, 0));
      state.studyFilter = ['all','due','difficult'].includes(data.studyFilter) ? data.studyFilter : 'all';
      state.direction = data.direction === 'ar-en' ? 'ar-en' : 'en-ar';
      state.dark = Boolean(data.dark);
      state.testSubMode = ['writing','choice','voice'].includes(data.testSubMode) ? data.testSubMode : 'writing';
      state.selectedIds = Array.isArray(data.selectedIds)
        ? data.selectedIds.map(String).filter(id => state.vocabulary.some(w => w.id === id))
        : state.vocabulary.filter(w => w.selected).map(w => w.id);
      state.vocabulary.forEach(w => w.selected = state.selectedIds.includes(w.id));

      applyTheme();
      applyDirectionUI();
      updateTestModeUI();
      saveState(true);
      updateAllViews();
      alert(`✅ تم استرجاع ${state.vocabulary.length} كلمة.`);
    } catch (error) {
      console.error(error);
      alert('❌ ملف النسخة الاحتياطية غير صالح.');
    }
  }

  function downloadBlob(content, name, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetProgress() {
    if (!state.vocabulary.length) return;
    if (!confirm('إعادة كل الكلمات إلى "جديدة"؟')) return;

    state.vocabulary.forEach(w => {
      w.status = 'new';
      w.interval = 0;
      w.lastReview = null;
      w.due = now();
      w.correctCount = 0;
      w.wrongCount = 0;
    });
    state.currentIndex = 0;
    state.studyFilter = 'all';
    saveState(true);
    updateAllViews();
  }

  function resetAll() {
    if (!state.vocabulary.length) return;
    if (!confirm('سيتم حذف كل الكلمات والتقدم من هذا المتصفح. هل أنت متأكد؟')) return;

    state.vocabulary = [];
    state.currentIndex = 0;
    state.selectedIds = [];
    state.studyFilter = 'all';
    state.hafazni = { active: false, ids: [], index: 0, mistakes: [] };
    el.hafazniSession.style.display = 'none';
    storageSet(STORAGE_KEY, buildPersistedState());
    updateAllViews();
    navigateTo('homePage');
  }

  function updateAllViews() {
    updateStats();
    updateStudyView();
    updateTestView();
    renderWordList(state.search);
    updateSelectionUI();
    updateHafazniOverview();
  }

  function openModal(modal) { if (modal) modal.style.display = 'flex'; }
  function closeModal(modal) { if (modal) modal.style.display = 'none'; }

  function showUpdateIfNeeded() {
    const seen = storageGet(UPDATE_KEY);
    if (seen !== APP_VERSION) {
      openModal(el.updateModal);
      try { localStorage.setItem(UPDATE_KEY, APP_VERSION); } catch (_) {}
    }
  }

  async function setupFeedbackForm() {
    if (!el.feedbackForm || feedbackBound) return;
    feedbackBound = true;

    el.feedbackForm.addEventListener('submit', async event => {
      event.preventDefault();
      el.feedbackSuccess.style.display = 'none';
      el.feedbackError.style.display = 'none';

      const button = el.feedbackForm.querySelector('button[type="submit"]');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '⏳ جارٍ الإرسال...';

      try {
        const response = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          body: new FormData(el.feedbackForm),
          headers: { Accept: 'application/json' }
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Submission failed');
        }

        el.feedbackSuccess.textContent = '✅ تم إرسال رأيك بنجاح. شكرًا لك!';
        el.feedbackSuccess.style.display = 'block';
        el.feedbackForm.reset();
      } catch (error) {
        console.error(error);
        el.feedbackError.textContent = '❌ تعذر الإرسال. هذه الميزة تحتاج اتصالًا بالإنترنت.';
        el.feedbackError.style.display = 'block';
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  function setupEvents() {
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    document.querySelectorAll('[data-action="navigate"]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    el.fileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importTextFile(file);
      event.target.value = '';
    });

    el.uploadArea.addEventListener('dragover', event => {
      event.preventDefault();
      el.uploadArea.classList.add('dragover');
    });

    el.uploadArea.addEventListener('dragleave', () => el.uploadArea.classList.remove('dragover'));

    el.uploadArea.addEventListener('drop', event => {
      event.preventDefault();
      el.uploadArea.classList.remove('dragover');
      const file = event.dataTransfer.files?.[0];
      if (file) importTextFile(file);
    });

    el.flashcard.addEventListener('click', event => {
      if (event.target.closest('.pronounce-btn')) return;
      flipStudyCard();
    });
    el.flashcard.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flipStudyCard();
      }
    });

    el.flipBtn.addEventListener('click', flipStudyCard);
    el.prevBtn.addEventListener('click', () => {
      if (state.testLocked) return;
      moveStudy(-1);
    });
    el.nextBtn.addEventListener('click', () => {
      if (state.testLocked) return;
      moveStudy(1);
    });

    el.pronounceBtn.addEventListener('click', event => {
      event.stopPropagation();
      const word = getCurrentStudyWord();
      if (word) speak(word.english);
    });

    el.testPronounceBtn.addEventListener('click', event => {
      event.stopPropagation();
      const word = getCurrentStudyWord();
      if (word) speak(word.english);
    });

    el.checkBtn.addEventListener('click', checkWriting);
    el.hintBtn.addEventListener('click', showHint);
    el.skipBtn.addEventListener('click', () => {
      if (state.testLocked) return;
      moveStudy(1);
    });
    el.markDifficultBtn.addEventListener('click', markCurrentDifficult);
    el.recordBtn.addEventListener('click', () => recognition ? stopRecognition() : startVoiceTest());

    el.typeWritingBtn.addEventListener('click', () => {
      state.testSubMode = 'writing';
      updateTestModeUI();
      resetTestUI();
      saveState();
    });
    el.typeChoiceBtn.addEventListener('click', () => {
      state.testSubMode = 'choice';
      updateTestModeUI();
      resetTestUI();
      saveState();
    });
    el.typeVoiceBtn.addEventListener('click', () => {
      state.testSubMode = 'voice';
      updateTestModeUI();
      resetTestUI();
      saveState();
    });

    el.enToArBtn.addEventListener('click', () => {
      state.direction = 'en-ar';
      applyDirectionUI();
      updateAllViews();
      saveState();
    });
    el.arToEnBtn.addEventListener('click', () => {
      state.direction = 'ar-en';
      applyDirectionUI();
      updateAllViews();
      saveState();
    });

    el.darkToggleBtn.addEventListener('click', () => {
      state.dark = !state.dark;
      applyTheme();
      saveState();
    });

    el.shuffleBtn.addEventListener('click', shuffleVocabulary);
    el.focusDifficultBtn.addEventListener('click', () => setStudyFilter('difficult'));
    el.dueReviewBtn.addEventListener('click', () => setStudyFilter('due'));

    el.newEnglish.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addWord();
      }
    });
    el.newArabic.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addWord();
      }
    });

    el.addWordBtn.addEventListener('click', addWord);

    el.importTextBtn.addEventListener('click', () => el.textImportInput.click());
    el.textImportInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importTextFile(file);
      event.target.value = '';
    });

    el.exportBackupBtn.addEventListener('click', exportBackup);
    el.importBackupBtn.addEventListener('click', () => el.backupInput.click());
    el.backupInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
      event.target.value = '';
    });

    el.selectAllBtn.addEventListener('click', selectAll);
    el.clearSelectionBtn.addEventListener('click', clearSelection);
    el.sendToHafazniBtn.addEventListener('click', goToHafazni);
    el.downloadWordsBtn.addEventListener('click', downloadTextWords);
    el.resetProgressBtn.addEventListener('click', resetProgress);
    el.resetBtn.addEventListener('click', resetAll);

    el.searchInput.addEventListener('input', event => {
      state.search = event.target.value;
      renderWordList(state.search);
    });

    el.startHafazniBtn.addEventListener('click', () => startHafazniSession());
    el.reviewMistakesBtn.addEventListener('click', reviewMistakes);
    el.hafazniSpeakBtn.addEventListener('click', () => {
      const word = state.vocabulary.find(w => w.id === state.hafazni.ids[state.hafazni.index]);
      if (word) speak(word.english);
    });
    el.hafazniCheckBtn.addEventListener('click', checkHafazni);
    el.hafazniSkipBtn.addEventListener('click', skipHafazni);
    el.hafazniStopBtn.addEventListener('click', stopHafazni);
    el.hafazniInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        checkHafazni();
      }
    });

    el.helpSettingsBtn.addEventListener('click', () => openModal(el.helpModal));
    el.closeHelpModal.addEventListener('click', () => closeModal(el.helpModal));
    el.closeUpdateModal.addEventListener('click', () => closeModal(el.updateModal));
    el.viewFeaturesBtn.addEventListener('click', () => openModal(el.updateModal));

    window.addEventListener('click', event => {
      if (event.target === el.helpModal) closeModal(el.helpModal);
      if (event.target === el.updateModal) closeModal(el.updateModal);
    });

    document.addEventListener('keydown', event => {
      const target = event.target;
      if (target && ['INPUT','TEXTAREA'].includes(target.tagName)) {
        if (event.key === 'Enter' && target === el.guessInput) {
          event.preventDefault();
          checkWriting();
        }
        return;
      }

      if (state.currentPage === 'testPage' && state.testLocked) return;

      if (event.key === 'ArrowRight') moveStudy(1);
      if (event.key === 'ArrowLeft') moveStudy(-1);
      if (event.code === 'Space' && state.currentPage === 'studyPage') {
        event.preventDefault();
        flipStudyCard();
      }
      if (event.key.toLowerCase() === 's' && state.currentPage === 'testPage' && state.testSubMode === 'voice') {
        startVoiceTest();
      }
    });

    window.addEventListener('beforeunload', () => saveState(true));
    window.addEventListener('pagehide', () => saveState(true));

    setupFeedbackForm();
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  }

  function init() {
    cacheElements();
    loadState();
    setupEvents();
    applyTheme();
    applyDirectionUI();
    updateTestModeUI();
    updateAllViews();

    if (!state.vocabulary.length) {
      navigateTo('homePage', false);
    } else {
      navigateTo(state.currentPage === 'homePage' ? 'studyPage' : state.currentPage, false);
    }

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      registerServiceWorker();
    }
    showUpdateIfNeeded();
  }

  init();
})();
