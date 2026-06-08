# Auth Flows — Frontend Handoff

Two new authentication flows are live on the backend and need FE wiring:

1. **Forgot password** (OTP via email) — new screens.
2. **Force password change on first login** (admin-created accounts) — a gate after login.

- **Base URL:** all paths below are prefixed with `/api/v1` (global prefix).
- **Response envelope:** every endpoint returns `{ message, statusCode, data }`.
- **Errors:** failures return a non-2xx with `{ statusCode, error, message }`. Show
  `error`/`message` to the user.

---

## 1. Forgot Password (OTP)

A 3-step flow. The user requests a code by email, enters it, then sets a new password.

```
[Forgot password?]
      │  email
      ▼
POST /auth/forgot-password ──────────► always 200 (generic message)
      │                                 (email sent only if account exists)
      ▼
  "Enter the 6-digit code" screen ◄──── (Resend available, rate-limited)
      │  email + otp
      ▼
POST /auth/forgot-password/verify-otp ─► { resetToken, expiresInMinutes }
      │  email + resetToken + newPassword
      ▼
POST /auth/forgot-password/reset ──────► 200 → redirect to login
```

### 1.1 Request OTP
`POST /auth/forgot-password`
```json
{ "email": "user@example.com" }
```
- **Always returns 200** with a generic message, whether or not the email exists
  (intentional — prevents attackers probing which emails are registered).
- FE should **always** advance to the "enter code" screen on 200. Never reveal
  whether the email was found.
- Response:
  ```json
  { "message": "If an account exists for that email, a verification code has been sent.",
    "statusCode": 200, "data": {} }
  ```

### 1.2 Resend OTP
`POST /auth/forgot-password/resend`
```json
{ "email": "user@example.com" }
```
- Rate-limited server-side: **60-second cooldown** between sends, **max 3 resends**
  per reset attempt. If the FE calls too soon / too often, it returns a 400 with a
  message like *"Please wait 42 second(s)…"* or *"Resend limit reached…"* — show it.
- Recommended FE: disable the Resend button for 60s after each send (countdown timer)
  to avoid hitting the limit.

### 1.3 Verify OTP
`POST /auth/forgot-password/verify-otp`
```json
{ "email": "user@example.com", "otp": "123456" }
```
- `otp` must be **exactly 6 digits**.
- **OTP expires 10 minutes** after it was sent.
- **Max 5 wrong attempts**, then the code locks — the user must request a new one.
  Wrong-attempt errors include remaining count: *"Invalid verification code. 3 attempt(s) remaining."*
- On success:
  ```json
  { "message": "Verification successful", "statusCode": 200,
    "data": { "resetToken": "a1b2c3…", "expiresInMinutes": 15 } }
  ```
- **Store `resetToken` in memory** (not localStorage) — it's needed for step 3 and is
  valid for **15 minutes**. Do not display it.

### 1.4 Reset Password
`POST /auth/forgot-password/reset`
```json
{ "email": "user@example.com", "resetToken": "a1b2c3…", "newPassword": "MyNewPass123" }
```
- `newPassword`: **minimum 8 characters** (enforce on the FE too for instant feedback).
- On success → show "Password reset" confirmation and route to the **login** screen.
  The user logs in fresh with the new password (no token is returned here).
  ```json
  { "message": "Password has been reset successfully. You can now log in.",
    "statusCode": 200, "data": {} }
  ```

### Error states to handle (forgot-password)
| Situation | What the FE sees | UX |
| --- | --- | --- |
| Wrong OTP | 400 + "Invalid verification code. N attempt(s) remaining." | Show message, let them retry |
| OTP expired / too many attempts | 400 + "…request a new code." | Send them back to step 1 / show Resend |
| Resend too soon | 400 + "Please wait N second(s)…" | Keep button disabled |
| Reset token expired | 400 + "Reset token has expired. Please start again." | Restart from step 1 |

---

## 2. Force Password Change on First Login (admin-created accounts)

When an **admin creates** a student account, the admin sets a temporary password. On the
student's **first login**, they must replace it with their own. Self-registered users are
**not** affected (they chose their own password).

### How the FE detects it
The login response now includes a flag on the user object:

`POST /auth/login` → `data.user.mustChangePassword: boolean`

```jsonc
{
  "message": "Successfully logged in",
  "statusCode": 200,
  "data": {
    "jwt": "…",
    "user": { "id": "…", "email": "…", "mustChangePassword": true /* or false */ }
  }
}
```

### Required FE behavior
After a successful login, **before routing to the dashboard**, check the flag:

```ts
const { jwt, user } = res.data;
if (user.mustChangePassword) {
  // store jwt, then route to "Set your new password" screen — do NOT land on dashboard
  navigate('/set-new-password');
} else {
  // normal login
  navigate('/dashboard');
}
```

> The user is technically authenticated (you get a `jwt`), so guard your routes so a
> user with `mustChangePassword: true` cannot navigate away to other pages until they
> complete the change. Treat it as a blocking modal/screen.

### The change endpoint
`POST /auth/force-change-password`
```json
{ "email": "user@example.com", "currentPassword": "<temp password they just logged in with>", "newPassword": "TheirNewPass123" }
```
- `currentPassword` = the temporary password the admin gave them (the one they just used to log in).
- `newPassword`: **minimum 8 characters**, and **must differ** from the current password.
- On success → returns a **fresh JWT**; replace the stored token and proceed to the dashboard.
  ```json
  { "message": "Password changed successfully.", "statusCode": 200, "data": { "jwt": "…" } }
  ```

### Error states to handle (force-change)
| Situation | What the FE sees | UX |
| --- | --- | --- |
| Wrong current password | 403 + "Credentials incorrect" | Show inline error |
| New password same as current | 403 + "New password must be different…" | Show inline error |
| Flag not actually set | 403 + "A password change is not required…" | Shouldn't happen via normal flow; route to dashboard |

---

## Quick reference — all endpoints

| Method | Path | Body | Auth |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/forgot-password` | `{ email }` | none |
| POST | `/api/v1/auth/forgot-password/resend` | `{ email }` | none |
| POST | `/api/v1/auth/forgot-password/verify-otp` | `{ email, otp }` | none |
| POST | `/api/v1/auth/forgot-password/reset` | `{ email, resetToken, newPassword }` | none |
| POST | `/api/v1/auth/force-change-password` | `{ email, currentPassword, newPassword }` | none (current pw proves identity) |
| POST | `/api/v1/auth/login` | `{ email, password }` | none → now returns `user.mustChangePassword` |

## Notes
- **Password policy:** backend enforces min 8 chars on new passwords. Mirror on the FE
  for instant feedback; add strength hints if desired (no max/complexity rule enforced
  server-side beyond length).
- **No enumeration:** the forgot-password request/resend never reveal whether an email
  exists. Keep the FE copy generic too ("If an account exists, we've sent a code").
- **Emails** come from `Greenwich Training Centre <noreply@greenwichtc-elearning.com>`.
  If a user doesn't receive a code, advise checking spam before resending.
