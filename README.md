# wplace-griefscan
A Discord bot to report [Wplace](https://wplace.live) griefing to a Discord channel. It does not place pixels for you.

![Sample of wplace-griefscan on my personal instance, SEAL.](docs/sample.png)

## Installation
**Beware:** This is my personal project, I am publishing it "in the hope that it will be useful but without any warranty", etc.<br>
I assume [git](https://git-scm.com/downloads), [pm2](https://pm2.keymetrics.io/docs/usage/quick-start/), and [bun](https://bun.sh/) are installed, and optionally a file server (step 7) to link to raw templates.

1. `git clone https://github.com/nyakase/wplace-griefscan && cd wplace-griefscan`
2. [Create and add a Discord bot to your Discord server](https://discordpy.readthedocs.io/en/stable/discord.html) with the [required permissions](docs/permissions.md). Keep the token for the next step.
3. Create an `.env` file and add the bot token as `DISCORD_TOKEN=yourtokenhere`.
4. Create a Discord channel for the bot and add the [channel ID](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID) to the `.env` file as `DISCORD_CHANNEL=channelidhere`.
5. *Optional:* Create another channel for [overviews](docs/overview.png) and add its ID as `OVERVIEW_CHANNEL=channelidhere`.
6. [Add templates to the `templates` folder.](templates/README.md) The bot's templates will hot-reload when you change files here.
7. *Optional, technical:* Host the `templates` folder somewhere online (e.g. thru [caddy](https://caddyserver.com/docs/caddyfile/directives/file_server), [nginx](https://docs.nginx.com/nginx/admin-guide/web-server/serving-static-content/), [copyparty](https://github.com/9001/copyparty/blob/hovudstraum/README.md)) and set `FILESERVER_BASEURL=https://example.com`.
8. `bun install && pm2 start --interpreter bun --name griefscan src/index.ts`
9. Win! ...[I hope](https://twitter.com/i/status/1488257992827015172)

If you passed step ⑨ you'll see the channel topic [update to show scanner information](docs/topic.png). If not, see if `pm2 log griefscan` has useful information.