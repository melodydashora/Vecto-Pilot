-- 2026-04-29: Soft trigger that complements the threading-claude-memory-followups skill.
-- Fires RAISE NOTICE (not EXCEPTION) when a row with a continuation-prefix title
-- has neither a parent_id nor an "Antecedent:" body line — i.e., the row is
-- titled like a follow-up but doesn't disclose what it's a follow-up to.
--
-- Spec: docs/superpowers/specs/2026-04-29-threading-claude-memory-followups.md
-- Skill: .claude/skills/threading-claude-memory-followups/SKILL.md
-- CLAUDE.md cross-reference: Rule 15

CREATE OR REPLACE FUNCTION claude_memory_antecedent_check() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.title ILIKE 'Followup:%'
      OR NEW.title ILIKE 'Resolution:%'
      OR NEW.title ILIKE 'Update:%')
     AND NEW.parent_id IS NULL
     AND NEW.content NOT ILIKE 'Antecedent:%'
  THEN
    RAISE NOTICE 'claude_memory: row titled with continuation prefix has neither parent_id nor Antecedent: line in body. See skill threading-claude-memory-followups.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claude_memory_antecedent_check_trigger ON claude_memory;

CREATE TRIGGER claude_memory_antecedent_check_trigger
  BEFORE INSERT ON claude_memory
  FOR EACH ROW EXECUTE FUNCTION claude_memory_antecedent_check();
