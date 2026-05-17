# TWCARDGAME v2

This repository root now contains the v2 parallel rewrite workspace.

The original static/v1 project has been moved into `LEGACY/` for reference.

## v2 Commands

```bash
npm install
npm run validate:cards
npm test
npm run check
npm run build
npm run start -w @twcardgame/server
npm run dev -w @twcardgame/web
```

## Layout

- `apps/server`: Colyseus authoritative PvP server.
- `apps/web`: Vite vanilla TypeScript client.
- `packages/cards`: source-controlled card catalog and validation.
- `packages/rules`: deterministic gameplay engine.
- `packages/db`: Supabase helpers and migrations.
- `packages/shared`: shared command/state/event contracts.
- `LEGACY`: original v1 app, assets, scripts, and old tests.

## Documentation And Skill

- Chinese build/maintenance guide: `docs/製作.md`
- Repo copy of the Codex skill: `skills/twcardgame-v2/SKILL.md`
- Local installed skill path: `%USERPROFILE%/.codex/skills/twcardgame-v2/SKILL.md`
