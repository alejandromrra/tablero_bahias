-- =====================================================================
-- Tablero de bahías · Reiniciar los datos de ejemplo
-- Borra órdenes, clientes, bloques, pagos, refacciones, ausencias,
-- liquidaciones y operaciones, y reinicia los folios (OT-0001, B-0001).
-- NO toca usuarios, perfiles, técnicos, áreas, catálogo, horario ni configuración.
--
-- Uso (SQL Editor de Supabase): ejecutar este archivo y después supabase/seed.sql
-- completo. Las órdenes de ejemplo quedan fechadas en la semana actual.
-- =====================================================================
truncate public.orden, public.cliente, public.operacion, public.liquidacion,
         public.ausencia, public.bloque, public.registro_tiempo cascade;
alter sequence public.orden_folio_seq restart;
alter sequence public.bloque_folio_seq restart;
