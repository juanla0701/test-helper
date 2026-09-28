// materials.js
// 학습자료 (사진 / 직접 입력). 내용 암기 단원 자료와 단어 암기용 자료를 모두 다룬다.
//
// 자료 레코드:
//   id(materialId), subjectId, unitId(단어 암기 자료는 null), studyMode('content'|'word'),
//   type/materialType('PHOTO'|'TEXT'), title,
//   rawText   - 원본 텍스트 (사진: OCR이 처음 인식한 결과 / 글: 처음 입력한 내용)
//   finalText - 사용자가 확인·수정한 최종 텍스트. 요약·포인트·시험은 항상 이 값을 쓴다.
//   imageIds, createdAt, updatedAt
window.Materials = (function () {
  function textOf(m) {
    return m ? m.finalText ?? m.rawText ?? "" : "";
  }

  async function listByUnit(unitId) {
    const items = await Storage.getAllByIndex("materials", "unitId", unitId);
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }

  async function listWordMaterials(subjectId) {
    const items = await Storage.getAllByIndex("materials", "subjectId", subjectId);
    return items.filter((m) => m.studyMode === "word").sort((a, b) => b.createdAt - a.createdAt);
  }

  async function get(id) {
    return Storage.get("materials", id);
  }

  function baseRecord({ id, subjectId, unitId, studyMode, type, title }) {
    const now = Utils.now();
    return {
      id: id || Utils.generateId(),
      subjectId,
      unitId: unitId || null,
      studyMode: studyMode || "content",
      type,
      materialType: type,
      title: title.trim(),
      rawText: "",
      finalText: "",
      imageIds: [],
      isVerifiedByUser: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 직접 입력 텍스트로 자료 생성. */
  async function createText({ subjectId, unitId, studyMode, title, text }) {
    const material = baseRecord({ subjectId, unitId, studyMode, type: "TEXT", title });
    material.rawText = text;
    material.finalText = text;
    await Storage.put("materials", material);
    if (material.studyMode === "content") await Learning.onMaterialsChanged(material.unitId);
    return material;
  }

  /**
   * 사용자가 OCR 결과를 확인/수정까지 마친 상태로 한 번에 저장.
   * images: [{ blob, rawOcrText, editedText }]
   */
  async function createPhotoFromOcrResults({ materialId, subjectId, unitId, studyMode, title, images }) {
    const material = baseRecord({ id: materialId, subjectId, unitId, studyMode, type: "PHOTO", title });
    material.finalText = images.map((i) => i.editedText || "").join("\n\n");
    material.rawText = images.map((i) => i.rawOcrText || "").join("\n\n");
    const saved = await ImageStorage.saveImages(material.id, images);
    material.imageIds = saved.map((s) => s.id);
    await Storage.put("materials", material);
    if (material.studyMode === "content") await Learning.onMaterialsChanged(material.unitId);
    return material;
  }

  /** 자료 수정: 최종 텍스트만 바꾸고 원본(rawText)은 보존한다. */
  async function updateContent(id, title, text) {
    const material = await get(id);
    if (!material) return null;
    material.title = title.trim();
    material.finalText = text;
    material.updatedAt = Utils.now();
    await Storage.put("materials", material);
    if ((material.studyMode || "content") === "content") await Learning.onMaterialsChanged(material.unitId);
    return material;
  }

  /**
   * 자료 삭제: 그 자료의 사진, 그 자료에서 나온 암기 포인트/단어 항목까지 정리한다.
   * 이미지는 materialId로만 묶여 있고 다른 자료와 공유되지 않으므로 안전하다.
   */
  async function remove(id, opts) {
    const material = await get(id);
    await ImageStorage.removeImages(id);
    await Storage.removeAllByIndex("points", "materialId", id);
    await Storage.removeAllByIndex("wordItems", "materialId", id);
    await Storage.remove("materials", id);
    if (material && material.unitId && !(opts && opts.skipRefresh)) {
      await Learning.onMaterialsChanged(material.unitId);
    }
  }

  return { textOf, listByUnit, listWordMaterials, get, createText, createPhotoFromOcrResults, updateContent, remove };
})();
