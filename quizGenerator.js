// quizGenerator.js
// "자료 전체가 들어가는 시험" 조립기.
//
//   자료 수집 → 암기 포인트 전체 추출 → (포인트마다 최소 1문제) 출제 계획 →
//   문제 생성(AI 또는 기본 출제) → 검증 → 전체 포인트 커버리지 확인 → 순서/보기 섞기
//
// 공통 규칙
//  - 모든 대상(암기 포인트/단어)은 최소 1번 출제된다. 문제 수가 부족하면 문제 수를 늘린다.
//    (내용 보존 > 랜덤화)
//  - 문제 수는 대상 개수(=실제 암기 포인트 수)로 자동 결정한다. 글자 수가 아니다.
//  - 한 대상은 한 시험에서 최대 3번까지만 나오고, 같은 대상에 같은 유형을 반복하지 않는다.
//  - 문제 유형은 학습 정도에 맞춰 가중 랜덤: 처음(낮은 학습도)엔 O/X·객관식 위주,
//    익숙해질수록(높은 학습도) 주관식·설명형 비중이 커진다. 직전 시험과 같은 유형은 피한다.
//  - 문제 순서, 객관식 보기 순서, O/X 참/거짓, 빈칸 위치, 질문 표현이 매번 랜덤이다.
//
// 기본 출제(AI 미연결 또는 AI 실패 시)는 자료 문장만 재배열해서 문제를 만든다.
// 오답 보기·틀린 진술도 같은 단원 자료 속 다른 낱말로만 만들어서, 자료에 없는 말이 들어가지 않는다.
window.QuizGenerator = (function () {
  const T = () => Quiz.TYPES;
  const MAX_REPEAT = 3;

  // ------------------------------------------------------------------
  // 문제 수 자동 결정
  // ------------------------------------------------------------------
  function decideCount(n) {
    if (n <= 0) return 0;
    let count;
    if (n <= 5) count = Math.min(Math.max(5, n * 2), 10); // 매우 적은 자료: 5~10
    else if (n <= 12) count = Utils.clamp(Math.round(n * 1.3), 10, 15); // 적은 자료: 10~15
    else if (n <= 30) count = Utils.clamp(Math.round(n * 1.15), 15, 30); // 중간: 15~30
    else count = Math.max(30, n); // 많은 자료: 30~50+ (모든 포인트 최소 1회)
    count = Math.max(count, n); // 커버리지 보장
    return Math.min(count, n * MAX_REPEAT); // 한 내용 과다 반복 방지
  }

  // ------------------------------------------------------------------
  // 유형 선택 (학습 정도 + 다양성 + 직전 유형 회피)
  // ------------------------------------------------------------------
  function typeWeight(type, level) {
    const t = T();
    const easy = [t.OX, t.MC];
    const mid = [t.FILL, t.SHORT];
    if (level < 30) return easy.includes(type) ? 1.6 : mid.includes(type) ? 1.0 : 0.5;
    if (level < 70) return mid.includes(type) ? 1.3 : 1.0;
    return easy.includes(type) ? 0.6 : mid.includes(type) ? 1.1 : 1.6;
  }

  function orderTypes(target, supported, usedForTarget, typeCounts) {
    const level = target.studyLevel || 0;
    const remaining = supported.slice();
    const ordered = [];
    while (remaining.length) {
      const weights = remaining.map((type) => {
        let w = typeWeight(type, level);
        w *= 1 / (1 + (typeCounts[type] || 0)); // 이번 시험에서 덜 나온 유형 우선
        if (usedForTarget.includes(type)) w *= 0.05; // 같은 대상에 같은 유형 반복 방지
        if (target.lastQuestionType === type && supported.length > 1) w *= 0.35; // 직전 시험과 다르게
        return w;
      });
      const pick = Utils.weightedPick(remaining, weights);
      ordered.push(pick);
      remaining.splice(remaining.indexOf(pick), 1);
    }
    return ordered;
  }

  // ------------------------------------------------------------------
  // 출제 계획: 어떤 대상을 몇 번 낼지
  // ------------------------------------------------------------------
  function planTargets(targets, count) {
    const slots = targets.slice(); // 모든 대상 1회 (커버리지)
    const times = new Map(targets.map((t) => [t.id, 1]));
    let extra = count - targets.length;
    let guard = 0;
    while (extra > 0 && guard++ < 1000) {
      const candidates = targets.filter((t) => times.get(t.id) < MAX_REPEAT);
      if (!candidates.length) break;
      const weights = candidates.map((t) => {
        const weak = 100 - (t.studyLevel || 0);
        const wrong = Math.min(t.wrongCount || 0, 5) * 15;
        const again = times.get(t.id) > 1 ? 0.3 : 1; // 이미 2번 나온 건 덜 뽑음
        return (weak + wrong + 10) * again;
      });
      const pick = Utils.weightedPick(candidates, weights);
      times.set(pick.id, times.get(pick.id) + 1);
      slots.push(pick);
      extra--;
    }
    return slots;
  }

  /** 같은 대상 문제가 연달아 나오지 않도록 섞는다. */
  function shuffleSpread(drafts) {
    const a = Utils.shuffle(drafts);
    for (let i = 1; i < a.length; i++) {
      if (a[i].targetId === a[i - 1].targetId) {
        const j = a.findIndex((d, k) => k > i && d.targetId !== a[i - 1].targetId && (k + 1 >= a.length || a[k + 1].targetId !== a[i].targetId));
        if (j > 0) [a[i], a[j]] = [a[j], a[i]];
      }
    }
    return a;
  }

  /**
   * 공통 조립: targets 각각에 대해 build(target, type)로 문제를 만든다.
   * supportedTypesOf(target)은 그 대상에 가능한 유형 목록.
   * aiResults(선택)는 slotIndex → AI 문제(검증 완료) 맵.
   */
  function assemble({ targets, supportedTypesOf, build, fallback }) {
    const count = decideCount(targets.length);
    const slots = planTargets(targets, count);
    const typeCounts = {};
    const used = new Map();
    const drafts = [];
    for (const target of slots) {
      const usedForTarget = used.get(target.id) || [];
      const types = orderTypes(target, supportedTypesOf(target), usedForTarget, typeCounts);
      let draft = null;
      for (const type of types) {
        draft = build(target, type);
        if (draft) break;
      }
      if (!draft && usedForTarget.length === 0) draft = fallback(target); // 커버리지용 최후 수단
      if (!draft) continue;
      typeCounts[draft.type] = (typeCounts[draft.type] || 0) + 1;
      used.set(target.id, usedForTarget.concat(draft.type));
      drafts.push(draft);
    }
    return drafts;
  }

  function verifyCoverage(targets, drafts) {
    const covered = new Set(drafts.map((d) => d.targetId));
    return targets.filter((t) => !covered.has(t.id));
  }

  // ------------------------------------------------------------------
  // 내용 암기: 기본 출제 (자료 문장 기반)
  // ------------------------------------------------------------------
  const PARTICLES = [
    "으로부터", "에서부터", "으로써", "으로서", "에게서", "이라고", "에서는", "에서도", "에서의",
    "으로는", "이라는", "라는", "에서", "에게", "으로", "부터", "까지", "처럼", "보다", "라고",
    "와는", "과는", "이나", "이란", "이며", "이고", "에는", "에도", "은", "는", "이", "가", "을",
    "를", "에", "의", "와", "과", "도", "만", "로", "란", "나",
  ];
  const STOPWORDS = new Set([
    "그리고", "그러나", "하지만", "또한", "및", "등", "것", "수", "때", "그", "이", "저", "더", "또",
    "통해", "위해", "대한", "대해", "따라", "의해", "가장", "매우", "모든", "각", "여러", "다른",
    "이후", "이전", "때문", "경우", "중", "후", "전", "현재", "당시", "주로", "특히", "처음",
  ]);
  // 서술어/연결어미로 끝나는 낱말은 빈칸 후보에서 뺀다 (명사 위주로 묻기 위해)
  const VERBISH = /(다|요|함|됨|져|하고|하며|하여|되어|해서|되고|하는|되는|있는|없는|된|했던|였던|이던|면서|지만|는데|으며|어서|아서)$/;

  // 한 글자 명사(뇌, 뼈, 폐, 간 …) 뒤에서도 떼어도 안전한 조사.
  // ("마을", "사과", "도로"처럼 조사처럼 보이는 글자로 끝나는 명사가 잘리지 않도록 좁게 잡는다)
  const SAFE_AFTER_ONE_SYLLABLE = new Set(["를", "는", "에", "와", "에서", "에게", "으로", "에는", "에도", "에서는"]);

  function stripParticle(word) {
    const clean = word.replace(/^[“"'‘(\[<《「『]+|[”"'’)\]>》」』.,!?;:·…]+$/g, "");
    for (const p of PARTICLES) {
      if (!clean.endsWith(p)) continue;
      const rest = clean.length - p.length;
      if (rest >= 2 || (rest === 1 && SAFE_AFTER_ONE_SYLLABLE.has(p) && /[가-힣]/.test(clean[0]))) {
        return clean.slice(0, -p.length);
      }
    }
    return clean;
  }

  /** 문장에서 빈칸/오답 교체에 쓸 핵심 낱말 후보. 점수가 높을수록 중요한 낱말. */
  function keywordCandidates(sentence) {
    const tokens = sentence.split(/\s+/).filter(Boolean);
    const out = [];
    tokens.forEach((tok, i) => {
      const stem = stripParticle(tok);
      const bare = tok.replace(/[.,!?;:]+$/, "");
      const oneSyllableNoun = stem.length === 1 && stem !== bare && /[가-힣]/.test(stem);
      if ((stem.length < 2 && !oneSyllableNoun) || STOPWORDS.has(stem)) return;
      if (!/[가-힣a-zA-Z0-9]/.test(stem)) return;
      const isLast = i === tokens.length - 1;
      if (/[0-9]/.test(stem)) {
        out.push({ stem, score: 4 });
        return;
      }
      if (VERBISH.test(stem) || (isLast && /[가-힣]$/.test(stem) && /[.다]$/.test(tok))) return;
      let score = stem.length <= 6 ? 2 : 1;
      if (i === 0) score += 0.5;
      if (stem !== tok.replace(/[.,!?;:]+$/, "")) score += 0.5; // 조사가 붙어 있던 명사
      out.push({ stem, score });
    });
    // 중복 제거
    const seen = new Set();
    return out.filter((c) => (seen.has(c.stem) ? false : seen.add(c.stem))).sort((a, b) => b.score - a.score);
  }

  function chooseKeyword(sentence) {
    const cands = keywordCandidates(sentence);
    if (!cands.length) return null;
    return Utils.pickRandom(cands.slice(0, 3)).stem; // 매번 다른 빈칸 위치
  }

  function distractorsFor(answer, pool, sentence, n) {
    const isNum = /[0-9]/.test(answer);
    const normAns = Utils.normalizeText(answer);
    const normSentence = Utils.normalizeText(sentence);
    const cands = Utils.shuffle(pool).filter((w) => {
      const nw = Utils.normalizeText(w);
      return nw && nw !== normAns && !normSentence.includes(nw) && /[0-9]/.test(w) === isNum;
    });
    const uniq = [];
    for (const c of cands) if (!uniq.some((u) => Utils.normalizeText(u) === Utils.normalizeText(c))) uniq.push(c);
    return uniq.slice(0, n);
  }

  function replaceOnce(sentence, word, replacement) {
    const idx = sentence.indexOf(word);
    if (idx < 0) return null;
    return sentence.slice(0, idx) + replacement + sentence.slice(idx + word.length);
  }

  function contentBase(point, type) {
    return {
      targetType: "point",
      targetId: point.id,
      sourceUnitId: point.unitId,
      sourceMaterialId: point.materialId,
      sourceExcerpt: point.sourceExcerpt || point.text,
      type,
      difficulty: Quiz.difficultyFor(type),
      gradeMode: Quiz.gradeModeFor(type),
      generator: "local",
    };
  }

  function buildContentLocal(point, type, pool) {
    const t = T();
    const s = point.text;
    const base = contentBase(point, type);
    const kw = chooseKeyword(s);

    if (type === t.OX) {
      const wantFalse = Math.random() < 0.5;
      if (wantFalse && kw) {
        const [wrong] = distractorsFor(kw, pool, s, 1);
        const altered = wrong ? replaceOnce(s, kw, wrong) : null;
        if (altered) {
          return {
            ...base,
            question: `다음 내용이 자료와 일치하면 O, 틀리면 X를 고르시오.\n${altered}`,
            options: ["O", "X"],
            answer: "X",
            explanation: `‘${wrong}’이(가) 아니라 ‘${kw}’입니다. 자료: “${s}”`,
          };
        }
      }
      return {
        ...base,
        question: `다음 내용이 자료와 일치하면 O, 틀리면 X를 고르시오.\n${s}`,
        options: ["O", "X"],
        answer: "O",
        explanation: `자료에 그대로 나오는 내용입니다: “${s}”`,
      };
    }

    if (type === t.MC) {
      if (!kw) return null;
      const ds = distractorsFor(kw, pool, s, 3);
      if (ds.length < 1) return null;
      const blanked = replaceOnce(s, kw, "(      )");
      if (!blanked) return null;
      return {
        ...base,
        question: Utils.pickRandom([
          `다음 (      )에 들어갈 알맞은 말은?\n${blanked}`,
          `빈칸에 알맞은 것을 고르시오.\n${blanked}`,
        ]),
        options: Utils.shuffle([kw, ...ds]),
        answer: kw,
        explanation: `정답은 ‘${kw}’입니다. 자료: “${s}”`,
      };
    }

    if (type === t.FILL) {
      if (!kw) return null;
      const blanked = replaceOnce(s, kw, "(      )");
      if (!blanked) return null;
      return {
        ...base,
        question: `빈칸에 들어갈 말을 쓰시오.\n${blanked}`,
        answer: kw,
        explanation: `빈칸에는 ‘${kw}’이(가) 들어갑니다. 자료: “${s}”`,
      };
    }

    if (type === t.SHORT) {
      if (!kw) return null;
      const masked = replaceOnce(s, kw, "○○");
      if (!masked) return null;
      return {
        ...base,
        question: Utils.pickRandom([
          `다음에서 ○○에 해당하는 것을 한두 단어로 쓰시오.\n${masked}`,
          `○○은(는) 무엇인가?\n${masked}`,
        ]),
        answer: kw,
        explanation: `○○은(는) ‘${kw}’입니다. 자료: “${s}”`,
      };
    }

    if (type === t.SUBJECTIVE) {
      const words = s.split(/\s+/);
      if (words.length < 4) return null;
      const cut = Math.max(2, Math.floor(words.length / 2));
      const head = words.slice(0, cut).join(" ");
      const tail = words.slice(cut).join(" ");
      return {
        ...base,
        question: `다음 문장의 뒷부분을 자료 내용대로 완성하시오.\n“${head} …”`,
        answer: tail,
        explanation: `전체 문장: “${s}”`,
      };
    }

    if (type === t.DESC) {
      if (!kw) return null;
      return {
        ...base,
        question: Utils.pickRandom([
          `‘${kw}’에 대해 자료에 나온 내용을 설명하시오.`,
          `자료에서 ‘${kw}’와(과) 관련해 설명한 내용을 쓰시오.`,
        ]),
        answer: s,
        explanation: `자료 내용: “${s}”`,
      };
    }
    return null;
  }

  function contentFallback(point) {
    // 항상 만들 수 있는 문제 (자료 문장 그대로의 O/X) → 모든 포인트 최소 1회 출제 보장
    const t = T();
    return {
      ...contentBase(point, t.OX),
      question: `다음 내용이 자료와 일치하면 O, 틀리면 X를 고르시오.\n${point.text}`,
      options: ["O", "X"],
      answer: "O",
      explanation: `자료에 그대로 나오는 내용입니다: “${point.text}”`,
    };
  }

  function contentPool(points) {
    const pool = [];
    for (const p of points) for (const c of keywordCandidates(p.text)) pool.push(c.stem);
    return pool;
  }

  function allTypes() {
    const t = T();
    return [t.OX, t.MC, t.SUBJECTIVE, t.FILL, t.SHORT, t.DESC];
  }

  // ------------------------------------------------------------------
  // 내용 암기 시험 만들기 (단원)
  // opts: { targetIds?: string[] (오답 다시 풀기 등 일부만), onProgress?: fn(text) }
  // ------------------------------------------------------------------
  async function buildUnitTest(unitId, opts) {
    const o = opts || {};
    const useAi = Ai.isConfigured();
    const progress = o.onProgress || (() => {});
    const notes = [];

    progress("자료 전체를 모으고 암기 포인트를 정리하는 중…");
    const { points: allPoints, aiErrors } = await Learning.refreshUnitPoints(unitId, { useAi });
    if (aiErrors.length) notes.push("일부 자료는 AI 분석에 실패해 기본 방식으로 정리했습니다.");
    const targets = o.targetIds ? allPoints.filter((p) => o.targetIds.includes(p.id)) : allPoints;
    if (!targets.length) {
      throw new Error(o.targetIds ? "다시 풀 오답이 없습니다." : "이 단원에 시험 볼 자료가 없습니다. 먼저 사진이나 글을 추가하세요.");
    }

    const pool = contentPool(allPoints);
    const localSupported = (p) => allTypes().filter((type) => buildContentLocal(p, type, pool) !== null || type === T().OX);

    // 1) 출제 계획 + 기본 출제로 전체 문제 초안 생성 (커버리지 확보)
    let drafts = assemble({
      targets,
      supportedTypesOf: useAi ? () => allTypes() : localSupported,
      build: (p, type) => {
        if (useAi) {
          // AI 모드: 일단 "요청 자리"만 만든다. 실제 문제는 아래 2)에서 AI가 채운다.
          return { ...contentBase(p, type), pending: true, pointText: p.text };
        }
        return buildContentLocal(p, type, pool);
      },
      fallback: contentFallback,
    });

    // 2) AI 모드: 자료 전체를 하나의 컨텍스트로 보내 각 자리에 맞는 문제를 생성·검증
    if (useAi) {
      const materials = (await Materials.listByUnit(unitId)).filter((m) => (m.studyMode || "content") === "content");
      const context = materials.map((m) => `[${m.title}]\n${Materials.textOf(m)}`).join("\n\n");
      const requests = drafts.map((d, i) => ({
        requestId: "r" + i,
        pointText: d.pointText,
        sourceExcerpt: d.sourceExcerpt,
        type: d.type,
        difficulty: d.difficulty,
      }));
      let aiMap = new Map();
      try {
        progress(`AI가 문제 ${requests.length}개를 만드는 중…`);
        aiMap = await Ai.generateQuestions({ context, requests });
      } catch (err) {
        console.warn("AI 문제 생성 실패, 기본 출제로 대체:", err);
        notes.push(`AI 문제 생성 실패(${err.message || err}) → 기본 출제로 대체했습니다.`);
      }
      let replaced = 0;
      drafts = drafts.map((d, i) => {
        const point = targets.find((p) => p.id === d.targetId);
        const aiQ = aiMap.get("r" + i);
        if (aiQ) {
          return {
            ...contentBase(point, d.type),
            ...aiQ,
            options: aiQ.options && d.type === T().MC ? Utils.shuffle(aiQ.options) : aiQ.options,
            generator: "ai",
          };
        }
        replaced++;
        return buildContentLocal(point, d.type, pool) || buildContentLocal(point, T().FILL, pool) || contentFallback(point);
      });
      if (replaced && aiMap.size) notes.push(`AI 결과 검증을 통과하지 못한 ${replaced}문제는 기본 출제로 대체했습니다.`);
    }

    // 3) 커버리지 확인: 한 번도 안 나온 포인트가 있으면 추가 출제
    const missing = verifyCoverage(targets, drafts);
    for (const p of missing) drafts.push(buildContentLocal(p, T().FILL, pool) || contentFallback(p));

    // 4) sourceExcerpt 없는 문제는 만들지 않는다
    drafts = drafts.filter((d) => d && d.sourceExcerpt);

    progress("문제 순서를 섞는 중…");
    return { drafts: shuffleSpread(drafts), notes, targetCount: targets.length };
  }

  return {
    decideCount,
    assemble,
    verifyCoverage,
    shuffleSpread,
    keywordCandidates,
    buildContentLocal,
    buildUnitTest,
    allTypes,
  };
})();
