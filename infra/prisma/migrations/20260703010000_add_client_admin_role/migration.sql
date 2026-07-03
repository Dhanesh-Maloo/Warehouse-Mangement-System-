-- Add 'client_admin' value to the UserRole enum: full control (including
-- delete/approve/user management) but fenced to a single client.
ALTER TYPE "UserRole" ADD VALUE 'client_admin';
