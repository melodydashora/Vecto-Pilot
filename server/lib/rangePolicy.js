export function normalizeRange(min, max, city) {
  if (!city) return {min, max};
  const c = city.toLowerCase();
  if (c.includes("new york")) {
    if (min===8 && max===10) return {min: 6, max: 10};
    if (min===11 && max===15) return {min: 10, max: 15};
  }
  return {min, max};
}
