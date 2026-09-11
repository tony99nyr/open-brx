# Agents

**Read [`CLAUDE.md`](CLAUDE.md).** It is the one instruction file for any coding agent working in this repo
(hard rules, environment, layout, where the docs start); the name is only the convention of the tool it was
written for first. Nothing in it needs that tool:

- the procedures it cites as "skills" are plain markdown under [`.claude/skills/`](.claude/skills/); read and
  follow them like any doc. Where one says to spawn parallel review agents or track findings with a task tool,
  run the passes one after another yourself and keep the list in a scratch file;
- the `brx` tagger instrument is a standard stdio MCP server (`python -m brx_mcp`) and works with any MCP client;
- session state lives in the repo, not in a tool's memory: `docs/HANDOFF.md`, `docs/FOLLOWUPS.md`,
  `docs/experiment-log/`.
