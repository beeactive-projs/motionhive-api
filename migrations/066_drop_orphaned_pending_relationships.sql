-- 066: delete orphaned PENDING rows from instructor_client.
--
-- A pending relationship is a `client_request` row. `instructor_client` holds
-- the settled relationship — ACTIVE or ARCHIVED. The code that wrote PENDING
-- rows there was removed when the invitation flow moved (it survives only as
-- a commented block in ClientService.sendInvitation), so every PENDING row
-- left in this table is an orphan with no request behind it.
--
-- They are not harmless. Such a row:
--   * appeared in `GET /clients` (which fetched every status) but never in
--     `GET /clients?status=PENDING` (which reads client_request), so the
--     coach saw a request they could not open, accept, decline or withdraw;
--   * blocked re-inviting that person — sendInvitation rejects any pair that
--     already has an instructor_client row;
--   * hid that person from `/users/search?excludeConnected=true`, so they
--     could not be found in the invite picker either.
--
-- Deleting is safe: there is no accepted state to preserve. If the pair is
-- still in flight the client_request row carries it; if not, the coach can
-- now invite them again. ACTIVE and ARCHIVED rows are untouched.
--
-- Idempotent: re-running matches nothing once the rows are gone.

BEGIN;

DELETE FROM instructor_client
WHERE status = 'PENDING';

COMMIT;
