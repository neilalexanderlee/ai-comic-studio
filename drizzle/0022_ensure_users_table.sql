-- Ensure users table exists (fixes 0021 which failed due to statement-breakpoint parsing)
CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL UNIQUE,
  `password_hash` text NOT NULL,
  `created_at` integer NOT NULL
);
