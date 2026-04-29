# Engineering Decisions

---

## Problem Understanding

**What I am building:** Two features on top of an existing event ticketing
platform — ticket transfer between registered users, and a waitlist system
for sold-out events with automatic promotion on cancellation.

**Key challenges:**
- Transfer must be atomic: the original ticket disappears and the recipient
  gets a valid new one in the same transaction, with no capacity leak.
- Waitlist promotion must fire automatically inside the cancellation
  transaction — if promotion fails, the cancellation should not commit.
- Sold-out detection must be reliable, which requires correct capacity
  accounting throughout.

**What I found before writing a line of code:**

`capacity.ts` has a bug. `decrementCapacity` nests the event-level
`soldCount` decrement inside the `if (booking.seatTierId)` guard. This means
cancelling a flat-price ticket (no seat tier) never decrements `soldCount`.
The event permanently over-reports sold tickets. `incrementCapacity` does not
have this asymmetry — it always increments event soldCount. This directly
breaks the waitlist story because promotion depends on accurate capacity.

`transfer.ts` is fully implemented but duplicates inline capacity logic
instead of calling `decrementCapacity` / `incrementCapacity`. It will
silently diverge if `capacity.ts` is ever corrected.

The schema's `Booking.status` already includes `"WAITLISTED"` as a declared
value. The original developer anticipated this feature. No new model is
needed.

---

## Approach

**Transfer:** Wire `POST /api/bookings/:id/transfer` into `bookings.ts`.
The route authenticates the caller, verifies ownership and CONFIRMED status,
looks up the recipient by email, rejects self-transfer, then calls the
existing `transferBooking` utility inside a `$transaction`. Before doing
any of this, fix `transfer.ts` to call the centralized capacity helpers
rather than duplicating the logic inline.

**Waitlist:** Use the existing Booking model with `status = "WAITLISTED"`.
No schema migration needed. Position is derived at query time by counting
WAITLISTED bookings for the same event with an earlier `createdAt`. Three
endpoints in `waitlist.ts`: join, leave, and position. Auto-promotion hooks
into the existing cancellation handler in `bookings.ts` — after cancel and
decrement, query for the oldest WAITLISTED booking for that event and promote
it to CONFIRMED inside the same transaction.

**Capacity bug fix:** Correct `decrementCapacity` by moving the event
decrement outside the seatTierId guard. This is a prerequisite, not a new
feature — broken capacity accounting silently corrupts both stories.

---

## Risks & Assumptions

- A user may hold only one active waitlist entry per event. Enforced by
  checking for an existing WAITLISTED booking before creating a new one.
- Waitlist is first-come-first-served by `createdAt`. No priority tiers.
- No email notification on promotion — no mail service exists in the
  codebase and it is not in scope.
- Transfer recipient must be a registered user. No guest transfers.
- The capacity bug fix changes existing cancellation behaviour for flat-price
  events. This is a correctness fix and a prerequisite for the waitlist —
  would flag it to the PM but proceed, since the current behaviour is
  objectively wrong.
- Question for PM: should transferring to a user who already holds a ticket
  for the same event be blocked? Requirements are silent on this.

---

## Implementation Sequence

1. **Fix `capacity.ts`** — move event decrement outside the seatTierId
   guard. One line. Do this first so everything built on top is correct.

2. **Fix `transfer.ts`** — replace inline capacity calls with
   `decrementCapacity` / `incrementCapacity`. Keeps capacity logic
   centralized before the transfer route is wired.

3. **Transfer route** — `POST /api/bookings/:id/transfer` in `bookings.ts`,
   recipient lookup by email, call existing utility.

4. **Transfer frontend** — form on the ticket detail page, visible only for
   CONFIRMED bookings, redirect to `/bookings` on success.

5. **Waitlist endpoints** — join, leave, position in `waitlist.ts`, register
   router in `index.ts`.

6. **Waitlist auto-promotion** — hook into cancellation handler in
   `bookings.ts` inside the same transaction.

7. **Waitlist frontend** — sold-out detection on event detail page, join /
   leave buttons, position display.

8. **Screenshots** — all 10 acceptance tests captured and placed in
   `submission/`.


find frontend/src -type f -name "*.tsx" | xargs grep -l -i "transfer\|qr\|ticketCode" 2>/dev/null