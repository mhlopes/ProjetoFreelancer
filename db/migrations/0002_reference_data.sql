-- Dados de referência: catálogo controlado e política demonstrativa (specs/politicas.example.json).
-- Preços sugeridos são uma TABELA DEMONSTRATIVA (O09), não preço de mercado.

INSERT INTO categories (slug, name, feature_flag, requires_credential, max_radius_km, suggested_price_cents, sort) VALUES
  ('limpeza',           'Limpeza',                NULL,        false, 30, 15000, 1),
  ('pequenos-reparos',  'Pequenos reparos',       NULL,        false, 30, 12000, 2),
  ('jardinagem',        'Jardinagem',             NULL,        false, 30, 13000, 3),
  ('carga-mudanca',     'Carga e mudança',        NULL,        false, 40, 18000, 4),
  ('eventos',           'Eventos e garçom',       NULL,        false, 40, 16000, 5),
  ('entregas',          'Entregas locais',        'delivery',  false, 20,  3000, 6),
  ('seguranca',         'Segurança',              'security',  true,  40, 20000, 7),
  ('transporte',        'Transporte particular',  'transport', true,  50,  4000, 8);

INSERT INTO tags (category_id, slug, name)
SELECT c.id, t.slug, t.name FROM categories c JOIN (VALUES
  ('limpeza', 'residencial', 'Residencial'),
  ('limpeza', 'pos-obra', 'Pós-obra'),
  ('limpeza', 'comercial', 'Comercial'),
  ('limpeza', 'vidros', 'Vidros'),
  ('pequenos-reparos', 'eletrica', 'Elétrica'),
  ('pequenos-reparos', 'hidraulica', 'Hidráulica'),
  ('pequenos-reparos', 'montagem-moveis', 'Montagem de móveis'),
  ('pequenos-reparos', 'pintura', 'Pintura'),
  ('jardinagem', 'poda', 'Poda'),
  ('jardinagem', 'corte-grama', 'Corte de grama'),
  ('carga-mudanca', 'ajudante', 'Ajudante'),
  ('carga-mudanca', 'embalagem', 'Embalagem'),
  ('eventos', 'garcom', 'Garçom'),
  ('eventos', 'bartender', 'Bartender'),
  ('eventos', 'montagem', 'Montagem de evento')
) AS t(cat, slug, name) ON t.cat = c.slug;

-- Política v1: status draft, não vale para produção. "approved" veio da entrevista; "proposed" aguarda ratificação (O04).
INSERT INTO policy_versions (version, status, params) VALUES (1, 'draft_not_for_production', '{
  "requestExpiryHours": 3,
  "completionConfirmationHours": 24,
  "penaltyReviewCount": 3,
  "penaltyLookbackCalendarMonths": 12,
  "scheduledFreeCancellationBeforeHours": 24,
  "scheduledBookingGraceMinutes": 30,
  "noShowWaitMinutes": 15,
  "cancellationPenaltyBps": 1000,
  "cancellationCapCents": 10000,
  "noShowPenaltyBps": 2000,
  "noShowCapCents": 20000,
  "fundingReservationMinutes": 15,
  "matchingBatchSize": 10,
  "matchingBatchIntervalSeconds": 60,
  "matchingInitialRadiusKm": 5
}');
