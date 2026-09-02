-- Drop the "(Blanco)" wording from rate card descriptions — display text
-- only, doesn't touch pricing/versioning, so updated in place rather than
-- creating a new rate version.
UPDATE "rate_card_items" SET "description" = 'Certified Data Destruction'
  WHERE "code" = 'DISPOSAL_CERTIFIED' AND "description" = 'Certified Data Destruction (Blanco)';

UPDATE "rate_card_items" SET "description" = 'Data Wipe - Certified Data Destruction'
  WHERE "code" = 'RETRIEVAL_WIPE_CERTIFIED' AND "description" = 'Data Wipe - Certified Data Destruction (Blanco)';
