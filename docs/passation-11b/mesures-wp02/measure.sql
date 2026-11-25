-- Mesure : 50 exécutions par requête, sous cashless_app (RLS active), p95 en ms. Usage : psql -d cashless_wp02 -f measure.sql
\set QUIET 1
SET ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000000f001', false);
DO $d$ DECLARE n text; s text; t timestamptz; ms numeric[]; i int; qs text[][] := ARRAY[
  ARRAY['page1', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$],
  ARRAY['cursor_deep', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' AND (occurred_at, transaction_id) < ('2026-06-10 00:00+00', 'ffffffff-ffff-ffff-ffff-ffffffffffff') ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$],
  ARRAY['pos', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' AND pos_id = '00000000-0000-0000-0000-0000000f5003' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$],
  ARRAY['merchant', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' AND merchant_id = '00000000-0000-0000-0000-0000000f2005' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$],
  ARRAY['range', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' AND occurred_at >= '2026-06-15' AND occurred_at < '2026-06-16' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$],
  ARRAY['reversed', $q$SELECT * FROM sale_overview WHERE event_id = '00000000-0000-0000-0000-00000000fd01' AND reversal_transaction_id IS NOT NULL ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51$q$]
]; BEGIN
 FOR k IN 1..array_length(qs, 1) LOOP
   n := qs[k][1]; s := qs[k][2]; ms := '{}';
   FOR i IN 1..50 LOOP t := clock_timestamp(); EXECUTE s; ms := ms || (extract(epoch FROM clock_timestamp() - t) * 1000)::numeric; END LOOP;
   RAISE NOTICE '% p50=% ms p95=% ms max=% ms', rpad(n, 12), round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) FROM unnest(ms) x)::numeric, 2),
     round((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY x) FROM unnest(ms) x)::numeric, 2), round((SELECT max(x) FROM unnest(ms) x), 2);
 END LOOP; END $d$;
