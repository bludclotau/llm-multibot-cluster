# Bot deploy wizard

Paint-by-numbers launcher for a new Discord bot in this cluster. Tabatha, Wendy, and Gumbo are the live reference. `bot4` / Lyla is a special case and the wizard will refuse it.

## What you must paste

`shared/bot.js` will not log in without these:

| Field | Env / unit key | What it is |
| --- | --- | --- |
| Discord bot token | `DISCORD_TOKEN` | Bot token from the Discord developer portal. Login fails if this is missing. |
| Channel IDs | `ALLOWED_CHANNELS` | Comma-separated channel snowflakes the bot is allowed to speak in. |
| Bot name | `BOT_NAME` | Slug and directory name (`wendy`, `gumbo`, …). |

Also collected, matching the live units:

| Field | Key | Why |
| --- | --- | --- |
| Server / guild ID | `DISCORD_GUILD_ID` | Discord server id, written onto the deploy unit. |
| Model | `LLM_MODEL` | Same knob the live units set. |
| Allow bot messages | `ALLOW_BOT_MESSAGES` | Bot-to-bot replies. |
| Persona traits | persona file | Stub if no persona exists yet. |

The local llama sequencer on `127.0.0.1:3005` is shared infra, not a per-bot token.

## Run it

Interactive:

```bash
node scripts/deploy-wizard.js
```

One-shot:

```bash
node scripts/deploy-wizard.js \
  --name rex \
  --token 'YOUR_DISCORD_BOT_TOKEN' \
  --guild 123456789012345678 \
  --channels 111111111111111111,222222222222222222 \
  --model dolphin-2.8-mistral-7b-v02
```

`--install` copies the secret-bearing unit to `/etc/systemd/system` and enables it. Off by default.

The older `.opencode/scripts/create-bot.sh` now forwards here.

## What it writes

- `<name>/.env` — secrets, gitignored. `dotenv` loads this from the working directory.
- `<name>/.env.example` — same keys, empty token.
- `<name>/personas/<name>.txt` — created only if missing.
- `<name>/<name>.service` and `systemd-units/<name>.service` — public units (token via `EnvironmentFile`, safe to commit).
- `deploy/<name>.service` — unit with token + server/channel IDs inline. Gitignored. Copy this onto the host.
- `bots.json` — registry entry.

## Smoke test

```bash
node scripts/smoke-deploy-wizard.js
```
