# CLAUDE.md

See `README.md` for architecture, setup and scripts.

## Browser verification

Verify any change that reaches the browser (`web/`, or a `src/worker` route the UI calls) in a real browser with the `playwright-cli` skill before calling it done. Typecheck and tests alone don't prove it: `fetch` binding bugs that pass under Node have already shipped once.

The Worker gates every request behind Basic Auth. Run your own dev server on port 8799 with a throwaway passphrase, so the user's real passphrase stays out of your hands and their own `npm run dev` on 8787 is left alone:

```bash
npx wrangler dev --port 8799 \
  --var "PASSPHRASE_HASH:$(echo claude-verify | npx tsx scripts/passphrase.ts 2>/dev/null)"
```

Run it in the background. `--var` overrides the `PASSPHRASE_HASH` in `.dev.vars`. `.playwright/cli.config.json` (the default config) already sends the matching credentials to `http://localhost:8799`, so a plain `playwright-cli open http://localhost:8799/` is authenticated. Keep credentials out of the URL: `user:pass@host` URLs make the app's relative `fetch` calls throw.

You're done when:

- the changed UI renders and behaves as intended in a snapshot,
- `playwright-cli console` shows no errors except the known `favicon.ico` 404,
- the browser is closed and the 8799 server is stopped.

The local D1 replica may hold no corpus. For views that depend on data, an empty but well-formed result counts as a pass; say so in your report instead of claiming you checked real data.
