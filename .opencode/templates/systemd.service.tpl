[Unit]
Description={{name}} Discord Bot
After=network.target

[Service]
Type=simple
User=snerloc
WorkingDirectory=/home/snerloc/discord-bots/{{directory}}
Environment=DISCORD_TOKEN={{token}}
Environment=PERSONA_FILE=/home/snerloc/discord-bots/{{persona}}
Environment=LLM_MODEL={{model}}
Environment=ALLOWED_CHANNELS={{channels}}
Environment=ALLOW_BOT_MESSAGES={{allowBotMessages}}
Environment=BOT_NAME={{name}}
ExecStart=/usr/bin/node /home/snerloc/discord-bots/shared/bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
