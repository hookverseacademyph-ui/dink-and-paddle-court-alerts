# Dink and Paddle: personal Telegram court alerts

This package runs on GitHub Actions without your PC, browser or ngrok. It does not deploy the website. No bot token or chat ID is included in these files.

Cloud watchlist: PCKLD., The Pickle Prime - Bacoor, Garahe Pickleball Court, Assenda, Dink ‘n Smash (Kawit), The Court BLVD, and Courthaus. Edit watchlist.json to choose your real favorites. Website stars do not sync to this cloud watchlist yet.

Rules: check the next 14 days for Saturday/Sunday sessions, 4 PM-10 PM Asia/Manila, with at least 2 continuous hours on the same active Pickleball court. Only verified live 360 Sports calendar results qualify. Bacoor results come first. Multiple new times for the same venue are combined into a Telegram message when they fit.

## 1. Upload the prepared files

Unzip the package on your PC. In https://github.com/hookverseacademyph-ui/dink-and-paddle-court-alerts select Add file -> Upload files. Drag the CONTENTS of the extracted folder into GitHub, including .github/ and tests/. Commit to the default branch (normally main). Do not upload the ZIP itself or the outer cloud-alerts folder.

The repository should contain:

    .github/workflows/court-alerts.yml
    .gitignore
    README.md
    watchlist.json
    telegram-alerts.mjs
    scrape-sports360.mjs
    live-availability.mjs
    tests/alerts.test.mjs

If GitHub does not upload .github/, use Add file -> Create new file. Enter .github/workflows/court-alerts.yml as the filename, paste the contents from the included file, then commit.

Scheduled runs start in disabled mode and do not send messages until you complete the settings below.

## 2. Start your personal bot chat

Open your own bot in Telegram, press Start, and send /start. If you do not have a bot yet, create one through the official @BotFather using /newbot. Keep the token private.

To find your personal chat ID, run the separate Get-TelegramChatId.ps1 helper locally in PowerShell (right-click -> Run with PowerShell, or open PowerShell in its folder and run .\Get-TelegramChatId.ps1). It asks for the token in a hidden prompt and reads recent bot updates. It does not send messages or save the token. No need to upload this helper to GitHub.

## 3. Add TWO repository secrets

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

- TELEGRAM_BOT_TOKEN: your own bot token from BotFather.
- TELEGRAM_CHAT_ID: your positive numeric PERSONAL chat ID from step 2.

Do not put either value in code, watchlist.json, commits, issues, or chat. This workflow uses GitHub's automatic GITHUB_TOKEN to save alert history; no personal access token is needed.

## 4. Send a connection test

Repository -> Actions -> Court availability alerts -> Run workflow -> choose mode test -> Run workflow. You should receive a Telegram message explicitly marked as a setup test. Enable Telegram notifications for your bot on your phone.

If the workflow does not appear, confirm the YAML is exactly at .github/workflows/court-alerts.yml on the default branch. Allow GitHub Actions if prompted.

## 5. Enable court alerts

Open watchlist.json -> pencil/Edit -> change "enabled": false to "enabled": true -> Commit changes. Confirm or edit the starter favorite before enabling. Keep the hubId for each chosen venue; they come from verified 360 Sports booking links.

Then Actions -> Court availability alerts -> Run workflow -> mode check. The first enabled run alerts on matching availability it finds. No alert is sent if your favorites have no qualifying courts. A successful run with 0 alerts can be correct.

Checks are scheduled at minutes 17 and 47 of every hour (every 30 minutes, all week). This checks availability FOR Saturday/Sunday sessions, not only DURING Saturday/Sunday. GitHub scheduling can be delayed or dropped; it is not instant or guaranteed at exact times.

## Alert history and failures

The workflow saves state/alerts.json to the repository using contents: write permission. It holds only public session identifiers and court numbers, never Telegram credentials or personal chat IDs. Unchanged available sessions do not send again. Newly free courts and sessions that disappear and later return can trigger another alert. Unavailable sessions never trigger availability alerts. History is updated only after a successful scrape and confirmed Telegram sends.

Keep this state file; deleting it resets duplicate prevention. If a Telegram send or state commit fails, inspect the failed workflow. A crash or failed commit after Telegram accepted a message can cause a repeat on retry; delivery is not exactly-once.

Protected branches or repository policies may reject automatic state commits. If the Save alert history step fails, fix write access before relying on duplicate prevention. Do not store personal credentials in the public repository to work around permissions.

Public standard GitHub-hosted runner compute is free subject to GitHub policy. Private repositories have limited free minutes. Public scheduled workflows may be disabled after 60 days without repository activity; watch for GitHub's notifications. Cloud network access to 360 Sports must be confirmed by the first GitHub run; local success does not guarantee cloud access. Do not bypass provider access restrictions if the runner is blocked.

## Update favorites later

Edit watchlist.json and add/remove verified hub IDs. Favorite venue names alone do not control scraping. Cloud favorites are separate from the website's star buttons. The prepared starting entry is a template, not an automatic copy of your current browser favorites.

## Local verification

Requires Node.js 24 and curl. No npm dependencies:

    node --test tests/alerts.test.mjs

With alerts disabled, this command sends nothing:

    node telegram-alerts.mjs

References:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://core.telegram.org/bots/tutorial

The daysAhead field in watchlist.json controls the scrape horizon (14 calendar days including today). Existing weekend, 4 PM-10 PM and 2-hour continuity checks remain in effect. No notification is sent for unchanged availability.
