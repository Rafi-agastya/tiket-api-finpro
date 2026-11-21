CREATE TABLE payment_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  order_id          BIGINT,
  status            TEXT NOT NULL,
  outcome           TEXT,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);