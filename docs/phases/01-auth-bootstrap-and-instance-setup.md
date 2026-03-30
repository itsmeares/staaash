# Phase 01: Auth, Bootstrap, and Instance Setup

## Approach

Build the instance identity model first so every later phase sits on real owner/member boundaries instead of temporary stubs.

## Scope

- In:
  - one-time `/setup`
  - owner creation
  - local email/password auth
  - opaque DB sessions
  - sign-in and sign-out
  - invite issue/redeem/revoke/reissue
  - owner-assisted reset baseline
- Out:
  - OAuth
  - open signup
  - full multi-device session management

## Dependencies

- Phase 00 complete

## Action Items

- [ ] Extend the Prisma schema for `Instance`, `User`, `Session`, and `Invite` with the exact auth requirements.
- [ ] Add password hashing and token generation modules under `apps/web/server`.
- [ ] Implement one-time bootstrap logic that creates the instance and first owner, then disables `/setup`.
- [ ] Implement sign-in and sign-out route handlers with HTTP-only cookie sessions.
- [ ] Implement invite creation, redemption, revoke, and reissue flows for owner-issued invites only.
- [ ] Add route guards for owner-only and signed-in-only surfaces.
- [ ] Add owner-assisted password reset scaffolding without SMTP dependency.
- [ ] Add tests for bootstrap-once behavior, sign-in, sign-out, and invite redemption.

## Validation

- Verify `/setup` works exactly once.
- Verify invited users can activate accounts.
- Verify members cannot access `/admin`.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The app has a real instance owner and member model.
- Sessions are DB-backed and safe-by-default.
- No later phase depends on fake auth placeholders.
