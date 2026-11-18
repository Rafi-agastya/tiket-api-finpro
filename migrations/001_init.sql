CREATE TABLE users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  venue       TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_types (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id  BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  price     INTEGER NOT NULL CHECK (price >= 0),
  quota     INTEGER NOT NULL CHECK (quota > 0),
  held      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT held_dalam_batas CHECK (held >= 0 AND held <= quota),
  UNIQUE (event_id, name)
);

CREATE TABLE orders (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id       BIGINT NOT NULL REFERENCES users(id),
  event_id       BIGINT NOT NULL REFERENCES events(id),
  ticket_type_id BIGINT NOT NULL REFERENCES ticket_types(id),
  qty            INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 4),
  total_price    INTEGER NOT NULL CHECK (total_price >= 0),
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED')),
  expires_at     TIMESTAMPTZ NOT NULL,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_buyer_event_idx ON orders (buyer_id, event_id);
CREATE INDEX orders_pending_expiry_idx ON orders (expires_at) WHERE status = 'PENDING';

CREATE TABLE tickets (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id),
  seq        INTEGER NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);