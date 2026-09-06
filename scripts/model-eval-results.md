# Model quality comparison

Generated 2026-09-06T10:36:32.095Z. Same-provider tool-calling not evaluated here — see the header comment in this script for why.


## Requirement extraction

**Prompt:**

> Extract Functional Requirements, Non-functional Requirements, Business Rules, Dependencies, Risks, Assumptions, and Acceptance Criteria from this BRD excerpt. Flag anything inferred rather than stated as an assumption.
> 
> BRD excerpt:
> """
> Users must be able to reset their password via email. A reset link is valid for 30 minutes. The system must support at least 500 concurrent password reset requests. Only the account owner's registered email may be used. After 3 failed reset attempts within an hour, the account is temporarily locked for 15 minutes.
> """

### claude-haiku-4-5

_52362ms, $0.0139_

# BRD Requirements Extraction

## Functional Requirements
| ID | Requirement |
|---|---|
| FR-1 | Users can initiate a password reset request |
| FR-2 | System sends a password reset link via email to the account's registered email address |
| FR-3 | Users can click/use the reset link to set a new password |
| FR-4 | System validates the reset link before allowing password change |
| FR-5 | System rejects reset links that have expired (>30 minutes old) |
| FR-6 | System rejects reset attempts using unregistered email addresses |
| FR-7 | System tracks failed password reset attempts per account |
| FR-8 | System locks account after 3 failed reset attempts within a rolling 1-hour window |
| FR-9 | System automatically unlocks account after 15-minute lockout period |

---

## Non-Functional Requirements
| Category | Requirement |
|---|---|
| **Scalability** | System must support ≥500 concurrent password reset requests |
| **Availability** | Password reset email delivery must be timely/reliable |
| **Security** | Reset links must be cryptographically secure and single-use |
| **Performance** | Reset link generation and validation must complete within acceptable latency |

---

## Business Rules
| Rule |
|---|
| Only the email registered to the account may initiate a reset for that account |
| Reset link validity window: 30 minutes from generation |
| Failed reset attempt lockout threshold: 3 attempts within 60 minutes |
| Lockout duration: 15 minutes (automatic) |

---

## Dependencies
| Dependency | Notes |
|---|---|
| Email service | Must reliably deliver reset emails |
| User authentication system | Must verify account ownership |
| User database | Must store registered email addresses |
| Token management system | Must generate/validate secure reset tokens |
| Time/scheduling system | Must handle expiration timers and lockout windows |

---

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Email service failure or delays | Users cannot reset password | Retry queue, fallback notifications |
| Users lose access to registered email | Account becomes inaccessible | Email change/recovery options needed |
| Reset link interception | Account compromise | HTTPS only, secure token design |
| Brute force attacks on reset mechanism | Repeated lockouts | Rate limiting, CAPTCHA, progressive delays |
| Account lockout used for DoS | Legitimate users blocked | Admin unlock mechanism, appeal process |
| Clock skew in distributed systems | Timer inaccuracy | NTP synchronization, server time authority |
| Race conditions on concurrent attempts | Attempt counter inconsistency | Database locks, atomic operations |

---

## Assumptions
| Assumption | Status | Notes |
|---|---|---|
| Reset link validity timer starts when email is sent | **[INFERRED]** | Stated: "valid for 30 minutes" but no start point given |
| Failed attempt counter resets after 60 minutes or after successful reset | **[INFERRED]** | Only upper bound given; reset timing unclear |
| Reset tokens are cryptographically secure and cannot be guessed | **[INFERRED]** | Security assumption not explicitly stated |
| Failed attempts are tracked by account/email identifier | **[INFERRED]** | Mechanism not specified |
| Lockout is automatic without user intervention | **[INFERRED]** | Only lockout duration stated, not behavior |
| Users know their registered email address | **[INFERRED]** | Required to self-serve but not guaranteed |
| Email addresses are immutable or have separate change controls | **[INFERRED]** | "Registered email" implies stable reference |
| System distinguishes between expired vs. invalid/already-used tokens | **[INFERRED]** | Different user experiences but not defined |
| Concurrent requests do not corrupt attempt counter state | **[INFERRED]** | 500-concurrent requirement implies this |
| No explicit admin override exists for lockouts | **[INFERRED]** | Only 15-min auto-unlock mentioned |

---

## Acceptance Criteria
- [ ] Password reset email received within [SLA—**not specified** ⚠️]
- [ ] Reset link functions when clicked within 30 minutes of email send
- [ ] Reset link returns error/invalid message if clicked after 30 minutes
- [ ] Reset link only works with the account's registered email (not other emails)
- [ ] Unregistered email addresses receive no password reset link
- [ ] System tracks ≥3 reset attempts per account per rolling hour
- [ ] 3rd failed attempt within 1 hour triggers immediate 15-minute account lockout
- [ ] Locked account cannot reset password or log in during lockout window
- [ ] Account automatically unlocks after exactly 15 minutes
- [ ] System handles 500+ concurrent reset requests without errors or degradation
- [ ] Reset tokens are single-use (cannot be reused after first use)
- [ ] Reset tokens are not predictable/guessable
- [ ] Error messages clearly distinguish between: link expired, link invalid, account locked, unregistered email
- [ ] All password reset activity is logged with timestamp, account, result, IP address

---

## ⚠️ **Critical Gaps Requiring Clarification**
1. **Email delivery SLA** — No timeframe specified for reset email delivery
2. **Failed attempt window definition** — Is it rolling, or fixed hours from first attempt?
3. **Counter reset logic** — Does counter reset after the 1-hour window or after successful reset?
4. **Reset link format** — Token embedded in URL? Separate code? Copy-paste?
5. **Post-lockout recovery** — Self-unlock after 15 min, or admin approval required?
6. **New password validation** — Any complexity requirements, reuse prevention, history?
7. **Session termination** — Do existing sessions end after password reset?

### claude-sonnet-5

_47501ms, $0.0679_

# Requirements Extraction: Password Reset BRD Excerpt

## Functional Requirements (FR)

| ID | Requirement | Source Text |
|---|---|---|
| FR-01 | Users must be able to initiate a password reset via email | "Users must be able to reset their password via email" |
| FR-02 | System must generate a reset link with a 30-minute validity window | "A reset link is valid for 30 minutes" |
| FR-03 | System must restrict reset requests to the account owner's registered email address only | "Only the account owner's registered email may be used" |
| FR-04 | System must count failed reset attempts and lock the account after the 3rd failure within a 1-hour window | "After 3 failed reset attempts within an hour, the account is temporarily locked for 15 minutes" |
| FR-05 | System must automatically unlock the account after the 15-minute lockout period expires | Derived directly from FR-04 |

## Non-Functional Requirements (NFR)

| ID | Requirement | Source Text |
|---|---|---|
| NFR-01 | System must support ≥500 concurrent password reset requests | "The system must support at least 500 concurrent password reset requests" |
| NFR-02 (⚠ inferred) | Reset link generation/validation should complete within an acceptable response time under peak (500 concurrent) load | **Assumption** — BRD states concurrency capacity but not a latency/performance target |
| NFR-03 (⚠ inferred) | Reset tokens must be securely generated (e.g., cryptographically random, single-use) | **Assumption** — security best practice implied by "reset link," not explicitly stated |
| NFR-04 (⚠ inferred) | Email delivery must be reasonably timely (e.g., within seconds/minutes of request) | **Assumption** — no delivery SLA given in the excerpt |

## Business Rules (BR)

| ID | Rule | Source Text |
|---|---|---|
| BR-01 | A reset link expires exactly 30 minutes after issuance and cannot be used afterward | "valid for 30 minutes" |
| BR-02 | Reset requests are only valid for the email address on file for that account (no alternate/secondary email) | "Only the account owner's registered email" |
| BR-03 | 3 failed attempts within a rolling/fixed 1-hour window triggers lockout | "3 failed reset attempts within an hour" |
| BR-04 | Lockout duration is fixed at 15 minutes | "temporarily locked for 15 minutes" |
| BR-05 (⚠ inferred) | Failed attempt counter resets after a successful reset or after the 1-hour window elapses | **Assumption** — not explicitly stated; standard lockout logic inferred |

## Dependencies

| ID | Dependency | Notes |
|---|---|---|
| DEP-01 | Email delivery service/provider (SMTP, transactional email API) | Required for FR-01; not named in excerpt |
| DEP-02 | Account/user data store with verified registered email field | Required for FR-03 |
| DEP-03 | Token/session store capable of tracking expiry (30 min) and attempt counts (lockout logic) | Required for FR-02, FR-04 |
| DEP-04 (⚠ inferred) | Rate-limiting/infrastructure capable of handling 500 concurrent requests | **Assumption** — implies load balancer/scalable backend, not stated explicitly |

## Risks

| ID | Risk | Notes |
|---|---|---|
| R-01 | Email deliverability issues (spam filtering, delays) could block legitimate reset flow | Not addressed in excerpt |
| R-02 | 500 concurrent request threshold may be exceeded during real-world spikes (e.g., mass password reset events, credential-stuffing attacks) | Capacity risk |
| R-03 | Lockout mechanism could be exploited for denial-of-service (an attacker deliberately fails 3 attempts to lock out a legitimate user) | Not addressed — no mention of CAPTCHA/mitigation |
| R-04 | No mention of audit logging for reset attempts/lockouts — could hinder security monitoring | ⚠ inferred gap |
| R-05 | No specification of what happens to concurrent/multiple active reset links (e.g., does requesting a new one invalidate the old one?) | ⚠ inferred gap |

## Assumptions (⚠ all inferred, not stated in BRD)

1. **NFR-02, NFR-03, NFR-04** above.
2. The "hour" window for failed attempts is a rolling window, not a fixed clock-hour — ambiguous in the text.
3. The lockout applies to the account (not just the reset function) — text says "account is temporarily locked," assumed to mean full login lockout, not just further reset attempts.
4. After 15-minute lockout expires, the failed-attempt counter resets to zero (BR-05).
5. Reset links are single-use (invalidated after one successful use) — not stated explicitly.
6. "Registered email" implies email must already be verified/confirmed on the account.
7. Notification to the user is limited to the reset link itself — no mention of a separate lockout notification email/SMS.

## Acceptance Criteria (AC)

| ID | Criteria |
|---|---|
| AC-01 | Given a valid registered email, when a user requests a password reset, then a reset link is emailed to that address. |
| AC-02 | Given a reset link older than 30 minutes, when the user clicks it, then the system rejects it as expired. |
| AC-03 | Given a reset link within 30 minutes of issuance, when the user clicks it, then the system allows the password reset to proceed. |
| AC-04 | Given an email not registered to any account, when a reset is requested, then the system does not send a reset link (and, per security best practice, ⚠ *assumption*: should not reveal whether the email exists). |
| AC-05 | Given 500 concurrent reset requests, when submitted simultaneously, then the system processes all without failure/timeout. |
| AC-06 | Given 3 failed reset attempts on an account within 1 hour, when the 3rd failure occurs, then the account is locked for 15 minutes. |
| AC-07 | Given an account locked for failed attempts, when 15 minutes have elapsed, then the account is automatically unlocked and reset attempts are permitted again. |
| AC-08 | Given an account is currently locked, when a reset attempt is made, then the system rejects it and indicates the lockout status (⚠ assumption — messaging behavior not specified). |

---

**Summary of gaps requiring clarification from stakeholders:** exact lockout scope (login vs. reset-only), single-use vs. multi-use reset links, rolling vs. fixed hour window, performance/latency SLA under load, email deliverability SLA, and audit/notification requirements around lockout events.

### claude-opus-5

_130570ms, $0.2400_

# Requirements Extraction — Password Reset (BRD Excerpt)

**Source text is 5 sentences.** Everything traceable to those sentences is marked **[STATED]**. Everything else is marked **[INFERRED]** and duplicated into the Assumptions register.

---

## 1. Functional Requirements

| ID | Requirement | Source |
|---|---|---|
| FR-01 | A user shall be able to initiate a password reset for their account via email. | **[STATED]** — S1 |
| FR-02 | The system shall generate a password reset link and deliver it to the account's registered email address. | **[STATED]** — S1+S2 ("reset link" is named in S2) |
| FR-03 | The system shall reject/expire a reset link once 30 minutes have elapsed. | **[STATED]** — S2 |
| FR-04 | The system shall accept only the account owner's registered email address as the reset destination. | **[STATED]** — S4 |
| FR-05 | The system shall count failed reset attempts per account within a 1-hour window. | **[STATED]** — S5 |
| FR-06 | On the 3rd failed reset attempt within 1 hour, the system shall place the account into a temporary locked state for 15 minutes. | **[STATED]** — S5 |
| FR-07 | The system shall automatically release the lock after 15 minutes without manual intervention. | **[INFERRED]** — "temporarily" implies auto-release; no unlock mechanism is stated |
| FR-08 | The system shall invalidate a reset link after successful use (single-use token). | **[INFERRED]** — not stated at all |
| FR-09 | The system shall present the user an error/re-request path when an expired or invalid link is used. | **[INFERRED]** — S2 states expiry but not the expiry behaviour |
| FR-10 | The system shall allow the user to set a new password after successful link validation. | **[INFERRED]** — implied by "reset their password" but the set-password step is never described |
| FR-11 | The system shall notify the user when their account is locked and when the password is successfully changed. | **[INFERRED]** — no notification requirement stated |
| FR-12 | The system shall log reset requests, failures, and lockouts for audit. | **[INFERRED]** |

**Undefined term — blocking:** "failed reset attempt" (S5) is never defined. It could mean (a) requesting a reset for a non-existent/unregistered email, (b) submitting an expired/invalid token, (c) failing a new-password validation rule, or (d) any combination. FR-05/FR-06 are **not implementable or testable** until this is defined.

---

## 2. Non-Functional Requirements

| ID | Requirement | Category | Source |
|---|---|---|---|
| NFR-01 | The system shall support ≥ 500 concurrent password reset requests. | Performance/Scalability | **[STATED]** — S3 |
| NFR-02 | Reset tokens shall be cryptographically random, unguessable, and not derivable from user data. | Security | **[INFERRED]** |
| NFR-03 | Reset tokens shall be stored hashed at rest and transmitted only over TLS. | Security | **[INFERRED]** |
| NFR-04 | Reset responses shall be uniform regardless of whether the email exists (no account enumeration). | Security/Privacy | **[INFERRED]** — arguably in tension with FR-04 |
| NFR-05 | Reset email shall be delivered within a latency budget materially shorter than the 30-minute validity window. | Performance/Usability | **[INFERRED]** — no delivery SLA stated |
| NFR-06 | Reset attempt counters and lock state shall remain accurate under concurrent load (no race-condition undercounting). | Reliability | **[INFERRED]** — arises from NFR-01 × FR-06 interaction |
| NFR-07 | Availability target for the reset service. | Availability | **[GAP]** — not stated, no value can be inferred |
| NFR-08 | Response-time target per reset request. | Performance | **[GAP]** — S3 gives concurrency but no latency ceiling |

**NFR-01 is under-specified.** "500 concurrent requests" does not state: whether *concurrent* means simultaneous in-flight HTTP requests, requests/second, or active unexpired tokens; the acceptable response time at that load; the sustain duration; or the error-rate ceiling. As written it is a number without a pass/fail definition.

---

## 3. Business Rules

| ID | Rule | Source |
|---|---|---|
| BR-01 | Reset link validity period = 30 minutes. | **[STATED]** |
| BR-02 | Reset destination must be the account owner's registered email; no alternate/secondary addresses permitted. | **[STATED]** |
| BR-03 | Failure threshold = 3 failed reset attempts. | **[STATED]** |
| BR-04 | Failure counting window = 1 hour. | **[STATED]** |
| BR-05 | Lockout duration = 15 minutes. | **[STATED]** |
| BR-06 | Lockout is temporary and self-releasing. | **[INFERRED]** |
| BR-07 | The failure counter resets after a successful reset or after lock expiry. | **[INFERRED]** — reset-condition never stated |
| BR-08 | The 1-hour window is a rolling window, not a fixed clock-hour bucket. | **[INFERRED]** — S5 says "within an hour", ambiguous |
| BR-09 | Existing password complexity/history policy applies to the new password. | **[INFERRED]** — excerpt is silent |
| BR-10 | Lockout scope is the *password reset* function only, not general login. | **[INFERRED]** — S5 says "the account is locked", which could mean full account lockout |

**BR-10 is a material ambiguity.** If "account is temporarily locked" means login is blocked, this is a self-service denial-of-service vector (see RSK-03) and a much larger scope than reset-only throttling.

---

## 4. Dependencies

| ID | Dependency | Type | Source |
|---|---|---|---|
| DEP-01 | Outbound email delivery service (SMTP relay / transactional email provider) with capacity for the peak in NFR-01. | External service | **[INFERRED]** from S1 |
| DEP-02 | User identity store containing a verified registered email per account. | Internal | **[INFERRED]** from S4 |
| DEP-03 | Token generation, storage, and expiry mechanism. | Internal | **[INFERRED]** from S2 |
| DEP-04 | Attempt-counter / lock-state store supporting atomic increments (e.g. Redis or equivalent). | Internal | **[INFERRED]** from S5 + S3 |
| DEP-05 | Reliable, synchronised server clock (NTP) — all three time windows depend on it. | Infrastructure | **[INFERRED]** |
| DEP-06 | TLS-terminating public endpoint for the reset link. | Infrastructure | **[INFERRED]** |
| DEP-07 | Infrastructure sized to sustain the NFR-01 concurrency level. | Infrastructure | **[INFERRED]** |
| DEP-08 | Email-address verification process at registration (BR-02 is only meaningful if the registered address is verified). | Upstream process | **[INFERRED]** |

---

## 5. Risks

| ID | Risk | Impact | Likelihood | Notes |
|---|---|---|---|---|
| RSK-01 | Email delivery delay or spam-foldering consumes a large share of the 30-minute window, causing links to expire before use. | High | Medium | No delivery SLA is specified (NFR-05 gap). |
| RSK-02 | "Failed reset attempt" ambiguity leads to divergent implementation vs. test vs. business intent; lockout fires too often or never. | High | High | Blocking clarification. |
| RSK-03 | Lockout weaponised as a denial-of-service: an attacker who knows a victim's email triggers 3 failures to lock the account repeatedly. | High | Medium | Severity depends on resolution of BR-10. |
| RSK-04 | Account enumeration — strict enforcement of BR-02 with a distinguishable error reveals which emails are registered. | Medium | High | Direct conflict between FR-04 and NFR-04. |
| RSK-05 | NFR-01 is not measurable as written; load testing may certify a scenario unlike production. | Medium | High | |
| RSK-06 | Counter race conditions at 500 concurrent requests allow the 3-attempt threshold to be bypassed. | Medium | Medium | |
| RSK-07 | Token leakage via HTTP Referer headers, browser history, proxy/server logs, or shared/forwarded mailboxes. | High | Medium | Mitigated by single-use tokens (FR-08, currently inferred). |
| RSK-08 | No stated cap on *how many* reset emails may be requested → email bombing / mail-provider reputation damage. | Medium | Medium | S5 caps *failures*, not *requests*. |
| RSK-09 | 30 minutes may exceed the organisation's security standard for reset token lifetime. | Low | Medium | Needs InfoSec sign-off. |
| RSK-10 | Clock skew or timezone/DST handling causes premature or delayed expiry across the three timers. | Medium | Low | |
| RSK-11 | No stated behaviour for a locked user who contacts support → undefined manual override path. | Low | Medium | |

---

## 6. Assumptions (all items below are **inferred, not stated**)

| ID | Assumption | Needs confirmation from |
|---|---|---|
| ASM-01 | The reset link is single-use and invalidated on successful password change. | BA / Security |
| ASM-02 | The 30-minute clock starts at token generation/dispatch, not at email receipt or first click. | BA |
| ASM-03 | Issuing a new reset link invalidates any previously outstanding link for that account. | BA / Security |
| ASM-04 | The 1-hour failure window is rolling, evaluated per account. | BA |
| ASM-05 | Failure counting is keyed to the account, not to source IP or session. | BA / Security |
| ASM-06 | Lockout restricts the password-reset function only; normal login remains available. | BA — **high impact** |
| ASM-07 | Lockout auto-expires after 15 minutes with no admin action. | BA |
| ASM-08 | The failure counter is cleared on lock expiry and on successful reset. | BA |
| ASM-09 | The registered email is already verified at registration time. | BA |
| ASM-10 | Existing password complexity, history, and reuse policies apply to the new password. | BA |
| ASM-11 | All active sessions are invalidated after a successful password reset. | Security |
| ASM-12 | The user receives a confirmation email on successful reset and a notification on lockout. | BA / UX |
| ASM-13 | Reset request responses are generic to avoid account enumeration. | Security — **conflicts with FR-04 as literally worded** |
| ASM-14 | All reset traffic is over HTTPS. | Architecture |
| ASM-15 | "500 concurrent" means 500 simultaneous in-flight reset requests sustained at peak, not 500 req/s and not 500 active tokens. | BA / Performance — **blocks NFR-01 testing** |
| ASM-16 | Reset is available to all standard user account types (no admin/service-account exclusions). | BA |
| ASM-17 | No multi-factor step-up is required during reset beyond email possession. | Security |
| ASM-18 | Reset UI and emails are single-language; no localisation in scope. | BA |
| ASM-19 | Audit logging of reset events is required by policy even though unstated. | Compliance |
| ASM-20 | Accessibility standard (e.g. WCAG 2.1 AA) applies to reset screens per organisational default. | BA / UX |

---

## 7. Acceptance Criteria

### AC-01 — Reset initiation *(FR-01, FR-02)* — **[STATED]**
- **Given** a registered, unlocked user, **when** they submit a password reset request for their registered email, **then** a reset email containing a unique link is dispatched to that address.
- **And** the response to the requester does not reveal whether the address is registered *(covers ASM-13)*.

### AC-02 — Link validity, in-window *(FR-03, BR-01)* — **[STATED]**
- **Given** a link generated at T0, **when** it is used at T0 + 29m59s, **then** the password reset screen loads and the reset completes successfully.

### AC-03 — Link expiry, boundary *(FR-03, BR-01)* — **[STATED]**
- **Given** a link generated at T0, **when** it is used at T0 + 30m00s or later, **then** the link is rejected with an "expired link" message and a re-request option; the password is unchanged.

### AC-04 — Single use *(FR-08)* — **[INFERRED / ASM-01]**
- **Given** a link already used to change a password, **when** the same link is opened again, **then** it is rejected as invalid.

### AC-05 — Registered email only *(FR-04, BR-02)* — **[STATED]**
- **Given** an account, **when** a reset is requested naming any address other than the account's registered email, **then** no reset link is delivered to that address.
- **And** no reset link is ever delivered to an address not on file for the account.

### AC-06 — Lockout threshold, boundary *(FR-06, BR-03/04/05)* — **[STATED]**
- **Given** an account with 2 failed reset attempts inside the current 1-hour window, **when** a 3rd failed attempt occurs, **then** the account enters a locked state and further reset attempts are refused for 15 minutes.
- **Given** 2 failed attempts, **when** no 3rd occurs, **then** the account remains unlocked.

### AC-07 — Window boundary *(BR-04)* — **[STATED] threshold / [INFERRED] rolling semantics — ASM-04**
- **Given** failures at T0, T0+50m, **when** a third failure occurs at T0+61m, **then** the account is **not** locked (the T0 failure has aged out of the rolling window).

### AC-08 — Lock auto-release *(FR-07, BR-06)* — **[INFERRED / ASM-07]**
- **Given** an account locked at T0, **when** a valid reset is attempted at T0 + 15m01s, **then** it is accepted and processed normally.
- **When** attempted at T0 + 14m59s, **then** it is still refused.

### AC-09 — Concurrency *(NFR-01)* — **[STATED] target / [INFERRED] test definition — ASM-15**
- **Given** a production-equivalent environment, **when** 500 concurrent password reset requests are applied, **then** 100% are accepted without error, all reset emails are dispatched, and no counter/lock state is corrupted.
- ⚠️ **Not yet a valid AC** — requires an agreed response-time ceiling, error-rate ceiling, and sustain duration before it can pass or fail. Flagged as a gap, not an approved criterion.

### AC-10 — Counter integrity under load *(NFR-06)* — **[INFERRED]**
- **Given** 10 simultaneous failed attempts against a single account, **when** processed concurrently, **then** exactly one lock is applied and the count does not exceed the threshold incorrectly.

### AC-11 — Notification *(FR-11)* — **[INFERRED / ASM-12]**
- **Given** a successful password reset, **when** it completes, **then** a confirmation email is sent to the registered address.
- **Given** a lockout event, **when** it triggers, **then** the account owner is notified.

### AC-12 — Session invalidation — **[INFERRED / ASM-11]**
- **Given** an active session elsewhere, **when** the password is reset, **then** that session is terminated.

---

## 8. Open Questions — Recommended Before Sign-Off

1. **Define "failed reset attempt."** (Blocks FR-05, FR-06, AC-06.)
2. **Does lockout block login, or only password reset?** (Determines RSK-03 severity and BR-10.)
3. **Define "500 concurrent"** — plus response-time and error-rate ceilings. (Blocks AC-09.)
4. **Reconcile FR-04 with anti-enumeration (NFR-04).** What exactly is shown when an unregistered email is submitted?
5. **Is the 1-hour window rolling or fixed-bucket?**
6. **Is the reset link single-use? Does a new request invalidate prior links?**
7. **What is the email delivery SLA?** A 30-minute token is only usable if delivery is reliably fast.
8. **Is there a cap on reset *requests* (not just failures)?** (RSK-08.)
9. **Is there a support/admin unlock override?** (RSK-11.)
10. **Are sessions invalidated on reset?** (ASM-11.)

---

### Coverage Summary

| Category | Stated | Inferred | Gaps (undefined, uninferable) |
|---|---|---|---|
| Functional | 6 | 6 | 1 (definition of "failed attempt") |
| Non-functional | 1 | 5 | 2 (availability, response time) |
| Business Rules | 5 | 5 | 0 |
| Dependencies | 0 | 8 | — |
| Risks | — | 11 | — |
| Assumptions | — | 20 | — |
| Acceptance Criteria | 6 | 6 | 1 conditional (AC-09) |

The excerpt states **five discrete facts**; a further **~30 items** had to be inferred to make the feature buildable and testable. The three highest-priority clarifications are Q1, Q2, and Q3 — each currently blocks a testable acceptance criterion.

### ollama/gpt-oss:20b (local, free)

_306863ms_

[ERROR — Ollama unreachable: fetch failed]


## Test case generation

**Prompt:**

> Generate 5 test cases (case ID, steps, expected result, priority) for a standard login form with email + password fields and a "Forgot password" link. Cover at least one negative and one edge case.

### claude-haiku-4-5

_55755ms, $0.0258_

# Login Form Test Cases

## TC-LF-001 | Valid Credentials Login
**Priority:** P0 (Critical)

**Steps:**
1. Navigate to login page
2. Enter valid email (e.g., `user@example.com`) in email field
3. Enter correct password in password field
4. Click "Login" button

**Expected Result:**
- User is authenticated and redirected to dashboard/home page
- Session is established
- User name or profile indicator displays on page

---

## TC-LF-002 | Invalid Password (Negative)
**Priority:** P1 (High)

**Steps:**
1. Navigate to login page
2. Enter valid email in email field
3. Enter incorrect password in password field
4. Click "Login" button

**Expected Result:**
- Login fails with error message: "Invalid email or password" (or similar)
- User remains on login page
- No session is created
- Password field is cleared (optional security measure)

---

## TC-LF-003 | Invalid Email Format (Negative)
**Priority:** P1 (High)

**Steps:**
1. Navigate to login page
2. Enter malformed email (e.g., `notanemail` or `user@`) in email field
3. Enter any password in password field
4. Click "Login" button

**Expected Result:**
- Client-side validation triggers before API call
- Error message displays: "Please enter a valid email address"
- Login button is disabled or request is not sent
- User remains on login page

---

## TC-LF-004 | Edge Case – SQL Injection Attempt
**Priority:** P1 (High)

**Steps:**
1. Navigate to login page
2. Enter SQL injection payload in email field: `' OR '1'='1` or `admin'--`
3. Enter any password
4. Click "Login" button

**Expected Result:**
- Input is sanitized and treated as literal string (not executed)
- Login fails with standard "Invalid email or password" message
- No database error is exposed to user
- Attack is logged/monitored (backend security)

---

## TC-LF-005 | Edge Case – Empty Fields
**Priority:** P1 (High)

**Steps:**
1. Navigate to login page
2. Leave both email and password fields empty
3. Click "Login" button

**Expected Result:**
- Client-side validation triggers
- Error messages display: "Email is required" and "Password is required"
- Login button does not submit request
- "Forgot password" link remains accessible and functional

---

### Additional Test Cases to Consider:
- **Forgot Password Link** – Verify link navigation and password reset flow
- **Account Lockout** – Test behavior after N failed login attempts
- **Session Timeout** – Verify user is logged out after inactivity
- **Special Characters** – Test with unicode, emoji, or special symbols in password

### claude-sonnet-5

_40029ms, $0.0470_

Invoking task-observer skill per global config before starting.

---

## Login Form — Test Cases

| Case ID | Steps | Expected Result | Priority |
|---|---|---|---|
| **TC-01** | 1. Navigate to login page<br>2. Enter valid registered email<br>3. Enter correct matching password<br>4. Click "Login" | User is authenticated and redirected to dashboard/home page; valid session/token created | High |
| **TC-02** *(Negative)* | 1. Navigate to login page<br>2. Enter valid registered email<br>3. Enter incorrect password<br>4. Click "Login" | Login rejected; generic error shown (e.g., "Invalid email or password") — no indication of which field was wrong; no session created; password field cleared | High |
| **TC-03** *(Negative)* | 1. Navigate to login page<br>2. Leave both email and password fields empty<br>3. Click "Login" | Inline validation errors shown for both required fields; form does not submit; no request sent to backend | Medium |
| **TC-04** *(Edge case)* | 1. Enter a valid email with leading/trailing whitespace (e.g., " user@test.com ") and correct password<br>2. Click "Login"<br>*(also verify with a max-length, e.g. 254-char, email)* | Email is trimmed/normalized server-side and login succeeds; no false rejection due to whitespace; no truncation/overflow error on max-length input | Medium |
| **TC-05** | 1. On login page, click "Forgot password" link | User is navigated to the correct password-reset flow/page (no dead link, no console error); page loads with its own email-entry field to initiate reset | Medium |

**Coverage note:** TC-02/TC-03 = negative; TC-04 = edge case (input normalization + boundary length). Could extend with rate-limiting/lockout after N failed attempts and SQL-injection/XSS payload in fields if security testing is in scope — let me know if you want those added.

### claude-opus-5

_65678ms, $0.2796_

## Login Form — Test Cases

**Module:** Authentication / Login
**Scope:** Email field, Password field, Submit, "Forgot password" link
**Priority scale:** P1 = Critical, P2 = High, P3 = Medium

---

### TC-LOGIN-001 — Successful login with valid credentials
**Type:** Positive · **Priority:** P1

**Preconditions:** An active, verified account exists (`valid.user@example.com` / `Correct#Pass123`). User is logged out.

**Steps:**
1. Navigate to the login page.
2. Enter `valid.user@example.com` in the Email field.
3. Enter `Correct#Pass123` in the Password field.
4. Click **Login**.

**Expected result:** User is authenticated and redirected to the dashboard/landing page within acceptable load time. A valid session cookie is set (`HttpOnly`, `Secure`). The user's identity is reflected in the header/profile area. No error messages are shown.

---

### TC-LOGIN-002 — Login rejected with valid email and incorrect password
**Type:** Negative · **Priority:** P1

**Preconditions:** Account `valid.user@example.com` exists. Failed-attempt counter is below lockout threshold.

**Steps:**
1. Navigate to the login page.
2. Enter `valid.user@example.com` in the Email field.
3. Enter `WrongPass999` in the Password field.
4. Click **Login**.

**Expected result:** Login fails and the user remains on the login page. A **generic** error is displayed — e.g. "Invalid email or password" — that does **not** reveal whether the email exists (no user enumeration). No session is created. The password field is cleared; the email field retains its value. HTTP response is 401, not 500.

---

### TC-LOGIN-003 — Client-side validation on empty / malformed submission
**Type:** Negative · **Priority:** P2

**Preconditions:** User is on the login page with both fields empty.

**Steps:**
1. Click **Login** with both fields blank; observe the response.
2. Enter `plainstring` (no `@`) in Email, leave Password blank, click **Login**.
3. Enter a valid email, leave Password blank, click **Login**.

**Expected result:** In all three cases the form is not submitted to the server. Inline validation messages appear against the offending field(s) ("Email is required", "Enter a valid email address", "Password is required"). Focus moves to the first invalid field. Error text is announced to screen readers via `aria-describedby` / `aria-invalid`.

---

### TC-LOGIN-004 — Edge case: email normalisation and input boundaries
**Type:** Edge · **Priority:** P3

**Preconditions:** Account registered as `valid.user@example.com`.

**Steps:**
1. Enter `  Valid.User@Example.COM  ` (mixed case, leading and trailing spaces) in the Email field.
2. Enter the correct password `Correct#Pass123`, click **Login**.
3. Log out. Attempt login with a 320-character email address and a 256-character password string.
4. Attempt login pasting the credentials via clipboard rather than typing.

**Expected result:** Step 2 succeeds — email is trimmed and treated case-insensitively. Step 3 is handled gracefully: input is capped at the documented max length or rejected with a clear validation message; no crash, no truncated-hash authentication, no 500 error. Step 4 succeeds — paste is not blocked on either field.

---

### TC-LOGIN-005 — "Forgot password" link navigation and continuity
**Type:** Positive · **Priority:** P2

**Preconditions:** User is on the login page.

**Steps:**
1. Enter `valid.user@example.com` in the Email field (do not submit).
2. Click the **Forgot password** link.
3. Observe the destination page.
4. Use the browser Back button to return to login.
5. Verify the link is reachable and activatable via keyboard (Tab + Enter).

**Expected result:** User is routed to the password-reset page. The email entered on the login form is pre-filled into the reset form (or the field is empty and focused — per spec). The reset page renders correctly with no console errors. Back navigation returns to a functional login form. The link is keyboard-focusable with a visible focus indicator.

---

### Coverage summary

| Case ID | Title | Type | Priority |
|---|---|---|---|
| TC-LOGIN-001 | Successful login with valid credentials | Positive | P1 |
| TC-LOGIN-002 | Valid email + incorrect password | Negative | P1 |
| TC-LOGIN-003 | Empty / malformed field validation | Negative | P2 |
| TC-LOGIN-004 | Email normalisation and input boundaries | Edge | P3 |
| TC-LOGIN-005 | "Forgot password" link navigation | Positive | P2 |

---

**Suggested next-tier cases** (if you want to extend beyond 5): account lockout / throttling after N consecutive failures, SQL-injection and XSS payloads in the email field, session fixation on login, "remember me" persistence, and login while already authenticated.

Two notes: I tried to check stored memory for any project-specific test-case template before writing and the tool call wasn't permitted, so these follow generic QA conventions — tell me if qa-agent uses a different ID scheme or priority scale and I'll reformat. I can also drop this into a Google Sheet or Doc if you want it in a shareable form.

### ollama/gpt-oss:20b (local, free)

_171599ms_

**Login Form Test Suite – 5 Test Cases**

| Case ID | Steps | Expected Result | Priority |
|---------|-------|-----------------|----------|
| **TC001 – Valid Login** | 1. Open the application login page.<br>2. Enter a registered email address (e.g., `user@example.com`).<br>3. Enter the correct password.<br>4. Click **Login**. | User is authenticated and redirected to the dashboard/home page. A success message may appear. | High |
| **TC002 – Invalid Credentials (Negative)** | 1. Open the login page.<br>2. Enter a registered email address.<br>3. Enter an incorrect password.<br>4. Click **Login**. | Error message such as “Invalid email or password” is displayed. No navigation to the protected area occurs. | High |
| **TC003 – Empty Fields (Negative)** | 1. Open the login page.<br>2. Leave the email field empty.<br>3. Leave the password field empty.<br>4. Click **Login**. | Two inline error messages: “Email is required” and “Password is required” appear. The form does not submit. | Medium |
| **TC004 – Edge Case: Max‑Length Password** | 1. Open the login page.<br>2. Enter a valid email address.<br>3. Enter a password that is **exactly the maximum allowed length** (e.g., 255 or 512 characters depending on system spec).<br>4. Click **Login**. | The system accepts the password if it meets the length requirement and logs in successfully. If the length exceeds the limit, an error such as “Password must be ≤ 255 characters” is shown. | Medium (Edge) |
| **TC005 – Forgot Password Flow** | 1. Open the login page.<br>2. Click the **Forgot password** link.<br>3. Verify that the password‑reset page or modal appears with the email input field and instructions.<br>4. (Optional) Enter a registered email and submit. | The password‑reset page loads correctly; upon submission a confirmation message like “Password reset instructions have been sent to your email” appears. | Medium |

> **Notes**
> - Adjust the maximum password length in TC004 to match your application’s real constraints.  
> - The negative cases (TC002 & TC003) are essential for verifying input validation and security.  
> - The edge case (TC004) ensures that boundary values are handled gracefully.  
> - Priority levels are indicative; you can adjust them based on your release strategy.


## Bug severity/priority assessment

**Prompt:**

> Assess severity and priority (with a one-line justification for each) for this bug: "On checkout, clicking 'Place Order' twice in quick succession creates two separate orders and charges the customer's card twice. Reproducible 3/3 times on the production-like staging environment."

### claude-haiku-4-5

_33398ms, $0.0064_

# Bug Assessment: Duplicate Orders on Double-Click

| Dimension | Rating | Justification |
|-----------|--------|---------------|
| **SEVERITY** | 🔴 **CRITICAL** | Direct financial loss to customers (double charging) + data integrity violation (duplicate orders) + reproducible with 100% consistency (3/3); affects core transaction flow with immediate monetary impact. |
| **PRIORITY** | 🔴 **CRITICAL/URGENT** | Production-like staging environment means this is highly likely live in production; every customer using checkout is at risk; requires immediate fix before any new deploys or further testing. |

---

## Why This Ranks Critical×Critical

✅ **Financial impact** — real money charged twice per affected user  
✅ **Reproducibility** — not flaky; 100% consistent (3/3)  
✅ **Scope** — every checkout user is vulnerable  
✅ **Root cause simple** — likely missing submit button debounce/disable, missing idempotency key, or race condition in order handler (fast fix once identified)  

---

## Recommended Action

1. **Immediate:** Disable checkout temporarily or add client-side debounce (1-2 min fix) if this is live
2. **Investigation:** Check for missing `e.preventDefault()` + button disable, or backend request deduplication
3. **Data cleanup:** Audit production for duplicate orders from this bug; prepare customer refunds
4. **Regression test:** Create automated test that rapid-clicks "Place Order" and asserts single order created

### claude-sonnet-5

_27873ms, $0.0290_

**Severity: Critical (S1/Blocker)**
Justification: It causes direct financial harm (double-charging a customer's card) and data integrity corruption (duplicate orders) — a core transactional/payment failure, not a cosmetic or minor functional issue.

**Priority: Highest (P1 — fix immediately, block release)**
Justification: 100% reproducible (3/3) on a production-like environment means it will hit real customers in production with real money, so it must be fixed and verified before any further deploy.

### claude-opus-5

_36379ms, $0.0583_

**Severity: Critical (S1)**
Real financial loss and duplicate order fulfillment on a core revenue path, with data integrity damage (two order records) that persists after the fact — no user-side workaround exists.

**Priority: P0 / Immediate (fix before next release)**
Deterministically reproducible (3/3) on production-like staging via a completely normal user action (an impatient double-click), so it will hit real customers at scale the moment it ships.

**Supporting rationale**

| Factor | Assessment |
|---|---|
| Impact | Monetary — duplicate charges, refunds, chargebacks, possible payment-processor penalties |
| Likelihood | High — double-clicking a submit button is common user behavior, not an edge case |
| Reproducibility | 100% (3/3), environment parity with production |
| Workaround | None for the user; only manual refund + order cancellation after the fact |
| Blast radius | Every checkout, every customer |
| Reputational/legal | High — billing errors erode trust fast and can trigger compliance issues |

**Note for the fix (worth capturing in the ticket):** client-side button disabling alone is insufficient — it only narrows the race window. The durable fix is server-side idempotency (idempotency key on the order-creation/payment request, plus a unique constraint on the cart/session + attempt token) so retries collapse into a single order and a single charge.

### ollama/gpt-oss:20b (local, free)

_33506ms_

**Severity:** Critical – Duplicate orders and double card charges lead to immediate financial loss and major customer trust issues.  
**Priority:** P1 – The defect blocks the checkout flow and causes revenue loss; it must be fixed in the next release.


## Status-style question

**Prompt:**

> Given this data — 12 total bugs: 2 Critical (both open), 3 High (1 open, 2 in progress), 5 Medium (all open), 2 Low (both done) — answer concisely: how many bugs are currently open, and what's the highest-severity one still open?

### claude-haiku-4-5

_44577ms, $0.0151_

**8 bugs are currently open.**

Breaking it down:
- **Critical:** 2 open
- **High:** 1 open  
- **Medium:** 5 open
- **Low:** 0 open (both done)

**Highest-severity open:** **Critical** (2 of them)

### claude-sonnet-5

_25061ms, $0.0226_

Open bugs: **8 total** — 1 Critical... wait, let me recompute: 2 Critical (open) + 1 High (open) + 5 Medium (open) = **8 open bugs**.

Highest-severity open bug: **Critical** (2 of them still open).

### claude-opus-5

_29941ms, $0.0978_

**8 bugs are open** (2 Critical + 1 High + 5 Medium) — or **10 unresolved** if you count the 2 High bugs that are in progress.

**Highest-severity still open: Critical** — both Critical bugs are open and untouched, so they're the top priority.

Breakdown:
- Critical: 2 open / 0 in progress / 0 done
- High: 1 open / 2 in progress / 0 done
- Medium: 5 open / 0 in progress / 0 done
- Low: 0 open / 0 in progress / 2 done

Only 2 of 12 bugs (17%) are actually closed, and they're the lowest-severity ones — nothing Critical has been started yet.

### ollama/gpt-oss:20b (local, free)

_30785ms_

**Open bugs:** 8  
**Highest‑severity still open:** Critical
