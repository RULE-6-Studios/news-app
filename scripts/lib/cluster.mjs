import { cosineSim, meanVector } from './embed.mjs';

// Groups articles into "stories": same-ish event, mostly same-language outlets.
// articles: [{ id, title, summary, embedding, publishedAt, country, ... }]
// Returns clusters: [{ articleIds: [...], centroid: [...] }]
export function clusterArticles(articles, threshold) {
  const clusters = [];
  const sorted = [...articles].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

  for (const article of sorted) {
    let best = null;
    let bestSim = -1;
    for (const cluster of clusters) {
      const sim = cosineSim(article.embedding, cluster.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = cluster;
      }
    }
    if (best && bestSim >= threshold) {
      best.articleIds.push(article.id);
      best.embeddings.push(article.embedding);
      best.centroid = meanVector(best.embeddings);
    } else {
      clusters.push({
        articleIds: [article.id],
        embeddings: [article.embedding],
        centroid: article.embedding,
      });
    }
  }

  return clusters.map(({ articleIds, centroid }) => ({ articleIds, centroid }));
}

// Pairs up clusters from two different country groups that look like the same
// underlying event, for the "same story, two countries" view.
export function findCrossBorderPairs(clustersA, clustersB, threshold) {
  const pairs = [];
  for (const a of clustersA) {
    let best = null;
    let bestSim = -1;
    for (const b of clustersB) {
      const sim = cosineSim(a.centroid, b.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = b;
      }
    }
    if (best && bestSim >= threshold) {
      pairs.push({ a, b: best, similarity: bestSim });
    }
  }
  return pairs;
}
