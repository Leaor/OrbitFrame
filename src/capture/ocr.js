const Tesseract = require('tesseract.js');
const path = require('path');

let worker = null;

async function initWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng');
  }
  return worker;
}

async function runOCR(imageInput) {
  const w = await initWorker();

  // imageInput can be a file path or a buffer
  const { data } = await w.recognize(imageInput);

  return {
    text: data.text,
    confidence: data.confidence,
    words: data.words?.map(w => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox
    })) || []
  };
}

async function cleanup() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

module.exports = { runOCR, cleanup };
