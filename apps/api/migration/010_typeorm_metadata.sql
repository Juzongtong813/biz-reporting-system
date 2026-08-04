-- TypeORM metadata required by the MySQL schema builder at application startup.
-- Forward-only compatibility migration; existing migrations are immutable.

CREATE TABLE typeorm_metadata (
  `type` VARCHAR(255) NOT NULL,
  `database` VARCHAR(255) NULL,
  `schema` VARCHAR(255) NULL,
  `table` VARCHAR(255) NULL,
  `name` VARCHAR(255) NULL,
  `value` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
