/* =============================================================================
 * StudyBrain v0.4 — Frontend Logic
 * ========================================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'studybrain.state.v3';

  const DEFAULT_GRADE_SCALE = {
    'A': 93, 'A-': 90,
    'B+': 87, 'B': 83, 'B-': 80,
    'C+': 77, 'C': 73, 'C-': 70,
    'D': 60, 'F': 0,
  };

  const VALID_THEMES = ['dark', 'gray', 'light', 'gold'];
  const DEFAULT_SETTINGS = { showPercentage: true, showLetter: true, showChapters: true, theme: 'dark' };
  const VALID_TUTOR_MODES = ['socratic', 'summary', 'test'];
  const VALID_SUBMODES = ['flashcards', 'multiple_choice', 'short_answer'];
  const VALID_SUMMARY_MODES = ['cheatsheet', 'overview'];
  const DEFAULT_TEST_STATE = {
    index: 0, flipped: false, explainShown: false, explainText: '', answer: '', right: 0, wrong: 0,
    subMode: 'flashcards',
    shuffled: false, shuffledOrder: null,
    selectedChapterIds: null, // null = all chapters; [] = none; otherwise array of chapter IDs
    // Multiple choice specific
    mcSelectedOption: null, mcGraded: false, mcExplainShown: false, mcExplainText: '', mcSeed: 0,
  };
  const DEFAULT_SUMMARY_STATE = {
    mode: 'cheatsheet',
    selectedChapterIds: null, // null = all chapters; [] = none
    selectedTopicKey: null, // "chIdx:topicIdx"
  };

  const defaultState = {
    user: null,
    activeCourseId: 'econ-3251',
    activeChapterId: 'ch-1',
    courses: [
      {
        id: 'econ-3251', code: 'ECON 3251', name: 'Intermediate Macroeconomics',
        gradePercentage: 91, gradeLetter: 'A-', gradeManual: false,
        gradeScale: { ...DEFAULT_GRADE_SCALE },
        gradingWeights: [
          { id: 'w1', name: 'Exams', weight: 50, earned: 88 },
          { id: 'w2', name: 'Homework', weight: 30, earned: 95 },
          { id: 'w3', name: 'Participation', weight: 20, earned: 100 },
        ],
        chapters: [
          { id: 'ch-1', title: 'Aggregate Demand', topics: ['IS-LM', 'Multiplier effect'] },
          { id: 'ch-2', title: 'Aggregate Supply', topics: ['SRAS', 'LRAS'] },
          { id: 'ch-3', title: 'Phillips Curve', topics: ['Short-run', 'Long-run'] },
          { id: 'ch-4', title: 'Sticky Price Models', topics: [] },
          { id: 'ch-5', title: 'Monetary Policy', topics: [] },
        ],
        coursework: [],
        studyMaterials: {},
      },
      {
        id: 'math-2300', code: 'MATH 2300', name: 'Calculus II',
        gradePercentage: 87, gradeLetter: 'B+', gradeManual: true,
        gradeScale: { ...DEFAULT_GRADE_SCALE }, gradingWeights: [],
        chapters: [
          { id: 'ch-1', title: 'Integration Techniques', topics: [] },
          { id: 'ch-2', title: 'Series', topics: [] },
        ],
        coursework: [],
        studyMaterials: {},
      },
      {
        id: 'cs-1050', code: 'CS 1050', name: 'Algorithm Design',
        gradePercentage: 95, gradeLetter: 'A', gradeManual: true,
        gradeScale: { ...DEFAULT_GRADE_SCALE }, gradingWeights: [],
        chapters: [
          { id: 'ch-1', title: 'Big-O Notation', topics: [] },
          { id: 'ch-2', title: 'Sorting', topics: [] },
        ],
        coursework: [],
        studyMaterials: {},
      },
    ],
    chatHistory: {},
    dashboardCollapsed: false,
    tutorMode: 'socratic',
    testState: { ...DEFAULT_TEST_STATE },
    summaryState: { ...DEFAULT_SUMMARY_STATE },
    settings: { ...DEFAULT_SETTINGS },
  };

  // ===========================================================================
  // STATE
  // ===========================================================================

  let state = loadState();
  let pendingIngest = null;
  let editingChapterId = null;
  let editingCourseId = null;
  let flashExplainRequestId = 0;
  let mcExplainRequestId = 0;
  // Coursework staged for add-class modal
  let addClassStagedIngest = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const saved = JSON.parse(raw);
      const merged = { ...structuredClone(defaultState), ...saved };
      merged.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      if (!VALID_THEMES.includes(merged.settings.theme)) merged.settings.theme = 'dark';
      merged.tutorMode = VALID_TUTOR_MODES.includes(saved.tutorMode) ? saved.tutorMode : 'socratic';
      merged.testState = { ...DEFAULT_TEST_STATE, ...(saved.testState || {}) };
      // Migrate any old subMode names
      if (!VALID_SUBMODES.includes(merged.testState.subMode)) merged.testState.subMode = 'flashcards';
      merged.summaryState = { ...DEFAULT_SUMMARY_STATE, ...(saved.summaryState || {}) };
      if (!VALID_SUMMARY_MODES.includes(merged.summaryState.mode)) merged.summaryState.mode = 'cheatsheet';
      if (Array.isArray(merged.courses)) {
        merged.courses = merged.courses.map(c => ({
          gradeManual: false, gradeScale: { ...DEFAULT_GRADE_SCALE },
          gradingWeights: [], coursework: [], chapters: [], studyMaterials: {}, ...c,
        }));
      }
      return merged;
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  // ===========================================================================
  // GRADE LOGIC
  // ===========================================================================

  function computeGradeFromWeights(weights) {
    if (!weights?.length) return null;
    const total = weights.reduce((s, w) => s + (Number(w.weight) || 0), 0);
    if (total <= 0) return null;
    const earned = weights.reduce((s, w) => s + ((Number(w.weight) || 0) * (Number(w.earned) || 0) / 100), 0);
    return Math.round((earned / total) * 100 * 10) / 10;
  }

  function letterFromPercentage(pct, scale) {
    if (pct == null || isNaN(pct)) return '—';
    const entries = Object.entries(scale || DEFAULT_GRADE_SCALE).sort((a, b) => b[1] - a[1]);
    for (const [letter, cutoff] of entries) if (pct >= cutoff) return letter;
    return 'F';
  }

  function refreshCourseGrade(course) {
    if (!course || course.gradeManual) return;
    const c = computeGradeFromWeights(course.gradingWeights);
    if (c != null) { course.gradePercentage = c; course.gradeLetter = letterFromPercentage(c, course.gradeScale); }
  }

  function refreshAllGrades() { state.courses.forEach(refreshCourseGrade); }

  // ===========================================================================
  // DOM REFS
  // ===========================================================================

  const $ = id => document.getElementById(id);
  const el = {
    authScreen:         $('authScreen'),
    appScreen:          $('appScreen'),
    tabSignIn:          $('tabSignIn'),
    tabSignUp:          $('tabSignUp'),
    signInForm:         $('signInForm'),
    signUpForm:         $('signUpForm'),
    signInEmail:        $('signInEmail'),
    signInPassword:     $('signInPassword'),
    signInError:        $('signInError'),
    signUpName:         $('signUpName'),
    signUpEmail:        $('signUpEmail'),
    signUpPassword:     $('signUpPassword'),
    signUpError:        $('signUpError'),
    avatarBtn:          $('avatarBtn'),
    accountModal:       $('accountModal'),
    accountInitials:    $('accountInitials'),
    accountName:        $('accountName'),
    accountEmail:       $('accountEmail'),
    accountSettingsBtn: $('accountSettingsBtn'),
    accountSignOutBtn:  $('accountSignOutBtn'),
    courseGrid:         $('courseGrid'),
    chapterList:        $('chapterList'),
    chapterHeading:     $('chapterHeading'),
    activeClassLabel:   $('activeClassLabel'),
    activeClassName:    $('activeClassName'),
    contextLabel:       $('contextLabel'),
    tutorModeSelect:    $('tutorModeSelect'),
    socraticPanel:      $('socraticPanel'),
    summaryPanel:       $('summaryPanel'),
    testPanel:          $('testPanel'),
    // Summary mode
    summaryCourseSelect:    $('summaryCourseSelect'),
    summaryChapterBtn:      $('summaryChapterBtn'),
    summaryChapterBtnLabel: $('summaryChapterBtnLabel'),
    summaryChapterPopover:  $('summaryChapterPopover'),
    cheatsheetPanel:        $('cheatsheetPanel'),
    cheatsheetContent:      $('cheatsheetContent'),
    overviewPanel:          $('overviewPanel'),
    overviewTopicSelect:    $('overviewTopicSelect'),
    overviewContent:        $('overviewContent'),
    // Test mode
    testCourseSelect:       $('testCourseSelect'),
    testChapterBtn:         $('testChapterBtn'),
    testChapterBtnLabel:    $('testChapterBtnLabel'),
    testChapterPopover:     $('testChapterPopover'),
    testShuffleBtn:         $('testShuffleBtn'),
    flashcardsPanel:        $('flashcardsPanel'),
    multipleChoicePanel:    $('multipleChoicePanel'),
    shortAnswerPanel:       $('shortAnswerPanel'),
    testProgressLabel:      $('testProgressLabel'),
    testScoreLabel:         $('testScoreLabel'),
    testProgressBar:        $('testProgressBar'),
    testFlashcard:          $('testFlashcard'),
    flashcardFrontText:     $('flashcardFrontText'),
    flashcardFrontOverview: $('flashcardFrontOverview'),
    flashcardBackText:      $('flashcardBackText'),
    testHint:               $('testHint'),
    testQuestion:           $('testQuestion'),
    testAnswer:             $('testAnswer'),
    mcQuestionText:         $('mcQuestionText'),
    mcOptionsList:          $('mcOptionsList'),
    mcExplainBox:           $('mcExplainBox'),
    mcExplainBtn:           $('mcExplainBtn'),
    mcNextBtn:              $('mcNextBtn'),
    chatLog:            $('chatLog'),
    chatInput:          $('chatInput'),
    sendBtn:            $('sendBtn'),
    fileInput:          $('fileInput'),
    uploadBtn:          $('uploadBtn'),
    uploadBtnLabel:     $('uploadBtnLabel'),
    uploadTargetLabel:  $('uploadTargetLabel'),
    addClassBtn:        $('addClassBtn'),
    addChapterBtn:      $('addChapterBtn'),
    hideDashBtn:        $('hideDashBtn'),
    restoreTab:         $('restoreTab'),
    dashboardPanel:     $('dashboardPanel'),
    courseworkList:     $('courseworkList'),
    courseworkCount:    $('courseworkCount'),
    // Add class modal
    addClassModal:      $('addClassModal'),
    addClassForm:       $('addClassForm'),
    addClassUploadBtn:  $('addClassUploadBtn'),
    addClassFileInput:  $('addClassFileInput'),
    addClassUploadStatus: $('addClassUploadStatus'),
    addClassUploadMsg:  $('addClassUploadMsg'),
    addClassChaptersPreview: $('addClassChaptersPreview'),
    newCourseCode:      $('newCourseCode'),
    newCourseName:      $('newCourseName'),
    newCoursePct:       $('newCoursePct'),
    // Edit chapter modal
    editChapterModal:   $('editChapterModal'),
    editChapterForm:    $('editChapterForm'),
    editChapterTitle:   $('editChapterTitle'),
    editChapterTopics:  $('editChapterTopics'),
    deleteChapterBtn:   $('deleteChapterBtn'),
    // Add chapter modal
    addChapterModal:    $('addChapterModal'),
    addChapterForm:     $('addChapterForm'),
    newChapterTitle:    $('newChapterTitle'),
    newChapterTopics:   $('newChapterTopics'),
    // Edit course modal
    editCourseModal:    $('editCourseModal'),
    editCourseCode:     $('editCourseCode'),
    editCourseName:     $('editCourseName'),
    editGradeManual:    $('editGradeManual'),
    editGradePct:       $('editGradePct'),
    editGradeLetter:    $('editGradeLetter'),
    editGradeHint:      $('editGradeHint'),
    weightsList:        $('weightsList'),
    weightsTotal:       $('weightsTotal'),
    weightsComputed:    $('weightsComputed'),
    addWeightBtn:       $('addWeightBtn'),
    gradeScaleGrid:     $('gradeScaleGrid'),
    resetScaleBtn:      $('resetScaleBtn'),
    saveCourseBtn:      $('saveCourseBtn'),
    deleteCourseBtn:    $('deleteCourseBtn'),
    // Ingest modal
    ingestModal:        $('ingestModal'),
    ingestCode:         $('ingestCode'),
    ingestName:         $('ingestName'),
    ingestChaptersList: $('ingestChaptersList'),
    ingestChaptersCount:$('ingestChaptersCount'),
    ingestAddChapterBtn:$('ingestAddChapterBtn'),
    ingestWeightsList:  $('ingestWeightsList'),
    ingestWeightsEmpty: $('ingestWeightsEmpty'),
    ingestWeightsHeader:$('ingestWeightsHeader'),
    ingestApplyBtn:     $('ingestApplyBtn'),
    // Settings
    settingsBtn:        $('settingsBtn'),
    settingsModal:      $('settingsModal'),
    settingShowPct:     $('settingShowPct'),
    settingShowLetter:  $('settingShowLetter'),
    settingShowChapters:$('settingShowChapters'),
    settingTheme:       $('settingTheme'),
    backendStatus:      $('backendStatus'),
    apiKeyStatus:       $('apiKeyStatus'),
    modelStatus:        $('modelStatus'),
    resetAllBtn:        $('resetAllBtn'),
    toast:              $('toast'),
  };

  // ===========================================================================
  // AUTH
  // ===========================================================================

  function showAuth() {
    applyTheme();
    el.authScreen.classList.remove('hidden');
    el.appScreen.classList.add('hidden');
  }

  function showApp() {
    applyTheme();
    el.authScreen.classList.add('hidden');
    el.appScreen.classList.remove('hidden');
    updateAvatarDisplay();
    refreshAllGrades();
    renderAll();
  }

  function updateAvatarDisplay() {
    if (!state.user) return;
    el.avatarBtn.textContent = state.user.initials || '?';
  }

  function switchAuthTab(tab) {
    el.tabSignIn.classList.toggle('active', tab === 'signin');
    el.tabSignUp.classList.toggle('active', tab === 'signup');
    el.signInForm.classList.toggle('hidden', tab !== 'signin');
    el.signUpForm.classList.toggle('hidden', tab !== 'signup');
    el.signInError.classList.add('hidden');
    el.signUpError.classList.add('hidden');
  }

  async function handleSignIn(e) {
    e.preventDefault();
    const email    = el.signInEmail.value.trim();
    const password = el.signInPassword.value.trim();
    el.signInError.classList.add('hidden');
    if (!email || !password) { showAuthError(el.signInError, 'Please fill in all fields.'); return; }
    try {
      const res  = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok || !data.ok) { showAuthError(el.signInError, data.error || 'Login failed.'); return; }
      state.user = data.user;
      saveState();
      showApp();
    } catch { showAuthError(el.signInError, 'Cannot reach server. Is python server.py running?'); }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    const name     = el.signUpName.value.trim();
    const email    = el.signUpEmail.value.trim();
    const password = el.signUpPassword.value.trim();
    el.signUpError.classList.add('hidden');
    if (!name || !email || !password) { showAuthError(el.signUpError, 'Please fill in all fields.'); return; }
    try {
      const res  = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
      const data = await res.json();
      if (!res.ok || !data.ok) { showAuthError(el.signUpError, data.error || 'Registration failed.'); return; }
      state.user = data.user;
      saveState();
      showApp();
    } catch { showAuthError(el.signUpError, 'Cannot reach server. Is python server.py running?'); }
  }

  function showAuthError(el_err, msg) {
    el_err.textContent = msg;
    el_err.classList.remove('hidden');
  }

  function signOut() {
    state.user = null;
    saveState();
    closeAccountModal();
    showAuth();
  }

  // ===========================================================================
  // ACCOUNT MODAL
  // ===========================================================================

  function openAccountModal() {
    if (!state.user) return;
    el.accountInitials.textContent = state.user.initials || '?';
    el.accountName.textContent     = state.user.name || '—';
    el.accountEmail.textContent    = state.user.email || '—';
    el.accountModal.classList.remove('hidden-modal');
  }
  function closeAccountModal() {
    el.accountModal.classList.add('hidden-modal');
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtPct(p) {
    if (p == null || isNaN(p)) return '—';
    return Number(p).toFixed(1).replace(/\.0$/, '') + '%';
  }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return b + 'B';
    if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
    return (b / 1048576).toFixed(1) + 'MB';
  }

  function renderCourses() {
    const s = state.settings;
    const cards = state.courses.map(c => {
      const pct    = s.showPercentage && c.gradePercentage != null ? `<span class="pct">${fmtPct(c.gradePercentage)}</span>` : '';
      const sep    = (s.showPercentage && c.gradePercentage != null && s.showLetter && c.gradeLetter) ? `<span class="sep">·</span>` : '';
      const letter = s.showLetter && c.gradeLetter ? `<span>${escapeHtml(c.gradeLetter)}</span>` : '';
      const badge  = (pct || letter) ? `<div class="grade-badge">${pct}${sep}${letter}</div>` : '';
      const chaps  = s.showChapters ? `<div class="mt-3 text-[10px] font-mono uppercase tracking-widest text-muted">${c.chapters.length} chapter${c.chapters.length === 1 ? '' : 's'}</div>` : '';
      return `
        <div class="course-card ${c.id === state.activeCourseId ? 'active' : ''}" data-course-id="${c.id}">
          <button class="course-card-edit" data-edit-course="${c.id}" title="Edit course">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <div class="flex items-start justify-between mb-3 pr-7">
            <div class="text-[10px] font-mono uppercase tracking-widest text-muted">${escapeHtml(c.code)}</div>
            ${badge}
          </div>
          <div class="font-serif text-lg leading-tight">${escapeHtml(c.name)}</div>
          ${chaps}
        </div>`;
    }).join('');
    el.courseGrid.innerHTML = cards + `
      <button class="add-card" data-action="add-class">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <span class="text-xs mt-2 font-medium">Add class</span>
      </button>`;
  }

  function renderChapters() {
    const course = state.courses.find(c => c.id === state.activeCourseId);
    if (!course) {
      el.activeClassLabel.textContent = '—';
      el.activeClassName.textContent  = 'Select a course';
      el.chapterList.innerHTML        = '<div class="px-5 py-4 text-xs text-muted">No course selected</div>';
      el.uploadTargetLabel.textContent = 'no course selected';
      return;
    }
    el.activeClassLabel.textContent  = course.code;
    el.activeClassName.textContent   = course.name;
    el.uploadTargetLabel.textContent = course.code;

    if (!course.chapters.length) {
      el.chapterList.innerHTML = `<div class="px-5 py-4 text-xs text-muted leading-relaxed">No chapters. Click <span class="text-secondary">+ Add</span> or upload a syllabus.</div>`;
      return;
    }
    // Chapter rows: pencil edit icon instead of direct X
    el.chapterList.innerHTML = course.chapters.map((ch, i) => `
      <div class="chapter-row ${ch.id === state.activeChapterId ? 'active' : ''}" data-chapter-id="${ch.id}">
        <div class="flex items-baseline gap-3 pr-8">
          <span class="text-[10px] font-mono text-muted">${String(i + 1).padStart(2, '0')}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${escapeHtml(ch.title)}</div>
            ${ch.topics?.length ? `<div class="text-[10px] mt-0.5 truncate text-muted">${escapeHtml(ch.topics.join(' · '))}</div>` : ''}
          </div>
        </div>
        <button class="chapter-edit-btn" data-edit-chapter="${ch.id}" title="Edit chapter">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
      </div>`).join('');
  }

  function renderCoursework() {
    const course = state.courses.find(c => c.id === state.activeCourseId);
    const items  = course?.coursework || [];
    el.courseworkCount.textContent = `(${items.length})`;
    if (!items.length) {
      el.courseworkList.innerHTML = '<div class="coursework-empty">Nothing uploaded yet.</div>';
      return;
    }
    el.courseworkList.innerHTML = items.map(f => {
      const spinner = f.uploading
        ? `<svg class="coursework-spinner" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="none" stroke-width="2"/></svg>`
        : `<button class="delete-btn" data-delete-coursework="${f.id}" title="Remove">✕</button>`;
      return `
        <div class="coursework-row" title="${escapeHtml(f.name)}">
          <span class="name">${escapeHtml(f.name)}</span>
          <span class="size">${fmtSize(f.size)}</span>
          ${spinner}
        </div>`;
    }).join('');
  }

  function renderChat() {
    const course  = state.courses.find(c => c.id === state.activeCourseId);
    const chapter = course?.chapters.find(ch => ch.id === state.activeChapterId);
    if (chapter) {
      const idx = course.chapters.indexOf(chapter) + 1;
      el.chapterHeading.textContent = `Chapter ${idx} · ${chapter.title}`;
      el.contextLabel.textContent   = `Context: ${chapter.title.toLowerCase()}`;
    } else {
      el.chapterHeading.textContent = 'Select a chapter';
      el.contextLabel.textContent   = 'No context';
    }
    const key     = `${state.activeCourseId}:${state.activeChapterId}`;
    const history = state.chatHistory[key] || [];
    if (!history.length) {
      el.chatLog.innerHTML = `
        <div class="msg flex flex-col items-center text-center py-12">
          <div class="font-serif italic text-3xl mb-2 text-faint">Let's work through it.</div>
          <p class="text-sm max-w-md text-soft">
            Ask a question about <span class="text-primary">${chapter ? escapeHtml(chapter.title) : 'this chapter'}</span>.
            I'll guide you toward understanding rather than just handing you the answer.
          </p>
        </div>`;
    } else {
      el.chatLog.innerHTML = history.map(renderMessage).join('');
    }
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function renderMessage(m) {
    if (m.role === 'user') return `<div class="msg flex justify-end"><div class="max-w-[75%] rounded-lg px-4 py-3 text-sm leading-relaxed text-primary" style="background:var(--c-elevated);">${escapeHtml(m.content)}</div></div>`;
    if (m.role === 'thinking') return `<div class="msg flex items-center gap-2 px-1"><div class="flex gap-1"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><span class="text-xs font-mono text-muted">tutor is thinking</span></div>`;
    return `
      <div class="msg flex gap-3">
        <div class="brand-mark mt-0.5" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v8.5A3.5 3.5 0 0 0 9.5 20" />
            <path d="M14.5 4.5A3.5 3.5 0 0 1 18 8v8.5a3.5 3.5 0 0 1-3.5 3.5" />
            <path d="M9.5 4.5v15M14.5 4.5v15M6 9.5h3.5M14.5 9.5H18M6 14.5h3.5M14.5 14.5H18M9.5 12h5" />
          </svg>
        </div>
        <div class="flex-1 text-sm leading-relaxed text-faint">${escapeHtml(m.content).replace(/\n/g, '<br/>')}</div>
      </div>`;
  }

  function renderAll() {
    renderCourses();
    renderChapters();
    renderCoursework();
    renderChat();
    renderTutorMode();
    renderTestPanel();
    renderSummaryPanel();
  }


  // ===========================================================================
  // TUTOR MODE SWITCHING + TEST PANEL + SUMMARY PANEL
  // ===========================================================================

  function activeCourse() {
    return state.courses.find(c => c.id === state.activeCourseId);
  }

  function activeChapter() {
    const course = activeCourse();
    return course?.chapters.find(ch => ch.id === state.activeChapterId) || null;
  }

  function resetTestCard() {
    state.testState.index = 0;
    state.testState.flipped = false;
    state.testState.explainShown = false;
    state.testState.explainText = '';
    state.testState.answer = '';
    state.testState.right = 0;
    state.testState.wrong = 0;
    state.testState.shuffledOrder = null;
    state.testState.shuffled = false;
    state.testState.mcSelectedOption = null;
    state.testState.mcGraded = false;
    state.testState.mcExplainShown = false;
    state.testState.mcExplainText = '';
  }

  function setTutorMode(mode) {
    if (!VALID_TUTOR_MODES.includes(mode)) return;
    state.tutorMode = mode;
    saveState();
    renderTutorMode();
    renderTestPanel();
    renderSummaryPanel();
  }

  function renderTutorMode() {
    const mode = VALID_TUTOR_MODES.includes(state.tutorMode) ? state.tutorMode : 'socratic';
    state.tutorMode = mode;
    if (el.tutorModeSelect) el.tutorModeSelect.value = mode;
    el.socraticPanel.classList.toggle('hidden', mode !== 'socratic');
    el.summaryPanel.classList.toggle('hidden', mode !== 'summary');
    el.testPanel.classList.toggle('hidden', mode !== 'test');
  }

  // ===========================================================================
  // SUBJECT DETECTION + CONTENT HELPERS
  // ===========================================================================

  function detectSubject(course) {
    const code = (course?.code || '').toUpperCase();
    if (/^(MATH|CALC|STAT|ALGE|TRIG|DIFF)/.test(code)) return 'math';
    if (/^(CS|CIS|CSC|CSCI|CMP|PROG|ECE)/.test(code)) return 'cs';
    if (/^(ECON|MICRO|MACRO|FIN)/.test(code)) return 'econ';
    if (/^(CHEM|BIO|BIOL|PHYS|SCI|ANAT)/.test(code)) return 'science';
    if (/^(HIST|POLS|SOC|ANTH|PSYC|PSY|GOVT)/.test(code)) return 'social';
    if (/^(ENG|LIT|WRIT|ENGL|RHET)/.test(code)) return 'humanities';
    return 'general';
  }

  function normalizeTitleKey(title) {
    return String(title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function mapStudyMaterialsToChapters(studyMaterials, chapters, useIndexFallback = true) {
    const generated = studyMaterials?.chapters;
    if (!Array.isArray(generated) || !Array.isArray(chapters)) return {};
    const byTitle = new Map();
    generated.forEach(material => {
      const key = normalizeTitleKey(material?.title);
      if (key) byTitle.set(key, material);
    });

    const mapped = {};
    chapters.forEach((chapter, idx) => {
      const material = byTitle.get(normalizeTitleKey(chapter.title)) || (useIndexFallback ? generated[idx] : null);
      if (!material) return;
      mapped[chapter.id] = {
        title: material.title || chapter.title,
        summary: material.summary || '',
        topics: Array.isArray(material.topics) ? material.topics : [],
        flashcards: Array.isArray(material.flashcards) ? material.flashcards : [],
        multipleChoice: Array.isArray(material.multipleChoice) ? material.multipleChoice : [],
        shortAnswer: Array.isArray(material.shortAnswer) ? material.shortAnswer : [],
        generatedAt: Date.now(),
      };
    });
    return mapped;
  }

  function getChapterStudyMaterial(course, chapter) {
    if (!course?.studyMaterials || !chapter?.id) return null;
    return course.studyMaterials[chapter.id] || null;
  }

  function uniqueByQuestion(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(item => {
      const question = String(item?.question || '').trim();
      if (!question) return false;
      const key = question.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isValidMCQ(item) {
    return !!(
      item?.question &&
      Array.isArray(item.options) &&
      item.options.length === 4 &&
      item.options.every(option => option && !String(option).includes('?'))
    );
  }

  // Try to find sentences in uploaded coursework that mention the topic.
  // Returns up to 2 sentences joined; null if no coursework or no match.
  function findTopicContextFromCoursework(topic, course) {
    if (!course?.coursework?.length) return null;
    const allText = course.coursework.map(c => c.text || '').filter(Boolean).join('\n');
    if (!allText) return null;
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`[^.!?\\n]*\\b${escaped}\\b[^.!?\\n]*[.!?]`, 'gi');
    const matches = allText.match(re) || [];
    if (!matches.length) return null;
    return matches.slice(0, 2).map(s => s.trim().replace(/\s+/g, ' ')).join(' ');
  }

  // Brief overview (1 sentence) for the front of the flashcard.
  function generateTopicOverview(topic, chapter, course, subject) {
    const lecture = findTopicContextFromCoursework(topic, course);
    if (lecture && lecture.length < 220) return lecture;
    const overviews = {
      econ:    `A core idea in ${chapter.title} that helps explain how the economy responds to shocks and policy.`,
      math:    `A foundational result in ${chapter.title} used to analyze functions, sequences, or structures.`,
      cs:      `A central concept in ${chapter.title} for designing, analyzing, or implementing algorithms.`,
      science: `A key process or principle in ${chapter.title} that explains underlying mechanisms.`,
      social:  `An important framework in ${chapter.title} for interpreting human behavior or institutions.`,
      humanities: `A defining theme in ${chapter.title} that organizes how we read and interpret the material.`,
      general: `A key idea in ${chapter.title} worth understanding deeply.`,
    };
    return overviews[subject] || overviews.general;
  }

  // Definition / answer side of flashcard.
  function generateTopicDefinition(topic, chapter, course, subject) {
    const lecture = findTopicContextFromCoursework(topic, course);
    if (lecture) return lecture;
    const stems = {
      econ:    `${topic} describes a relationship or mechanism within ${chapter.title} that links assumptions, causes, and economic outcomes.`,
      math:    `${topic} is a precise statement or procedure used in ${chapter.title} to reach a defined conclusion under stated assumptions.`,
      cs:      `${topic} is an algorithmic concept or data structure used in ${chapter.title} to solve a problem with specific trade-offs.`,
      science: `${topic} refers to a process or principle in ${chapter.title} that connects causes, mechanisms, and observable outcomes.`,
      social:  `${topic} is a concept used in ${chapter.title} to interpret human or institutional behavior in context.`,
      humanities: `${topic} is a recurring concept in ${chapter.title} that shapes interpretation and meaning.`,
      general: `${topic} is a key concept in ${chapter.title} with a specific definition, use case, and connection to nearby ideas.`,
    };
    return stems[subject] || stems.general;
  }

  // Deeper explanation with example for the flashcard "Explain" button.
  function generateTopicDeepExplanation(topic, chapter, course, subject) {
    const lecture = findTopicContextFromCoursework(topic, course);
    const lectureBlock = lecture ? `From your notes: "${lecture}"\n\n` : '';
    const examples = {
      econ:    `Example: Suppose policymakers shift a key variable (say, the federal funds rate). Using ${topic}, trace the response of output, employment, and inflation in the short run vs. long run. The size of the effect depends on assumptions like how sticky prices are or how forward-looking households are.`,
      math:    `Example: Apply ${topic} to a concrete function, say f(x) = x² - 4x + 3. Walk through each step, note where the assumptions are used, and check the result against intuition. The procedure works whenever the stated conditions hold.`,
      cs:      `Example: Run ${topic} on a small input (say, [3, 1, 4, 1, 5]). Show intermediate state at each step and where the time complexity comes from. Compare it against a naive approach to see the speedup.`,
      science: `Example: Imagine the system at equilibrium, then perturb one variable. Apply ${topic} to predict which direction the system shifts and what observable changes follow. Real systems often behave this way under controlled conditions.`,
      social:  `Example: Take a real-world case (a policy debate, election outcome, or social movement). Apply ${topic} as a lens to explain why the outcome occurred. Then consider an alternative theory and where the two diverge.`,
      humanities: `Example: Take a passage or work where ${topic} appears. Show how it operates in context, what it does for the reader, and how shifting it would change the meaning.`,
      general: `Example: Apply ${topic} to a concrete case from ${course.code}. Walk through the reasoning, note where assumptions matter, and check the result.`,
    };
    return `${lectureBlock}${examples[subject] || examples.general}`;
  }

  // Multiple choice question + 4 options. Correct option is at correctIndex.
  function generateMultipleChoiceQuestion(topic, chapter, course, allTopics, seed) {
    const subject = detectSubject(course);
    const correctDesc = generateMCOptionDescription(topic, subject);
    // Truncate the correct definition to a reasonable single-sentence option
    const correctShort = shortenForOption(correctDesc);

    // Build distractors: pull other topics from selected pool, fall back to generic.
    const otherTopics = allTopics.filter(t => t.topic !== topic);
    const distractors = [];
    for (let i = 0; i < otherTopics.length && distractors.length < 3; i++) {
      const idx = (seed + i * 7) % otherTopics.length;
      const t = otherTopics[idx];
      const def = generateMCOptionDescription(t.topic, subject);
      const short = shortenForOption(def);
      if (!distractors.includes(short) && short !== correctShort) distractors.push(short);
    }
    while (distractors.length < 3) {
      const fallback = subjectFallbackDistractor(subject, distractors.length, topic, chapter);
      if (!distractors.includes(fallback)) distractors.push(fallback);
    }

    // Build option list, place correct at deterministic position based on seed
    const correctIndex = seed % 4;
    const options = [];
    let dIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (i === correctIndex) options.push(correctShort);
      else options.push(distractors[dIdx++]);
    }

    const question = mcQuestionStem(topic, chapter, subject);
    return { question, options, correctIndex, topic };
  }

  function generateMCOptionDescription(topic, subject) {
    const descriptions = {
      econ:    `${topic} explains how one economic force changes another under a model's assumptions.`,
      math:    `${topic} is a rule, result, or method used to make a valid mathematical conclusion.`,
      cs:      `${topic} is a computing idea used to organize data, logic, or performance trade-offs.`,
      science: `${topic} explains a mechanism that links a cause to an observable result.`,
      social:  `${topic} is a framework for interpreting behavior, institutions, or social outcomes.`,
      humanities: `${topic} is a concept used to interpret meaning, form, or recurring patterns.`,
      general: `${topic} is a core idea with a specific definition and practical use.`,
    };
    return descriptions[subject] || descriptions.general;
  }

  function shortenForOption(text) {
    // Take first sentence, cap at ~140 chars
    let s = (text || '').split(/(?<=[.!?])\s/)[0] || text || '';
    s = s.trim();
    if (s.length > 160) s = s.slice(0, 157).trim() + '...';
    return s;
  }

  function subjectFallbackDistractor(subject, idx, topic, chapter) {
    const pools = {
      econ: [
        'Refers to the long-run equilibrium where supply and demand are perfectly inelastic.',
        'A scenario where rational expectations always cause monetary policy to be neutral.',
        'A measure of the average household savings rate during a recession only.',
      ],
      math: [
        'A theorem that holds only under continuity but not differentiability assumptions.',
        'A property that applies exclusively to non-decreasing bounded sequences.',
        'A definition that requires the input set to be uncountably infinite.',
      ],
      cs: [
        'A data structure with O(n²) average-case access time and O(1) insertion.',
        'An algorithm that requires sorted input and runs only in linear time.',
        'A pattern that is only valid for single-threaded synchronous workloads.',
      ],
      science: [
        'A reaction that proceeds spontaneously only at temperatures below 0 K.',
        'A process that conserves energy but not mass, applied to closed systems.',
        'A mechanism that operates only in the absence of catalysts or enzymes.',
      ],
      social: [
        'A theory arguing that institutions have no influence on individual behavior.',
        'A framework in which all economic decisions are determined by genetics alone.',
        'An approach that explains outcomes purely through random environmental factors.',
      ],
      humanities: [
        `A reading strategy that ignores authorial context entirely while focusing on form.`,
        `A theme that appears only in ancient texts and is absent from modern interpretation.`,
        `A mode of analysis used exclusively for non-narrative works.`,
      ],
      general: [
        `A concept used only in adjacent fields and unrelated to the main idea.`,
        `An idea that contradicts the main definition being tested.`,
        `A definition that applies only when ${topic} is held constant.`,
      ],
    };
    const pool = pools[subject] || pools.general;
    return pool[idx % pool.length];
  }

  function mcQuestionStem(topic, chapter, subject) {
    const stems = {
      econ:    `Which statement best describes ${topic}?`,
      math:    `Which statement about ${topic} is correct?`,
      cs:      `Which of the following best characterizes ${topic}?`,
      science: `Which description of ${topic} is most accurate?`,
      social:  `Which of the following best captures ${topic}?`,
      humanities: `Which interpretation of ${topic} is most accurate?`,
      general: `Which of the following best describes ${topic}?`,
    };
    return stems[subject] || stems.general;
  }

  function generateMCExplanation(item, selectedIdx) {
    const correctIdx = item.correctIndex;
    const correct = item.options[correctIdx];
    let block = `<div class="mc-explain-section"><div class="mc-explain-section-label">Correct answer (${'ABCD'[correctIdx]})</div><div>${escapeHtml(correct)}</div></div>`;
    if (selectedIdx != null && selectedIdx !== correctIdx) {
      const picked = item.options[selectedIdx];
      block += `<div class="mc-explain-section"><div class="mc-explain-section-label">Why "${'ABCD'[selectedIdx]}" is incorrect</div><div>${escapeHtml(picked)} — this option misrepresents or oversimplifies the concept. The correct option more precisely captures what <strong>${escapeHtml(item.topic)}</strong> means in this chapter.</div></div>`;
    } else if (selectedIdx === correctIdx) {
      block += `<div class="mc-explain-section"><div class="mc-explain-section-label">Why this is right</div><div>This option correctly identifies the defining features of <strong>${escapeHtml(item.topic)}</strong>. The other options miss the mark by either overgeneralizing, applying conditions that do not hold, or describing a related but distinct concept.</div></div>`;
    }
    return block;
  }

  // ===========================================================================
  // SHORT ANSWER QUESTION GENERATOR (varied by subject)
  // ===========================================================================

  function generateShortAnswerQuestion(topic, chapter, course, itemIndex) {
    const subject = detectSubject(course);
    const chTitle = chapter.title;
    const econTypes = [
      `Explain ${topic} and draw the relevant diagram. Label all curves, axes, and any key equilibrium points.`,
      `Using ${topic}, analyze what happens to the economy in the short run if the central bank raises interest rates unexpectedly.`,
      `${topic} is at the core of ${chTitle}. In 3–4 sentences, define it and give a real-world policy example.`,
      `Compare the short-run and long-run implications of a supply shock using ${topic} as your framework.`,
      `Calculate: If the MPC = 0.8 and government spending increases by $200 billion, what is the total change in GDP? Use ${topic} to explain your answer.`,
      `A firm experiences rising input costs. Using ${topic}, trace through the effects on the price level and output.`,
    ];
    const mathTypes = [
      `Define ${topic} precisely and state the conditions under which it holds. Provide a worked example.`,
      `Prove or derive the key result related to ${topic} in ${chTitle}. Show each step clearly.`,
      `Given the function f(x) = x³ – 3x² + 2, apply ${topic} to find all critical points and classify them.`,
      `Explain how ${topic} connects to the broader ideas in ${chTitle}. Where does it break down or have exceptions?`,
      `True or False: ${topic} always guarantees convergence. Justify your answer with an example.`,
    ];
    const csTypes = [
      `Describe the algorithm associated with ${topic}. What is its time and space complexity in the best, average, and worst cases?`,
      `Write pseudocode that demonstrates ${topic}. Explain the key decision points in your logic.`,
      `${topic} is used in ${chTitle}. Give a concrete use-case and explain why this approach is preferred over alternatives.`,
      `What are the trade-offs when choosing ${topic}? Discuss two scenarios where it excels and one where it fails.`,
      `Trace through an example input step-by-step using ${topic}. Show intermediate state at each major step.`,
    ];
    const scienceTypes = [
      `Define ${topic} and explain the underlying mechanism at the molecular/atomic level.`,
      `A sample undergoes a change involving ${topic}. Describe the observable results and the reasoning behind them.`,
      `How does ${topic} fit into the larger framework of ${chTitle}? What would happen if this process were disrupted?`,
      `Calculate or estimate: Given the relevant values for ${topic}, determine the expected outcome. Show your work.`,
    ];
    const socialTypes = [
      `Define ${topic} and explain its significance within ${chTitle}. Cite at least one historical or contemporary example.`,
      `Compare two competing perspectives on ${topic}. Which is more persuasive, and why?`,
      `How does ${topic} shape individual behavior or social institutions? Provide a concrete example.`,
      `Critically evaluate ${topic}: what does it explain well, and what are its limitations?`,
    ];
    const generalTypes = [
      `In 3–5 sentences, explain ${topic} and why it matters in ${chTitle}.`,
      `Define ${topic} and connect it to at least one other key idea from ${course.code}.`,
      `Give an example of ${topic} in practice. What would a real-world scenario look like?`,
      `Compare ${topic} to an adjacent concept from ${chTitle}. What distinguishes them?`,
    ];
    const pools = { econ: econTypes, math: mathTypes, cs: csTypes, science: scienceTypes, social: socialTypes, general: generalTypes, humanities: socialTypes };
    const pool = pools[subject] || generalTypes;
    return pool[itemIndex % pool.length];
  }

  // ===========================================================================
  // CHAPTER SELECTION (multi-select)
  // ===========================================================================

  function getSelectedChapters(course, selectedIds) {
    if (!course || !course.chapters.length) return [];
    if (selectedIds == null) return course.chapters.slice(); // default: all
    if (!selectedIds.length) return [];
    return course.chapters.filter(ch => selectedIds.includes(ch.id));
  }

  function chapterSelectionLabel(course, selectedIds) {
    if (!course || !course.chapters.length) return 'No chapters';
    const all = course.chapters;
    if (selectedIds == null || selectedIds.length === all.length) return 'All chapters';
    if (!selectedIds.length) return 'Choose at least one chapter';
    const idxs = selectedIds.map(id => all.findIndex(ch => ch.id === id)).filter(i => i >= 0).sort((a,b) => a-b);
    if (!idxs.length) return 'Choose at least one chapter';
    // Build a compact "Ch. 1, 3, 5" or "Ch. 1–3" label
    const ranges = [];
    let start = idxs[0], prev = idxs[0];
    for (let i = 1; i < idxs.length; i++) {
      if (idxs[i] === prev + 1) { prev = idxs[i]; continue; }
      ranges.push(start === prev ? `${start + 1}` : `${start + 1}–${prev + 1}`);
      start = idxs[i]; prev = idxs[i];
    }
    ranges.push(start === prev ? `${start + 1}` : `${start + 1}–${prev + 1}`);
    return `Ch. ${ranges.join(', ')}`;
  }

  function renderChapterPopover(popoverEl, course, selectedIds, onChange) {
    if (!course || !course.chapters.length) {
      popoverEl.innerHTML = '<div class="px-3 py-2 text-xs text-muted">No chapters yet.</div>';
      return;
    }
    const all = course.chapters;
    const selSet = new Set(selectedIds == null ? all.map(c => c.id) : selectedIds);
    const allSelected = all.every(ch => selSet.has(ch.id));
    popoverEl.innerHTML = `
      <div class="chapter-multi-toolbar">
        <button type="button" data-multi-action="all">${allSelected ? 'Clear all' : 'Select all'}</button>
        <button type="button" data-multi-action="close">Done</button>
      </div>
      ${all.map((ch, i) => `
        <div class="chapter-multi-row ${selSet.has(ch.id) ? 'selected' : ''}" data-chapter-id="${escapeHtml(ch.id)}" role="option" aria-selected="${selSet.has(ch.id)}">
          <span class="chapter-multi-circle"></span>
          <span class="chapter-multi-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="flex-1 truncate">${escapeHtml(ch.title)}</span>
        </div>
      `).join('')}
    `;
  }

  // ===========================================================================
  // TEST PANEL: build items & render
  // ===========================================================================

  function getTestItems(course, chapters) {
    if (!course || !chapters || !chapters.length) {
      return [{
        topic: '—',
        front: 'Choose at least one chapter to begin.',
        overview: '',
        back:  'Use the chapter dropdown above to select at least one chapter.',
        question: 'Choose at least one chapter to generate questions.',
        deeper: 'Choose at least one chapter from the dropdown.',
        chapter: null,
      }];
    }

    const subject = detectSubject(course);
    const items = [];
    let globalIdx = 0;
    chapters.forEach(chapter => {
      const material = getChapterStudyMaterial(course, chapter);
      const aiCards = material?.flashcards?.filter(card => card?.front && card?.back) || [];
      const aiMcqs = uniqueByQuestion(material?.multipleChoice).filter(isValidMCQ);
      const aiShortAnswers = uniqueByQuestion(material?.shortAnswer);
      if (aiCards.length) {
        aiCards.forEach((card, cardIdx) => {
          const topic = card.front;
          items.push({
            topic,
            front: topic,
            overview: material.summary || generateTopicOverview(topic, chapter, course, subject),
            back: card.back,
            deeper: card.explanation || generateTopicDeepExplanation(topic, chapter, course, subject),
            question: generateShortAnswerQuestion(topic, chapter, course, globalIdx),
            sampleAnswer: '',
            aiMcq: null,
            chapter,
          });
          globalIdx++;
        });
        aiMcqs.forEach((mcq, qIdx) => {
          items.push({
            topic: mcq.question,
            front: mcq.question,
            overview: material.summary || '',
            back: mcq.explanation || mcq.options?.[mcq.correctIndex] || '',
            deeper: mcq.explanation || '',
            question: aiShortAnswers[qIdx]?.question || generateShortAnswerQuestion(mcq.question, chapter, course, globalIdx),
            sampleAnswer: aiShortAnswers[qIdx]?.sampleAnswer || '',
            aiMcq: mcq,
            chapter,
          });
          globalIdx++;
        });
        aiShortAnswers.slice(aiMcqs.length).forEach(sa => {
          items.push({
            topic: sa.question,
            front: sa.question,
            overview: material.summary || '',
            back: sa.sampleAnswer || '',
            deeper: sa.sampleAnswer || '',
            question: sa.question,
            sampleAnswer: sa.sampleAnswer || '',
            aiMcq: null,
            chapter,
          });
          globalIdx++;
        });
        return;
      }

      const topics = material?.topics?.length ? material.topics : (chapter.topics?.length ? chapter.topics : [chapter.title]);
      topics.forEach(topic => {
        items.push({
          topic,
          front:    topic,
          overview: generateTopicOverview(topic, chapter, course, subject),
          back:     generateTopicDefinition(topic, chapter, course, subject),
          deeper:   generateTopicDeepExplanation(topic, chapter, course, subject),
          question: generateShortAnswerQuestion(topic, chapter, course, globalIdx),
          sampleAnswer: '',
          aiMcq: null,
          chapter,
        });
        globalIdx++;
      });
      aiMcqs.forEach((mcq, qIdx) => {
        items.push({
          topic: mcq.question,
          front: mcq.question,
          overview: material?.summary || '',
          back: mcq.explanation || mcq.options?.[mcq.correctIndex] || '',
          deeper: mcq.explanation || '',
          question: aiShortAnswers[qIdx]?.question || generateShortAnswerQuestion(mcq.question, chapter, course, globalIdx),
          sampleAnswer: aiShortAnswers[qIdx]?.sampleAnswer || '',
          aiMcq: mcq,
          chapter,
        });
        globalIdx++;
      });
      aiShortAnswers.slice(aiMcqs.length).forEach(sa => {
        items.push({
          topic: sa.question,
          front: sa.question,
          overview: material?.summary || '',
          back: sa.sampleAnswer || '',
          deeper: sa.sampleAnswer || '',
          question: sa.question,
          sampleAnswer: sa.sampleAnswer || '',
          aiMcq: null,
          chapter,
        });
        globalIdx++;
      });
    });
    return items;
  }

  function buildShuffledOrder(len) {
    const arr = Array.from({ length: len }, (_, i) => i);
    for (let i = len - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function getEffectiveIndex(items) {
    const ts = state.testState;
    if (!ts.shuffled || !ts.shuffledOrder || ts.shuffledOrder.length !== items.length) return ts.index;
    return ts.shuffledOrder[ts.index] ?? ts.index;
  }

  function getCurrentTestContext() {
    const course = activeCourse();
    const selectedChapters = getSelectedChapters(course, state.testState.selectedChapterIds);
    const items = getTestItems(course, selectedChapters);
    if (state.testState.index >= items.length) state.testState.index = 0;
    if (state.testState.index < 0) state.testState.index = items.length - 1;
    const item = items[getEffectiveIndex(items)];
    return { course, selectedChapters, items, item };
  }

  function formatAiExplanation(text) {
    return escapeHtml(text || '').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  }

  function renderTestPanel() {
    if (!el.testPanel) return;
    const course = activeCourse();
    const chapters = course?.chapters || [];

    // Course dropdown
    el.testCourseSelect.innerHTML = state.courses.length
      ? state.courses.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.code)}</option>`).join('')
      : '<option value="">No classes</option>';
    el.testCourseSelect.value = course?.id || '';
    el.testCourseSelect.disabled = !state.courses.length;

    // Chapter multi-select label
    el.testChapterBtnLabel.textContent = chapterSelectionLabel(course, state.testState.selectedChapterIds);
    el.testChapterBtn.disabled = !chapters.length;

    // Shuffle button visual
    if (el.testShuffleBtn) el.testShuffleBtn.classList.toggle('active', !!state.testState.shuffled);

    // Sub-mode buttons
    const sub = VALID_SUBMODES.includes(state.testState.subMode) ? state.testState.subMode : 'flashcards';
    state.testState.subMode = sub;
    el.testPanel.querySelectorAll('.test-submode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.submode === sub);
    });
    el.flashcardsPanel.classList.toggle('hidden', sub !== 'flashcards');
    el.multipleChoicePanel.classList.toggle('hidden', sub !== 'multiple_choice');
    el.shortAnswerPanel.classList.toggle('hidden', sub !== 'short_answer');

    // Hide right/wrong score on short answer; show on others
    if (sub === 'short_answer') {
      el.testScoreLabel.classList.add('test-score-hidden');
    } else {
      el.testScoreLabel.classList.remove('test-score-hidden');
    }

    // Build items from selected chapters
    const selectedChapters = getSelectedChapters(course, state.testState.selectedChapterIds);
    const items = getTestItems(course, selectedChapters);

    const ts = state.testState;
    if (ts.shuffled && (!ts.shuffledOrder || ts.shuffledOrder.length !== items.length)) {
      ts.shuffledOrder = buildShuffledOrder(items.length);
    }
    if (!ts.shuffled) ts.shuffledOrder = null;
    if (ts.index >= items.length) ts.index = 0;
    if (ts.index < 0) ts.index = items.length - 1;

    const displayIdx = getEffectiveIndex(items);
    const item = items[displayIdx];

    // Progress label
    const labelKind = sub === 'multiple_choice' ? 'Question' : (sub === 'short_answer' ? 'Question' : 'Card');
    el.testProgressLabel.textContent = `${labelKind} ${ts.index + 1} of ${items.length}`;
    el.testScoreLabel.textContent    = `Right ${ts.right || 0} · Wrong ${ts.wrong || 0}`;
    el.testProgressBar.style.width   = `${Math.round(((ts.index + 1) / items.length) * 100)}%`;

    // Flashcard side
    el.testFlashcard.classList.toggle('flipped', !!ts.flipped);
    el.flashcardFrontText.textContent    = item.front;
    el.flashcardFrontOverview.textContent = '';
    el.flashcardBackText.textContent     = item.back;
    el.testHint.textContent              = ts.explainText || item.deeper || '';
    el.testHint.classList.toggle('hidden', !ts.explainShown);

    // Short answer
    el.testQuestion.textContent = item.question;
    if (item.sampleAnswer) el.testQuestion.title = `Sample answer: ${item.sampleAnswer}`;
    else el.testQuestion.removeAttribute('title');
    if (document.activeElement !== el.testAnswer) el.testAnswer.value = ts.answer || '';

    // Multiple choice render
    renderMultipleChoice(item, items, course);
  }

  function renderMultipleChoice(currentItem, allItems, course) {
    if (!el.multipleChoicePanel) return;
    if (!currentItem || !currentItem.chapter) {
      el.mcQuestionText.textContent = currentItem?.question || 'Select chapters to generate questions.';
      el.mcOptionsList.innerHTML = '';
      el.mcExplainBox.classList.add('hidden');
      el.mcExplainBtn.classList.add('hidden');
      el.mcNextBtn.disabled = true;
      return;
    }
    el.mcNextBtn.disabled = false;

    // Build the topic pool from all items so distractors come from the user's selected chapters
    const topicPool = allItems
      .filter(it => it.chapter)
      .map(it => ({ topic: it.topic, chapter: it.chapter }));

    const seed = state.testState.mcSeed || 0;
    const aiMcq = currentItem.aiMcq;
    const mcq = isValidMCQ(aiMcq)
      ? {
          question: aiMcq.question,
          options: aiMcq.options,
          correctIndex: Number.isInteger(aiMcq.correctIndex) ? aiMcq.correctIndex : 0,
          explanation: aiMcq.explanation || '',
          topic: currentItem.topic,
        }
      : generateMultipleChoiceQuestion(currentItem.topic, currentItem.chapter, course, topicPool, seed + state.testState.index);

    el.mcQuestionText.textContent = mcq.question;

    const ts = state.testState;
    const selected = ts.mcSelectedOption;
    const graded = ts.mcGraded;

    el.mcOptionsList.innerHTML = mcq.options.map((opt, i) => {
      let cls = 'mc-option';
      let mark = '';
      if (graded) {
        cls += ' disabled';
        if (i === mcq.correctIndex) { cls += ' correct'; mark = '<span class="mc-option-mark">✓</span>'; }
        else if (i === selected) { cls += ' incorrect'; mark = '<span class="mc-option-mark">✗</span>'; }
      } else if (selected === i) {
        cls += ' selected';
      }
      return `
        <button type="button" class="${cls}" data-mc-option="${i}">
          <span class="mc-option-letter">${'ABCD'[i]}</span>
          <span class="mc-option-body">${escapeHtml(opt)}</span>
          ${mark}
        </button>
      `;
    }).join('');

    // Explain button visible only after grading
    el.mcExplainBtn.classList.toggle('hidden', !graded);
    el.mcNextBtn.textContent = graded ? 'Next →' : 'Next →';

    // Explain box
    if (graded && ts.mcExplainShown) {
      el.mcExplainBox.innerHTML = ts.mcExplainText
        ? `<div class="mc-explain-section">${formatAiExplanation(ts.mcExplainText)}</div>`
        : (mcq.explanation
            ? `<div class="mc-explain-section">${formatAiExplanation(mcq.explanation)}</div>`
            : generateMCExplanation(mcq, selected));
      el.mcExplainBox.classList.remove('hidden');
    } else {
      el.mcExplainBox.classList.add('hidden');
      el.mcExplainBox.innerHTML = '';
    }

    // Cache the current MCQ on the panel for grading lookup
    el.multipleChoicePanel._currentMCQ = mcq;
  }

  function moveTestCard(direction = 1) {
    const course = activeCourse();
    const selectedChapters = getSelectedChapters(course, state.testState.selectedChapterIds);
    const items = getTestItems(course, selectedChapters);
    state.testState.index = (state.testState.index + direction + items.length) % items.length;
    state.testState.flipped = false;
    state.testState.explainShown = false;
    state.testState.explainText = '';
    state.testState.answer = '';
    state.testState.mcSelectedOption = null;
    state.testState.mcGraded = false;
    state.testState.mcExplainShown = false;
    state.testState.mcExplainText = '';
    saveState();
    renderTestPanel();
  }

  function markTestCard(kind) {
    if (kind === 'right') state.testState.right = (state.testState.right || 0) + 1;
    if (kind === 'wrong') state.testState.wrong = (state.testState.wrong || 0) + 1;
    moveTestCard(1);
  }

  async function requestFlashcardExplanation() {
    const { course, item } = getCurrentTestContext();
    if (!course || !item?.chapter) {
      toast('Choose at least one chapter first.', { error: true });
      return;
    }

    const requestId = ++flashExplainRequestId;
    state.testState.explainShown = true;
    state.testState.flipped = true;
    state.testState.explainText = 'Asking AI for a fresh explanation...';
    saveState();
    renderTestPanel();

    try {
      const reply = await api.chat({
        message: `Give a fresh, concise explanation of "${item.topic}" for a study flashcard. Use 3-5 sentences, include one concrete example, and do not repeat generic template language.`,
        courseName: course.name || '',
        courseCode: course.code || '',
        chapterTitle: item.chapter.title || '',
        chapterTopics: item.chapter.topics || [],
        courseworkContext: getCourseworkContext(course.id),
        history: [],
      });
      if (requestId !== flashExplainRequestId) return;
      state.testState.explainText = reply;
    } catch (err) {
      if (requestId !== flashExplainRequestId) return;
      state.testState.explainText = friendlyErrorMessage(err);
    } finally {
      if (requestId === flashExplainRequestId) {
        saveState();
        renderTestPanel();
      }
    }
  }

  async function requestMCExplanation() {
    const { course, item } = getCurrentTestContext();
    const mcq = el.multipleChoicePanel._currentMCQ;
    const selected = state.testState.mcSelectedOption;
    if (!course || !item?.chapter || !mcq || selected == null) {
      toast('Answer the question first.', { error: true });
      return;
    }

    const requestId = ++mcExplainRequestId;
    state.testState.mcExplainShown = true;
    state.testState.mcExplainText = 'Asking AI for a fresh explanation...';
    saveState();
    renderTestPanel();

    const optionLines = mcq.options.map((opt, i) => `${'ABCD'[i]}. ${opt}`).join('\n');
    try {
      const reply = await api.chat({
        message: `Explain this multiple-choice result in 3-5 sentences. Question: ${mcq.question}\nOptions:\n${optionLines}\nSelected: ${'ABCD'[selected]}\nCorrect: ${'ABCD'[mcq.correctIndex]}\nExplain why the correct answer is right and, if the selected answer is wrong, what misconception it reflects. Use fresh wording.`,
        courseName: course.name || '',
        courseCode: course.code || '',
        chapterTitle: item.chapter.title || '',
        chapterTopics: item.chapter.topics || [],
        courseworkContext: getCourseworkContext(course.id),
        history: [],
      });
      if (requestId !== mcExplainRequestId) return;
      state.testState.mcExplainText = reply;
    } catch (err) {
      if (requestId !== mcExplainRequestId) return;
      state.testState.mcExplainText = friendlyErrorMessage(err);
    } finally {
      if (requestId === mcExplainRequestId) {
        saveState();
        renderTestPanel();
      }
    }
  }

  async function handleTestAction(action) {
    if (action === 'flip') {
      state.testState.flipped = !state.testState.flipped;
      saveState(); renderTestPanel(); return;
    }
    if (action === 'right' || action === 'wrong') { markTestCard(action); return; }
    if (action === 'explain') {
      await requestFlashcardExplanation(); return;
    }
    if (action === 'next') { moveTestCard(1); return; }
    if (action === 'previous') { moveTestCard(-1); return; }
    if (action === 'submit-answer') {
      const answer = el.testAnswer.value.trim();
      if (!answer) { toast('Type an answer first.', { error: true }); return; }
      moveTestCard(1);
      toast('Answer submitted — moving to next question.');
      return;
    }
    if (action === 'mc-next') {
      const ts = state.testState;
      const mcq = el.multipleChoicePanel._currentMCQ;
      if (!ts.mcGraded) {
        // First press: grade
        if (ts.mcSelectedOption == null) { toast('Pick an answer first.', { error: true }); return; }
        ts.mcGraded = true;
        ts.mcExplainShown = false;
        ts.mcExplainText = '';
        if (ts.mcSelectedOption === mcq.correctIndex) ts.right = (ts.right || 0) + 1;
        else ts.wrong = (ts.wrong || 0) + 1;
        saveState(); renderTestPanel();
      } else {
        // Second press: advance
        moveTestCard(1);
      }
      return;
    }
    if (action === 'mc-explain') {
      await requestMCExplanation(); return;
    }
    if (action === 'focus-answer') { el.testAnswer.focus(); }
  }

  function setTestSubMode(subMode) {
    if (!VALID_SUBMODES.includes(subMode)) return;
    state.testState.subMode = subMode;
    state.testState.explainShown = false;
    state.testState.explainText = '';
    // Reset MC interaction state when switching modes
    state.testState.mcSelectedOption = null;
    state.testState.mcGraded = false;
    state.testState.mcExplainShown = false;
    state.testState.mcExplainText = '';
    saveState();
    renderTestPanel();
  }

  function toggleShuffle() {
    const course = activeCourse();
    const selectedChapters = getSelectedChapters(course, state.testState.selectedChapterIds);
    const items = getTestItems(course, selectedChapters);
    state.testState.shuffled = !state.testState.shuffled;
    state.testState.index = 0;
    state.testState.flipped = false;
    state.testState.explainShown = false;
    state.testState.explainText = '';
    state.testState.mcSelectedOption = null;
    state.testState.mcGraded = false;
    state.testState.mcExplainShown = false;
    state.testState.mcExplainText = '';
    if (state.testState.shuffled) {
      state.testState.shuffledOrder = buildShuffledOrder(items.length);
    } else {
      state.testState.shuffledOrder = null;
    }
    saveState();
    renderTestPanel();
    toast(state.testState.shuffled ? 'Cards shuffled.' : 'Cards reset to chapter order.');
  }

  // ===========================================================================
  // SUMMARY PANEL
  // ===========================================================================

  function renderSummaryPanel() {
    if (!el.summaryPanel) return;
    const course = activeCourse();
    const chapters = course?.chapters || [];

    // Course dropdown
    el.summaryCourseSelect.innerHTML = state.courses.length
      ? state.courses.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.code)}</option>`).join('')
      : '<option value="">No classes</option>';
    el.summaryCourseSelect.value = course?.id || '';
    el.summaryCourseSelect.disabled = !state.courses.length;

    // Chapter multi-select label
    el.summaryChapterBtnLabel.textContent = chapterSelectionLabel(course, state.summaryState.selectedChapterIds);
    el.summaryChapterBtn.disabled = !chapters.length;

    // Sub-mode buttons
    const mode = VALID_SUMMARY_MODES.includes(state.summaryState.mode) ? state.summaryState.mode : 'cheatsheet';
    state.summaryState.mode = mode;
    el.summaryPanel.querySelectorAll('.test-submode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.summaryMode === mode);
    });
    el.cheatsheetPanel.classList.toggle('hidden', mode !== 'cheatsheet');
    el.overviewPanel.classList.toggle('hidden', mode !== 'overview');

    const selectedChapters = getSelectedChapters(course, state.summaryState.selectedChapterIds);

    if (mode === 'cheatsheet') {
      renderCheatSheet(course, selectedChapters);
    } else {
      renderChapterOverview(course, selectedChapters);
    }
  }

  // ----- Cheat Sheet -----
  function renderCheatSheet(course, chapters) {
    if (!course) {
      el.cheatsheetContent.innerHTML = '<p class="text-soft">Select a course to generate a study cheat sheet.</p>';
      return;
    }
    if (!chapters.length) {
      el.cheatsheetContent.innerHTML = '<p class="text-soft">Select at least one chapter to build a cheat sheet.</p>';
      return;
    }
    const subject = detectSubject(course);
    const subjectEquations = getSubjectEquations(subject);

    let html = `<h2>${escapeHtml(course.code)} — Study Cheat Sheet</h2>`;
    html += `<p class="text-soft" style="margin: 0 0 18px; font-size: 12.5px;">Compact reference covering ${chapters.length} chapter${chapters.length === 1 ? '' : 's'} of ${escapeHtml(course.name)}.</p>`;

    chapters.forEach((chapter, idx) => {
      const material = getChapterStudyMaterial(course, chapter);
      const topics = material?.topics?.length ? material.topics : (chapter.topics?.length ? chapter.topics : [chapter.title]);
      const topicRows = topics.map(t => {
        const aiCard = material?.flashcards?.find(card => normalizeTitleKey(card.front) === normalizeTitleKey(t));
        const lecture = findTopicContextFromCoursework(t, course);
        const desc = aiCard?.back
          ? aiCard.back
          : lecture && lecture.length < 280
          ? lecture
          : `${shortDescriptionFor(t, chapter, subject)}`;
        return `
          <div class="cheatsheet-topic-row">
            <div class="cheatsheet-topic-name">${escapeHtml(t)}</div>
            <div class="cheatsheet-topic-desc">${escapeHtml(desc)}</div>
          </div>`;
      }).join('');

      // Equations relevant to this chapter (subject-wide pool, filtered)
      // Match against both topic strings and the chapter title to catch broader chapter-level equations.
      const matchPool = [...topics, chapter.title];
      const relevantEqs = subjectEquations.filter(eq =>
        matchPool.some(t => eq.topics.some(et => t.toLowerCase().includes(et) || et.includes(t.toLowerCase())))
      );
      const eqHtml = relevantEqs.length ? `
        <div class="cheatsheet-block">
          <div class="cheatsheet-block-label">Key equations</div>
          <div class="cheatsheet-eq-list">
            ${relevantEqs.map(eq => `
              <div class="cheatsheet-eq-row">
                <div>${escapeHtml(eq.formula)}</div>
                <div class="cheatsheet-eq-meaning">${escapeHtml(eq.meaning)}</div>
              </div>`).join('')}
          </div>
        </div>` : '';

      html += `
        <div class="cheatsheet-section">
          <div class="cheatsheet-section-header">
            <span class="cheatsheet-section-num">CH ${String(idx + 1).padStart(2, '0')}</span>
            <span class="cheatsheet-section-title">${escapeHtml(chapter.title)}</span>
          </div>
          ${material?.summary ? `
          <div class="cheatsheet-block">
            <div class="cheatsheet-block-label">AI summary</div>
            <p class="text-soft" style="margin:0;font-size:12.5px;line-height:1.55;">${escapeHtml(material.summary)}</p>
          </div>` : ''}
          <div class="cheatsheet-block">
            <div class="cheatsheet-block-label">Topics</div>
            ${topicRows}
          </div>
          ${eqHtml}
        </div>`;
    });

    // If no chapter-specific equations matched but the subject has them, include a general equations block
    const hasAnyEq = chapters.some(ch => {
      const topics = ch.topics?.length ? ch.topics : [ch.title];
      const matchPool = [...topics, ch.title];
      return subjectEquations.some(eq => matchPool.some(t => eq.topics.some(et => t.toLowerCase().includes(et) || et.includes(t.toLowerCase()))));
    });
    if (!hasAnyEq && subjectEquations.length) {
      html += `
        <div class="cheatsheet-section">
          <div class="cheatsheet-section-header">
            <span class="cheatsheet-section-num">REF</span>
            <span class="cheatsheet-section-title">General ${subject === 'econ' ? 'Macro' : subject.toUpperCase()} Equations</span>
          </div>
          <div class="cheatsheet-eq-list">
            ${subjectEquations.slice(0, 6).map(eq => `
              <div class="cheatsheet-eq-row">
                <div>${escapeHtml(eq.formula)}</div>
                <div class="cheatsheet-eq-meaning">${escapeHtml(eq.meaning)}</div>
              </div>`).join('')}
          </div>
        </div>`;
    }

    el.cheatsheetContent.innerHTML = html;
  }

  function shortDescriptionFor(topic, chapter, subject) {
    const map = {
      econ:    `Core mechanism in ${chapter.title}. Connects policy or shock variables to output, prices, or expectations.`,
      math:    `Result or technique in ${chapter.title}. Used to analyze or transform expressions under stated assumptions.`,
      cs:      `Algorithmic concept used in ${chapter.title}. Trade-offs in time, space, and applicability.`,
      science: `Process or principle in ${chapter.title}. Governs cause-and-effect at the relevant scale.`,
      social:  `Framework in ${chapter.title} for interpreting human or institutional behavior.`,
      humanities: `Recurring theme or technique in ${chapter.title} that shapes interpretation.`,
      general: `Key idea in ${chapter.title}.`,
    };
    return map[subject] || map.general;
  }

  function getSubjectEquations(subject) {
    const econ = [
      { formula: 'Y = C + I + G + (X − M)', meaning: 'GDP identity. Output equals consumption + investment + government + net exports.', topics: ['gdp', 'aggregate demand', 'demand', 'output'] },
      { formula: 'MV = PQ', meaning: 'Quantity theory of money. Money supply × velocity = price level × real output.', topics: ['money', 'monetary', 'inflation', 'quantity theory'] },
      { formula: 'C = a + b·Yd', meaning: 'Consumption function. b is MPC; a is autonomous consumption.', topics: ['consumption', 'multiplier', 'mpc', 'aggregate demand'] },
      { formula: 'k = 1 / (1 − MPC)', meaning: 'Spending multiplier. How much GDP changes per $1 of autonomous spending.', topics: ['multiplier', 'aggregate demand', 'fiscal'] },
      { formula: 'IS: Y = C(Y−T) + I(r) + G', meaning: 'Goods-market equilibrium. Output adjusts to balance saving and investment.', topics: ['is-lm', 'is', 'aggregate demand'] },
      { formula: 'LM: M/P = L(r, Y)', meaning: 'Money-market equilibrium. Real money demand depends on interest rate and income.', topics: ['is-lm', 'lm', 'monetary'] },
      { formula: 'π = πᵉ − β(u − u*)', meaning: 'Phillips curve. Inflation depends on expected inflation and the unemployment gap.', topics: ['phillips', 'inflation', 'unemployment'] },
      { formula: 'i = r + πᵉ', meaning: 'Fisher equation. Nominal rate ≈ real rate + expected inflation.', topics: ['fisher', 'interest', 'monetary', 'inflation'] },
      { formula: 'AS-short: P = Pᵉ + α(Y − Y*)', meaning: 'Short-run aggregate supply. Prices respond to the output gap.', topics: ['aggregate supply', 'sras', 'short-run', 'sticky'] },
    ];
    const math = [
      { formula: 'd/dx [f(g(x))] = f\'(g(x))·g\'(x)', meaning: 'Chain rule.', topics: ['derivative', 'chain', 'differentiation'] },
      { formula: '∫ uv\' dx = uv − ∫ u\'v dx', meaning: 'Integration by parts.', topics: ['integration', 'parts', 'integral'] },
      { formula: 'lim_{n→∞} (1 + 1/n)ⁿ = e', meaning: 'Definition of e via limits.', topics: ['limit', 'series', 'sequence', 'e'] },
      { formula: 'e^(iπ) + 1 = 0', meaning: 'Euler\'s identity.', topics: ['euler', 'complex'] },
      { formula: 'a² + b² = c² (right triangle)', meaning: 'Pythagorean theorem.', topics: ['pythagor', 'triangle', 'geometry'] },
      { formula: 'σ²(X) = E[X²] − (E[X])²', meaning: 'Variance from moments.', topics: ['variance', 'statistics', 'probability'] },
    ];
    const cs = [
      { formula: 'O(n log n) — Mergesort, Heapsort', meaning: 'Comparison-based sorting lower bound.', topics: ['sort', 'merge', 'heap', 'big-o', 'sorting'] },
      { formula: 'T(n) = 2T(n/2) + O(n) ⇒ O(n log n)', meaning: 'Master theorem applied to divide-and-conquer.', topics: ['recurrence', 'master', 'divide', 'algorithm'] },
      { formula: 'Hash lookup: avg O(1), worst O(n)', meaning: 'Hash table complexity.', topics: ['hash', 'data structure', 'lookup'] },
      { formula: 'BFS / DFS: O(V + E)', meaning: 'Graph traversal complexity.', topics: ['graph', 'bfs', 'dfs', 'traversal'] },
    ];
    const science = [
      { formula: 'F = ma', meaning: 'Newton\'s second law.', topics: ['force', 'newton', 'motion'] },
      { formula: 'PV = nRT', meaning: 'Ideal gas law.', topics: ['gas', 'ideal', 'pressure', 'volume'] },
      { formula: 'ΔG = ΔH − TΔS', meaning: 'Gibbs free energy. Determines spontaneity.', topics: ['gibbs', 'thermodynam', 'free energy'] },
      { formula: 'pH = −log[H⁺]', meaning: 'pH definition.', topics: ['ph', 'acid', 'base'] },
    ];
    const pools = { econ, math, cs, science };
    return pools[subject] || [];
  }

  // ----- Chapter Overview -----
  function buildOverviewTopicList(course, chapters) {
    const list = [];
    chapters.forEach((chapter, ci) => {
      const material = getChapterStudyMaterial(course, chapter);
      const topics = material?.topics?.length ? material.topics : (chapter.topics?.length ? chapter.topics : [chapter.title]);
      // Pull only the most important topics per chapter (cap at 3 to avoid oversaturation)
      const limit = Math.min(topics.length, 3);
      for (let i = 0; i < limit; i++) {
        list.push({
          key: `${ci}:${i}`,
          label: `Ch. ${ci + 1} — ${topics[i]}`,
          topic: topics[i],
          chapter,
          material,
          chapterIndex: ci,
        });
      }
    });
    return list;
  }

  function renderChapterOverview(course, chapters) {
    if (!course || !chapters.length) {
      el.overviewTopicSelect.innerHTML = '<option value="">No topics</option>';
      el.overviewTopicSelect.disabled = true;
      el.overviewContent.innerHTML = '<p class="text-soft">Select chapters to load topic overviews.</p>';
      return;
    }
    const list = buildOverviewTopicList(course, chapters);
    if (!list.length) {
      el.overviewTopicSelect.innerHTML = '<option value="">No topics</option>';
      el.overviewTopicSelect.disabled = true;
      el.overviewContent.innerHTML = '<p class="text-soft">No topics available.</p>';
      return;
    }
    el.overviewTopicSelect.disabled = false;
    el.overviewTopicSelect.innerHTML = list.map(item =>
      `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`
    ).join('');

    let key = state.summaryState.selectedTopicKey;
    if (!list.find(item => item.key === key)) key = list[0].key;
    state.summaryState.selectedTopicKey = key;
    el.overviewTopicSelect.value = key;

    const item = list.find(i => i.key === key) || list[0];
    el.overviewContent.innerHTML = buildOverviewContent(item, course);
  }

  function buildOverviewContent(item, course) {
    const subject = detectSubject(course);
    const topic = item.topic;
    const chapter = item.chapter;

    const lecture = findTopicContextFromCoursework(topic, course);
    const aiCard = item.material?.flashcards?.find(card => normalizeTitleKey(card.front) === normalizeTitleKey(topic));
    const lectureBlock = lecture ? `
      <div class="overview-section">
        <div class="overview-section-label">From your lecture notes</div>
        <div class="overview-section-body">${escapeHtml(lecture)}</div>
      </div>` : '';

    const definition = aiCard?.back || generateTopicDefinition(topic, chapter, course, subject);
    const background = item.material?.summary
      ? escapeHtml(item.material.summary)
      : subjectBackground(subject, topic, chapter, course);
    const examples = subjectExamples(subject, topic, chapter, course);
    const variations = subjectVariations(subject, topic, chapter, course);

    return `
      <h2>${escapeHtml(topic)}</h2>
      <div class="overview-subtitle">Ch. ${item.chapterIndex + 1} · ${escapeHtml(chapter.title)} · ${escapeHtml(course.code)}</div>

      ${lectureBlock}

      <div class="overview-section">
        <div class="overview-section-label">What it is</div>
        <div class="overview-section-body">${escapeHtml(definition)}</div>
      </div>

      <div class="overview-section">
        <div class="overview-section-label">Background &amp; context</div>
        <div class="overview-section-body">${background}</div>
      </div>

      <div class="overview-section">
        <div class="overview-section-label">Worked example${examples.length > 1 ? 's' : ''}</div>
        ${examples.map(ex => `<div class="overview-example"><strong>${escapeHtml(ex.title)}.</strong> ${escapeHtml(ex.body)}</div>`).join('')}
      </div>

      ${variations ? `
      <div class="overview-section">
        <div class="overview-section-label">How variables interact / variations</div>
        <div class="overview-section-body">${variations}</div>
      </div>` : ''}
    `;
  }

  function subjectBackground(subject, topic, chapter, course) {
    const map = {
      econ:    `In macroeconomic theory, ${escapeHtml(topic)} sits within ${escapeHtml(chapter.title)} as one of the building blocks economists use to translate observed shocks (policy, technology, expectations) into predictions about output, employment, and prices. The intuition usually starts from a household or firm decision, aggregates that behavior up, and asks what equilibrium looks like in the short run versus the long run. Why it matters: if you mismodel ${escapeHtml(topic)}, your policy advice can be wrong by orders of magnitude.`,
      math:    `${escapeHtml(topic)} is part of the ${escapeHtml(chapter.title)} machinery. It is typically introduced after the basic definitions and is used to extend earlier results. Pay attention to the assumptions: most theorems in this area fail when continuity, differentiability, or boundedness is dropped. The proofs often follow a familiar pattern (epsilon-delta, induction, or constructive limit), and getting comfortable with the pattern is the actual goal.`,
      cs:      `${escapeHtml(topic)} appears in ${escapeHtml(chapter.title)} because it captures a recurring trade-off between time, space, and code complexity. In practice you choose this approach when input characteristics (size, distribution, access pattern) make the alternatives too slow or too memory-hungry. Real systems rarely use the textbook version unmodified; they tweak it for cache locality, parallelism, or tail-latency reasons.`,
      science: `${escapeHtml(topic)} is part of the ${escapeHtml(chapter.title)} framework that explains how matter or energy behaves under stated conditions. The microscopic picture (atoms, molecules, fields) drives the macroscopic observations (temperature, pressure, color, rate). When you change the conditions, the system shifts in a predictable direction, and ${escapeHtml(topic)} is one of the levers that determines how big that shift is.`,
      social:  `${escapeHtml(topic)} comes out of a long tradition of debate within ${escapeHtml(chapter.title)}. Different scholars disagree about whether it is best understood structurally (institutions and incentives) or culturally (beliefs and norms). The strongest writers in this area use both lenses. When you analyze a case, you should be explicit about which version of ${escapeHtml(topic)} you are using.`,
      humanities: `${escapeHtml(topic)} is one of the recurring devices or themes in ${escapeHtml(chapter.title)}. It is rarely defined once and for all; instead, it accumulates meaning through repeated use. Track how it changes across the texts in your syllabus: where it first appears, how it shifts, and which authors use it to do the most work.`,
      general: `${escapeHtml(topic)} is part of the ${escapeHtml(chapter.title)} unit and connects to other ideas you have been studying in ${escapeHtml(course.code)}.`,
    };
    return map[subject] || map.general;
  }

  function subjectExamples(subject, topic, chapter, course) {
    const map = {
      econ: [
        { title: 'Worked example', body: `Suppose the economy is at full employment when the central bank unexpectedly cuts the federal funds rate by 100 basis points. Walk through ${topic} step by step. Investment rises because the cost of borrowing falls. Consumption rises through the wealth effect. Aggregate demand shifts right. In the short run output rises above potential and unemployment falls. In the long run, prices adjust upward and output returns to potential. The size of the short-run boom depends on the slope of short-run aggregate supply, which itself depends on how sticky prices and wages are.` },
        { title: 'Counter-example', body: `Now suppose households are perfectly forward-looking and expect the rate cut to be reversed within a year. Saving rises today, consumption barely moves, and the boom is much smaller. ${topic} still applies — but the parameter values change because expectations changed. This is why empirical estimates of monetary policy effects vary so much across regimes.` },
      ],
      math: [
        { title: 'Worked example', body: `Apply ${topic} to a concrete object — say, the function f(x) = x² · sin(x). State which assumption of ${topic} you are using at each step. Show the intermediate result, then verify it matches what you would get from a direct computation.` },
        { title: 'Edge case', body: `Now consider a function that fails one of the assumptions — for example, |x| at x = 0 (not differentiable). ${topic} no longer applies, and you can construct a counterexample showing why the conclusion fails.` },
      ],
      cs: [
        { title: 'Worked example', body: `Run ${topic} on the input [3, 1, 4, 1, 5, 9, 2, 6]. Show intermediate state at each step. Note the comparison count and the swap count. Then count the work and verify it matches the asymptotic analysis.` },
        { title: 'When it fails', body: `Now imagine an adversarial input designed to hit the worst case (for example, an already-sorted or reverse-sorted array). The asymptotic bound still holds in the worst case, but the constant factor matters in practice. Production code typically uses a hybrid (e.g., switching to insertion sort for small subarrays).` },
      ],
      science: [
        { title: 'Worked example', body: `Place a closed system at equilibrium under stated initial conditions. Apply ${topic} to predict the direction the system shifts when one variable (temperature, pressure, concentration) is changed. Quantify the new equilibrium values using the relevant equation.` },
        { title: 'Real-world case', body: `${topic} explains a phenomenon you can observe directly — for example, the way a balloon shrinks when chilled (gas law) or the way a reaction speeds up under a catalyst. Connect the abstract result to the everyday observation.` },
      ],
      social: [
        { title: 'Historical case', body: `Take a specific historical episode (an election, a policy change, a social movement). Use ${topic} as your analytical lens. State what the lens predicts, then evaluate it against what actually happened. The fit is rarely perfect — the gap is where the next argument starts.` },
        { title: 'Contemporary parallel', body: `Find a current example. Apply ${topic} again. The fact that the same lens illuminates two very different periods is part of what gives it explanatory power; the places where it breaks down show its limits.` },
      ],
      humanities: [
        { title: 'Close reading', body: `Take a passage where ${topic} is most visible. Read it slowly. Note the choices the author made (word, image, structure) and how those choices produce the effect ${topic} names. Replace one of those choices with a plausible alternative and ask what changes.` },
      ],
      general: [
        { title: 'Worked example', body: `Apply ${topic} to a concrete case from ${course.code}. Walk through the steps, note where each assumption is used, and check the result against intuition.` },
      ],
    };
    return map[subject] || map.general;
  }

  function subjectVariations(subject, topic, chapter, course) {
    const map = {
      econ:    `Notice how ${topic} responds to changes in its inputs. If MPC rises, the multiplier grows. If expected inflation rises, the short-run Phillips curve shifts up. If price stickiness falls, short-run aggregate supply becomes more vertical and shocks pass through to inflation faster. Build a small table in your head: variable ↑ ⇒ effect on output, prices, and unemployment. The signs and magnitudes of those effects are exactly what exam questions test.`,
      math:    `Vary the assumptions one at a time. What happens to ${topic} when continuity is dropped? When the domain is unbounded? When the function is only piecewise-defined? Each variation either weakens the conclusion, requires a stronger version of the theorem, or breaks the result entirely. Map out which is which.`,
      cs:      `Vary the input characteristics: distribution (random vs. adversarial), size (small vs. huge), access pattern (sequential vs. random). The asymptotic bound usually holds, but the constant factors and cache behavior change drastically, which is why benchmarking matters in practice.`,
      science: `Change one variable at a time and predict the response. Temperature up: equilibrium shifts according to Le Chatelier-style reasoning. Concentration up: rate or position of equilibrium shifts predictably. Pressure or volume changes interact with the stoichiometry. The full picture is the matrix of all these one-at-a-time changes.`,
      social:  null,
      humanities: null,
      general: null,
    };
    return map[subject] || null;
  }

  // ===========================================================================
  // CHAPTER POPOVER (multi-select) - shared between Test and Summary
  // ===========================================================================

  function openChapterPopover(which) {
    closeAllChapterPopovers();
    const course = activeCourse();
    if (!course) return;
    const popover = which === 'test' ? el.testChapterPopover : el.summaryChapterPopover;
    const button  = which === 'test' ? el.testChapterBtn : el.summaryChapterBtn;
    const stateKey = which === 'test' ? 'testState' : 'summaryState';
    renderChapterPopover(popover, course, state[stateKey].selectedChapterIds);
    popover.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    popover._which = which;
  }

  function closeAllChapterPopovers() {
    [el.testChapterPopover, el.summaryChapterPopover].forEach(p => {
      if (p && !p.classList.contains('hidden')) p.classList.add('hidden');
    });
    [el.testChapterBtn, el.summaryChapterBtn].forEach(b => {
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  function handleChapterPopoverClick(popover, e) {
    const which = popover._which;
    if (!which) return;
    const stateKey = which === 'test' ? 'testState' : 'summaryState';
    const course = activeCourse();
    if (!course) return;
    const all = course.chapters;
    const allIds = all.map(c => c.id);
    const current = state[stateKey].selectedChapterIds == null
      ? allIds.slice()
      : state[stateKey].selectedChapterIds.slice();

    const actionBtn = e.target.closest('[data-multi-action]');
    if (actionBtn) {
      const act = actionBtn.dataset.multiAction;
      if (act === 'all') {
        const allSelected = allIds.every(id => current.includes(id));
        state[stateKey].selectedChapterIds = allSelected ? [] : null;
      } else if (act === 'close') {
        closeAllChapterPopovers();
        return;
      }
      saveState();
      renderChapterPopover(popover, course, state[stateKey].selectedChapterIds);
      // Re-render the affected panel
      if (which === 'test') { resetTestProgressOnSelection(); renderTestPanel(); }
      else { renderSummaryPanel(); }
      return;
    }

    const row = e.target.closest('[data-chapter-id]');
    if (!row) return;
    const id = row.dataset.chapterId;
    const set = new Set(current);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    state[stateKey].selectedChapterIds = next;
    saveState();
    renderChapterPopover(popover, course, state[stateKey].selectedChapterIds);
    if (which === 'test') { resetTestProgressOnSelection(); renderTestPanel(); }
    else { renderSummaryPanel(); }
  }

  function resetTestProgressOnSelection() {
    state.testState.index = 0;
    state.testState.shuffledOrder = null;
    state.testState.flipped = false;
    state.testState.explainShown = false;
    state.testState.mcSelectedOption = null;
    state.testState.mcGraded = false;
    state.testState.mcExplainShown = false;
    state.testState.explainText = '';
    state.testState.mcExplainText = '';
  }

  // ===========================================================================
  // COURSES
  // ===========================================================================

  function selectCourse(id) {
    state.activeCourseId  = id;
    const c = state.courses.find(c => c.id === id);
    state.activeChapterId = c?.chapters[0]?.id || null;
    // Reset chapter selections to "all" for both Test and Summary
    state.testState.selectedChapterIds = null;
    state.summaryState.selectedChapterIds = null;
    state.summaryState.selectedTopicKey = null;
    resetTestCard();
    saveState(); renderAll();
  }

  function selectChapter(id) {
    state.activeChapterId = id;
    resetTestCard();
    saveState(); renderChapters(); renderChat(); renderTestPanel();
  }

  function toggleDashboard() {
    state.dashboardCollapsed = !state.dashboardCollapsed;
    el.dashboardPanel.classList.toggle('collapsed', state.dashboardCollapsed);
    el.restoreTab.classList.toggle('visible', state.dashboardCollapsed);
    saveState();
  }

  // ----- Add class -----
  function openAddClassModal() {
    addClassStagedIngest = null;
    el.addClassForm.reset();
    el.addClassUploadStatus.classList.add('hidden');
    el.addClassChaptersPreview.classList.add('hidden');
    el.addClassModal.classList.remove('hidden-modal');
    setTimeout(() => el.newCourseCode.focus(), 80);
  }
  function closeAddClassModal() {
    el.addClassModal.classList.add('hidden-modal');
    el.addClassForm.reset();
    addClassStagedIngest = null;
  }

  async function handleAddClassUpload() {
    const file = el.addClassFileInput.files[0];
    if (!file) return;
    el.addClassUploadStatus.classList.remove('hidden');
    el.addClassUploadMsg.textContent = 'Parsing syllabus...';
    el.addClassUploadBtn.disabled = true;
    try {
      const data = await api.ingest([file], '_new_');
      addClassStagedIngest = data;
      // Auto-fill form fields
      if (data.code) el.newCourseCode.value = data.code;
      if (data.name) el.newCourseName.value = data.name;
      const chCount = data.chapters?.length || 0;
      if (chCount) {
        el.addClassChaptersPreview.textContent = `AI found ${chCount} chapter${chCount === 1 ? '' : 's'} — they'll be added when you confirm.`;
        el.addClassChaptersPreview.classList.remove('hidden');
      }
      const materialCount = data.studyMaterials?.chapters?.length || 0;
      el.addClassUploadMsg.textContent = materialCount
        ? `✓ Syllabus parsed. Generated study materials for ${materialCount} chapter${materialCount === 1 ? '' : 's'}.`
        : '✓ Syllabus parsed. Review and confirm below.';
    } catch (err) {
      el.addClassUploadMsg.textContent = `Parse failed: ${err.message}`;
    } finally {
      el.addClassUploadBtn.disabled = false;
      el.addClassFileInput.value = '';
    }
  }

  function submitAddClass(e) {
    e.preventDefault();
    const code   = el.newCourseCode.value.trim();
    const name   = el.newCourseName.value.trim();
    const pctRaw = el.newCoursePct.value.trim();
    if (!code || !name) return;

    const id  = code.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
    const pct = pctRaw ? Number(pctRaw) : null;

    // Build chapters and weights from staged ingest if available
    let chapters        = [];
    let gradingWeights  = [];
    if (addClassStagedIngest) {
      chapters = (addClassStagedIngest.chapters || []).map((ch, i) => ({
        id: `ch-${Date.now().toString(36)}-${i}`,
        title: ch.title, topics: ch.topics || [],
      }));
      const generatedMaterials = mapStudyMaterialsToChapters(addClassStagedIngest.studyMaterials, chapters);
      chapters.forEach(chapter => {
        const material = generatedMaterials[chapter.id];
        if ((!chapter.topics || !chapter.topics.length) && material?.topics?.length) {
          chapter.topics = material.topics.slice(0, 6);
        }
      });
      const w = addClassStagedIngest.gradingWeights || {};
      gradingWeights = Object.entries(w).map(([name, weight], i) => ({
        id: `w-${i}`, name, weight: Number(weight) || 0, earned: 0,
      }));
    }

    const newCourse = {
      id, code, name,
      gradePercentage: pct,
      gradeLetter: pct != null ? letterFromPercentage(pct, DEFAULT_GRADE_SCALE) : '—',
      gradeManual: pct != null,
      gradeScale: { ...DEFAULT_GRADE_SCALE },
      gradingWeights,
      chapters,
      coursework: addClassStagedIngest?.extractedText
        ? [{ id: 'cw-init', name: 'Syllabus (auto)', size: 0, type: 'text/plain', uploadedAt: Date.now(), text: addClassStagedIngest.extractedText }]
        : [],
      studyMaterials: mapStudyMaterialsToChapters(addClassStagedIngest?.studyMaterials, chapters),
    };

    state.courses.push(newCourse);
    state.activeCourseId  = id;
    state.activeChapterId = chapters[0]?.id || null;
    saveState();
    closeAddClassModal();
    renderAll();
    toast(`${code} added${chapters.length ? ` with ${chapters.length} chapters` : ''}.`, { success: true });
  }

  // ----- Add chapter (manual) -----
  function openAddChapterModal() {
    if (!state.activeCourseId) { toast('Select a course first.', { error: true }); return; }
    el.addChapterModal.classList.remove('hidden-modal');
    setTimeout(() => el.newChapterTitle.focus(), 80);
  }
  function closeAddChapterModal() {
    el.addChapterModal.classList.add('hidden-modal');
    el.addChapterForm.reset();
  }
  function submitAddChapter(e) {
    e.preventDefault();
    const title     = el.newChapterTitle.value.trim();
    const topicsRaw = el.newChapterTopics.value.trim();
    if (!title) return;
    const course  = state.courses.find(c => c.id === state.activeCourseId);
    if (!course) return;
    const topics  = topicsRaw ? topicsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const id      = 'ch-' + Date.now().toString(36);
    course.chapters.push({ id, title, topics });
    state.activeChapterId = id;
    resetTestCard();
    saveState(); closeAddChapterModal(); renderAll();
    toast(`Chapter "${title}" added.`);
  }

  // ----- Edit chapter (pencil icon → modal → save or delete) -----
  function openEditChapterModal(chapterId) {
    const course  = state.courses.find(c => c.id === state.activeCourseId);
    const chapter = course?.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;
    editingChapterId = chapterId;
    el.editChapterTitle.value  = chapter.title;
    el.editChapterTopics.value = (chapter.topics || []).join(', ');
    el.editChapterModal.classList.remove('hidden-modal');
    setTimeout(() => el.editChapterTitle.focus(), 80);
  }
  function closeEditChapterModal() {
    el.editChapterModal.classList.add('hidden-modal');
    editingChapterId = null;
  }
  function submitEditChapter(e) {
    e.preventDefault();
    const course  = state.courses.find(c => c.id === state.activeCourseId);
    const chapter = course?.chapters.find(ch => ch.id === editingChapterId);
    if (!chapter) return;
    chapter.title  = el.editChapterTitle.value.trim() || chapter.title;
    chapter.topics = el.editChapterTopics.value.trim()
      ? el.editChapterTopics.value.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    saveState(); closeEditChapterModal(); renderAll();
    toast('Chapter saved.');
  }
  function deleteEditingChapter() {
    const course  = state.courses.find(c => c.id === state.activeCourseId);
    const chapter = course?.chapters.find(ch => ch.id === editingChapterId);
    if (!chapter) return;
    if (!confirm(`Delete chapter "${chapter.title}"?\n\nChat history for this chapter will also be removed. This cannot be undone.`)) return;
    course.chapters = course.chapters.filter(ch => ch.id !== editingChapterId);
    delete state.chatHistory[`${course.id}:${editingChapterId}`];
    if (state.activeChapterId === editingChapterId) {
      state.activeChapterId = course.chapters[0]?.id || null;
    }
    resetTestCard();
    saveState(); closeEditChapterModal(); renderAll();
    toast('Chapter deleted.');
  }

  // ----- Coursework delete -----
  function deleteCoursework(workId) {
    const course = state.courses.find(c => c.id === state.activeCourseId);
    if (!course) return;
    course.coursework = course.coursework.filter(f => f.id !== workId);
    saveState(); renderCoursework();
    toast('File removed.');
  }

  // ===========================================================================
  // EDIT COURSE MODAL
  // ===========================================================================

  function openEditCourseModal(courseId) {
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return;
    editingCourseId = courseId;
    el.editCourseCode.value    = course.code;
    el.editCourseName.value    = course.name;
    el.editGradeManual.checked = !!course.gradeManual;
    el.editGradePct.value      = course.gradePercentage ?? '';
    el.editGradeLetter.value   = course.gradeLetter ?? '';
    renderWeightsEditor(course);
    renderScaleEditor(course);
    updateEditGradeFields();
    el.editCourseModal.classList.remove('hidden-modal');
  }
  function closeEditCourseModal() {
    el.editCourseModal.classList.add('hidden-modal');
    editingCourseId = null;
  }

  function renderWeightsEditor(course) {
    const w = course.gradingWeights || [];
    el.weightsList.innerHTML = !w.length
      ? `<div class="text-xs text-muted">No weights yet. Click "+ Add row".</div>`
      : w.map(row => `
          <div class="weight-row" data-weight-id="${row.id}">
            <input type="text" class="input-base input-sm weight-name" placeholder="Category" value="${escapeHtml(row.name || '')}" />
            <input type="number" class="input-base input-sm weight-weight" placeholder="%" min="0" max="100" step="0.1" value="${row.weight ?? ''}" />
            <input type="number" class="input-base input-sm weight-earned" placeholder="Earned %" min="0" max="100" step="0.1" value="${row.earned ?? ''}" />
            <button type="button" class="delete-btn" data-delete-weight="${row.id}">✕</button>
          </div>`).join('');
    updateWeightsSummary(course);
  }

  function updateWeightsSummary(course) {
    const total = (course.gradingWeights || []).reduce((s, w) => s + (Number(w.weight) || 0), 0);
    el.weightsTotal.textContent = total + '%';
    el.weightsTotal.style.color = (total === 100 || total === 0) ? '' : 'var(--c-danger)';
    const c = computeGradeFromWeights(course.gradingWeights);
    el.weightsComputed.textContent = c != null ? `${fmtPct(c)} (${letterFromPercentage(c, course.gradeScale)})` : '—';
  }

  function renderScaleEditor(course) {
    el.gradeScaleGrid.innerHTML = Object.entries(course.gradeScale || DEFAULT_GRADE_SCALE).map(([letter, cutoff]) => `
      <div class="scale-cell">
        <label>${escapeHtml(letter)}</label>
        <input type="number" class="input-base input-sm scale-input" data-letter="${escapeHtml(letter)}" min="0" max="100" step="0.1" value="${cutoff}" />
      </div>`).join('');
  }

  function updateEditGradeFields() {
    const manual = el.editGradeManual.checked;
    el.editGradePct.disabled    = !manual;
    el.editGradeLetter.disabled = !manual;
    if (!manual) {
      const course = state.courses.find(c => c.id === editingCourseId);
      if (!course) return;
      readWeightsFromForm(course);
      const c = computeGradeFromWeights(course.gradingWeights);
      if (c != null) { el.editGradePct.value = c; el.editGradeLetter.value = letterFromPercentage(c, course.gradeScale); }
    }
  }

  function readWeightsFromForm(course) {
    course.gradingWeights = Array.from(el.weightsList.querySelectorAll('.weight-row')).map(r => ({
      id: r.dataset.weightId,
      name: r.querySelector('.weight-name').value.trim(),
      weight: Number(r.querySelector('.weight-weight').value) || 0,
      earned: Number(r.querySelector('.weight-earned').value) || 0,
    }));
  }

  function readScaleFromForm(course) {
    const scale = {};
    el.gradeScaleGrid.querySelectorAll('.scale-input').forEach(i => {
      const v = Number(i.value);
      if (!isNaN(v)) scale[i.dataset.letter] = v;
    });
    course.gradeScale = scale;
  }

  function addWeightRow() {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    readWeightsFromForm(course);
    course.gradingWeights.push({ id: 'w-' + Date.now().toString(36), name: '', weight: 0, earned: 0 });
    renderWeightsEditor(course);
    if (!el.editGradeManual.checked) updateEditGradeFields();
  }

  function deleteWeight(id) {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    readWeightsFromForm(course);
    course.gradingWeights = course.gradingWeights.filter(w => w.id !== id);
    renderWeightsEditor(course);
    if (!el.editGradeManual.checked) updateEditGradeFields();
  }

  function saveCourseEdit() {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    course.code        = el.editCourseCode.value.trim() || course.code;
    course.name        = el.editCourseName.value.trim() || course.name;
    course.gradeManual = el.editGradeManual.checked;
    readWeightsFromForm(course); readScaleFromForm(course);
    if (course.gradeManual) {
      course.gradePercentage = el.editGradePct.value === '' ? null : Number(el.editGradePct.value);
      course.gradeLetter     = el.editGradeLetter.value.trim() || letterFromPercentage(course.gradePercentage, course.gradeScale);
    } else { refreshCourseGrade(course); }
    saveState(); closeEditCourseModal(); renderAll();
    toast('Course saved.', { success: true });
  }

  function deleteActiveCourse() {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    if (!confirm(`Delete "${course.code} — ${course.name}"?\n\nThis cannot be undone.`)) return;
    state.courses = state.courses.filter(c => c.id !== editingCourseId);
    Object.keys(state.chatHistory).forEach(k => { if (k.startsWith(editingCourseId + ':')) delete state.chatHistory[k]; });
    if (state.activeCourseId === editingCourseId) {
      state.activeCourseId  = state.courses[0]?.id || null;
      state.activeChapterId = state.courses[0]?.chapters[0]?.id || null;
    }
    saveState(); closeEditCourseModal(); renderAll();
    toast(`${course.code} deleted.`);
  }

  // ===========================================================================
  // CHAT
  // ===========================================================================

  function getCourseworkContext(courseId) {
    const course = state.courses.find(c => c.id === courseId);
    if (!course?.coursework?.length) return '';
    const texts = course.coursework
      .map(f => f.text || '')
      .filter(Boolean)
      .join('\n\n---\n\n');
    return texts.slice(0, 12000); // cap to avoid excessive tokens
  }

  async function sendMessage() {
    const text = el.chatInput.value.trim();
    if (!text) return;
    if (!state.activeCourseId || !state.activeChapterId) {
      toast('Select a course and chapter first.', { error: true }); return;
    }

    const key = `${state.activeCourseId}:${state.activeChapterId}`;
    if (!state.chatHistory[key]) state.chatHistory[key] = [];

    state.chatHistory[key].push({ role: 'user', content: text });
    state.chatHistory[key].push({ role: 'thinking' });
    el.chatInput.value = ''; autoResize(el.chatInput);
    el.sendBtn.disabled = true;
    saveState(); renderChat();

    try {
      const course  = state.courses.find(c => c.id === state.activeCourseId);
      const chapter = course?.chapters.find(ch => ch.id === state.activeChapterId);
      const history = state.chatHistory[key].filter(m => m.role === 'user' || m.role === 'assistant').slice(-10);

      const reply = await api.chat({
        message: text,
        courseName: course?.name || '',
        courseCode: course?.code || '',
        chapterTitle: chapter?.title || '',
        chapterTopics: chapter?.topics || [],
        courseworkContext: getCourseworkContext(state.activeCourseId),
        history,
      });

      state.chatHistory[key] = state.chatHistory[key].filter(m => m.role !== 'thinking');
      state.chatHistory[key].push({ role: 'assistant', content: reply });
    } catch (err) {
      state.chatHistory[key] = state.chatHistory[key].filter(m => m.role !== 'thinking');
      state.chatHistory[key].push({ role: 'assistant', content: friendlyErrorMessage(err) });
    } finally {
      el.sendBtn.disabled = false;
      saveState(); renderChat();
    }
  }

  // ===========================================================================
  // FILE UPLOAD + APPROVAL
  // ===========================================================================

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (!state.activeCourseId) { toast('Select a course first.', { error: true }); e.target.value = ''; return; }

    // Show loading state: add placeholder rows with spinner
    const course = state.courses.find(c => c.id === state.activeCourseId);
    const placeholders = files.map(f => ({
      id: 'cw-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: f.name, size: f.size, type: f.type,
      uploadedAt: Date.now(), uploading: true, text: '',
    }));
    course.coursework = [...(course.coursework || []), ...placeholders];
    renderCoursework();

    el.uploadBtn.disabled = true;
    el.uploadBtnLabel.textContent = `Parsing ${files.length} file${files.length === 1 ? '' : 's'}...`;

    try {
      const data = await api.ingest(files, state.activeCourseId);
      // Remove placeholders
      course.coursework = course.coursework.filter(f => !f.uploading);
      pendingIngest = {
        data,
        files: files.map((f, i) => ({
          id: placeholders[i].id,
          name: f.name, size: f.size, type: f.type,
          uploadedAt: Date.now(),
          text: data.extractedText || '',
        })),
      };
      openIngestModal();
    } catch (err) {
      course.coursework = course.coursework.filter(f => !f.uploading);
      toast(friendlyErrorMessage(err), { error: true });
    } finally {
      el.uploadBtn.disabled = false;
      el.uploadBtnLabel.textContent = 'Upload coursework';
      e.target.value = '';
      renderCoursework();
    }
  }

  function openIngestModal() {
    if (!pendingIngest) return;
    const { data } = pendingIngest;
    el.ingestCode.value = data.code || '';
    el.ingestName.value = data.name || '';

    pendingIngest.chapters = (data.chapters || []).map((ch, i) => ({
      id: ch.id || `ch-${Date.now().toString(36)}-${i}`,
      title: ch.title || '', topics: Array.isArray(ch.topics) ? ch.topics : [],
    }));
    renderIngestChapters();

    const w = data.gradingWeights || {};
    pendingIngest.weights = Object.entries(w).map(([name, weight], i) => ({
      id: `iw-${i}`, name, weight: Number(weight) || 0, earned: 0,
    }));
    renderIngestWeights();
    el.ingestModal.classList.remove('hidden-modal');
  }
  function closeIngestModal() { el.ingestModal.classList.add('hidden-modal'); pendingIngest = null; }

  function renderIngestChapters() {
    const list = pendingIngest.chapters;
    el.ingestChaptersCount.textContent = `${list.length} found`;
    if (!list.length) {
      el.ingestChaptersList.innerHTML = `<div class="text-xs text-muted">None. Click "+ Add" to add manually.</div>`;
      return;
    }
    el.ingestChaptersList.innerHTML = list.map(ch => `
      <div class="ingest-chapter-row" data-ingest-ch="${ch.id}">
        <input type="text" class="input-base input-sm ingest-ch-title" placeholder="Title" value="${escapeHtml(ch.title)}" />
        <input type="text" class="input-base input-sm ingest-ch-topics" placeholder="Topics, comma-separated" value="${escapeHtml((ch.topics || []).join(', '))}" />
        <button type="button" data-delete-ingest-ch="${ch.id}" style="width:28px;height:28px;background:transparent;border:none;color:var(--c-muted);cursor:pointer;border-radius:4px;font-size:14px;">✕</button>
      </div>`).join('');
  }

  function renderIngestWeights() {
    const list = pendingIngest.weights;
    if (!list.length) {
      el.ingestWeightsList.innerHTML = '';
      el.ingestWeightsEmpty.style.display = 'block';
      el.ingestWeightsHeader.classList.add('hidden');
      return;
    }
    el.ingestWeightsEmpty.style.display = 'none';
    el.ingestWeightsHeader.classList.remove('hidden');
    el.ingestWeightsList.innerHTML = list.map(w => `
      <div class="weight-row" data-ingest-w="${w.id}" style="grid-template-columns:1fr 80px 30px;">
        <input type="text" class="input-base input-sm ingest-w-name" placeholder="Category" value="${escapeHtml(w.name)}" />
        <input type="number" class="input-base input-sm ingest-w-weight" min="0" max="100" step="0.1" value="${w.weight}" />
        <button type="button" data-delete-ingest-w="${w.id}" style="width:28px;height:28px;background:transparent;border:none;color:var(--c-muted);cursor:pointer;border-radius:4px;font-size:14px;">✕</button>
      </div>`).join('');
  }

  function readIngestForm() {
    pendingIngest.data.code = el.ingestCode.value.trim();
    pendingIngest.data.name = el.ingestName.value.trim();
    pendingIngest.chapters = Array.from(el.ingestChaptersList.querySelectorAll('[data-ingest-ch]')).map(r => ({
      id: r.dataset.ingestCh,
      title: r.querySelector('.ingest-ch-title').value.trim(),
      topics: r.querySelector('.ingest-ch-topics').value.trim()
        ? r.querySelector('.ingest-ch-topics').value.split(',').map(t => t.trim()).filter(Boolean) : [],
    })).filter(c => c.title);
    pendingIngest.weights = Array.from(el.ingestWeightsList.querySelectorAll('[data-ingest-w]')).map(r => ({
      id: r.dataset.ingestW,
      name: r.querySelector('.ingest-w-name').value.trim(),
      weight: Number(r.querySelector('.ingest-w-weight').value) || 0,
      earned: 0,
    })).filter(w => w.name);
  }

  function applyIngest() {
    if (!pendingIngest) return;
    readIngestForm();
    const course = state.courses.find(c => c.id === state.activeCourseId);
    if (!course) return;
    const mode = document.querySelector('input[name="applyMode"]:checked')?.value || 'merge';
    if (pendingIngest.data.code) course.code = pendingIngest.data.code;
    if (pendingIngest.data.name) course.name = pendingIngest.data.name;

    const newChapters = pendingIngest.chapters.map((ch, i) => ({
      id: 'ch-' + Date.now().toString(36) + '-' + i,
      title: ch.title, topics: ch.topics,
    }));
    const generatedMaterialsForExisting = mapStudyMaterialsToChapters(pendingIngest.data.studyMaterials, course.chapters, false);
    const generatedMaterials = mapStudyMaterialsToChapters(pendingIngest.data.studyMaterials, newChapters);
    newChapters.forEach(chapter => {
      const material = generatedMaterials[chapter.id];
      if ((!chapter.topics || !chapter.topics.length) && material?.topics?.length) {
        chapter.topics = material.topics.slice(0, 6);
      }
    });

    if (mode === 'replace') {
      course.chapters = newChapters;
      course.studyMaterials = generatedMaterials;
      course.gradingWeights = pendingIngest.weights.map((w, i) => ({
        id: 'w-' + Date.now().toString(36) + '-' + i, name: w.name, weight: w.weight, earned: 0,
      }));
    } else {
      course.chapters = course.chapters.concat(newChapters);
      course.studyMaterials = { ...(course.studyMaterials || {}), ...generatedMaterialsForExisting, ...generatedMaterials };
      const existing = new Set(course.gradingWeights.map(w => w.name.toLowerCase()));
      pendingIngest.weights.forEach((w, i) => {
        if (!existing.has(w.name.toLowerCase())) {
          course.gradingWeights.push({ id: 'w-' + Date.now().toString(36) + '-' + i, name: w.name, weight: w.weight, earned: 0 });
        }
      });
    }

    // Store file metadata + extracted text in coursework
    course.coursework = [...(course.coursework || []), ...pendingIngest.files];
    if (newChapters.length && !course.chapters.find(c => c.id === state.activeChapterId)) {
      state.activeChapterId = newChapters[0]?.id;
    }
    if (newChapters.length) resetTestCard();
    refreshCourseGrade(course);
    saveState(); closeIngestModal(); renderAll();
    const materialCount = new Set([...Object.keys(generatedMaterialsForExisting), ...Object.keys(generatedMaterials)]).size;
    toast(`Applied. Added ${newChapters.length} chapter${newChapters.length === 1 ? '' : 's'} and updated ${materialCount} study set${materialCount === 1 ? '' : 's'}.`, { success: true });
  }

  // ===========================================================================
  // SETTINGS
  // ===========================================================================

  function applyTheme() {
    document.body.dataset.theme = VALID_THEMES.includes(state.settings.theme) ? state.settings.theme : 'dark';
  }

  function openSettingsModal() {
    el.settingShowPct.checked     = state.settings.showPercentage;
    el.settingShowLetter.checked  = state.settings.showLetter;
    el.settingShowChapters.checked= state.settings.showChapters;
    el.settingTheme.value         = VALID_THEMES.includes(state.settings.theme) ? state.settings.theme : 'dark';
    el.settingsModal.classList.remove('hidden-modal');
    refreshHealth();
  }
  function closeSettingsModal() { el.settingsModal.classList.add('hidden-modal'); }

  function onSettingsChange() {
    state.settings.showPercentage = el.settingShowPct.checked;
    state.settings.showLetter     = el.settingShowLetter.checked;
    state.settings.showChapters   = el.settingShowChapters.checked;
    state.settings.theme          = VALID_THEMES.includes(el.settingTheme.value) ? el.settingTheme.value : 'dark';
    applyTheme();
    saveState(); renderCourses();
  }

  async function refreshHealth() {
    el.backendStatus.textContent = 'checking...';
    el.backendStatus.style.color = '';
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.json();
      el.backendStatus.textContent = 'connected';
      el.backendStatus.style.color = '#BFE0BF';
      el.apiKeyStatus.textContent  = h.api_key_configured ? `${h.provider} ✓` : `${h.provider} missing`;
      el.apiKeyStatus.style.color  = h.api_key_configured ? '#BFE0BF' : 'var(--c-danger)';
      el.modelStatus.textContent   = h.model || '—';
    } catch {
      el.backendStatus.textContent = 'unreachable — run python server.py';
      el.backendStatus.style.color = 'var(--c-danger)';
    }
  }

  // ===========================================================================
  // API
  // ===========================================================================

  function friendlyErrorMessage(err) {
    const msg = err.message || String(err);
    if (msg.includes('405')) return 'HTTP 405 — you\'re not running python server.py.\n\nRun it in your terminal and visit http://localhost:5000.';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Cannot reach backend. Run python server.py, then reload at http://localhost:5000.';
    if (msg.includes('404')) return 'API route not found. Make sure server.py is up to date.';
    if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('anthropic') || msg.toLowerCase().includes('google')) return 'API key missing or invalid. Check your .env file and restart the server.';
    return msg;
  }

  const api = {
    async chat(payload) {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      return (await res.json()).reply;
    },
    async ingest(files, courseId) {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('courseId', courseId);
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      return res.json();
    },
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function autoResize(elm) { elm.style.height = 'auto'; elm.style.height = Math.min(elm.scrollHeight, 140) + 'px'; }

  let toastTimer;
  function toast(msg, opts = {}) {
    el.toast.textContent = msg;
    el.toast.classList.remove('error', 'success');
    if (opts.error) el.toast.classList.add('error');
    if (opts.success) el.toast.classList.add('success');
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('visible'), opts.error ? 7000 : 3200);
  }

  // ===========================================================================
  // EVENT WIRING
  // ===========================================================================

  // Auth tabs
  el.tabSignIn.addEventListener('click', () => switchAuthTab('signin'));
  el.tabSignUp.addEventListener('click', () => switchAuthTab('signup'));
  el.signInForm.addEventListener('submit', handleSignIn);
  el.signUpForm.addEventListener('submit', handleSignUp);

  // Account
  el.avatarBtn.addEventListener('click', openAccountModal);
  el.accountModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeAccountModal(); });
  el.accountSettingsBtn.addEventListener('click', () => { closeAccountModal(); openSettingsModal(); });
  el.accountSignOutBtn.addEventListener('click', signOut);

  // Dashboard
  el.courseGrid.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-course]');
    if (editBtn) { e.stopPropagation(); openEditCourseModal(editBtn.dataset.editCourse); return; }
    if (e.target.closest('[data-action="add-class"]')) { openAddClassModal(); return; }
    const card = e.target.closest('[data-course-id]');
    if (card) selectCourse(card.dataset.courseId);
  });

  el.addClassBtn.addEventListener('click', openAddClassModal);
  el.hideDashBtn.addEventListener('click', toggleDashboard);
  el.restoreTab.addEventListener('click', toggleDashboard);

  // Add class modal
  el.addClassModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeAddClassModal(); });
  el.addClassForm.addEventListener('submit', submitAddClass);
  el.addClassUploadBtn.addEventListener('click', () => el.addClassFileInput.click());
  el.addClassFileInput.addEventListener('change', handleAddClassUpload);

  // Chapter list (edit icon → modal, not direct X)
  el.chapterList.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-chapter]');
    if (editBtn) { e.stopPropagation(); openEditChapterModal(editBtn.dataset.editChapter); return; }
    const row = e.target.closest('[data-chapter-id]');
    if (row) selectChapter(row.dataset.chapterId);
  });

  // Edit chapter modal
  el.editChapterModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeEditChapterModal(); });
  el.editChapterForm.addEventListener('submit', submitEditChapter);
  el.deleteChapterBtn.addEventListener('click', deleteEditingChapter);

  // Add chapter modal
  el.addChapterBtn.addEventListener('click', openAddChapterModal);
  el.addChapterModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeAddChapterModal(); });
  el.addChapterForm.addEventListener('submit', submitAddChapter);

  // Coursework
  el.courseworkList.addEventListener('click', e => {
    const d = e.target.closest('[data-delete-coursework]');
    if (d) deleteCoursework(d.dataset.deleteCoursework);
  });
  el.uploadBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', handleFileUpload);

  // Edit course modal
  el.editCourseModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeEditCourseModal(); });
  el.saveCourseBtn.addEventListener('click', saveCourseEdit);
  el.deleteCourseBtn.addEventListener('click', deleteActiveCourse);
  el.addWeightBtn.addEventListener('click', addWeightRow);
  el.editGradeManual.addEventListener('change', updateEditGradeFields);
  el.weightsList.addEventListener('click', e => { const d = e.target.closest('[data-delete-weight]'); if (d) deleteWeight(d.dataset.deleteWeight); });
  el.weightsList.addEventListener('input', () => {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    readWeightsFromForm(course); updateWeightsSummary(course);
    if (!el.editGradeManual.checked) updateEditGradeFields();
  });
  el.gradeScaleGrid.addEventListener('input', () => {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    readScaleFromForm(course);
    if (!el.editGradeManual.checked) updateEditGradeFields();
  });
  el.resetScaleBtn.addEventListener('click', () => {
    const course = state.courses.find(c => c.id === editingCourseId);
    if (!course) return;
    course.gradeScale = { ...DEFAULT_GRADE_SCALE };
    renderScaleEditor(course);
    if (!el.editGradeManual.checked) updateEditGradeFields();
  });

  // Ingest modal
  el.ingestModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeIngestModal(); });
  el.ingestApplyBtn.addEventListener('click', applyIngest);
  el.ingestAddChapterBtn.addEventListener('click', () => {
    if (!pendingIngest) return;
    readIngestForm();
    pendingIngest.chapters.push({ id: 'ch-' + Date.now().toString(36), title: '', topics: [] });
    renderIngestChapters();
  });
  el.ingestChaptersList.addEventListener('click', e => {
    const d = e.target.closest('[data-delete-ingest-ch]');
    if (d && pendingIngest) { readIngestForm(); pendingIngest.chapters = pendingIngest.chapters.filter(c => c.id !== d.dataset.deleteIngestCh); renderIngestChapters(); }
  });
  el.ingestWeightsList.addEventListener('click', e => {
    const d = e.target.closest('[data-delete-ingest-w]');
    if (d && pendingIngest) { readIngestForm(); pendingIngest.weights = pendingIngest.weights.filter(w => w.id !== d.dataset.deleteIngestW); renderIngestWeights(); }
  });

  // Tutor mode switching + test page
  el.tutorModeSelect.addEventListener('change', e => setTutorMode(e.target.value));
  el.testCourseSelect.addEventListener('change', e => { if (e.target.value) selectCourse(e.target.value); });

  // Test chapter multi-select popover
  el.testChapterBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = el.testChapterPopover.classList.contains('hidden');
    closeAllChapterPopovers();
    if (open) openChapterPopover('test');
  });
  el.testChapterPopover.addEventListener('click', e => {
    e.stopPropagation();
    handleChapterPopoverClick(el.testChapterPopover, e);
  });

  // Summary chapter multi-select popover
  el.summaryChapterBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = el.summaryChapterPopover.classList.contains('hidden');
    closeAllChapterPopovers();
    if (open) openChapterPopover('summary');
  });
  el.summaryChapterPopover.addEventListener('click', e => {
    e.stopPropagation();
    handleChapterPopoverClick(el.summaryChapterPopover, e);
  });

  // Click outside to close popovers
  document.addEventListener('click', () => closeAllChapterPopovers());

  if (el.testShuffleBtn) el.testShuffleBtn.addEventListener('click', toggleShuffle);

  el.testPanel.addEventListener('click', e => {
    // Sub-mode toggle
    const submodeBtn = e.target.closest('.test-submode-btn');
    if (submodeBtn) { setTestSubMode(submodeBtn.dataset.submode); return; }
    // MC option selection
    const mcBtn = e.target.closest('[data-mc-option]');
    if (mcBtn && !state.testState.mcGraded) {
      state.testState.mcSelectedOption = parseInt(mcBtn.dataset.mcOption, 10);
      state.testState.mcExplainShown = false;
      state.testState.mcExplainText = '';
      saveState(); renderTestPanel();
      return;
    }
    // Test actions
    const btn = e.target.closest('[data-test-action]');
    if (btn) handleTestAction(btn.dataset.testAction);
  });
  el.testAnswer.addEventListener('input', () => {
    state.testState.answer = el.testAnswer.value;
    saveState();
  });

  // Summary mode
  el.summaryCourseSelect.addEventListener('change', e => { if (e.target.value) selectCourse(e.target.value); });
  el.summaryPanel.addEventListener('click', e => {
    const sub = e.target.closest('.test-submode-btn');
    if (sub) {
      const m = sub.dataset.summaryMode;
      if (VALID_SUMMARY_MODES.includes(m)) {
        state.summaryState.mode = m;
        saveState();
        renderSummaryPanel();
      }
    }
  });
  el.overviewTopicSelect.addEventListener('change', e => {
    state.summaryState.selectedTopicKey = e.target.value;
    saveState();
    renderSummaryPanel();
  });

  // Chat
  el.sendBtn.addEventListener('click', sendMessage);
  el.chatInput.addEventListener('input', () => autoResize(el.chatInput));
  el.chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  // Settings
  el.settingsBtn.addEventListener('click', openSettingsModal);
  el.settingsModal.addEventListener('click', e => { if (e.target.matches('[data-close-modal]')) closeSettingsModal(); });
  el.settingShowPct.addEventListener('change', onSettingsChange);
  el.settingShowLetter.addEventListener('change', onSettingsChange);
  el.settingShowChapters.addEventListener('change', onSettingsChange);
  el.settingTheme.addEventListener('change', onSettingsChange);
  el.resetAllBtn.addEventListener('click', () => {
    if (confirm('Reset all StudyBrain data? Courses, chapters, chats, and settings will be cleared.')) {
      const user = state.user;
      localStorage.removeItem(STORAGE_KEY);
      state = structuredClone(defaultState);
      state.user = user;     // keep user logged in after reset
      saveState();
      applyTheme();
      closeSettingsModal();
      renderAll();
      toast('All data reset.');
    }
  });

  // Escape closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!el.editChapterModal.classList.contains('hidden-modal')) { closeEditChapterModal(); return; }
    if (!el.addClassModal.classList.contains('hidden-modal'))    { closeAddClassModal(); return; }
    if (!el.addChapterModal.classList.contains('hidden-modal'))  { closeAddChapterModal(); return; }
    if (!el.editCourseModal.classList.contains('hidden-modal'))  { closeEditCourseModal(); return; }
    if (!el.ingestModal.classList.contains('hidden-modal'))      { closeIngestModal(); return; }
    if (!el.settingsModal.classList.contains('hidden-modal'))    { closeSettingsModal(); return; }
    if (!el.accountModal.classList.contains('hidden-modal'))     { closeAccountModal(); return; }
  });

  // ===========================================================================
  // INIT
  // ===========================================================================

  refreshAllGrades();
  applyTheme();
  if (state.dashboardCollapsed) {
    el.dashboardPanel.classList.add('collapsed');
    el.restoreTab.classList.add('visible');
  }

  // Show auth screen if not logged in, app screen if logged in
  if (state.user) { showApp(); } else { showAuth(); }
})();
