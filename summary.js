// summary.js
// 단원 요약본. 한 번 만든 요약은 저장해두고, 자료가 바뀌었을 때만 "다시 만들기"를 권한다
// (AI 비용이 반복해서 나가지 않도록).
//
// 저장 형태: { id, unitId, sections:[{ title, items:[{ text, sourceExcerpt }] }],
//              origin('ai'|'local'), contentHash, createdAt, updatedAt }
// v1에서 저장된 items가 문자열 배열이어도 화면에서 그대로 보이도록 호환한다.
window.Summary = (function () {
  async function get(unitId) {
    const items = await Storage.getAllByIndex("summaries", "unitId", unitId);
    return items[0] || null;
  }

  async function save(unitId, sections, extra) {
    const existing = await get(unitId);
    const now = Utils.now();
    const record = {
      id: existing ? existing.id : Utils.generateId(),
      unitId,
      sections,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      ...(extra || {}),
    };
    await Storage.put("summaries", record);
    return record;
  }

  async function unitContext(unitId) {
    const materials = (await Materials.listByUnit(unitId)).filter((m) => (m.studyMode || "content") === "content");
    const context = materials.map((m) => `[${m.title}]\n${Materials.textOf(m)}`).join("\n\n");
    return { materials, context, hash: Utils.hashString(context) };
  }

  /** AI 없이 만드는 요약: 자료별로 암기 포인트(자료 문장)를 정리해서 보여준다. */
  async function buildLocal(unitId) {
    const { points } = await Learning.refreshUnitPoints(unitId, { useAi: false });
    const materials = await Materials.listByUnit(unitId);
    return materials
      .map((m) => ({
        title: m.title,
        items: points.filter((p) => p.materialId === m.id).map((p) => ({ text: p.text, sourceExcerpt: p.sourceExcerpt })),
      }))
      .filter((s) => s.items.length);
  }

  /** 요약 생성. AI 연결 시 AI 요약(근거 검증 통과분만), 아니면 기본 요약. */
  async function generate(unitId) {
    const unit = await Units.get(unitId);
    const { context, hash } = await unitContext(unitId);
    if (!context.trim()) throw new Error("요약할 자료가 없습니다.");
    if (Ai.isConfigured()) {
      const sections = await Ai.summarize({ unitName: unit ? unit.name : "", context });
      if (!sections.length) throw new Error("AI 요약 결과가 자료 근거 검증을 통과하지 못했습니다.");
      return save(unitId, sections, { origin: "ai", contentHash: hash });
    }
    return save(unitId, await buildLocal(unitId), { origin: "local", contentHash: hash });
  }

  /** 화면용: 저장된 요약 + 자료가 바뀌었는지 여부. */
  async function load(unitId) {
    const saved = await get(unitId);
    const { hash, context } = await unitContext(unitId);
    return { summary: saved, outdated: !!(saved && saved.contentHash && saved.contentHash !== hash), hasMaterial: !!context.trim() };
  }

  return { get, save, generate, load, buildLocal };
})();
