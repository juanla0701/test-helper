// ai.js
// AI 호출 전담 모듈. 다른 파일은 AI를 직접 부르지 않고 반드시 이 모듈을 거친다.
//
// ■ 보안
//   이 파일(프론트엔드)에는 API 키가 없다. config.js의 AI_API_URL(내 백엔드/서버리스
//   함수 주소)로 요청을 보내고, 그 백엔드가 서버 쪽 환경변수에 있는 키로 Claude 등을
//   호출한다. 예시 백엔드: ai-proxy-worker.example.js
//
// ■ 백엔드와 약속한 요청/응답 형식
//   요청 (POST, JSON):
//     { "version": 1, "task": "extractPoints" | "extractWordItems" | "generateQuestions" | "summarize",
//       "instructions": "<모델에게 줄 지시문>", "input": { ...작업별 입력... } }
//   응답 (JSON):
//     { "ok": true, "result": <JSON 객체 또는 JSON 문자열> }
//     실패 시 { "ok": false, "error": "..." }
//
// ■ 자료 기반 원칙 (코드로 강제)
//   AI가 돌려준 모든 항목은 sourceExcerpt가 실제 자료 원문 안에 존재하는지 검사한다
//   (공백·구두점 무시 비교). 통과하지 못한 항목은 버린다. 즉 AI가 자료에 없는 내용을
//   지어내도 앱에는 저장되지 않는다.
window.Ai = (function () {
  const TIMEOUT_MS = 120000;
  const MAX_CHARS_PER_CALL = 12000;

  const COMMON_RULES = [
    "너는 사용자가 제공한 학습 자료만으로 암기 학습 데이터를 만드는 도우미다.",
    "절대 규칙:",
    "1) 제공된 자료에 없는 사실·숫자·이름·설명을 추가하지 마라. 네 배경지식으로 보충하지 마라.",
    "2) 모든 항목의 sourceExcerpt에는 자료 원문에서 그대로 복사한 연속된 구절(한 문장 이내)을 넣어라. 바꿔 쓰지 마라.",
    "3) 자료가 불분명하거나 OCR 오류로 보이면 그 부분은 건너뛰어라.",
    "4) 응답은 설명 없이 JSON만 출력하라. 마크다운 코드블록을 쓰지 마라.",
  ].join("\n");

  function isConfigured() {
    return Config.isAiConfigured();
  }

  function statusText() {
    return isConfigured() ? "AI 연결됨" : "AI 연결 필요";
  }

  // ------------------------------------------------------------------
  // 공통 요청
  // ------------------------------------------------------------------
  function parseJsonLoose(value) {
    if (value && typeof value === "object") return value;
    let text = String(value || "").trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      return JSON.parse(text);
    } catch (e) {
      const start = text.search(/[\[{]/);
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
      throw new Error("AI 응답을 JSON으로 해석할 수 없습니다.");
    }
  }

  async function request(task, instructions, input) {
    if (!isConfigured()) throw new Error("AI 연결 필요: 설정에서 AI 서버 주소를 입력하세요.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(Config.getAiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, task, instructions, input }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AI 서버 오류 (${res.status})`);
      const body = await res.json();
      if (body && body.ok === false) throw new Error(body.error || "AI 서버가 오류를 반환했습니다.");
      const result = body && Object.prototype.hasOwnProperty.call(body, "result") ? body.result : body;
      return parseJsonLoose(result);
    } catch (err) {
      if (err.name === "AbortError") throw new Error("AI 응답 시간이 초과되었습니다.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------
  // 검증
  // ------------------------------------------------------------------
  /** sourceExcerpt가 자료 원문 안에 실제로 있는지 (공백·구두점 무시). */
  function validateExcerpt(excerpt, context) {
    const e = Utils.normalizeText(excerpt);
    if (e.length < 3) return false;
    return Utils.normalizeText(context).includes(e);
  }

  function normalizeOX(v) {
    const s = String(v || "").trim().toUpperCase();
    if (["O", "○", "TRUE", "참", "맞음", "예"].includes(s)) return "O";
    if (["X", "×", "FALSE", "거짓", "틀림", "아니오"].includes(s)) return "X";
    return null;
  }

  /** AI가 만든 문제 1개를 검증하고 앱 형식으로 정리한다. 부적합하면 null. */
  function validateQuestion(raw, expectedType, context) {
    if (!raw || typeof raw !== "object") return null;
    const question = String(raw.question || "").trim();
    let answer = raw.answer;
    const explanation = String(raw.explanation || "").trim();
    const sourceExcerpt = String(raw.sourceExcerpt || "").trim();
    if (!question || answer === undefined || answer === null || String(answer).trim() === "") return null;
    if (!validateExcerpt(sourceExcerpt, context)) return null;

    const T = Quiz.TYPES;
    const q = { type: expectedType, question, answer: String(answer).trim(), explanation, sourceExcerpt, options: null };
    if (expectedType === T.OX) {
      const ox = normalizeOX(answer);
      if (!ox) return null;
      q.answer = ox;
      q.options = ["O", "X"];
    } else if (expectedType === T.MC) {
      const opts = Array.isArray(raw.options) ? raw.options.map((o) => String(o).trim()).filter(Boolean) : [];
      const uniq = [];
      for (const o of opts) if (!uniq.some((u) => Utils.normalizeText(u) === Utils.normalizeText(o))) uniq.push(o);
      const ans = uniq.find((o) => Utils.normalizeText(o) === Utils.normalizeText(q.answer));
      if (!ans || uniq.length < 2 || uniq.length > 6) return null;
      q.answer = ans;
      q.options = uniq;
    }
    if (Array.isArray(raw.acceptableAnswers)) {
      q.acceptableAnswers = raw.acceptableAnswers.map((a) => String(a).trim()).filter(Boolean);
    }
    return q;
  }

  function chunkText(text) {
    if (text.length <= MAX_CHARS_PER_CALL) return [text];
    const chunks = [];
    let current = "";
    for (const para of text.split(/\n\s*\n|\n/)) {
      if ((current + "\n" + para).length > MAX_CHARS_PER_CALL && current) {
        chunks.push(current);
        current = para;
      } else {
        current = current ? current + "\n" + para : para;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  // ------------------------------------------------------------------
  // 작업 1: 핵심 암기 포인트 추출 (자료 전체를 빠짐없이)
  // ------------------------------------------------------------------
  async function extractPoints({ title, text }) {
    const instructions = [
      COMMON_RULES,
      "",
      "작업: 자료 전체를 처음부터 끝까지 읽고, 시험에 나올 수 있는 '암기 포인트'를 빠짐없이 뽑아라.",
      "- 암기 포인트 하나 = 외워야 할 사실/개념/정의/원인/결과/특징/수치/구조·위치·기능 하나.",
      "- 자료의 앞부분만 보지 말고 모든 문단을 다뤄라. 같은 내용을 두 번 뽑지 마라.",
      "- text: 그 포인트를 한 문장으로 정리(자료의 표현을 최대한 유지).",
      '출력 형식: {"points":[{"text":"...","sourceExcerpt":"자료 원문 그대로"}]}',
    ].join("\n");
    const out = [];
    const seen = new Set();
    for (const chunk of chunkText(text)) {
      const result = await request("extractPoints", instructions, { title, material: chunk });
      const list = Array.isArray(result) ? result : result.points || [];
      for (const p of list) {
        const t = String((p && p.text) || "").trim();
        const ex = String((p && p.sourceExcerpt) || "").trim();
        if (!t || !validateExcerpt(ex, chunk)) continue;
        const key = Utils.normalizeText(t);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text: t, sourceExcerpt: ex });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 작업 2: 단어 암기 항목 정리 (용어 → 뜻)
  // ------------------------------------------------------------------
  async function extractWordItems(text) {
    const instructions = [
      COMMON_RULES,
      "",
      "작업: 자료에서 '용어(단어)'와 그 '뜻/설명' 쌍을 모두 찾아 암기 카드로 정리하라.",
      "- definition은 자료에 적힌 설명만 사용하라. 자료에 뜻이 없는 용어는 제외하라.",
      '출력 형식: {"items":[{"term":"...","definition":"...","sourceExcerpt":"자료 원문 그대로"}]}',
    ].join("\n");
    const out = [];
    const seen = new Set();
    for (const chunk of chunkText(text)) {
      const result = await request("extractWordItems", instructions, { material: chunk });
      const list = Array.isArray(result) ? result : result.items || [];
      for (const it of list) {
        const term = String((it && it.term) || "").trim();
        const definition = String((it && it.definition) || "").trim();
        const ex = String((it && it.sourceExcerpt) || "").trim();
        if (!term || !definition || !validateExcerpt(ex, chunk)) continue;
        const key = Utils.normalizeText(term);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ term, definition, sourceExcerpt: ex });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 작업 3: 시험 문제 생성
  // requests: [{ requestId, pointText, sourceExcerpt, type, difficulty }]
  // 반환: Map(requestId → 검증 통과한 문제)
  // ------------------------------------------------------------------
  async function generateQuestions({ context, requests }) {
    const T = Quiz.TYPES;
    const instructions = [
      COMMON_RULES,
      "",
      "작업: requests 배열의 각 요청마다 정확히 1문제를 만들어라. 요청의 pointText 내용만 묻는 문제여야 한다.",
      "- 같은 내용이라도 매번 다른 표현으로 질문하라(요청마다 문장 구조를 바꿔라).",
      `- type별 형식: ${T.OX}=참/거짓 판단(answer는 "O" 또는 "X", 틀린 진술을 만들 땐 자료의 다른 내용과 헷갈리게 바꿔라),`,
      `  ${T.MC}=보기 4개(options, answer는 options 중 하나와 정확히 같게, 오답 보기도 자료 속 용어로),`,
      `  ${T.SUBJECTIVE}=서술형 주관식, ${T.FILL}=문장 속 (   ) 빈칸 채우기, ${T.SHORT}=한두 단어 단답형, ${T.DESC}=개념 설명형.`,
      "- explanation: 왜 그것이 정답인지 자료 내용으로 1~2문장 설명.",
      "- sourceExcerpt: 이 문제의 근거가 되는 자료 원문 구절(그대로 복사).",
      "- 단답형/빈칸은 채점을 위해 acceptableAnswers(허용 가능한 다른 표기) 배열을 넣어도 된다.",
      '출력 형식: {"questions":[{"requestId":"...","question":"...","options":[...]|null,"answer":"...","acceptableAnswers":[],"explanation":"...","sourceExcerpt":"..."}]}',
    ].join("\n");

    const results = new Map();
    const BATCH = 15;
    for (let i = 0; i < requests.length; i += BATCH) {
      const batch = requests.slice(i, i + BATCH);
      const result = await request("generateQuestions", instructions, { material: context, requests: batch });
      const list = Array.isArray(result) ? result : result.questions || [];
      for (const raw of list) {
        const req = batch.find((r) => r.requestId === (raw && raw.requestId));
        if (!req || results.has(req.requestId)) continue;
        const q = validateQuestion(raw, req.type, context);
        if (q) results.set(req.requestId, q);
      }
    }
    return results;
  }

  // ------------------------------------------------------------------
  // 작업 4: 단원 요약본
  // ------------------------------------------------------------------
  async function summarize({ unitName, context }) {
    const instructions = [
      COMMON_RULES,
      "",
      "작업: 자료를 시험·암기에 좋도록 구조화한 요약본을 만들어라. 원문을 단순히 줄이지 마라.",
      "- 섹션 제목은 자료 성격에 맞게 정하라 (예: 역사→핵심 개념/인물/사건/연도/원인·결과, 해부학→구조명/위치/기능/주변 구조, 법학→개념/요건/차이점).",
      "- '헷갈리기 쉬운 내용', '반드시 외울 내용' 섹션이 자료에 근거해 가능하면 포함하라.",
      "- 각 item의 sourceExcerpt는 자료 원문 그대로.",
      '출력 형식: {"sections":[{"title":"...","items":[{"text":"...","sourceExcerpt":"..."}]}]}',
    ].join("\n");
    const result = await request("summarize", instructions, { unitName, material: context });
    const sections = Array.isArray(result) ? result : result.sections || [];
    const out = [];
    for (const s of sections) {
      const title = String((s && s.title) || "").trim();
      const items = (Array.isArray(s && s.items) ? s.items : [])
        .map((it) => ({
          text: String((it && it.text) || "").trim(),
          sourceExcerpt: String((it && it.sourceExcerpt) || "").trim(),
        }))
        .filter((it) => it.text && validateExcerpt(it.sourceExcerpt, context));
      if (title && items.length) out.push({ title, items });
    }
    return out;
  }

  return {
    isConfigured,
    statusText,
    request,
    validateExcerpt,
    validateQuestion,
    extractPoints,
    extractWordItems,
    generateQuestions,
    summarize,
  };
})();
