export function ndjson(type, data = {}) {
  const evt = { ts: new Date().toISOString(), type, ...data };
  process.stdout.write(JSON.stringify(evt) + '\n');
}
