# Meridian HQ

Licence management and billing portal for Meridian customers.
Deployed to Cloudflare Pages at `portal.meridian.vantax.co.za`.

## Prerequisites

- Node.js >= 20
- A Clerk application (sign up at clerk.com)
- A Stripe account with ZAR currency enabled

## Environment Variables

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Licence Worker
LICENCE_WORKER_URL=https://licence.meridian.vantax.co.za
LICENCE_ADMIN_SECRET=<same secret configured in the licence worker>
```

## Stripe Setup

Run the product setup script once per environment:

```bash
STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-stripe.ts
```

This creates the Starter, Growth, and Enterprise products with monthly and
annual pricing in ZAR, plus per-module add-on products.

Save the generated price IDs and configure them in the portal environment.

## Stripe Webhook

Create a webhook endpoint in the Stripe dashboard pointing to:

```
https://portal.meridian.vantax.co.za/api/webhooks/stripe
```

Subscribe to these events:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Set the webhook signing secret as `STRIPE_WEBHOOK_SECRET`.

## Development

```bash
npm install
npm run dev
```

## Deployment

```bash
npm run build
npx wrangler pages deploy .vercel/output/static
```

Or use the GitHub Actions workflow (`.github/workflows/deploy-cloudflare.yml`)
which deploys automatically on push to main.
