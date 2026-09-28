// ocr.js
// 브라우저에서 동작하는 한국어 OCR (스펙 8번: "영어 전용 OCR을 사용해서는 안 된다").
// Tesseract.js(WebAssembly 기반)를 CDN에서 불러와 사용한다 (index.html 참고).
// 'kor' 학습 데이터는 최초 인식 시 한 번 받아오고 브라우저가 캐시하므로,
// 그 이후에는 네트워크 없이도 재사용될 수 있다.
window.Ocr = (function () {
  let workerPromise = null;

  async function getWorker() {
    if (!workerPromise) {
      if (typeof Tesseract === "undefined") {
        throw new Error("Tesseract.js가 로드되지 않았습니다. 네트워크 연결을 확인해주세요.");
      }
      workerPromise = Tesseract.createWorker("kor");
    }
    return workerPromise;
  }

  /** 사진 한 장을 인식한다. 실패해도 예외를 던지지 않고 success:false로 알려준다 (스펙 15번). */
  async function recognize(blobOrUrl) {
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(blobOrUrl);
      const text = data && data.text ? data.text.trim() : "";
      return { success: true, text };
    } catch (err) {
      console.warn("OCR 실패 (사용자에게 직접 입력 안내):", err);
      return { success: false, text: "", error: String(err) };
    }
  }

  /** 여러 장을 순서대로 처리한다. 일부가 실패해도 나머지는 계속 진행한다 (스펙 8번). */
  async function recognizeMany(blobs, onProgress) {
    const results = [];
    for (let i = 0; i < blobs.length; i++) {
      const result = await recognize(blobs[i]);
      results.push(result);
      if (onProgress) onProgress(i + 1, blobs.length);
    }
    return results;
  }

  return { recognize, recognizeMany };
})();
