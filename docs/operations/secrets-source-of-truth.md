# Secrets source of truth

Bitwarden Secrets Manager project `hermes_keys` is the canonical store for Project Stack Structure credentials. Local env files are runtime materializations only. Obsidian documents names and operating procedure, never secret values.

## Required flow

1. Create or rotate the value in BWS first.
2. Materialize it into the runtime env only where the service requires it.
3. Add the environment-to-BWS name mapping to `config/secrets.manifest.json`.
4. Run `bun run secrets:check` before restarting or deploying the app.
5. Update the matching Obsidian operations note with the secret name, consumer, and rotation date. Never paste the value into Git, docs, Trigger logs, Obsidian, or chat summaries.

The preflight checks names only and deliberately does not print or compare secret values:

```powershell
bun run secrets:check
```

The current GitHub/Auth.js mappings are:

| Runtime environment | BWS secret |
|---|---|
| `AUTH_GITHUB_ID` | `STACK_STRUCTURE_AUTH_GITHUB_ID` |
| `AUTH_GITHUB_SECRET` | `STACK_STRUCTURE_AUTH_GITHUB_SECRET` |
| `AUTH_SECRET` | `STACK_STRUCTURE_AUTH_SECRET` |

The production application uses `STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY`.
Local Trigger development uses `STACK_STRUCTURE_TRIGGER_DEV_SECRET_KEY`; the
two keys are never interchangeable.

Trigger task variables and deployment credentials are declared by name in
`config/secrets.manifest.json`. Use `bun run trigger:env:check` to verify the
BWS pointers and `bun run trigger:env:sync` to import the task variables into
only the Project Stack Structure production environment. The sync path does not
print values.

GitHub OAuth app: `Project Stack Structure Studio`. LAN callback: `http://192.168.8.175:3000/api/auth/callback/github`.

## Persistence boundaries

- BWS: credential values and rotation history.
- Runtime env: values required by the currently running local service.
- Repository: secret names, mappings, validation scripts, and architecture.
- Local Obsidian vault: operator runbook and decisions; Syncthing propagates it.
- Codex memory: the preference that new secrets must enter BWS, never credential values.
