// server/lib/exploration.js
// Deterministic ε-greedy using mulberry32 PRNG
export function seededEpsilonPick(seed, sortedCandidates, epsilon = 0.2) {
  const rng = mulberry32(seed >>> 0);
  if (rng() < epsilon && sortedCandidates.length) {
    return sortedCandidates[Math.floor(rng() * sortedCandidates.length)];
  }
  return sortedCandidates[0] || null;
}
// Combine a stable seed from userId + dayOfYear
export function explorationSeed(userId, now = new Date()) {
  const day = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(),0,0)) / 86400000);
  let h = 2166136261; const s = String(userId) + ":" + day;
  for (let i=0;i<s.length;i++){h ^= s.charCodeAt(i); h = Math.imul(h, 16777619);}
  return h >>> 0;
}
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
