export function epsilonChoose(items, epsilon, poolK) {
  const base = [...items].sort((a,b)=>(b.model_score??0)-(a.model_score??0));
  const ranked = [...base];
  const prop = base.map(() => ({ p: 0, was_forced: false }));

  const pool = Math.min(poolK, ranked.length);
  if (pool <= 1 || epsilon <= 0) {
    if (ranked.length) prop[0].p = 1;
    return { ranked, propensities: prop };
  }

  const r = Math.random();
  if (r < epsilon) {
    const j = Math.floor(Math.random() * pool);
    if (j !== 0) {
      const tmp = ranked[0];
      ranked[0] = ranked[j];
      ranked[j] = tmp;
      prop[0].p = (1 - epsilon);
      prop[j].p = epsilon * (1 / pool);
      prop[j].was_forced = true;
      for (let k = 1; k < pool; k++) if (k !== j) prop[k].p = epsilon * (1 / pool);
    } else {
      prop[0].p = (1 - epsilon) + epsilon * (1 / pool);
      for (let k = 1; k < pool; k++) prop[k].p = epsilon * (1 / pool);
    }
  } else {
    prop[0].p = (1 - epsilon) + epsilon * (1 / pool);
    for (let k = 1; k < pool; k++) prop[k].p = epsilon * (1 / pool);
  }
  return { ranked, propensities: prop };
}
