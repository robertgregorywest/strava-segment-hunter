# CLAUDE.md

See `README.md` for architecture, setup and scripts.

## Browser verification

Verify any change that reaches the browser (`web/`, or a `src/api` route the UI calls) in a real browser with the `playwright-cli` skill before calling it done. Typecheck and tests alone don't prove it: `fetch` binding bugs that pass under Node have already shipped once.

Run your own server on port 8799, in the background, so the user's own `npm run api` on its usual port is left alone:

```bash
API_PORT=8799 npm run api
```

It reads the user's real corpus (`DB_PATH`). Don't change rider settings or anything else that writes to it unless the change under test needs that, and if it does, put them back afterwards.

You're done when:

- the changed UI renders and behaves as intended in a snapshot,
- `playwright-cli console` shows no errors except the known `favicon.ico` 404,
- the browser is closed and the 8799 server is stopped.
