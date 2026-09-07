// tests/mcp/fake-store.js
// In-memory stand-in for server/mcp/continuity-store.js with the same method
// surface, so the MCP tool layer is tested end-to-end (client → transport →
// server → tool → store) without a database.

export function makeFakeStore(seed = {}) {
  const state = {
    memory: seed.memory || [
      { id: 1, session_id: 's1', category: 'decision', title: 'Root decision', content: 'why', source: 'claude-code', priority: 'high', status: 'active', tags: ['mcp'], related_files: [], parent_id: null, metadata: {}, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
      { id: 2, session_id: 's1', category: 'session', title: 'Followup: child', content: 'detail', source: 'claude-code', priority: 'normal', status: 'active', tags: [], related_files: [], parent_id: 1, metadata: {}, created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
      { id: 3, session_id: 's0', category: 'audit', title: 'Old superseded', content: 'gone', source: 'claude-code', priority: 'low', status: 'superseded', tags: [], related_files: [], parent_id: null, metadata: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ],
    todo: seed.todo || [
      { id: 10, title: 'Open task', detail: null, status: 'open', priority: 1, source_memory_id: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
      { id: 11, title: 'Done task', detail: null, status: 'done', priority: 2, source_memory_id: 1, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    ],
    lessons: seed.lessons || [
      { id: 20, lesson: 'A lesson', trigger: 't', rule: 'r', severity: 'high', created_at: '2026-09-01T00:00:00Z' },
    ],
    definitions: seed.definitions || [
      { id: 30, term: 'agent bridge', meaning: 'gateway /agent/* proxy to 43717', location: 'server/agent/bridge.js', aliases: 'bridge', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    ],
    appRules: seed.appRules || [
      { id: 40, rule_key: 'no-fallbacks', rule_text: 'No fallbacks.', rationale: null, provenance: 'melody', status: 'active', superseded_by: null, enforced_by: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    ],
  };
  let nextId = 1000;
  const calls = [];
  const rec = (name, args) => calls.push({ name, args });

  const store = {
    state, calls,
    async searchMemory(args = {}) {
      rec('searchMemory', args);
      const status = args.status ?? 'active';
      return state.memory.filter(r =>
        (status === 'any' || r.status === status) &&
        (!args.category || r.category === args.category) &&
        (!args.query || r.title.toLowerCase().includes(args.query.toLowerCase()) || r.content.toLowerCase().includes(args.query.toLowerCase())) &&
        (!args.tag || (r.tags || []).includes(args.tag)),
      ).slice(0, args.limit || 25);
    },
    async getMemory(id) { rec('getMemory', id); return state.memory.find(r => r.id === id) || null; },
    async getMemoryThread(id) {
      rec('getMemoryThread', id);
      const row = state.memory.find(r => r.id === id);
      if (!row) return null;
      const parents = [];
      let cur = row.parent_id;
      while (cur) { const p = state.memory.find(r => r.id === cur); if (!p) break; parents.push(p); cur = p.parent_id; }
      return { row, parents, children: state.memory.filter(r => r.parent_id === id) };
    },
    async addMemory(input) {
      rec('addMemory', input);
      const row = { id: nextId++, status: 'active', source: 'mcp', priority: 'normal', tags: [], related_files: [], parent_id: null, metadata: {}, ...input, created_at: 'now', updated_at: 'now' };
      state.memory.push(row);
      return row;
    },
    async setMemoryStatus(id, status) {
      rec('setMemoryStatus', { id, status });
      const row = state.memory.find(r => r.id === id);
      if (!row) return null;
      row.status = status; row.updated_at = 'now';
      return row;
    },
    async listTodo(args = {}) {
      rec('listTodo', args);
      const statuses = args.statuses || ['open', 'in_progress'];
      return state.todo.filter(t => statuses.includes(t.status)).slice(0, args.limit || 25);
    },
    async addTodo(input) { rec('addTodo', input); const row = { id: nextId++, status: 'open', priority: 3, detail: null, source_memory_id: null, ...input }; state.todo.push(row); return row; },
    async setTodoStatus(id, status) { rec('setTodoStatus', { id, status }); const row = state.todo.find(t => t.id === id); if (!row) return null; row.status = status; return row; },
    async listLessons(args = {}) { rec('listLessons', args); return state.lessons.filter(l => !args.severity || l.severity === args.severity); },
    async addLesson(input) { rec('addLesson', input); const row = { id: nextId++, severity: 'medium', ...input }; state.lessons.push(row); return row; },
    async lookupDefinitions(args = {}) {
      rec('lookupDefinitions', args);
      const q = (args.query || '').toLowerCase();
      return state.definitions.filter(d => !q || d.term.toLowerCase().includes(q) || (d.aliases || '').toLowerCase().includes(q) || d.meaning.toLowerCase().includes(q));
    },
    async getDefinitionByTerm(term) { rec('getDefinitionByTerm', term); return state.definitions.find(d => d.term.toLowerCase() === term.toLowerCase()) || null; },
    async addDefinition(input) { rec('addDefinition', input); const row = { id: nextId++, location: null, aliases: null, ...input }; state.definitions.push(row); return row; },
    async updateDefinition(id, patch) { rec('updateDefinition', { id, patch }); const row = state.definitions.find(d => d.id === id); if (!row) return null; Object.assign(row, patch); return row; },
    async listAppRules(args = {}) { rec('listAppRules', args); const s = args.status ?? 'active'; return state.appRules.filter(r => s === 'any' || r.status === s); },
    async bootContext(args = {}) {
      rec('bootContext', args);
      return {
        counts: { memory_active: state.memory.filter(r => r.status === 'active').length, todo_open: state.todo.filter(t => t.status !== 'done').length, lessons: state.lessons.length, definitions: state.definitions.length },
        app_rules: state.appRules,
        memory_active_newest: state.memory.filter(r => r.status === 'active'),
        todo_open: state.todo.filter(t => t.status !== 'done'),
        lessons_newest: state.lessons,
        definition_terms: state.definitions.map(d => d.term),
      };
    },
  };
  return store;
}
