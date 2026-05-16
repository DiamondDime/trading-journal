# E2E tests

End-to-end tests that drive the running Next.js app via Playwright Chromium.

## Prerequisites

1. Dev server running on http://localhost:3000:
   `pnpm dev`
2. Database seeded with demo data:
   `pnpm db:reset && pnpm db:seed`
3. APP_USER_ID in `.env.local` matches the seeded UUID.

## Running

```bash
pnpm e2e           # headless
pnpm e2e:headed    # see the browser
pnpm e2e:ui        # interactive Playwright UI
```

## Conventions

- Tests prefer `getByRole`, `getByText`, and `data-testid` (added on demand).
- Wizard write tests append a unique suffix to their inputs (e.g. `BTC-PERP-test-<ts>`)
  so re-runs do not collide with prior rows.
- No test deletes seeded fixtures. Write tests rely on the user being able to
  scroll their archive to spot the newly-added row.

## Skipped tests

- Spread wizard end-to-end is `.skip()`-ed. The leg picker depends on a much
  larger set of imported fills that is not stable. Cover that flow manually
  in pre-launch QA.
- Edit / Delete are `.skip()`-ed pending Wave 6's UI landing.
