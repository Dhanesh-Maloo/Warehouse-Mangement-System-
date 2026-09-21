-- Invite-based registration for client-scoped users (client_user / editor /
-- client_admin). An admin or client_admin creates the account with no
-- password; the invited person sets their own password via a one-time,
-- expiring token emailed to them (POST /auth/register).

-- Domains allowed to self-register against a given client, e.g. "esevel.com".
-- Empty array (the default) means the domain check is skipped for that
-- client, so existing clients are unaffected until an admin configures this.
ALTER TABLE "clients" ADD COLUMN "allowed_email_domains" TEXT[] NOT NULL DEFAULT '{}';

-- password_hash becomes optional: an invited user has none until they
-- complete registration.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "invite_token" TEXT;
ALTER TABLE "users" ADD COLUMN "invite_token_expires_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX "users_invite_token_key" ON "users"("invite_token");

-- Add the new status value. Existing rows are untouched — every current
-- user already has a password and stays 'active' or 'suspended'.
ALTER TYPE "UserStatus" ADD VALUE 'invited';
