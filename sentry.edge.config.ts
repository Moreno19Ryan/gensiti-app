import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Tier gratis Sentry: jaga sample rate rendah agar tidak boros kuota event.
  tracesSampleRate: 0.1,

  enabled: !!process.env.SENTRY_DSN,
  debug: false,
});
