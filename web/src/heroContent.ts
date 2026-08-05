// Everything the hero renders. Edit here; no need to touch Hero.tsx.
export const heroContent = {
  riveSrc: "/rive/character-follow.riv",
  riveStateMachine: "State Machine 1",
  brand: "Terra",
  brandMark: "✳︎",
  navLinks: ["Product", "Docs", "Pricing", "Blog"],
  navCta: "Get started",
  repo: {
    name: "acme / checkout-service",
    branch: "main",
    rows: [
      ["src/payments/", "stripe webhooks, retries"],
      ["src/cart/", "session state, pricing"],
      ["src/notify/", "email + sms senders"],
      ["src/auth/", "jwt, refresh tokens"],
      ["migrations/", "42 files"],
      ["tests/", "1,204 cases"],
      [".github/workflows/", "ci, deploy, nightly"],
      ["Dockerfile", "edited 2d ago"],
      ["README.md", "3 lines, unhelpful"],
    ] as [string, string][],
    caption: "What agents read",
  },
  activateLabel: "Activate Terra",
  activatedLabel: "Terra active",
  humanCard: {
    kicker: "What humans understand",
    title: "This app takes payments",
    body: "Customers fill a cart, pay with Stripe, and get a receipt by email or text. Three parts do the work:",
    chips: ["🛒 Cart", "💳 Payments", "✉️ Receipts"],
    foot: "Agents keep the code trusted. Terra keeps you in the loop.",
  },
};
