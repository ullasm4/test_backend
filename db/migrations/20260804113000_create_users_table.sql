-- migrate:up

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Default admin: phone 1234567890 / password 123123
INSERT INTO users (name, email, phone, password_hash, role)
VALUES (
    'Admin',
    'admin@example.com',
    '1234567890',
    '$2b$10$7pexePtWJF7VbmY1b1btCOtlngpAyGfZqhW8JbhT.nUcuvGrDHrDy',
    'admin'
)
ON CONFLICT DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS users;
