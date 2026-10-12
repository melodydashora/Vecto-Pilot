// Search remains enabled. These schemas constrain the Airport response format;
// the pipeline still validates requested identities and preserves source facts.
const object = properties => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: { type: 'string' } };
const wait = { anyOf: [{ type: 'number', minimum: 0 }, { type: 'string', enum: ['unreported'] }] };
const airports = (codes, properties) => ({ type: 'array', minItems: codes.length, maxItems: codes.length,
  items: object({ code: { type: 'string', enum: codes }, ...properties }) });

export function airportConditionsSchema(codes) {
  return object({ airports: airports(codes, {
    status: { type: 'string', enum: ['normal', 'delayed', 'severe', 'closed', 'ground-stop', 'restricted', 'unreported'] },
    delays: { type: 'string' },
  }) });
}

export function airportTerminalsSchema(codes) {
  return object({
    airports: airports(codes, {
      busyTimes: strings,
      terminals: { type: 'array', items: object({
        terminal: { type: 'string' },
        arrivalsActivity: { type: 'string' },
        ridesharePickup: { type: 'string' },
        checkpoints: { type: 'array', items: object({
          name: { type: 'string' },
          lanes: { type: 'object', properties: { general: wait, preCheck: wait, clear: wait }, additionalProperties: false },
        }) },
      }) },
    }),
    busyPeriods: strings,
    recommendations: { type: 'string' },
  });
}
