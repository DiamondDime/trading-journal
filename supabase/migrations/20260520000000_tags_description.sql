-- Tag descriptions — user-written explanation of what a tag means.
-- The MCP tag_glossary tool exposes this to LLMs so they can interpret
-- tag-based analysis correctly. Null when the user hasn't defined the
-- tag (LLM falls back to inferring from name + usage pattern).

ALTER TABLE tags ADD COLUMN description text;

COMMENT ON COLUMN tags.description IS
  'Optional user-written definition of the tag, surfaced to LLM clients via MCP tag_glossary. Null when undefined.';
