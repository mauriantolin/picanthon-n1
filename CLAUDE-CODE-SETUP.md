# Claude Code — setup del proyecto

Configuración mínima y reproducible de Claude Code para este repo. El objetivo
es que cualquiera (o una máquina nueva) tenga la **base inmediatamente**: sólo
los plugins, MCPs y skills necesarios, nada más.

## Qué queda habilitado (y nada más)

### Plugins (3)

Fijados en [`.claude/settings.json`](.claude/settings.json) — versionado, así
el repo es auto-suficiente:

| Plugin                  | Marketplace                  | Para qué |
| ----------------------- | ---------------------------- | -------- |
| `superpowers`           | `claude-plugins-official`    | Metodología: brainstorm, TDD, debug sistemático, write/execute-plan |
| `everything-claude-code`| `everything-claude-code` (GitHub `affaan-m/everything-claude-code`) | Agentes especializados, skills, y MCPs (incluye **playwright** y **github**) |
| `vercel`                | `claude-plugins-official`    | Skills de Next.js, AI SDK, deploy, env, etc. + MCP de Vercel |

> `playwright` y `github` **no son plugins sueltos**: son MCP servers que vienen
> dentro de `everything-claude-code`. Por eso no aparecen en `enabledPlugins`.

### MCP servers

- **De `everything-claude-code`** (bundled): `playwright`, `github`, `context7`,
  `exa`, `memory`, `sequential-thinking`.
- **User scope** (definidos globalmente, disponibles en todo proyecto):
  `github` (Copilot MCP), `vercel` (OAuth), `supabase` (OAuth).

No hace falta declarar MCPs en este repo: los bundled vienen con el plugin y los
de user scope ya están cargados. Si más adelante querés MCPs project-scope
(AWS docs, Neon, Chrome DevTools), corré `/init-project`.

### Skills

Sólo las que aportan los 3 plugins de arriba + las built-in de Claude Code +
la skill de Vercel AI SDK agregada explícitamente (abajo). No se instaló nada
más, así que la lista queda limpia.

## Vercel AI SDK skill

Skill `ai-sdk` (AI SDK, AI SDK Elements, AI Gateway, agents, providers,
`generateText`/`streamText`, `useChat`, tool calling, structured output):

```bash
npx skills add vercel/ai
```

- Se instala en `.agents/skills/ai-sdk/` (ubicación universal multi-agente).
- Claude Code la descubre vía symlink en `.claude/skills/ai-sdk`.
- **En Windows** el symlink necesita Developer Mode/admin; si falla, se crea un
  *junction* (no requiere permisos):
  ```powershell
  cmd /c mklink /J ".claude\skills\ai-sdk" ".agents\skills\ai-sdk"
  ```

Tanto `.agents/` como `.claude/skills/` están en `.gitignore` (el junction es
OS-específico y la skill se re-baja con el comando de arriba). Lo que **sí** se
versiona es `.claude/settings.json`, que fija los plugins.

## Bootstrap en una máquina/clon nuevo

```bash
git clone <repo> && cd picanthon

# 1. Deps del proyecto (extensión Chrome — ver README.md)
npm install

# 2. Skill de Vercel AI SDK
npx skills add vercel/ai
#    (Windows, si el symlink falló:)
#    cmd /c mklink /J ".claude\skills\ai-sdk" ".agents\skills\ai-sdk"
```

Al abrir Claude Code en el repo, lee `.claude/settings.json`, registra el
marketplace `everything-claude-code` y habilita los 3 plugins automáticamente.
La primera vez puede pedir confirmación para instalar el marketplace de GitHub.

## Verificar

| Qué | Cómo |
| --- | ---- |
| Plugins activos          | `/plugin`            |
| Agentes disponibles      | `/agents`            |
| MCP servers + estado     | `/mcp` o `claude mcp list` |
| Skills (incl. `ai-sdk`)  | escribí `/` y buscá `ai-sdk` |

## Replicar en otro proyecto

1. Copiar [`.claude/settings.json`](.claude/settings.json) al nuevo repo.
2. Copiar el bloque `.gitignore` de Claude Code.
3. Correr `npx skills add vercel/ai` (+ junction en Windows si hace falta).
4. (Opcional) `/init-project` para sumar MCPs project-scope.
