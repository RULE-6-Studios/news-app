import { pipeline, env } from '@xenova/transformers';

// Keep everything local -- no telemetry, no remote model-hub writes beyond the
// first download (which is cached under node_modules/.cache for later runs).
env.allowLocalModels = false;

let extractorPromise = null;
function getExtractor() {
  extractorPromise ??= pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  return extractorPromise;
}

export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) {
    out.push(await embed(t));
  }
  return out;
}

// Vectors are L2-normalized, so dot product is cosine similarity.
export function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function meanVector(vectors) {
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length;
  }
  const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0)) || 1;
  return mean.map((x) => x / norm);
}
