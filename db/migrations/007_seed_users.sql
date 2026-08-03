-- migrate:up

-- Note: some databases already have a `users` table with a different schema.
-- To avoid conflicts, we seed into `demo_users` used by this backend.

CREATE TABLE IF NOT EXISTS demo_users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(100) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_users_email ON demo_users (email);

INSERT INTO demo_users (name, email, role) VALUES
  ('Mukesh Chaudhary', 'mukesh.chaudhary@example.com', 'admin')
ON CONFLICT (email) DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS demo_users;

