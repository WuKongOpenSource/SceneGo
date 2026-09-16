# Phone code login and registration

On the login page, choose **验证码登录 / 注册**, enter a phone number, complete
the security challenge and request a code. A phone does not need an existing
account to receive a login code. Entering a valid code creates a normal account
only if needed, then establishes the same browser session as existing users.
No separate registration page or initial password is required in this flow.

The password-login and explicit password-registration paths remain available.
Code-created accounts can keep using SMS or set a password through the existing
verified password-reset flow. There is no shared/default password: the standard
registration path hashes a cryptographically random secret that is never exposed
or retained in plaintext. Existing passwords, roles and permissions are unchanged.

The verification code is scoped to the normalized phone and the login purpose,
expires and is consumed once. Registration/reset/binding codes cannot be reused as
login codes. Account creation occurs only after successful verification, using the
same DAO defaults as normal registration. The unique verified-phone index handles
concurrent creation; the winner is reused, never overwritten. Disabled accounts
remain blocked. Failed verification, failed delivery, and account/database errors
do not issue a session. CAPTCHA, resend cooldowns and SMS daily budgets remain.

Successful requests use the existing HttpOnly session cookie, authoritative account
status/session-version checks, last-login/online updates, daily reward flow and
same-origin destination validation. New accounts have no automatic administrator
privileges. Sending a code alone does not create a user or grant rewards. No schema
migration or bulk registration of historical phone numbers is needed.
