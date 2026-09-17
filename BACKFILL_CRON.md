# Backfill cron job

A local `cron` job resumes the Strava segment-hunter backfill once a day, shortly
after Strava's daily read quota rolls over at midnight UTC. This runs on this
machine (via macOS's `cron`), not as a Claude cloud routine — the backfill needs
this machine's local SQLite db (`data/segment-hunter.db`) and local Strava OAuth
credentials, which a cloud sandbox wouldn't have access to.

## What's installed

```
TZ=UTC
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

# Resume Strava segment-hunter backfill daily, shortly after the Strava
# daily read quota rolls over at midnight UTC.
5 0 * * * cd /Users/rob/GitHub/robertgregorywest/strava-segment-hunter && ./scripts/backfill.sh >> logs/cron.log 2>&1
```

- Runs daily at **00:05 UTC**. `TZ=UTC` is pinned in the crontab so the schedule
  stays correct across BST/GMT clock changes.
- Invokes `scripts/backfill.sh`, which already guards against double-starting
  (checks `logs/backfill.pid`) and auto-restarts the underlying `npm run
  sync:backfill` on crash, up to 20 attempts.
- Cron's own stdout/stderr goes to `logs/cron.log`; the backfill script's own
  timestamped log goes to `logs/backfill-<timestamp>.log` as usual.

## Checking on it

```bash
crontab -l                # confirm the job is installed
tail -f logs/cron.log     # cron-level output (job start, any shell errors)
tail -f logs/backfill-*.log  # actual backfill progress from the latest run
```

If `logs/cron.log` is empty/missing the morning after an expected run, macOS may
be blocking `cron` from running in the background — check System Settings →
Privacy & Security → Full Disk Access and grant it to `cron`
(`/usr/sbin/cron`).

## Removing it

Edit the crontab and delete the job's lines (or the whole file if nothing else
uses it):

```bash
crontab -e
```

Or remove it non-interactively:

```bash
crontab -l | grep -v 'scripts/backfill.sh' | crontab -
```

To verify it's gone:

```bash
crontab -l
```
