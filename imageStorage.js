// imageStorage.js
// 사진 자료의 실제 이미지(Blob)를 다루는 모듈. IndexedDB가 Blob을 직접 저장할 수 있어서
// Base64 변환 없이 File/Blob 그대로 보관한다.
window.ImageStorage = (function () {
  /**
   * OCR까지 끝난 이미지들을 한 번에 저장한다.
   * images: [{ blob: Blob, rawOcrText: string|null, editedText: string }]
   */
  async function saveImages(materialId, images) {
    const now = Utils.now();
    const records = images.map((img, i) => ({
      id: Utils.generateId(),
      materialId,
      blob: img.blob,
      rawOcrText: img.rawOcrText ?? null, // OCR이 처음 인식한 원본 (수정하지 않음)
      ocrText: img.editedText ?? "", // 사용자가 확인·수정한 최종본
      structureJson: null, // 향후 해부학 그림 구조물 인식 확장 자리
      orderIndex: i,
      createdAt: now,
    }));
    await Storage.putMany("materialImages", records);
    return records;
  }

  async function getImages(materialId) {
    const items = await Storage.getAllByIndex("materialImages", "materialId", materialId);
    return items.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  async function removeImages(materialId) {
    return Storage.removeAllByIndex("materialImages", "materialId", materialId);
  }

  function blobToObjectUrl(blob) {
    return URL.createObjectURL(blob);
  }

  return { saveImages, getImages, removeImages, blobToObjectUrl };
})();
