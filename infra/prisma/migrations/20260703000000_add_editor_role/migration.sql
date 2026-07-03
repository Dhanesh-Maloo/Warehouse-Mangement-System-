-- Add 'editor' value to the UserRole enum: can create/edit records for their
-- own client only; never delete, deactivate, or approve anything.
ALTER TYPE "UserRole" ADD VALUE 'editor';
