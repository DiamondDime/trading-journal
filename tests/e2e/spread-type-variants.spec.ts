/**
 * Spread type picker — every card emits the right query string.
 *
 * The /add/spread/type page renders 7 cards across 3 groups
 * (funding-based, basis & arbitrage, time-based). Each card has its
 * `spreadType` and optional `variantCanonical` baked into the href.
 *
 * A regression here would silently break the link between the picker and
 * the /fields step's gating logic — e.g. a user clicks "Long spot, short
 * dated future" expecting basis fields, but the href ships `variantCanonical=
 * funding` so they get a different form. Easy to miss in code review;
 * caught here.
 *
 * Read-only: each test loads /type, asserts the card's href, and stops.
 */
import { test, expect } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

interface VariantCase {
  /** Visible card title in EN. */
  cardTitle: RegExp;
  /** Expected `spreadType` query param. */
  spreadType: string;
  /** Expected `variantCanonical` query param. `null` when the type has no
   *  variant (cross_exchange, dex_cex, calendar). */
  variantCanonical: string | null;
}

const VARIANT_CASES: readonly VariantCase[] = [
  {
    cardTitle: /^Long-short perps · same venue$/,
    spreadType: "funding",
    variantCanonical: "same_venue",
  },
  {
    cardTitle: /^Long-short perps · cross venue$/,
    spreadType: "funding",
    variantCanonical: "cross_venue",
  },
  {
    cardTitle: /^Long spot, short perp \(funding\)$/,
    spreadType: "cash_carry",
    variantCanonical: "funding",
  },
  {
    cardTitle: /^Long spot, short dated future$/,
    spreadType: "cash_carry",
    variantCanonical: "basis",
  },
  {
    cardTitle: /^Cross-exchange arbitrage$/,
    spreadType: "cross_exchange",
    variantCanonical: null,
  },
  {
    cardTitle: /^DEX vs CEX$/,
    spreadType: "dex_cex",
    variantCanonical: null,
  },
  {
    cardTitle: /^Calendar \(long near, short far\)$/,
    spreadType: "calendar",
    variantCanonical: null,
  },
];

test.beforeEach(async ({ context }) => {
  await setLocaleCookie(context, "en");
  await hideDevOverlay(context);
});

test.describe("spread type picker emits correct hrefs", () => {
  for (const tc of VARIANT_CASES) {
    test(`card "${tc.cardTitle.source}" → spreadType=${tc.spreadType}, variantCanonical=${tc.variantCanonical ?? "(none)"}`, async ({
      page,
    }) => {
      const tracker = trackPageErrors(page);
      await page.goto("/add/spread/type");

      // Each card renders as an <a> wrapping an <h4 class="...">title</h4>
      // and a <p>description</p>. The link's accessible name is the
      // concatenation of all descendant text, so a strict `^title$` regex
      // against the link role doesn't match. Instead, find the heading by
      // its text, then walk to the enclosing <a>.
      const heading = page.getByRole("heading", { name: tc.cardTitle });
      await expect(
        heading,
        `card heading ${tc.cardTitle} not found on /add/spread/type`,
      ).toBeVisible();

      const card = page.locator("a", { has: heading });
      const href = await card.getAttribute("href");
      expect(href, "card has an href").toBeTruthy();

      const parsed = new URL(href!, page.url());
      expect(parsed.pathname).toBe("/add/spread/fields");
      expect(parsed.searchParams.get("spreadType")).toBe(tc.spreadType);
      if (tc.variantCanonical === null) {
        // Cards without a canonical variant must NOT pass one through —
        // otherwise the /fields page would render the variant radio on a
        // type that doesn't allow variants.
        expect(parsed.searchParams.get("variantCanonical")).toBeNull();
      } else {
        expect(parsed.searchParams.get("variantCanonical")).toBe(
          tc.variantCanonical,
        );
      }

      // No JS errors during the page render.
      expect(
        tracker.isClean(),
        `producing card ${tc.cardTitle} fired errors:\n${tracker.snapshot()}`,
      ).toBe(true);
    });
  }
});
