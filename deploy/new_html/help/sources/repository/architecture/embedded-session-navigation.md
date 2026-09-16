# Embedded workspace authentication

## Impact and ownership

Studio and the legacy administration console share the authenticated HTTP client
with the main application. An HTTP 401 still clears the relevant expired browser
session and requires server authentication; it never enables anonymous access.
When the client is inside a same-origin frame, login navigation belongs to the
outer shell. Navigating the child to login would intentionally be blocked by the
login document's anti-framing policy and leave an unusable gray frame.

The outer same-origin URL is retained as the return destination, including its
project, episode, query, and fragment. A foreign or unreadable parent is never
navigated. Standalone navigation retains its existing behavior.

Only the Studio HTML entry aliases allow same-origin ancestors. Asset paths,
arbitrary nested documents, login, and other application pages remain protected.
This does not broaden script permissions or allow embedding by another origin.

## Unchanged contracts

There are no database migrations, workspace snapshot changes, API payload changes,
media transformations, generation submissions, credit deductions, or notification
changes. Session redirects do not cancel background generation. Both application
and Studio bundles import the shared client and must be rebuilt together when
releasing this fix; local verification is not a production deployment.

## Regression gates

- Embedded Studio expiry navigates the same-origin outer shell to login.
- The project canvas return path survives reauthentication.
- Standalone, foreign-parent, and inaccessible-parent paths remain safe.
- Studio HTML aliases accept only same-origin embedding.
- Login and non-entry documents continue to deny framing.
