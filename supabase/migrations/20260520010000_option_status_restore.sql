-- ============================================================================
-- Migration 20260520010000 — restore option's full status vocabulary
--
-- v5_1_wave2_followups (20260518000300) narrowed the option branch of
-- `chk_activity_status_by_type` to ('open','closed'). But:
--
--   * src/app/add/option/db.ts writes 'expired' (when every leg's expiry is
--     in the past at submit time) and 'unwinding' (when the user is mid-
--     close).
--   * src/lib/db/zod-schemas.ts accepts 'expired' / 'unwinding' on the
--     wizard's status field.
--
-- The narrower constraint trips every option submit that isn't a fresh
-- 'open' or fully closed entry — i.e. the worker can't flip expired,
-- and the user can't journal a position in the middle of an unwind.
--
-- This migration restores the option allowlist to the v5 set
-- ('open','unwinding','expired','closed') while leaving every other
-- activity_type's vocabulary untouched. Reversible: drop the constraint
-- and re-create it with the narrower 2-value option list to undo.
-- ============================================================================

alter table public.activity drop constraint if exists chk_activity_status_by_type;

alter table public.activity add constraint chk_activity_status_by_type check (
  (type = 'spread'         and status in ('open','winding_down','orphaned','expired','closed')) or
  (type = 'trade'          and status in ('open','liquidated','closed'))                        or
  (type = 'sale'           and status in ('pending','vesting','closed'))                        or
  (type = 'airdrop'        and status in ('pending','claimed','closed'))                        or
  (type = 'yield_position' and status in ('pending','open','unwinding','closed'))               or
  (type = 'option'         and status in ('open','unwinding','expired','closed'))
);
