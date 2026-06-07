# Forgot Password — Frontend / Backend Contract

**Status:** Backend implemented, migrated, and live-tested end-to-end.
**Owner:** Backend. Hand this to the FE team to build the UI against.

A 3-step OTP flow with resend + rate limiting. All endpoints are **public**
(no JWT). All responses use the app's standard envelope:

```json
{ "message": "...", "statusCode": 200, "data": <payload> }
```

Base path: all routes are under the global prefix `/api/v1`.

---

## 1. Flow overview

```
[Login page] → "Forgot password?"
   │
   ▼
Step 1  POST /auth/forgot-password            { email }
   │     → always 200 (generic message, no account enumeration)
   │     → email with a 6-digit code is sent IF the account exists & is active
   ▼
[Enter code screen]  ── "Resend code" ──▶ POST /auth/forgot-password/resend  { email }
   │
   ▼
Step 2  POST /auth/forgot-password/verify-otp { email, otp }
   │     → 200 { resetToken }   (on correct code)
   │     → 400 with error message (wrong/expired/locked)
   ▼
[Set new password screen]
   │
   ▼
Step 3  POST /auth/forgot-password/reset      { email, resetToken, newPassword }
   │     → 200 success → redirect to login
   ▼
[Login with new password]
```

---

## 2. Endpoints

### 2.1 `POST /auth/forgot-password` — request a code

**Body:**
```json
{ "email": "user@example.com" }
```

**Always responds 200** (whether or not the account exists — this prevents
attackers from discovering which emails are registered):
```json
{
  "message": "If an account exists for that email, a verification code has been sent.",
  "statusCode": 200,
  "data": {}
}
```

**FE behavior:** after this call, always advance to the "enter code" screen and
show the generic message. Do **not** branch on whether the email exists.

A 6-digit code is emailed (valid **10 minutes**). The email is only sent when
the account exists **and** is `active`. (Inactive accounts can't log in, so they
can't reset either — they must contact the admin.)

---

### 2.2 `POST /auth/forgot-password/resend` — resend the code

**Body:**
```json
{ "email": "user@example.com" }
```

**Success (200):** same generic message as 2.1.

**Rate limits (return `400`):**
- **Cooldown:** must wait **60 seconds** between sends.
  → `"Please wait N second(s) before requesting another code."`
- **Max resends:** **3** per reset attempt.
  → `"Resend limit reached. Please try again later or request a new code."`

**FE behavior:** disable the "Resend" button and show a 60s countdown after each
send. Surface the `message` from a 400 if the user beats the timer.

---

### 2.3 `POST /auth/forgot-password/verify-otp` — verify the code

**Body:**
```json
{ "email": "user@example.com", "otp": "531107" }
```
`otp` must be exactly 6 digits (validated server-side too).

**Success (200):**
```json
{
  "message": "Verification successful",
  "statusCode": 200,
  "data": { "resetToken": "d453e37...c3c2a8", "expiresInMinutes": 15 }
}
```
Store `resetToken` in memory (e.g. component state) — needed for step 3. It is
valid for **15 minutes** and is **single-use**.

**Failures (400)** — show `data`/`error`/`message`:
| Situation | `message` |
| --------- | --------- |
| Wrong code | `Invalid verification code. N attempt(s) remaining.` |
| 5 wrong attempts | `Too many incorrect attempts. Please request a new code.` |
| Expired / no active code | `Invalid or expired verification code` |

After **5** wrong attempts the code is locked — the FE should route the user
back to "request a new code".

---

### 2.4 `POST /auth/forgot-password/reset` — set the new password

**Body:**
```json
{
  "email": "user@example.com",
  "resetToken": "d453e37...c3c2a8",
  "newPassword": "NewSecret123"
}
```
`newPassword` must be **≥ 8 characters** (validated server-side; mirror this in
the FE form with a confirm-password field).

**Success (200):**
```json
{
  "message": "Password has been reset successfully. You can now log in.",
  "statusCode": 200,
  "data": {}
}
```
→ Redirect to the login page.

**Failures (400):**
| Situation | `message` |
| --------- | --------- |
| Bad/used/missing token | `Invalid or expired reset request` |
| Token older than 15 min | `Reset token has expired. Please start again.` |

---

## 3. Error shape

Validation and business errors return HTTP **400** with:
```json
{ "status": 400, "error": "<message>", "message": "<message>" }
```
FE should read `message` (or `error`) for the user-facing text. `class-validator`
field errors (e.g. malformed email, short password) come back in the standard
Nest validation format with a `message` array.

---

## 4. Security notes (FE-relevant)

- **No enumeration:** steps 1 & 2's *request*/*resend* never reveal whether an
  email exists. Don't add FE logic that infers it.
- **Codes are not retrievable** — only delivered by email. There is no endpoint
  to "get the current code".
- **`resetToken` is sensitive** — keep it in memory only; do not put it in the
  URL or localStorage. It dies after one successful reset or 15 minutes.
- **Active accounts only:** if a user's account is `inactive` (not yet activated
  by the admin), no code is sent. The generic message is still returned, so the
  FE shows the same screen — the user simply won't receive an email and should
  contact the admin (same as the login page's inactive message).

---

## 5. Suggested FE screens

1. **Forgot password** — email input → calls 2.1 → go to (2).
2. **Enter code** — 6-digit input, "Resend code" (60s cooldown), "Verify" →
   calls 2.3 → on success store `resetToken`, go to (3).
3. **New password** — password + confirm → calls 2.4 → on success go to login
   with a success toast.

---

## 6. Config / limits (server-side, for reference)

| Setting | Value |
| ------- | ----- |
| OTP length | 6 digits |
| OTP lifetime | 10 minutes |
| Max verify attempts | 5 (then locked) |
| Reset-token lifetime | 15 minutes |
| Max resends | 3 per attempt |
| Resend cooldown | 60 seconds |

These live in `src/auth/password-reset.service.ts` (constants at the top) if
they ever need tuning.
