-- Esquema inicial. Instantes em UTC (timestamptz); dinheiro em centavos inteiros (bigint), moeda BRL.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────── Identidade ─────────────
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  birth_date date NOT NULL,
  cpf_enc text NOT NULL,                 -- CPF cifrado; nunca em claro
  cpf_index text NOT NULL UNIQUE,        -- índice cego para unicidade
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  is_support boolean NOT NULL DEFAULT false,
  phone_verified_at timestamptz,
  identity_status text NOT NULL DEFAULT 'unverified' CHECK (identity_status IN ('unverified','verified','failed')),
  active_mode text NOT NULL DEFAULT 'client' CHECK (active_mode IN ('client','worker')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE rate_limits (
  scope text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
);

CREATE TABLE phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('verified','failed')),
  checked_at timestamptz NOT NULL
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),   -- responsável humano (PROPOSTA)
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  cnpj_enc text NOT NULL,
  cnpj_index text NOT NULL UNIQUE,
  approval_status text NOT NULL DEFAULT 'pending_review' CHECK (approval_status IN ('pending_review','approved','rejected')),
  review_reason text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  reason text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_resource_idx ON audit_events(resource_type, resource_id);

CREATE TABLE policy_versions (
  version int PRIMARY KEY,
  status text NOT NULL,
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  dedupe_key text NOT NULL UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key, user_id)
);

-- ───────────── Catálogo, perfil e disponibilidade ─────────────
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  feature_flag text,                      -- NULL = sempre habilitada; senão exige flag operacional ligada
  requires_credential boolean NOT NULL DEFAULT false,
  max_radius_km int NOT NULL DEFAULT 30 CHECK (max_radius_km > 0),
  suggested_price_cents bigint NOT NULL CHECK (suggested_price_cents >= 0), -- tabela demonstrativa (O09)
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  slug text NOT NULL,
  name text NOT NULL,
  UNIQUE (category_id, slug)
);

CREATE TABLE worker_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  bio text NOT NULL DEFAULT '',
  experience text NOT NULL DEFAULT '',
  radius_km int NOT NULL DEFAULT 10 CHECK (radius_km BETWEEN 1 AND 200),
  city text NOT NULL,
  uf char(2) NOT NULL,
  lat double precision,                   -- localização privada
  lng double precision,
  online_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_skills (
  user_id uuid NOT NULL REFERENCES worker_profiles(user_id),
  category_id uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE worker_tags (
  user_id uuid NOT NULL REFERENCES worker_profiles(user_id),
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (user_id, tag_id)
);

CREATE TABLE availability_blocks (        -- períodos indisponíveis informados pelo trabalhador
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES users(id),
  during tstzrange NOT NULL CHECK (NOT isempty(during)),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX availability_blocks_idx ON availability_blocks USING gist (worker_id, during);

-- ───────────── Pedidos, propostas e chat ─────────────
CREATE TABLE service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  category_id uuid NOT NULL REFERENCES categories(id),
  kind text NOT NULL CHECK (kind IN ('urgent','scheduled')),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
  materials text NOT NULL DEFAULT '',
  seats int NOT NULL CHECK (seats BETWEEN 1 AND 50),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),       -- por profissional (fixo) ou por hora
  billing_unit text NOT NULL CHECK (billing_unit IN ('fixed','hour')),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  payment_kind text NOT NULL CHECK (payment_kind IN ('digital','cash')),
  starts_at timestamptz,                                       -- agendado: início; urgente: publicação
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 15 AND 20160),
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','expired','cancelled')),
  published_at timestamptz,
  expires_at timestamptz,
  cycle int NOT NULL DEFAULT 0,
  wave int NOT NULL DEFAULT 0,
  next_wave_at timestamptz,
  version int NOT NULL DEFAULT 1,
  -- localização pública aproximada
  area text NOT NULL,
  city text NOT NULL,
  uf char(2) NOT NULL,
  approx_lat double precision,
  approx_lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_requests_owner_idx ON service_requests(owner_id);
CREATE INDEX service_requests_status_idx ON service_requests(status, expires_at);

CREATE TABLE request_locations (          -- endereço exato: privado, só partes de contrato confirmado
  request_id uuid PRIMARY KEY REFERENCES service_requests(id),
  street text NOT NULL,
  number text NOT NULL DEFAULT '',
  complement text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  lat double precision,
  lng double precision
);

CREATE TABLE request_tags (
  request_id uuid NOT NULL REFERENCES service_requests(id),
  tag_id uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (request_id, tag_id)
);

CREATE TABLE request_dispatches (         -- distribuição em grupos; deduplica alertas por pedido/trabalhador
  request_id uuid NOT NULL REFERENCES service_requests(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  wave int NOT NULL,
  cycle int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, worker_id)
);
CREATE INDEX request_dispatches_worker_idx ON request_dispatches(worker_id);

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES service_requests(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('submitted','countered','accepted','rejected','withdrawn','expired')),
  current_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- no máximo uma negociação viva por trabalhador em cada pedido
CREATE UNIQUE INDEX proposals_live_idx ON proposals(request_id, worker_id) WHERE status IN ('submitted','countered','accepted');
CREATE INDEX proposals_worker_idx ON proposals(worker_id);

CREATE TABLE proposal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  version_no int NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  billing_unit text NOT NULL CHECK (billing_unit IN ('fixed','hour')),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  scope text NOT NULL CHECK (length(scope) BETWEEN 3 AND 2000),
  worker_agreed_at timestamptz,          -- trabalhador concorda com esta versão exata (não contrata)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, version_no)
);

CREATE TABLE conversations (              -- ACL: somente contratante e este candidato
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES service_requests(id),
  client_id uuid NOT NULL REFERENCES users(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, worker_id),
  CHECK (client_id <> worker_id)
);

CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages(conversation_id, id);

-- ───────────── Contratos, agenda e execução ─────────────
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES service_requests(id),
  client_id uuid NOT NULL REFERENCES users(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  accepted_version_id uuid NOT NULL REFERENCES proposal_versions(id),
  status text NOT NULL CHECK (status IN ('awaiting_funding','confirmed','en_route','in_progress','completion_requested','completed','cancelled')),
  payment_mode text NOT NULL CHECK (payment_mode IN ('pix','card','wallet','cash')),
  billing_unit text NOT NULL CHECK (billing_unit IN ('fixed','hour')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),      -- preço fixo ou tarifa/hora da versão aceita
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),      -- teto autorizado
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  kind text NOT NULL CHECK (kind IN ('urgent','scheduled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  policy_version int NOT NULL REFERENCES policy_versions(version),
  policy_snapshot jsonb NOT NULL,                              -- regras e comissão vigentes na contratação
  confirmed_at timestamptz,
  departed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (worker_id <> client_id),                              -- sem autocontratação
  CHECK (ends_at > starts_at),
  UNIQUE (request_id, accepted_version_id)
);
-- mesmo trabalhador não ocupa duas vagas vivas no mesmo pedido
CREATE UNIQUE INDEX contracts_live_worker_idx ON contracts(request_id, worker_id) WHERE status <> 'cancelled';
CREATE INDEX contracts_client_idx ON contracts(client_id);
CREATE INDEX contracts_worker_idx ON contracts(worker_id);

CREATE TABLE schedule_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES users(id),
  contract_id uuid NOT NULL UNIQUE REFERENCES contracts(id),
  during tstzrange NOT NULL CHECK (NOT isempty(during)),
  state text NOT NULL CHECK (state IN ('held','confirmed','released','expired')),
  expires_at timestamptz,                                      -- só para reservas temporárias (held)
  -- agenda sem sobreposição e sem buffer: intervalos [início, fim) do mesmo trabalhador não se cruzam
  EXCLUDE USING gist (worker_id WITH =, during WITH &&) WHERE (state IN ('held','confirmed'))
);

CREATE TABLE work_units (                 -- unidade de pagamento
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  kind text NOT NULL DEFAULT 'service' CHECK (kind IN ('service','milestone','week')),
  seq int NOT NULL DEFAULT 1,
  scope text NOT NULL,
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),
  funded_cents bigint NOT NULL DEFAULT 0 CHECK (funded_cents >= 0),
  status text NOT NULL CHECK (status IN (
    'planned','awaiting_funding','funded','in_progress','submitted','approved','released','disputed','resolved','cancelled',
    'external_due','external_reported','external_confirmed')),
  status_before_dispute text,
  summary text,
  reported_minutes int CHECK (reported_minutes > 0),
  pending_correction_minutes int CHECK (pending_correction_minutes >= 0),  -- alteração material pendente
  submitted_at timestamptz,
  deadline_at timestamptz,
  released_at timestamptz,
  released_worker_cents bigint,
  released_fee_cents bigint,
  refunded_cents bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, seq)
);
CREATE INDEX work_units_deadline_idx ON work_units(deadline_at) WHERE status = 'submitted';

CREATE TABLE work_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES work_units(id),
  author_id uuid NOT NULL REFERENCES users(id),
  work_date date NOT NULL,
  minutes int NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_confirmations (         -- pagamento externo confirmado por cada parte
  contract_id uuid NOT NULL REFERENCES contracts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (contract_id, user_id)
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES work_units(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text CHECK (resolution IN ('release','refund','partial')),
  worker_cents bigint CHECK (worker_cents >= 0),
  resolved_by uuid REFERENCES users(id),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX disputes_open_unit_idx ON disputes(unit_id) WHERE status = 'open';

CREATE TABLE dispute_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES disputes(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cancellations (
  contract_id uuid PRIMARY KEY REFERENCES contracts(id),
  cancelled_by uuid REFERENCES users(id),                      -- NULL = sistema
  responsible text NOT NULL CHECK (responsible IN ('client','worker','none')),
  kind text NOT NULL CHECK (kind IN ('free','penalty','no_show','funding_timeout','dispute_refund')),
  reason text NOT NULL DEFAULT '',
  policy_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL UNIQUE REFERENCES contracts(id),  -- uma multa por fato/unidade afetada, sem duplicação
  unit_id uuid NOT NULL REFERENCES work_units(id),
  user_id uuid NOT NULL REFERENCES users(id),                  -- parte responsável
  beneficiary_id uuid NOT NULL REFERENCES users(id),           -- parte prejudicada (PROPOSTA R30)
  kind text NOT NULL CHECK (kind IN ('cancellation','no_show')),
  base_cents bigint NOT NULL CHECK (base_cents >= 0),
  bps int NOT NULL CHECK (bps BETWEEN 0 AND 10000),
  cap_cents bigint NOT NULL CHECK (cap_cents >= 0),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  settlement text NOT NULL CHECK (settlement IN ('from_reserve','debt')),
  policy_version int NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','voided')),
  void_reason text,
  voided_by uuid REFERENCES users(id),
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX penalties_user_idx ON penalties(user_id, created_at);

CREATE TABLE penalty_reviews (            -- análise após três multas válidas em 12 meses; nunca banimento automático
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  triggered_by uuid NOT NULL REFERENCES penalties(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  decision text CHECK (decision IN ('no_action','blocked')),
  note text,
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX penalty_reviews_open_idx ON penalty_reviews(user_id) WHERE status = 'open';

-- ───────────── Pagamentos e ledger ─────────────
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES work_units(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  payer_id uuid NOT NULL REFERENCES users(id),
  method text NOT NULL CHECK (method IN ('pix','card')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  provider text NOT NULL,
  provider_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','late_reconciled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (provider, provider_ref)
);
CREATE INDEX payments_unit_idx ON payments(unit_id);

CREATE TABLE provider_events (            -- caixa de entrada de webhooks: gravado antes de processar
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'provider_clearing','client_wallet','unit_reserve','worker_earnings','payout_transit','provider_payout',
    'fee_revenue','penalty_debt','penalty_receivable','reconciliation')),
  user_id uuid REFERENCES users(id),
  unit_id uuid REFERENCES work_units(id),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  balance_cents bigint NOT NULL DEFAULT 0,                     -- cache derivado dos lançamentos (trigger)
  allow_negative boolean NOT NULL DEFAULT false,
  CONSTRAINT ledger_accounts_balance_nonneg CHECK (allow_negative OR balance_cents >= 0)
);
CREATE UNIQUE INDEX ledger_accounts_user_idx ON ledger_accounts(kind, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_unit_idx ON ledger_accounts(kind, unit_id) WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_system_idx ON ledger_accounts(kind) WHERE user_id IS NULL AND unit_id IS NULL;

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  reverses_tx_id uuid REFERENCES ledger_transactions(id),      -- estorno referencia o original
  memo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_tx_ref_idx ON ledger_transactions(reference_type, reference_id);

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  tx_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),      -- >0 crédito na conta, <0 débito
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries(account_id, id);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries(tx_id);

-- Ledger imutável: nenhuma alteração ou exclusão de lançamentos.
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger é append-only (%)', TG_TABLE_NAME;
END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Saldo em cache atualizado pelo próprio lançamento; o CHECK da conta impede saldo negativo indevido.
CREATE FUNCTION ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ledger_accounts SET balance_cents = balance_cents + NEW.amount_cents WHERE id = NEW.account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_apply AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- Partidas balanceadas: a soma de cada transação deve ser zero ao confirmar.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount_cents), 0) FROM ledger_entries WHERE tx_id = NEW.tx_id) <> 0 THEN
    RAISE EXCEPTION 'transação de ledger desbalanceada: %', NEW.tx_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed')),
  idempotency_key text NOT NULL,
  provider text,
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id),
  unit_id uuid REFERENCES work_units(id),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  destination text NOT NULL CHECK (destination IN ('wallet','origin')),
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mock_provider_objects (      -- estado interno do provedor SIMULADO; não existe fora de dev/teste
  ref text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('payment','payout')),
  amount_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  pending_event jsonb,
  deliver_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Avaliações e proteção ─────────────
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  author_id uuid NOT NULL REFERENCES users(id),
  target_id uuid NOT NULL REFERENCES users(id),
  target_role text NOT NULL CHECK (target_role IN ('worker','client')),  -- reputação por papel (P05)
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  punctuality int CHECK (punctuality BETWEEN 1 AND 5),
  quality int CHECK (quality BETWEEN 1 AND 5),
  communication int CHECK (communication BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  submitted_at timestamptz NOT NULL,
  published_at timestamptz,               -- só preenchido quando ambas as partes avaliaram
  UNIQUE (contract_id, author_id),
  CHECK (author_id <> target_id)
);
CREATE INDEX reviews_target_idx ON reviews(target_id) WHERE published_at IS NOT NULL;

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id),
  blocked_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id),
  contract_id uuid REFERENCES contracts(id),
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  resolution_note text,
  handled_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
