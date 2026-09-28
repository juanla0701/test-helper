// ui.js
// 화면 렌더링 (메인·과목·단어 암기·내용 암기·단원·자료·요약·설정).
// 학습하기/시험/결과 화면은 uiQuiz.js에 있다.
// 프레임워크 없이 innerHTML + 이벤트 연결 방식. 화면 전환 시 해당 화면을 다시 그린다.
window.UI = (function () {
  const h = (s) => Utils.escapeHtml(s);
  const root = () => document.getElementById("app");

  // ---------------------------------------------------------------------
  // 공통: 화면 출력, 사진 URL 관리, 조각들
  // ---------------------------------------------------------------------
  let screenHash = null; // 이 화면이 그려질 때의 주소. 다른 화면으로 떠났으면 늦게 끝난 작업이 덮어쓰지 않게.
  let currentUrls = [];
  let nextUrls = [];

  function objUrl(blob) {
    const url = URL.createObjectURL(blob);
    nextUrls.push(url);
    return url;
  }

  function show(html) {
    if (screenHash !== null && window.location.hash !== screenHash && !(screenHash === "" && window.location.hash === "#/")) {
      nextUrls.forEach((u) => URL.revokeObjectURL(u));
      nextUrls = [];
      return false;
    }
    currentUrls.forEach((u) => URL.revokeObjectURL(u));
    currentUrls = nextUrls;
    nextUrls = [];
    root().innerHTML = html;
    window.scrollTo(0, 0);
    return true;
  }

  function $(sel) {
    return root().querySelector(sel);
  }
  function $all(sel) {
    return Array.from(root().querySelectorAll(sel));
  }
  function on(sel, event, fn) {
    const el = $(sel);
    if (el) el.addEventListener(event, fn);
  }

  function topBar(title, backPath, right) {
    return `
      <header class="topbar">
        ${backPath !== null ? `<button class="icon-btn" data-back="${h(backPath)}" aria-label="뒤로">←</button>` : `<span class="icon-btn-spacer"></span>`}
        <h1>${h(title)}</h1>
        ${right || `<span class="icon-btn-spacer"></span>`}
      </header>`;
  }

  function bindCommon() {
    $all("[data-back]").forEach((btn) => btn.addEventListener("click", () => Router.navigate(btn.dataset.back)));
    $all("[data-go]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-stop]")) return;
        Router.navigate(el.dataset.go);
      })
    );
  }

  function progressBar(pct, small) {
    const p = Utils.clamp(Math.round(pct || 0), 0, 100);
    const level = p >= 80 ? "high" : p >= 40 ? "mid" : "low";
    return `<div class="progress ${small ? "small" : ""}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-fill ${level}" style="width:${p}%"></div></div>`;
  }

  function aiBanner(context) {
    if (Ai.isConfigured()) return "";
    const msg =
      context === "word"
        ? "AI 연결 필요 · 사진/글에서 단어를 자동 정리할 때는 기본 형식(용어: 뜻)만 인식합니다. 단어 시험은 AI 없이도 정상 동작합니다."
        : "AI 연결 필요 · 지금은 자료 문장을 그대로 활용하는 기본 출제 모드입니다. AI를 연결하면 요약과 문제 표현이 더 다양해집니다.";
    return `<div class="banner"><span>${h(msg)}</span> <button class="link-btn" data-go="/settings">설정</button></div>`;
  }

  function lastStudyText(stat) {
    if (!stat.lastStudiedAt && !stat.lastSession) return "아직 학습 기록 없음";
    const parts = [];
    if (stat.lastStudiedAt) parts.push(`마지막 학습 ${Utils.timeAgo(stat.lastStudiedAt)}`);
    if (stat.lastSession) parts.push(`최근 시험 ${stat.lastSession.scorePercent}점`);
    return parts.join(" · ");
  }

  function showError(err) {
    console.error(err);
    alert(err && err.message ? err.message : String(err));
  }

  function loadingScreen(title, text) {
    show(`
      ${topBar(title, null)}
      <main class="content center">
        <div class="spinner"></div>
        <p id="loadingText">${h(text || "잠시만 기다려주세요…")}</p>
      </main>`);
  }

  function setLoadingText(text) {
    const el = document.getElementById("loadingText");
    if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------------
  // 메인: 과목 목록 + 학습률
  // ---------------------------------------------------------------------
  async function renderHome() {
    const subjects = await Subjects.list();
    const stats = [];
    for (const s of subjects) stats.push(await Learning.subjectProgress(s.id));

    const shown = show(`
      <header class="topbar home">
        <span class="icon-btn-spacer"></span>
        <h1>암기 도우미</h1>
        <button class="icon-btn" data-go="/settings" aria-label="설정">⚙</button>
      </header>
      <main class="content">
        <button id="toggleAddSubject" class="primary-btn">+ 과목 추가</button>
        <div id="addSubjectForm" class="add-form" hidden>
          <input id="newSubjectName" type="text" placeholder="과목 이름 (예: 해부학, 한국사, 영어 단어)" />
          <div class="row-btns">
            <button id="cancelSubjectBtn" class="secondary-btn">취소</button>
            <button id="addSubjectBtn" class="primary-btn">추가</button>
          </div>
        </div>
        ${
          subjects.length === 0
            ? `<p class="empty">아직 과목이 없습니다.<br/>“+ 과목 추가”로 공부할 과목을 만들어보세요.</p>`
            : `<ul class="card-list">
                ${subjects
                  .map((s, i) => {
                    const st = stats[i];
                    return `
                  <li class="card subject-card" data-go="/subject/${s.id}">
                    <div class="card-head">
                      <span class="card-title">${h(s.name)}</span>
                      <span class="pct">${st.pct}%</span>
                    </div>
                    ${progressBar(st.pct)}
                    <div class="card-meta">
                      <span>자료 ${st.materialCount}개${st.wordCount ? ` · 단어 ${st.wordCount}개` : ""}</span>
                      <span>${h(lastStudyText(st))}</span>
                    </div>
                    <button class="delete-mini" data-stop data-delete-subject="${s.id}" data-name="${h(s.name)}" aria-label="과목 삭제">삭제</button>
                  </li>`;
                  })
                  .join("")}
              </ul>`
        }
      </main>
    `);
    if (!shown) return;
    bindCommon();

    const form = $("#addSubjectForm");
    on("#toggleAddSubject", "click", () => {
      form.hidden = false;
      $("#toggleAddSubject").hidden = true;
      $("#newSubjectName").focus();
    });
    on("#cancelSubjectBtn", "click", () => {
      form.hidden = true;
      $("#toggleAddSubject").hidden = false;
    });
    const add = async () => {
      const name = $("#newSubjectName").value.trim();
      if (!name) return;
      await Subjects.create(name);
      renderHome();
    };
    on("#addSubjectBtn", "click", add);
    on("#newSubjectName", "keydown", (e) => e.key === "Enter" && add());

    $all("[data-delete-subject]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = confirm(
          `‘${btn.dataset.name}’ 과목을 삭제할까요?\n\n이 과목의 단원·자료·사진·단어·문제·시험 기록·학습 기록이 모두 삭제되며 되돌릴 수 없습니다.`
        );
        if (!ok) return;
        try {
          await Subjects.remove(btn.dataset.deleteSubject);
        } catch (err) {
          showError(err);
        }
        renderHome();
      })
    );
  }

  // ---------------------------------------------------------------------
  // 과목: 학습 방식 선택 (단어 암기 / 내용 암기)
  // ---------------------------------------------------------------------
  async function renderSubject(subjectId) {
    const subject = await Subjects.get(subjectId);
    if (!subject) return renderNotFound("과목을 찾을 수 없습니다.", "/");
    const st = await Learning.subjectProgress(subjectId);
    const contentPct = (() => {
      const lv = st.unitStats.filter((u) => u.pointCount || u.materialCount).map((u) => u.pct);
      return lv.length ? Math.round(Utils.average(lv)) : 0;
    })();

    const shown = show(`
      ${topBar(subject.name, "/", `<button class="icon-btn" id="renameSubject" aria-label="과목 이름 수정">✏</button>`)}
      <main class="content">
        <section class="overall">
          <div class="card-head"><span>과목 전체 학습률</span><span class="pct big">${st.pct}%</span></div>
          ${progressBar(st.pct)}
          <div class="card-meta"><span>${h(lastStudyText(st))}</span></div>
        </section>

        <button class="mode-card" data-go="/subject/${subjectId}/words">
          <div class="mode-icon">🔤</div>
          <div class="mode-body">
            <div class="mode-title">단어 암기</div>
            <div class="mode-desc">용어와 뜻을 짧게 외우기 · 단어 ${st.wordCount}개</div>
            ${progressBar(st.words.pct, true)}
          </div>
          <div class="mode-pct">${st.words.pct}%</div>
        </button>

        <button class="mode-card" data-go="/subject/${subjectId}/content">
          <div class="mode-icon">📚</div>
          <div class="mode-body">
            <div class="mode-title">내용 암기</div>
            <div class="mode-desc">단원별 사진·글 자료로 공부하고 시험 보기 · 단원 ${st.unitCount}개</div>
            ${progressBar(contentPct, true)}
          </div>
          <div class="mode-pct">${contentPct}%</div>
        </button>
      </main>
    `);
    if (!shown) return;
    bindCommon();
    on("#renameSubject", "click", async () => {
      const name = prompt("과목 이름", subject.name);
      if (name && name.trim()) {
        await Subjects.rename(subjectId, name);
        renderSubject(subjectId);
      }
    });
  }

  // ---------------------------------------------------------------------
  // 단어 암기
  // ---------------------------------------------------------------------
  async function renderWords(subjectId) {
    const subject = await Subjects.get(subjectId);
    if (!subject) return renderNotFound("과목을 찾을 수 없습니다.", "/");
    const [items, wp, wrongIds, wordMaterials] = await Promise.all([
      WordStudy.list(subjectId),
      Learning.wordProgress(subjectId),
      WrongAnswers.listWrongTargetIds({ subjectId }),
      Materials.listWordMaterials(subjectId),
    ]);
    const wrongCount = wrongIds.filter((id) => items.some((i) => i.id === id)).length;

    const shown = show(`
      ${topBar(`${subject.name} · 단어 암기`, `/subject/${subjectId}`)}
      <main class="content">
        <section class="overall">
          <div class="card-head"><span>단어 학습률 · ${items.length}개</span><span class="pct big">${wp.pct}%</span></div>
          ${progressBar(wp.pct)}
        </section>

        <div class="btn-grid">
          <button id="studyBtn" class="secondary-btn" ${items.length ? "" : "disabled"}>학습하기</button>
          <button id="testBtn" class="primary-btn" ${items.length ? "" : "disabled"}>시험 시작</button>
          <button id="wrongBtn" class="secondary-btn wide" ${wrongCount ? "" : "disabled"}>오답 다시 풀기${wrongCount ? ` (${wrongCount})` : ""}</button>
        </div>

        <section class="panel">
          <h2 class="panel-title">단어 추가</h2>
          <input id="termInput" type="text" placeholder="단어/용어 (예: 대퇴골)" />
          <textarea id="defInput" rows="2" placeholder="뜻/설명 (예: 인체에서 가장 긴 뼈)"></textarea>
          <p id="wordError" class="error-msg"></p>
          <button id="addWordBtn" class="primary-btn">+ 단어 추가</button>
          <div class="row-btns top-gap">
            <button class="secondary-btn" data-go="/subject/${subjectId}/words/add-photo">+ 사진 추가</button>
            <button class="secondary-btn" data-go="/subject/${subjectId}/words/add-text">+ 글 추가</button>
          </div>
          <p class="hint">사진·글로 추가하면 “용어: 뜻”, “용어 → 뜻”, “용어 - 뜻” 형식의 줄을 단어로 정리합니다.</p>
        </section>

        <h2 class="section-label">단어 목록</h2>
        ${
          items.length === 0
            ? `<p class="empty">아직 단어가 없습니다.</p>`
            : `<ul class="card-list" id="wordList">
            ${items
              .map(
                (it) => `
              <li class="card word-row" data-word-id="${it.id}">
                <div class="word-view">
                  <div class="card-head">
                    <span class="card-title">${h(it.term)}</span>
                    <span class="pct small">${Math.round(it.studyLevel || 0)}%</span>
                  </div>
                  <div class="word-def">${h(it.definition)}</div>
                  ${progressBar(it.studyLevel || 0, true)}
                  <div class="row-actions">
                    <button class="link-btn" data-edit-word="${it.id}">수정</button>
                    <button class="link-btn danger" data-delete-word="${it.id}">삭제</button>
                  </div>
                </div>
              </li>`
              )
              .join("")}
          </ul>`
        }
        ${
          wordMaterials.length
            ? `<h2 class="section-label">가져온 자료</h2>
          <ul class="card-list">${wordMaterials
            .map(
              (m) => `<li class="card" data-go="/material/${m.id}">
                <div class="card-title">${h(m.title)}</div>
                <div class="card-sub">${m.type === "PHOTO" ? "사진 자료" : "글 자료"} · ${Utils.formatDate(m.createdAt)}</div>
              </li>`
            )
            .join("")}</ul>`
            : ""
        }
      </main>
    `);
    if (!shown) return;
    bindCommon();

    on("#addWordBtn", "click", async () => {
      const term = $("#termInput").value.trim();
      const definition = $("#defInput").value.trim();
      if (!term || !definition) {
        $("#wordError").textContent = "단어와 뜻을 모두 입력해주세요.";
        return;
      }
      await WordStudy.create({ subjectId, term, definition });
      renderWords(subjectId);
    });
    on("#studyBtn", "click", () => Router.navigate(`/study/words/${subjectId}`));
    on("#testBtn", "click", () => UIQuiz.startTest({ scope: "words", subjectId }));
    on("#wrongBtn", "click", () =>
      UIQuiz.startTest({ scope: "words", subjectId, targetIds: wrongIds, mode: "wrong-retry" })
    );

    $all("[data-delete-word]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("이 단어를 삭제할까요? 학습 기록도 함께 삭제됩니다.")) return;
        await WordStudy.remove(btn.dataset.deleteWord);
        renderWords(subjectId);
      })
    );
    $all("[data-edit-word]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.editWord;
        const it = items.find((i) => i.id === id);
        const li = root().querySelector(`[data-word-id="${id}"]`);
        li.innerHTML = `
          <input class="edit-term" type="text" value="${h(it.term)}" />
          <textarea class="edit-def" rows="2">${h(it.definition)}</textarea>
          <div class="row-btns">
            <button class="secondary-btn" data-cancel>취소</button>
            <button class="primary-btn" data-save>저장</button>
          </div>`;
        li.querySelector("[data-cancel]").addEventListener("click", () => renderWords(subjectId));
        li.querySelector("[data-save]").addEventListener("click", async () => {
          const term = li.querySelector(".edit-term").value.trim();
          const definition = li.querySelector(".edit-def").value.trim();
          if (!term || !definition) return;
          await WordStudy.update(id, { term, definition });
          renderWords(subjectId);
        });
      })
    );
  }

  /** 사진/글 자료에서 단어 항목을 뽑아 사용자가 확인·수정 후 저장하는 화면. */
  async function renderWordReview(subjectId, materialId) {
    const material = await Materials.get(materialId);
    if (!material) return renderNotFound("자료를 찾을 수 없습니다.", `/subject/${subjectId}/words`);
    loadingScreen("단어 정리", Ai.isConfigured() ? "AI가 자료에서 단어와 뜻을 정리하는 중…" : "자료에서 단어와 뜻을 찾는 중…");

    let result;
    try {
      result = await WordStudy.extractItems(Materials.textOf(material));
    } catch (err) {
      result = { ...WordStudy.parseItemsLocal(Materials.textOf(material)), origin: "local", aiError: err.message };
    }
    let rows = result.items.map((i) => ({ ...i }));
    const unparsed = result.unparsed || [];

    function draw() {
      const shown = show(`
        ${topBar("단어 확인", `/subject/${subjectId}/words`)}
        <main class="content">
          <p class="hint">‘${h(material.title)}’에서 찾은 단어입니다. 틀린 부분은 고치고, 필요 없는 줄은 지운 뒤 저장하세요.
          ${result.origin === "ai" ? "(AI 정리 · 근거 검증 통과분만 표시)" : "(기본 형식 인식)"}</p>
          ${result.aiError ? `<p class="error-msg">AI 정리 실패: ${h(result.aiError)} → 기본 방식으로 정리했습니다.</p>` : ""}
          <ul class="card-list">
            ${rows
              .map(
                (r, i) => `
              <li class="card review-row">
                <div class="row-head"><span class="chip">${i + 1}</span><button class="link-btn danger" data-remove-row="${i}">삭제</button></div>
                <input type="text" data-term="${i}" value="${h(r.term)}" placeholder="단어/용어" />
                <textarea rows="2" data-def="${i}" placeholder="뜻/설명">${h(r.definition)}</textarea>
                ${r.sourceExcerpt ? `<div class="source-mini">근거: ${h(r.sourceExcerpt)}</div>` : ""}
              </li>`
              )
              .join("")}
          </ul>
          <button id="addRowBtn" class="secondary-btn full">+ 직접 한 줄 추가</button>
          ${
            unparsed.length
              ? `<details class="panel top-gap"><summary>형식을 인식하지 못한 줄 ${unparsed.length}개</summary>
                  <ul class="plain-list">${unparsed
                    .map((u, i) => `<li><span>${h(u)}</span> <button class="link-btn" data-use-line="${i}">단어로 추가</button></li>`)
                    .join("")}</ul></details>`
              : ""
          }
          <p id="reviewError" class="error-msg"></p>
          <button id="saveItemsBtn" class="primary-btn">단어 ${rows.length}개 저장</button>
        </main>`);
      if (!shown) return;
      bindCommon();
      $all("[data-term]").forEach((el) => el.addEventListener("input", () => (rows[+el.dataset.term].term = el.value)));
      $all("[data-def]").forEach((el) => el.addEventListener("input", () => (rows[+el.dataset.def].definition = el.value)));
      $all("[data-remove-row]").forEach((el) =>
        el.addEventListener("click", () => {
          rows.splice(+el.dataset.removeRow, 1);
          draw();
        })
      );
      on("#addRowBtn", "click", () => {
        rows.push({ term: "", definition: "", sourceExcerpt: "" });
        draw();
      });
      $all("[data-use-line]").forEach((el) =>
        el.addEventListener("click", () => {
          const line = unparsed.splice(+el.dataset.useLine, 1)[0];
          rows.push({ term: line, definition: "", sourceExcerpt: line });
          draw();
        })
      );
      on("#saveItemsBtn", "click", async () => {
        const valid = rows.filter((r) => r.term.trim() && r.definition.trim());
        if (!valid.length) {
          $("#reviewError").textContent = "저장할 단어가 없습니다. 단어와 뜻을 모두 입력해주세요.";
          return;
        }
        // 사용자가 직접 추가/수정한 줄은 그 내용 자체를 근거로 남긴다.
        const prepared = valid.map((r) => {
          const src = Materials.textOf(material);
          const ok = r.sourceExcerpt && Ai.validateExcerpt(r.sourceExcerpt, src);
          return { term: r.term, definition: r.definition, sourceExcerpt: ok ? r.sourceExcerpt : `${r.term.trim()} → ${r.definition.trim()}` };
        });
        await WordStudy.createMany(subjectId, prepared, materialId);
        Router.navigate(`/subject/${subjectId}/words`);
      });
    }
    draw();
  }

  // ---------------------------------------------------------------------
  // 내용 암기: 단원 목록
  // ---------------------------------------------------------------------
  async function renderContent(subjectId) {
    const subject = await Subjects.get(subjectId);
    if (!subject) return renderNotFound("과목을 찾을 수 없습니다.", "/");
    const units = await Units.listBySubject(subjectId);
    const stats = [];
    for (const u of units) stats.push(await Learning.unitProgress(u.id));

    const shown = show(`
      ${topBar(`${subject.name} · 내용 암기`, `/subject/${subjectId}`)}
      <main class="content">
        ${aiBanner("content")}
        <div class="add-row">
          <input id="newUnitName" type="text" placeholder="새 단원 이름 (예: 1단원. 뼈)" />
          <button id="addUnitBtn" class="primary-btn narrow">+ 단원 추가</button>
        </div>
        ${
          units.length === 0
            ? `<p class="empty">아직 단원이 없습니다. 단원을 만들고 사진이나 글 자료를 넣어보세요.</p>`
            : `<ul class="card-list">
                ${units
                  .map((u, i) => {
                    const st = stats[i];
                    return `
                  <li class="card subject-card" data-go="/unit/${u.id}">
                    <div class="card-head"><span class="card-title">${h(u.name)}</span><span class="pct">${st.pct}%</span></div>
                    ${progressBar(st.pct)}
                    <div class="card-meta">
                      <span>자료 ${st.materialCount}개 · 암기 포인트 ${st.pointCount}개</span>
                      <span>${h(lastStudyText(st))}</span>
                    </div>
                    <div class="row-actions" data-stop>
                      <button class="link-btn" data-stop data-rename-unit="${u.id}" data-name="${h(u.name)}">이름 수정</button>
                      <button class="link-btn danger" data-stop data-delete-unit="${u.id}" data-name="${h(u.name)}">삭제</button>
                    </div>
                  </li>`;
                  })
                  .join("")}
              </ul>`
        }
      </main>
    `);
    if (!shown) return;
    bindCommon();

    const add = async () => {
      const name = $("#newUnitName").value.trim();
      if (!name) return;
      await Units.create(subjectId, name);
      renderContent(subjectId);
    };
    on("#addUnitBtn", "click", add);
    on("#newUnitName", "keydown", (e) => e.key === "Enter" && add());
    $all("[data-rename-unit]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = prompt("단원 이름", btn.dataset.name);
        if (name && name.trim()) {
          await Units.rename(btn.dataset.renameUnit, name);
          renderContent(subjectId);
        }
      })
    );
    $all("[data-delete-unit]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`‘${btn.dataset.name}’ 단원을 삭제할까요?\n단원의 자료·사진·시험 기록·학습 기록이 모두 삭제됩니다.`)) return;
        await Units.remove(btn.dataset.deleteUnit);
        renderContent(subjectId);
      })
    );
  }

  // ---------------------------------------------------------------------
  // 단원: 자료 + 학습하기 / 시험 시작 / 요약본 / 오답 다시 풀기
  // ---------------------------------------------------------------------
  async function renderUnit(unitId) {
    const unit = await Units.get(unitId);
    if (!unit) return renderNotFound("단원을 찾을 수 없습니다.", "/");
    const [materials, st, wrongIds, sessions] = await Promise.all([
      Materials.listByUnit(unitId),
      Learning.unitProgress(unitId),
      WrongAnswers.listWrongTargetIds({ unitId }),
      Quiz.listSessionsByUnit(unitId),
    ]);
    const points = await Storage.getAllByIndex("points", "unitId", unitId);
    const wrongCount = wrongIds.filter((id) => points.some((p) => p.id === id)).length;
    const recent = sessions.filter((s) => s.finishedAt).slice(0, 3);
    const has = materials.length > 0;

    const shown = show(`
      ${topBar(unit.name, `/subject/${unit.subjectId}/content`)}
      <main class="content">
        ${aiBanner("content")}
        <section class="overall">
          <div class="card-head"><span>단원 학습률 · 암기 포인트 ${st.pointCount}개</span><span class="pct big">${st.pct}%</span></div>
          ${progressBar(st.pct)}
          <div class="card-meta"><span>${h(lastStudyText(st))}</span></div>
        </section>

        <div class="btn-grid">
          <button id="studyBtn" class="secondary-btn" ${has ? "" : "disabled"}>학습하기</button>
          <button id="testBtn" class="primary-btn" ${has ? "" : "disabled"}>시험 시작</button>
          <button id="summaryBtn" class="secondary-btn" ${has ? "" : "disabled"}>요약본</button>
          <button id="wrongBtn" class="secondary-btn" ${wrongCount ? "" : "disabled"}>오답 다시 풀기${wrongCount ? ` (${wrongCount})` : ""}</button>
        </div>

        <h2 class="section-label">자료 ${materials.length}개</h2>
        <div class="row-btns">
          <button class="secondary-btn" data-go="/unit/${unitId}/add-photo">+ 사진 추가</button>
          <button class="secondary-btn" data-go="/unit/${unitId}/add-text">+ 글 추가</button>
        </div>
        ${
          materials.length === 0
            ? `<p class="empty">아직 자료가 없습니다. 교재·프린트 사진이나 글을 추가하세요.</p>`
            : `<ul class="card-list top-gap">
                ${materials
                  .map((m) => {
                    const mp = points.filter((p) => p.materialId === m.id);
                    return `
                  <li class="card" data-go="/material/${m.id}">
                    <div class="card-title">${h(m.title)}</div>
                    <div class="card-sub">${m.type === "PHOTO" ? `사진 ${(m.imageIds || []).length || ""}장` : "글 자료"} · 암기 포인트 ${mp.length}개</div>
                    <div class="card-preview">${h(Utils.truncate(Materials.textOf(m), 80))}</div>
                  </li>`;
                  })
                  .join("")}
              </ul>`
        }

        ${
          recent.length
            ? `<h2 class="section-label">최근 시험</h2>
          <ul class="card-list">${recent
            .map(
              (s) => `<li class="card" data-go="/result/${s.id}">
                <div class="card-head"><span class="card-title">${s.scorePercent}점</span><span class="card-sub">${Utils.timeAgo(s.finishedAt)}</span></div>
                <div class="card-sub">${s.correctCount}/${s.totalQuestions} 정답${s.mode === "wrong-retry" ? " · 오답 다시 풀기" : ""}</div>
              </li>`
            )
            .join("")}</ul>`
            : ""
        }
      </main>
    `);
    if (!shown) return;
    bindCommon();
    on("#studyBtn", "click", () => Router.navigate(`/study/unit/${unitId}`));
    on("#summaryBtn", "click", () => Router.navigate(`/unit/${unitId}/summary`));
    on("#testBtn", "click", () => UIQuiz.startTest({ scope: "unit", subjectId: unit.subjectId, unitId }));
    on("#wrongBtn", "click", () =>
      UIQuiz.startTest({ scope: "unit", subjectId: unit.subjectId, unitId, targetIds: wrongIds, mode: "wrong-retry" })
    );
  }

  // ---------------------------------------------------------------------
  // 글로 자료 추가 (내용 암기 단원 / 단어 암기 공용)
  // ctx: { subjectId, unitId, studyMode, backPath, afterSave(material) }
  // ---------------------------------------------------------------------
  function renderAddText(ctx) {
    const shown = show(`
      ${topBar("+ 글 추가", ctx.backPath)}
      <main class="content">
        <input id="materialTitle" type="text" placeholder="자료 제목 (예: 한국사 1단원, 심장의 구조)" />
        <textarea id="materialText" rows="14" placeholder="${
          ctx.studyMode === "word"
            ? "한 줄에 하나씩 입력하세요.\n예)\n대퇴골: 인체에서 가장 긴 뼈\n해마 → 기억 형성에 중요한 뇌 구조"
            : "학습 자료 내용을 입력하세요. 긴 시험범위도 그대로 붙여넣을 수 있습니다."
        }"></textarea>
        <p id="errorMsg" class="error-msg"></p>
        <button id="saveBtn" class="primary-btn">자료 저장</button>
      </main>
    `);
    if (!shown) return;
    bindCommon();

    on("#saveBtn", "click", async () => {
      const title = $("#materialTitle").value.trim();
      const text = $("#materialText").value;
      const errorEl = $("#errorMsg");
      if (!title) return (errorEl.textContent = "제목을 입력해주세요.");
      if (!text.trim()) return (errorEl.textContent = "내용을 입력해주세요.");
      $("#saveBtn").disabled = true;
      try {
        const m = await Materials.createText({
          subjectId: ctx.subjectId,
          unitId: ctx.unitId,
          studyMode: ctx.studyMode,
          title,
          text,
        });
        Router.navigate(ctx.afterSave(m));
      } catch (err) {
        $("#saveBtn").disabled = false;
        errorEl.textContent = "저장 실패: " + (err.message || err);
      }
    });
  }

  // ---------------------------------------------------------------------
  // 사진으로 자료 추가 (선택 → 미리보기 → OCR → 확인/수정 → 저장)
  // ---------------------------------------------------------------------
  function renderAddPhoto(ctx) {
    const draftMaterialId = Utils.generateId();
    let pickedFiles = []; // File[]
    let reviewImages = []; // [{ file, rawOcrText, editedText, ocrFailed }]
    let title = "";

    function renderPicking(errorText) {
      const shown = show(`
        ${topBar("+ 사진 추가", ctx.backPath)}
        <main class="content">
          <div class="row-btns">
            <button id="cameraBtn" class="secondary-btn">📷 카메라 촬영</button>
            <button id="galleryBtn" class="secondary-btn">🖼 갤러리에서 선택</button>
          </div>
          <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden />
          <input type="file" id="galleryInput" accept="image/*" multiple hidden />

          <p class="section-label">선택한 사진 (${pickedFiles.length}장) · 이 순서대로 합쳐집니다</p>
          ${
            pickedFiles.length === 0
              ? `<p class="empty">교재, 프린트, 노트 등을 여러 장 한 번에 추가할 수 있습니다.</p>`
              : `<div class="thumb-row">
                  ${pickedFiles
                    .map(
                      (f, i) => `
                    <div class="thumb">
                      <img src="${objUrl(f)}" alt="사진 ${i + 1}" />
                      <span class="thumb-no">${i + 1}</span>
                      <button class="thumb-remove" data-remove-index="${i}" aria-label="사진 삭제">×</button>
                    </div>`
                    )
                    .join("")}
                </div>`
          }
          <p id="errorMsg" class="error-msg">${h(errorText || "")}</p>
          <button id="startOcrBtn" class="primary-btn" ${pickedFiles.length === 0 ? "disabled" : ""}>OCR 시작 (글자 인식)</button>
        </main>
      `);
      if (!shown) return;
      bindCommon();

      on("#cameraBtn", "click", () => $("#cameraInput").click());
      on("#galleryBtn", "click", () => $("#galleryInput").click());
      const addFiles = (e) => {
        const files = Array.from(e.target.files || []).filter((f) => !f.type || f.type.startsWith("image/"));
        pickedFiles = pickedFiles.concat(files);
        renderPicking();
      };
      on("#cameraInput", "change", addFiles);
      on("#galleryInput", "change", addFiles);
      $all("[data-remove-index]").forEach((el) =>
        el.addEventListener("click", () => {
          pickedFiles.splice(Number(el.dataset.removeIndex), 1);
          renderPicking();
        })
      );
      on("#startOcrBtn", "click", async () => {
        if (pickedFiles.length === 0) return renderPicking("사진을 1장 이상 추가해주세요.");
        renderOcrProgress(0, pickedFiles.length);
        const results = await Ocr.recognizeMany(pickedFiles, (done, total) => renderOcrProgress(done, total));
        reviewImages = pickedFiles.map((file, i) => {
          const r = results[i];
          const text = r.success ? r.text : "";
          return { file, rawOcrText: r.success ? r.text : null, editedText: text, ocrFailed: !r.success || !text };
        });
        renderReview();
      });
    }

    function renderOcrProgress(done, total) {
      show(`
        ${topBar("+ 사진 추가", null)}
        <main class="content center">
          <div class="spinner"></div>
          <p>사진에서 글자를 인식하는 중… (${done}/${total})</p>
          <p class="hint">처음 한 번은 한국어 인식 데이터를 내려받느라 시간이 더 걸릴 수 있습니다.</p>
        </main>
      `);
    }

    function renderReview(errorText) {
      const shown = show(`
        ${topBar("인식 결과 확인", null)}
        <main class="content">
          <p class="hint">사진과 인식된 글자를 비교해서 틀린 부분을 고쳐주세요. 고친 내용이 학습에 사용되고, 원본 인식 결과도 따로 보관됩니다.</p>
          <input id="materialTitle" type="text" placeholder="자료 제목 (예: 해부학 Chapter 3)" value="${h(title)}" />
          ${reviewImages
            .map(
              (img, i) => `
            <div class="review-card">
              <div class="row-head"><span class="chip">사진 ${i + 1}</span></div>
              <img src="${objUrl(img.file)}" class="review-img" alt="사진 ${i + 1}" />
              ${img.ocrFailed ? `<p class="error-msg">이 사진은 글자 인식에 실패했습니다. 아래에 직접 입력해주세요.</p>` : ""}
              <textarea class="editedText" data-index="${i}" rows="6">${h(img.editedText)}</textarea>
            </div>`
            )
            .join("")}
          <p id="errorMsg" class="error-msg">${h(errorText || "")}</p>
          <div class="row-btns">
            <button id="cancelBtn" class="secondary-btn">취소</button>
            <button id="saveBtn" class="primary-btn">자료 저장</button>
          </div>
        </main>
      `);
      if (!shown) return;

      on("#materialTitle", "input", (e) => (title = e.target.value));
      $all(".editedText").forEach((el) =>
        el.addEventListener("input", () => (reviewImages[Number(el.dataset.index)].editedText = el.value))
      );
      on("#cancelBtn", "click", () => {
        if (confirm("인식한 내용을 저장하지 않고 나갈까요?")) Router.navigate(ctx.backPath);
      });
      on("#saveBtn", "click", async () => {
        title = $("#materialTitle").value.trim();
        if (!title) return renderReview("제목을 입력해주세요.");
        if (reviewImages.every((i) => !i.editedText.trim())) {
          return renderReview("인식된 내용이 없습니다. 직접 텍스트를 입력해주세요.");
        }
        $("#saveBtn").disabled = true;
        try {
          const m = await Materials.createPhotoFromOcrResults({
            materialId: draftMaterialId,
            subjectId: ctx.subjectId,
            unitId: ctx.unitId,
            studyMode: ctx.studyMode,
            title,
            images: reviewImages.map((img) => ({ blob: img.file, rawOcrText: img.rawOcrText, editedText: img.editedText })),
          });
          Router.navigate(ctx.afterSave(m));
        } catch (err) {
          renderReview("저장 실패: " + (err.message || err));
        }
      });
    }

    renderPicking();
  }

  async function unitCtx(unitId) {
    const unit = await Units.get(unitId);
    if (!unit) return null;
    return {
      subjectId: unit.subjectId,
      unitId,
      studyMode: "content",
      backPath: `/unit/${unitId}`,
      afterSave: () => `/unit/${unitId}`,
    };
  }

  function wordCtx(subjectId) {
    return {
      subjectId,
      unitId: null,
      studyMode: "word",
      backPath: `/subject/${subjectId}/words`,
      afterSave: (m) => `/subject/${subjectId}/words/review/${m.id}`,
    };
  }

  // ---------------------------------------------------------------------
  // 자료 상세: 확인 / 수정 / 삭제 (원본 OCR 보존 확인 가능)
  // ---------------------------------------------------------------------
  async function renderMaterialDetail(materialId) {
    const material = await Materials.get(materialId);
    if (!material) return renderNotFound("자료를 찾을 수 없습니다.", "/");
    const isWord = material.studyMode === "word";
    const backPath = isWord ? `/subject/${material.subjectId}/words` : `/unit/${material.unitId}`;
    const images = material.type === "PHOTO" ? await ImageStorage.getImages(materialId) : [];
    const finalText = Materials.textOf(material);
    const rawDiffers = material.rawText && material.rawText !== finalText;
    const points = isWord ? [] : await Storage.getAllByIndex("points", "materialId", materialId);

    const shown = show(`
      ${topBar(material.title, backPath)}
      <main class="content">
        ${
          images.length
            ? `<div class="thumb-row">${images
                .map((img, i) => `<div class="thumb large"><img src="${objUrl(img.blob)}" alt="사진 ${i + 1}" /><span class="thumb-no">${i + 1}</span></div>`)
                .join("")}</div>`
            : ""
        }
        <div id="viewMode">
          <p class="card-sub">${material.type === "PHOTO" ? "사진 자료" : "글 자료"} · ${Utils.formatDate(material.updatedAt)}${
      isWord ? "" : ` · 암기 포인트 ${points.length}개`
    }</p>
          <p class="material-text">${h(finalText)}</p>
          ${
            rawDiffers
              ? `<details class="panel"><summary>${material.type === "PHOTO" ? "원본 OCR 결과 보기" : "처음 입력한 원본 보기"}</summary>
                  <p class="material-text muted">${h(material.rawText)}</p></details>`
              : ""
          }
        </div>
        <div id="editMode" hidden>
          <input id="editTitle" type="text" value="${h(material.title)}" />
          <textarea id="editText" rows="14">${h(finalText)}</textarea>
          <p class="hint">수정해도 원본(${material.type === "PHOTO" ? "OCR 인식 결과" : "처음 입력"})은 따로 보관됩니다.</p>
        </div>
        <div class="detail-actions">
          <button id="editBtn" class="secondary-btn">수정</button>
          <button id="saveEditBtn" class="primary-btn" hidden>수정 완료</button>
          <button id="deleteBtn" class="danger-btn">삭제</button>
        </div>
        ${
          isWord
            ? `<button class="secondary-btn full top-gap" data-go="/subject/${material.subjectId}/words/review/${material.id}">이 자료에서 단어 다시 가져오기</button>`
            : ""
        }
      </main>
    `);
    if (!shown) return;
    bindCommon();

    on("#editBtn", "click", () => {
      $("#viewMode").hidden = true;
      $("#editMode").hidden = false;
      $("#editBtn").hidden = true;
      $("#saveEditBtn").hidden = false;
    });
    on("#saveEditBtn", "click", async () => {
      const t = $("#editTitle").value.trim();
      const text = $("#editText").value;
      if (!t) return alert("제목을 입력해주세요.");
      await Materials.updateContent(materialId, t, text);
      renderMaterialDetail(materialId);
    });
    on("#deleteBtn", "click", async () => {
      const msg = isWord
        ? "자료를 삭제할까요?\n사진과 이 자료에서 가져온 단어(학습 기록 포함)도 함께 삭제됩니다."
        : "자료를 삭제할까요?\n사진과 이 자료의 암기 포인트·학습 기록도 함께 삭제되며 되돌릴 수 없습니다.";
      if (!confirm(msg)) return;
      await Materials.remove(materialId);
      Router.navigate(backPath);
    });
  }

  // ---------------------------------------------------------------------
  // 요약본
  // ---------------------------------------------------------------------
  async function renderSummary(unitId) {
    const unit = await Units.get(unitId);
    if (!unit) return renderNotFound("단원을 찾을 수 없습니다.", "/");
    const { summary, outdated, hasMaterial } = await Summary.load(unitId);

    const itemHtml = (it) => {
      if (typeof it === "string") return `<li>${h(it)}</li>`; // v1 형식 호환
      const showSrc = it.sourceExcerpt && Utils.normalizeText(it.sourceExcerpt) !== Utils.normalizeText(it.text);
      return `<li>${h(it.text)}${showSrc ? `<div class="source-mini">근거: “${h(it.sourceExcerpt)}”</div>` : ""}</li>`;
    };

    const shown = show(`
      ${topBar(`${unit.name} · 요약본`, `/unit/${unitId}`)}
      <main class="content">
        ${aiBanner("content")}
        ${!hasMaterial ? `<p class="empty">요약할 자료가 없습니다.</p>` : ""}
        ${outdated ? `<div class="banner warn">자료가 바뀌었어요. 요약을 다시 만들면 최신 내용이 반영됩니다.</div>` : ""}
        ${
          summary && summary.sections && summary.sections.length
            ? `<p class="card-sub">${summary.origin === "ai" ? "AI 요약 (자료 근거 검증 통과 항목만)" : "기본 요약 (자료 문장 정리)"} · ${Utils.timeAgo(summary.updatedAt)}</p>
              ${summary.sections
                .map((s) => `<section class="panel"><h2 class="panel-title">${h(s.title)}</h2><ul class="summary-list">${(s.items || []).map(itemHtml).join("")}</ul></section>`)
                .join("")}`
            : hasMaterial
            ? `<p class="empty">아직 요약본이 없습니다.</p>`
            : ""
        }
        <p id="errorMsg" class="error-msg"></p>
        ${
          hasMaterial
            ? `<button id="genBtn" class="primary-btn">${summary ? "요약 다시 만들기" : "요약 만들기"}${Ai.isConfigured() ? " (AI)" : ""}</button>`
            : ""
        }
      </main>`);
    if (!shown) return;
    bindCommon();
    on("#genBtn", "click", async () => {
      loadingScreen("요약본", Ai.isConfigured() ? "AI가 자료 전체를 요약하는 중…" : "자료를 정리하는 중…");
      try {
        await Summary.generate(unitId);
      } catch (err) {
        showError(err);
      }
      renderSummary(unitId);
    });
  }

  // ---------------------------------------------------------------------
  // 설정: AI 서버 주소 (키 아님)
  // ---------------------------------------------------------------------
  async function renderSettings() {
    let usage = "";
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usage = `${(est.usage / 1024 / 1024).toFixed(1)}MB 사용 중`;
      }
    } catch (e) {
      /* 무시 */
    }
    const shown = show(`
      ${topBar("설정", "/")}
      <main class="content">
        <section class="panel">
          <h2 class="panel-title">AI 연결 · <span class="${Ai.isConfigured() ? "ok" : "warn-text"}">${h(Ai.statusText())}</span></h2>
          <p class="hint">요약·문제 생성을 처리할 <b>내 AI 서버(프록시) 주소</b>를 입력하세요.
          <b>API 키는 여기에 넣지 마세요.</b> 키는 서버 쪽에만 보관해야 안전합니다.
          (예시 서버 코드: ai-proxy-worker.example.js)</p>
          <input id="aiUrl" type="url" placeholder="https://내-서버-주소" value="${h(Config.getAiUrl())}" />
          <div class="row-btns">
            <button id="clearAi" class="secondary-btn">연결 해제</button>
            <button id="saveAi" class="primary-btn">저장</button>
          </div>
          <p id="aiMsg" class="hint"></p>
        </section>
        <section class="panel">
          <h2 class="panel-title">저장소</h2>
          <p class="hint">모든 자료와 학습 기록은 이 기기의 브라우저(IndexedDB)에 저장됩니다. ${h(usage)}<br/>
          브라우저의 “사이트 데이터 삭제”를 하면 학습 기록도 지워지니 주의하세요.</p>
        </section>
      </main>`);
    if (!shown) return;
    bindCommon();
    on("#saveAi", "click", () => {
      const url = $("#aiUrl").value.trim();
      if (/sk-ant-|sk-[a-z0-9]{20,}/i.test(url)) {
        $("#aiUrl").value = "";
        $("#aiMsg").textContent = "API 키처럼 보이는 값이라 저장하지 않았습니다. 키가 아니라 서버 주소를 입력하세요.";
        return;
      }
      if (url && !/^https?:\/\//.test(url)) {
        $("#aiMsg").textContent = "http:// 또는 https:// 로 시작하는 주소를 입력하세요.";
        return;
      }
      Config.setAiUrl(url);
      renderSettings();
    });
    on("#clearAi", "click", () => {
      Config.setAiUrl("");
      renderSettings();
    });
  }

  function renderNotFound(message, backPath) {
    const shown = show(`${topBar("알 수 없음", backPath)}<main class="content"><p class="empty">${h(message)}</p></main>`);
    if (shown) bindCommon();
  }

  // ---------------------------------------------------------------------
  // 라우팅 디스패치
  // ---------------------------------------------------------------------
  async function render() {
    screenHash = window.location.hash || "";
    const route = Router.parseHash();
    switch (route.name) {
      case "home":
        return renderHome();
      case "settings":
        return renderSettings();
      case "subject":
        return renderSubject(route.subjectId);
      case "words":
        return renderWords(route.subjectId);
      case "wordAddText":
        return renderAddText(wordCtx(route.subjectId));
      case "wordAddPhoto":
        return renderAddPhoto(wordCtx(route.subjectId));
      case "wordReview":
        return renderWordReview(route.subjectId, route.materialId);
      case "content":
        return renderContent(route.subjectId);
      case "unit":
        return renderUnit(route.unitId);
      case "addText": {
        const ctx = await unitCtx(route.unitId);
        return ctx ? renderAddText(ctx) : renderNotFound("단원을 찾을 수 없습니다.", "/");
      }
      case "addPhoto": {
        const ctx = await unitCtx(route.unitId);
        return ctx ? renderAddPhoto(ctx) : renderNotFound("단원을 찾을 수 없습니다.", "/");
      }
      case "summary":
        return renderSummary(route.unitId);
      case "material":
        return renderMaterialDetail(route.materialId);
      case "studyWords":
        return UIQuiz.renderStudy({ scope: "words", subjectId: route.subjectId });
      case "studyUnit":
        return UIQuiz.renderStudy({ scope: "unit", unitId: route.unitId });
      case "test":
        return UIQuiz.renderTest(route.sessionId);
      case "result":
        return UIQuiz.renderResult(route.sessionId);
      default:
        return renderHome();
    }
  }

  return {
    render,
    // uiQuiz.js에서 공통 조각 재사용
    show,
    topBar,
    bindCommon,
    progressBar,
    loadingScreen,
    setLoadingText,
    renderNotFound,
    showError,
    $,
    $all,
    on,
  };
})();
