# Tablero de bahías

Sistema de piso para un taller de colisión: reparte cada etapa de reparación entre las bahías, la única cabina de pintura y los técnicos **sin que nadie quede en dos autos a la vez**. Calcula el presupuesto, respeta la secuencia de etapas y los tiempos de curado, y le muestra a la gerencia cuántas horas vendió y cuánto ganó en la semana. Interfaz en español rioplatense, montos en pesos mexicanos, datos sintéticos.

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Supabase (Auth, RLS y funciones de base de datos). Es la misma base que usa Lovable, así que el repo se importa tal cual.

**Identidad visual:** grafito `#1F2933`, fondo `#F4F5F7`, blanco `#FFFFFF`; naranja de seguridad `#F26B1D` reservado para conflictos y atrasos; un color por área (`#3E7CB1`, `#6FA8D6`, `#8E5BB5`, `#2F9E6E`, `#2A8C99`). Tipografías Oswald (títulos) y Source Sans 3 (texto).

## Pantallas (13)

| Ruta | Pantalla | Roles |
|---|---|---|
| `/login` | Ingreso con cuentas de prueba (sin confirmación ni recuperación por correo) | todos |
| `/planificador` | Grilla semanal: filas por área (con tira de lugares libres), columnas de 30 min, franjas cerradas sombreadas, fichas por área/estado. «Por programar» para arrastrar etapas; las fichas se arrastran para moverlas. «Programar bloque» y «Actualizar» ante conflicto | gerencia, asesor |
| `/ordenes` | Lista: folio, placa, cliente, estado, etapa actual, fecha prometida, flag «Atrasada» | gerencia, asesor |
| `/ordenes/:id` | Detalle: etapas en secuencia con sus tramos, curado, refacciones; emitir/autorizar presupuesto, control de calidad, entregar, cancelar; «Compartir por WhatsApp», «Descargar .ics», «Copiar texto» | gerencia, asesor |
| `/ordenes/nueva` | Recepción: cliente, placa, Particular/Aseguradora, piezas con daño (Leve/Medio/Fuerte/Reemplazo), deducible | gerencia, asesor |
| `/ordenes/:id/presupuesto` | Horas vendidas, mano de obra, materiales, refacciones (costo +15%), subtotal, IVA 16%, total, anticipo 50%, deducible y saldo de aseguradora aparte; margen solo para gerencia | gerencia, asesor |
| `/pagos` | Anticipo, saldo, deducible o pago de aseguradora (op_id idempotente) | gerencia, asesor |
| `/refacciones` | Alta con costo, «Marcar Recibida» (costo y margen solo para gerencia) | gerencia, asesor |
| `/tecnico` | Vista técnico en celular: una columna, botones grandes «En curso», «Pausar», «Terminar», sin importes | técnico (gerencia puede elegir técnico) |
| `/liquidacion` | Horas vendidas y productivas, pago, bono $60 por hora productiva sobre 30; cierre en solo lectura | gerencia |
| `/configuracion` | Tarifas, horario del taller, horas por etapa, áreas, técnicos, ausencias, mantenimiento, usuarios (rol de solo lectura) | gerencia |
| `/consulta` | Consulta pública con folio + placa: etapa actual, fecha prometida y saldo | público |
| `/panel` | Horas vendidas, ganancia de la semana, pago a técnicos, ocupación por área, atrasos | gerencia |

## Dónde está cada cosa

```
├── src/
│   ├── main.tsx, App.tsx        entrada, rutas y permisos por rol
│   ├── pages/                   las 13 pantallas (Login, Planificador, Ordenes, OrdenDetalle,
│   │                            NuevaOrden, Presupuesto, Pagos, Refacciones, VistaTecnico,
│   │                            Liquidacion, Configuracion, ConsultaPublica, Panel)
│   ├── components/              Layout (menú lateral) y ui (botones, avisos, estados)
│   └── lib/                     supabase.ts (cliente con clave anon), op.ts (llamada a operar()
│                                con op_id e idempotencia), auth.tsx (sesión y rol), format.ts
│                                (MXN, fechas en zona del taller), ics.ts (archivo .ics)
├── supabase/
│   ├── migrations/              1 esquema y restricciones · 2 funciones de BD · 3 permisos y RLS
│   ├── seed.sql                 datos de ejemplo (SQL de preparación)
│   ├── reiniciar_datos.sql      borra los datos de ejemplo para volver a sembrarlos
│   ├── tests/                   pruebas SQL de aceptación y carrera de dos sesiones
│   └── config.toml              configuración para la CLI de Supabase en local
├── scripts/                     db-local.sh (pruebas SQL), verificar-rls.mjs, verificar-proyecto.mjs,
│                                carrera-cabina.mjs (prueba guiada por la API)
├── .github/workflows/pages.yml  publicación en GitHub Pages
└── .env.example                 variables que necesita el front (URL y clave anon)
```

Toda la lógica de negocio vive en la base (`supabase/migrations/20261120000002_funciones.sql`): el front solo muestra datos y llama a `public.operar()`.

## Qué está simulado

La app no se integra con servicios externos, como pide el encargo:

| Funcionalidad | Cómo se comporta |
|---|---|
| **Correos** | No se envía ningún correo. Las cuentas de prueba ya vienen confirmadas y no hay recuperación de contraseña por correo. |
| **Pagos** | No hay pasarela. «Pagos» registra a mano un anticipo, saldo, deducible o pago de aseguradora, como si el asesor cobrara en caja. Cada registro lleva un `op_id`: repetirlo no cobra dos veces. |
| **WhatsApp** | «Compartir por WhatsApp» abre `wa.me` con el texto armado (estado, fecha prometida, saldo y enlace de seguimiento). La persona tiene que apretar enviar: no hay envíos automáticos ni API de mensajería. |
| **Calendario** | «Descargar .ics» genera el archivo de la cita de entrega en el navegador. No se conecta a ningún calendario. |
| **Copiar texto** | Copia el mismo mensaje al portapapeles, como alternativa local. |
| **Aseguradora** | La autorización del presupuesto la marca el asesor con «Marcar autorizado». No hay conexión con aseguradoras. |
| **Tiempo real del técnico** | Las horas productivas salen de los botones «En curso», «Pausar» y «Terminar». No hay reloj checador. |

Todo lo demás (planificación, reglas, presupuestos, pagos, liquidación, consulta pública) es real y queda guardado en Supabase.

## Datos de ejemplo y cómo reiniciarlos

Los datos de ejemplo se cargan con `supabase/seed.sql` y viven en Supabase, **no en el navegador**. Incluyen:

- 7 cuentas de prueba;
- la configuración, el horario, las 5 áreas, los técnicos A–E y el catálogo del encargo;
- 6 órdenes sintéticas fechadas en la semana en que se corre la semilla:
  - **OT-0001:** caso resuelto, sin anticipo;
  - **OT-0002:** aseguradora con el enderezado partido;
  - **OT-0003:** atrasada;
  - **OT-0004 y OT-0005:** para la prueba guiada;
  - **OT-0006:** de la semana anterior, lista para entrega;
- un mantenimiento y una ausencia.

Para volver al estado inicial (por ejemplo, después de la prueba guiada o para que las fechas caigan en la semana actual), en el **SQL Editor** de Supabase:

1. Ejecutá `supabase/reiniciar_datos.sql`. Borra órdenes, bloques, pagos, refacciones, ausencias y liquidaciones, y reinicia los folios. No toca usuarios, técnicos, áreas, catálogo ni configuración.
2. Ejecutá `supabase/seed.sql` completo.

En local con la CLI alcanza con `supabase db reset`.

El navegador solo guarda la sesión iniciada (clave `tablero-bahias-auth` en el localStorage). Borrar el localStorage o tocar «Cerrar sesión» solo desloguea: no cambia ningún dato.

## Puesta en marcha

### 1. Proyecto Supabase (gratuito)

1. Creá un proyecto en Supabase.
2. **Authentication → Sign In / Providers → Email**: desactivá *Confirm email*. Las cuentas de prueba ya vienen confirmadas y no se usa recuperación por correo.
3. Ejecutá en el **SQL Editor**, en este orden (o `supabase db push` con la CLI vinculada):
   1. `supabase/migrations/20261120000001_esquema.sql`
   2. `supabase/migrations/20261120000002_funciones.sql`
   3. `supabase/migrations/20261120000003_rls.sql`
   4. `supabase/seed.sql`: semilla con el SQL de preparación, copiada al final de este README

Para volver a los datos de ejemplo más adelante, ver «Datos de ejemplo y cómo reiniciarlos».

En local con la CLI alcanza con `supabase start` (aplica migraciones y semilla) o `supabase db reset`.

### 2. Front

```bash
cp .env.example .env.local   # URL y clave anon (Project Settings → API)
npm install
npm run dev                  # http://localhost:8080
```

En **Lovable**: importá este repositorio desde GitHub, conectá la integración de Supabase al proyecto del paso 1 y definí `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

### 3. Publicación en GitHub Pages

URL de previsualización: **https://alejandromrra.github.io/tablero_bahias/**

El workflow `.github/workflows/pages.yml` compila y publica en cada push a `main`. Configuración (una sola vez):

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**:
   - `VITE_SUPABASE_URL` = URL del proyecto, por ejemplo `https://xxxx.supabase.co`.
   - `VITE_SUPABASE_ANON_KEY` = clave pública `anon`. **Nunca** la `service_role`.
3. **Actions → Publicar en GitHub Pages → Run workflow**, o cualquier push a `main`.

La app se compila con `VITE_BASE=/tablero_bahias/`. Una copia de `index.html` como `404.html` permite abrir o recargar cualquier ruta, por ejemplo `/tablero_bahias/planificador`.

### Cuentas de prueba

Contraseña para todas: **`Taller2026!`**. La pantalla de login tiene botones que completan cada cuenta.

| Correo | Rol |
|---|---|
| `gerencia@taller.test` | gerencia: lee y escribe todo |
| `asesor@taller.test` | asesor: órdenes, presupuestos, refacciones, pagos y programación; sin costos por hora ni márgenes |
| `tecnico.a@taller.test` … `tecnico.e@taller.test` | técnico A … E: solo sus bloques y órdenes, sin importes |

El rol vive en `public.perfil` (uno por usuario) y ningún formulario lo elige ni lo cambia.

### Secretos

- El navegador usa **solo** la clave pública `anon`. La `service_role` no está en el repo, la app no la usa y nunca debe ir en una variable `VITE_*` (Vite la embebería en el bundle).
- `.env`, `.env.local` y cualquier `.env.*` están en `.gitignore`; solo se versiona `.env.example`.

## Catálogo y configuración inicial

Todo queda en tablas editables por gerencia (`config`, `config_finanzas`, `horario_taller`, `catalogo_etapa`, `area`, `tecnico`).

- **Horario:** lunes a viernes de 9:00 a 14:00 y de 16:00 a 18:00; sábados de 9:30 a 13:00 (zona `America/Mexico_City`).
- **Etapas en orden:**
  - Desarmado: 0,5 h por pieza, área de armado, especialidad armado.
  - Enderezado: 1 / 2,5 / 4 / 0 h según daño Leve / Medio / Fuerte / Reemplazo.
  - Preparación: 1 / 1,5 / 2 / 1 h.
  - Pintura: 0,75 h por pieza, más 1 h de horneado por carga (cabina ocupada, técnico libre).
  - Curado: 12 h calendario, sin área ni técnico.
  - Pulido y armado: 0,75 h por pieza, especialidad pulido o armado.
  - Control de calidad: 0,5 h, lo marca gerencia o el asesor, sin área.
- **Áreas:**

  | Área | Capacidad |
  |---|---|
  | Bahía de enderezado 1 | 1 auto |
  | Bahía de enderezado 2 | 1 auto |
  | Bahía de preparación | 2 autos |
  | Cabina de pintura | 1 carga de hasta 6 piezas de un solo auto |
  | Bahía de armado y pulido | 2 autos |
- **Técnicos:**

  | Técnico | Especialidades | Costo por hora |
  |---|---|---|
  | A | enderezado y armado | $160 |
  | B | enderezado | $150 (no trabaja sábados) |
  | C | preparación y pulido | $140 |
  | D | pintura y preparación | $180 |
  | E | armado y pulido | $130 |
- **Cálculos:**
  - Horas vendidas: suma de desarmado, enderezado, preparación, pintura sin horneado y pulido y armado.
  - Mano de obra: horas vendidas × $450.
  - Materiales: $650 por pieza que pasa por pintura.
  - Refacciones: costo + 15%.
  - IVA: 16% del subtotal. Total = subtotal + IVA.
  - Anticipo: 50% del total en particulares.
  - Aseguradora: el cliente paga el deducible y el resto queda como saldo de la aseguradora, aparte.
  - Margen: subtotal − costo de horas reales de los técnicos − materiales − costo de refacciones.
  - Bono semanal: $60 por cada hora productiva por encima de 30.

**Caso resuelto** (OT-0001 en la semilla): puerta delantera izquierda en daño Medio y salpicadera en Reemplazo, con una refacción de $2.800. Horas vendidas: 1 + 2,5 + 2,5 + 1,5 + 1,5 = 9 h. Mano de obra $4.050, materiales $1.300, refacción $3.220, subtotal $8.570, IVA $1.371,20, **total $9.941,20, anticipo $4.970,60**. Si el horneado termina el jueves a las 17:30, el pulido no puede empezar antes del viernes a las 9:00; ambas cosas están verificadas en las pruebas.

## Cómo está hecho

### Una sola operación de base por acción

Toda escritura pasa por `public.operar(op_id, tipo, payload)`. Eso incluye asignar o mover un bloque, registrar un pago, cerrar la liquidación, recibir un vehículo, recibir refacciones, el avance del técnico, el control de calidad, cancelar, entregar y la configuración.

- **Transaccional:** valida rol y estado actual antes de escribir. Si cualquier regla falla, revierte todo y no quedan escrituras parciales.
- **Idempotente por `op_id`:** repetir la llamada devuelve el resultado anterior (`repetida: true`) sin duplicar bloques ni pagos. El front reintenta los cortes de red con el mismo `op_id`.
- **Sin escritura directa:** `anon` y `authenticated` no tienen INSERT, UPDATE ni DELETE sobre ninguna tabla.

### Exclusión por recurso en la base

`bloque` guarda `periodo_area` y `periodo_tecnico` como `tstzrange '[)'` (inicio incluido, fin excluido, más el margen en minutos). La base tiene dos restricciones `EXCLUDE USING gist`: una por área y lugar, otra por técnico.

Dentro de la operación se toman locks consultivos por recurso en orden fijo y se busca el choque antes de insertar. Así el rechazo **nombra el bloque exacto** y sale con SQLSTATE `PT409` (HTTP 409):

> No entra: Cabina de pintura está ocupada hasta las 14:00 del jue 26/11 (bloque B-0022 · OT-0004 · Pintura carga 1 · Técnico D).
> No entra: Técnico E ya tiene un bloque el mar 24/11 de 09:00 a 09:30 en Bahía de armado y pulido (bloque B-0004 · OT-0003 · Desarmado).

Las áreas con capacidad mayor a 1 usan lugares (slots): la grilla muestra cuántos quedan en cada bloque de 30 minutos y marca el hueco lleno. Un mantenimiento ocupa todos los lugares y deja la capacidad en cero en su franja.

### Reglas del planificador

Un bloque se acepta solo si se cumplen **todas** a la vez (`_programar_bloque`):

- **Orden habilitada:** particular con 50% de anticipo pagado, o aseguradora con presupuesto Autorizado.
- **Secuencia:** la etapa anterior está programada y termina antes del inicio, y el bloque no rompe etapas posteriores ya programadas.
- **Técnico:** tiene la especialidad, trabaja ese día, no está ausente y no tiene otro bloque superpuesto.
- **Área:** es del tipo correcto y tiene lugar libre durante todo el bloque. Un mantenimiento la bloquea.
- **Horario:** no se programa fuera del horario del taller. Una etapa larga **se parte** en el corte de mediodía o al final de la jornada y continúa en la siguiente franja hábil, con el mismo técnico y en la misma área (B salta el sábado).
- **Cabina:** una carga de hasta 6 piezas de un solo auto. La orden se parte en cargas al recibirse. El horneado de 1 h deja la cabina ocupada y al técnico libre.
- **Curado:** el pulido espera 12 h calendario desde el fin del horneado, aunque el taller esté cerrado, y el rechazo dice desde cuándo se puede.
- **Refacciones:** «Pulido y armado» no se programa ni empieza con refacciones sin recibir.
- **Liquidación:** una semana liquidada queda en solo lectura.

Mover una ficha es la misma operación con `reprogramar: true`: quita los tramos y vuelve a validar todo en la misma transacción. Si no entra, el bloque original queda intacto.

### Estados

- **Orden:** Recibida → Presupuestada (presupuesto emitido) → Autorizada (habilitada) → En proceso → Esperando refacción (sola, cuando hay refacciones sin recibir y las etapas previas al armado están terminadas) → En proceso al recibir la última → Lista para entrega (al terminar control de calidad) → Entregada (con saldo del cliente en cero). Además, Cancelada, que libera todos los bloques futuros.
- **Etapa:** Pendiente, Programada, En curso, Pausada, Terminada.

### Atraso

Una orden está atrasada si el fin de su última etapa programada supera la fecha prometida, o si ya pasó la fecha sin estar lista. Se marca en naranja en el planificador (ficha y aviso), la lista, el detalle y el panel.

### RLS en todas las tablas

- **Técnico:** solo sus bloques y las órdenes, etapas y piezas donde tiene bloques. No ve presupuestos, pagos, refacciones, clientes ni configuración.
- **Asesor:** no ve costos por hora ni márgenes (`tecnico.tarifa_hora`, `refaccion.costo`, `config_finanzas`, margen, liquidación ni panel).
- **Columnas sensibles** (`tecnico.tarifa_hora`, `refaccion.costo`, `orden.deducible`): sin permiso de SELECT por la API. Se leen con funciones que chequean el rol.
- **Identificadores:** cambiar un id en la petición nunca devuelve filas ajenas.
- **Consulta pública:** `consulta_publica(folio, placa)` es lo único que ejecuta `anon`. Exige folio **y** placa y devuelve solo etapa actual, fecha prometida y saldo. Con un folio ajeno devuelve `null`.

### Compartir

«Compartir por WhatsApp» abre `wa.me` con el texto armado, para que la persona lo envíe a mano. «Descargar .ics» baja la cita de entrega y «Copiar texto» copia el mensaje. No hay envíos automáticos ni API de mensajería.

## Pruebas

### Prueba guiada: dos sesiones compiten por la misma cabina

La semilla deja OT-0004 y OT-0005 con la preparación terminando el jueves a las 11:30 y la pintura pendiente. Es una preparación sintética que no toca el catálogo ni el caso resuelto.

1. Abrí dos navegadores (o uno normal y uno privado). En uno entrá como `gerencia@taller.test` y en el otro como `asesor@taller.test`, los dos en **Planificador**.
2. En los dos: «Programar bloque», jueves 12:00, **Cabina de pintura**, Técnico D (gerencia con OT-0004 · Pintura, asesor con OT-0005 · Pintura). También se puede arrastrar la tarjeta desde «Por programar».
3. Apretá «Programar bloque» en los dos casi a la vez.
4. Una sesión programa. La otra ve el aviso naranja `No entra: Cabina de pintura está ocupada hasta las 14:00 … (bloque B-00xx …)` con el botón «Actualizar», el bloque ganador parpadea en la grilla y la orden rechazada no ocupa técnico, cabina ni bahía.

Por la API, con las dos cuentas en paralelo y solo la clave `anon`:

```bash
npm run carrera
```

### RLS verificada por la API

`npm run rls` entra como `tecnico.a@taller.test` con la clave `anon` y consulta Supabase directamente. Verifica que:

- solo lee sus bloques y sus órdenes;
- `select *` de `orden` falla porque incluye el deducible;
- cambiar el id por el de otra orden devuelve 0 filas;
- presupuestos, pagos, refacciones, clientes y configuración devuelven 0 filas;
- `tarifa_hora` está denegada;
- no puede insertar bloques;
- la consulta pública con un folio ajeno devuelve `null`.

### Verificación de un proyecto ya sembrado (sin escribir datos)

`npm run verificar` se conecta al proyecto de `.env.local` y comprueba la configuración, el catálogo, las áreas, los técnicos, el horario, el caso resuelto, las órdenes programables y el atraso.

También intenta asignaciones que la base tiene que rechazar: sin anticipo, técnico ocupado, etapa anterior, especialidad, cabina ocupada, armado con refacciones pendientes, fuera de horario y ausencia. Muestra el mensaje exacto de cada rechazo y confirma que la cantidad de bloques no cambió. Un rechazo revierte toda la operación, así que el script no deja datos.

### Pruebas de la base de datos

`npm run test:db` (`scripts/db-local.sh`) arma una base en un Postgres 15 o superior local, con un stub mínimo de Supabase, aplica migraciones y semilla, y corre dos archivos.

`supabase/tests/01_pruebas.sql` cubre:

- **Montos y habilitación:** caso resuelto; anticipo; aseguradora sin autorizar.
- **Idempotencia:** pago, asignación y cierre de liquidación.
- **Conflictos y tiempos:** área llena y técnico ocupado con mensaje exacto; fin excluido y margen; secuencia, especialidad, tipo de área y alineación a 30 min; fuera de horario; partición en el corte de mediodía y salto del sábado de B; ausencia; cabina con cargas de 6; horneado; curado de jueves 17:30 a viernes 9:00.
- **Refacciones y estados:** armado bloqueado por refacciones; ciclo Esperando refacción → En proceso → control de calidad → Lista para entrega; entrega con saldo.
- **Mover y cancelar:** mover una ficha sin escrituras parciales; cancelar orden liberando bloques futuros.
- **Permisos:** RLS por rol y para `anon`; consulta pública.
- **Panel y liquidación:** atraso en vista y panel; ganancia por margen; liquidación con bono sobre horas productivas (32 h → $120, 30 h exactas → $0), cierre idempotente y solo lectura.
- **Programable:** solo aparecen como programables las órdenes habilitadas por anticipo o autorización.

Cada rechazo verifica además que no quedaron escrituras parciales.

`supabase/tests/02_carrera.sh` abre dos sesiones `psql` concurrentes. La primera retiene la transacción 2 s, la segunda espera, recibe el conflicto con el folio ganador y no escribe nada.

## Compartir el proyecto

Pendiente para quien administre las cuentas: invitar a **partners@kodarvia.com** como colaborador del repositorio de GitHub, del proyecto de Lovable y de la organización de Supabase.

## Semilla SQL

Es el contenido de [`supabase/seed.sql`](supabase/seed.sql), que es el archivo fuente. Las órdenes de ejemplo se fechan relativas a la semana en que se ejecuta:

- **OT-0001:** caso resuelto.
- **OT-0002:** aseguradora con el enderezado partido en dos tramos.
- **OT-0003:** atrasada, con curado nocturno.
- **OT-0004 y OT-0005:** para la prueba guiada.
- **OT-0006:** de la semana anterior, lista para entrega; alimenta el panel y la liquidación.

<details>
<summary>Ver SQL de semilla</summary>

```sql
-- =====================================================================
-- Tablero de bahías · Semilla (datos sintéticos, MXN)
-- Ejecutar DESPUÉS de las migraciones (supabase db reset lo hace solo,
-- o pegarlo en el SQL Editor del proyecto).
--
-- Cuentas de prueba (contraseña para todas: Taller2026!)
--   gerencia@taller.test   · gerencia
--   asesor@taller.test     · asesor
--   tecnico.a@taller.test … tecnico.e@taller.test · técnico A–E
-- =====================================================================

-- ---------- Configuración (editable por gerencia) ----------
insert into public.config (id) values (1) on conflict (id) do nothing;          -- $450/h, $650 por pieza pintada, IVA 16%, anticipo 50%
insert into public.config_finanzas (id) values (1) on conflict (id) do nothing; -- refacciones +15%, bono $60/h sobre 30 h productivas

-- ---------- Horario del taller ----------
insert into public.horario_taller (dia, inicio, fin)
select d, h.i::time, h.f::time
  from generate_series(1, 5) d, (values ('09:00', '14:00'), ('16:00', '18:00')) h(i, f)
 where not exists (select 1 from public.horario_taller);
insert into public.horario_taller (dia, inicio, fin)
select 6, '09:30', '13:00' where not exists (select 1 from public.horario_taller where dia = 6);

-- ---------- Áreas (un color por área) ----------
insert into public.area (id, nombre, tipo, capacidad, color, orden) values
  ('20000000-0000-4000-8000-000000000001', 'Bahía de enderezado 1',    'enderezado',  1, '#3E7CB1', 1),
  ('20000000-0000-4000-8000-000000000002', 'Bahía de enderezado 2',    'enderezado',  1, '#6FA8D6', 2),
  ('20000000-0000-4000-8000-000000000003', 'Bahía de preparación',     'preparacion', 2, '#8E5BB5', 3),
  ('20000000-0000-4000-8000-000000000004', 'Cabina de pintura',        'cabina',      1, '#2F9E6E', 4),
  ('20000000-0000-4000-8000-000000000005', 'Bahía de armado y pulido', 'armado',      2, '#2A8C99', 5)
on conflict (id) do nothing;

-- ---------- Catálogo de etapas (orden fijo; horas por pieza según daño) ----------
insert into public.catalogo_etapa (tipo, nombre, secuencia, especialidades, area_tipo, programable, vendible, h_leve, h_medio, h_fuerte, h_reemplazo, horas_fijas) values
  ('desarmado',       'Desarmado',          1, '{armado}',        'armado',      true,  true,  0.5,  0.5,  0.5,  0.5,  null),
  ('enderezado',      'Enderezado',         2, '{enderezado}',    'enderezado',  true,  true,  1.0,  2.5,  4.0,  0.0,  null),
  ('preparacion',     'Preparación',        3, '{preparacion}',   'preparacion', true,  true,  1.0,  1.5,  2.0,  1.0,  null),
  ('pintura',         'Pintura',            4, '{pintura}',       'cabina',      true,  true,  0.75, 0.75, 0.75, 0.75, null),
  ('pulido_armado',   'Pulido y armado',    5, '{pulido,armado}', 'armado',      true,  true,  0.75, 0.75, 0.75, 0.75, null),
  ('control_calidad', 'Control de calidad', 6, '{}',              null,          false, false, 0,    0,    0,    0,    0.5)
on conflict (tipo) do nothing;

-- ---------- Técnicos A–E (tarifa = costo por hora) ----------
insert into public.tecnico (id, nombre, especialidades, tarifa_hora, dias_laborables) values
  ('10000000-0000-4000-8000-00000000000a', 'Técnico A', '{enderezado,armado}',   160, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000b', 'Técnico B', '{enderezado}',          150, '{1,2,3,4,5}'),
  ('10000000-0000-4000-8000-00000000000c', 'Técnico C', '{preparacion,pulido}',  140, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000d', 'Técnico D', '{pintura,preparacion}', 180, '{1,2,3,4,5,6}'),
  ('10000000-0000-4000-8000-00000000000e', 'Técnico E', '{armado,pulido}',       130, '{1,2,3,4,5,6}')
on conflict (id) do nothing;

-- ---------- Cuentas de prueba (Supabase Auth, ya confirmadas) ----------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-8000-000000000001'::uuid, 'gerencia@taller.test',  'Marta (Gerencia)', 'gerencia', null::uuid),
      ('00000000-0000-4000-8000-000000000002'::uuid, 'asesor@taller.test',    'Nico (Asesor)',    'asesor',   null::uuid),
      ('00000000-0000-4000-8000-00000000001a'::uuid, 'tecnico.a@taller.test', 'Técnico A',        'tecnico',  '10000000-0000-4000-8000-00000000000a'::uuid),
      ('00000000-0000-4000-8000-00000000001b'::uuid, 'tecnico.b@taller.test', 'Técnico B',        'tecnico',  '10000000-0000-4000-8000-00000000000b'::uuid),
      ('00000000-0000-4000-8000-00000000001c'::uuid, 'tecnico.c@taller.test', 'Técnico C',        'tecnico',  '10000000-0000-4000-8000-00000000000c'::uuid),
      ('00000000-0000-4000-8000-00000000001d'::uuid, 'tecnico.d@taller.test', 'Técnico D',        'tecnico',  '10000000-0000-4000-8000-00000000000d'::uuid),
      ('00000000-0000-4000-8000-00000000001e'::uuid, 'tecnico.e@taller.test', 'Técnico E',        'tecnico',  '10000000-0000-4000-8000-00000000000e'::uuid)
    ) as t(id, email, nombre, rol, tecnico_id)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Taller2026!', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', u.nombre), now(), now(),
            '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now())
    on conflict do nothing;

    insert into public.perfil (user_id, rol, nombre, tecnico_id) values (u.id, u.rol, u.nombre, u.tecnico_id)
    on conflict (user_id) do nothing;
  end loop;
end $$;

-- ---------- Órdenes de ejemplo (fechas relativas a la semana actual; 0 = lunes) ----------
create or replace function pg_temp.t(p_dia int, p_hora text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Mexico_City')::date + p_dia) + p_hora::time)::timestamp
         at time zone 'America/Mexico_City'
$$;

create or replace function pg_temp.prog(p_orden uuid, p_tipo text, p_tec text, p_area text, p_dia int, p_hora text) returns jsonb
language sql as $$
  select public.operar(gen_random_uuid(), 'programar_bloque', jsonb_build_object(
    'etapa_id', (select id from public.etapa where orden_id = p_orden and tipo = p_tipo and carga = 1),
    'tecnico_id', (select id from public.tecnico where nombre = 'Técnico ' || p_tec),
    'area_id', (select id from public.area where nombre = p_area),
    'inicio', pg_temp.t(p_dia, p_hora)))
$$;

create or replace function pg_temp.orden(p_cliente text, p_tel text, p_placa text, p_tipo text, p_prometida timestamptz,
                                         p_piezas jsonb, p_aseg text default null, p_ded numeric default 0) returns uuid
language sql as $$
  select (public.operar(gen_random_uuid(), 'crear_orden', jsonb_build_object(
    'cliente', jsonb_build_object('nombre', p_cliente, 'telefono', p_tel), 'placa', p_placa, 'tipo', p_tipo,
    'aseguradora', p_aseg, 'deducible', p_ded, 'fecha_prometida', p_prometida, 'piezas', p_piezas)) ->> 'orden_id')::uuid
$$;

create or replace function pg_temp.anticipo(p_orden uuid) returns void language sql as $$
  select public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', p_orden));
  select public.operar(gen_random_uuid(), 'registrar_pago', jsonb_build_object('orden_id', p_orden,
    'monto', (select anticipo from public.presupuesto where orden_id = p_orden), 'concepto', 'Anticipo', 'metodo', 'Transferencia'));
$$;

do $$
declare
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid;
  E1 text := 'Bahía de enderezado 1'; E2 text := 'Bahía de enderezado 2'; PR text := 'Bahía de preparación';
  CB text := 'Cabina de pintura'; AR text := 'Bahía de armado y pulido';
begin
  if exists (select 1 from public.orden) then
    raise notice 'Ya hay órdenes: se omiten las de ejemplo';
    return;
  end if;
  -- Actuamos como la cuenta de gerencia para pasar por public.operar()
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

  -- OT-0001 · Caso resuelto del encargo (particular, falta el anticipo)
  --   9 h × $450 = 4.050 · materiales 2 × 650 = 1.300 · refacción 2.800 + 15% = 3.220
  --   subtotal 8.570 · IVA 1.371,20 · total 9.941,20 · anticipo 4.970,60
  o1 := pg_temp.orden('Laura Méndez', '5214770000001', 'PZK-482-B', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Puerta delantera izquierda","dano":"Medio"},{"nombre":"Salpicadera delantera izquierda","dano":"Reemplazo"}]');
  perform public.operar(gen_random_uuid(), 'alta_refaccion', jsonb_build_object('orden_id', o1, 'nombre', 'Salpicadera delantera izquierda', 'costo', 2800));
  perform public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', o1));

  -- OT-0002 · Aseguradora autorizada; el enderezado de 4 h se parte en el corte de mediodía
  o2 := pg_temp.orden('Jorge Ríos', '5214770000002', 'MXR-219-C', 'Aseguradora', pg_temp.t(5, '13:00'),
    '[{"nombre":"Cofre","dano":"Fuerte"},{"nombre":"Faro delantero derecho","dano":"Reemplazo"}]', 'Seguros Altavista', 3500);
  perform public.operar(gen_random_uuid(), 'alta_refaccion', jsonb_build_object('orden_id', o2, 'nombre', 'Faro delantero derecho', 'costo', 1500));
  perform public.operar(gen_random_uuid(), 'emitir_presupuesto', jsonb_build_object('orden_id', o2));
  perform public.operar(gen_random_uuid(), 'autorizar_presupuesto', jsonb_build_object('orden_id', o2));
  perform pg_temp.prog(o2, 'desarmado',  'A', AR, 0, '09:00');
  perform pg_temp.prog(o2, 'enderezado', 'B', E1, 0, '12:00');   -- 12:00–14:00 y 16:00–18:00

  -- OT-0003 · Particular con anticipo; curado nocturno; ATRASADA (prometida el martes)
  o3 := pg_temp.orden('Sofía Aguilar', '5214770000003', 'TGH-731-A', 'Particular', pg_temp.t(1, '18:00'),
    '[{"nombre":"Defensa trasera","dano":"Medio"}]');
  perform pg_temp.anticipo(o3);
  perform pg_temp.prog(o3, 'desarmado',     'E', AR, 1, '09:00');
  perform pg_temp.prog(o3, 'enderezado',    'A', E2, 1, '09:30');
  perform pg_temp.prog(o3, 'preparacion',   'C', PR, 1, '12:00');
  perform pg_temp.prog(o3, 'pintura',       'D', CB, 1, '16:00');   -- horneado hasta 18:00
  perform pg_temp.prog(o3, 'pulido_armado', 'E', AR, 2, '09:00');   -- curado hasta el miércoles 06:00

  -- OT-0004 y OT-0005 · listas para pintura el jueves (prueba guiada de la cabina)
  o4 := pg_temp.orden('Ramón Olvera', '5214770000004', 'JKL-905-D', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Facia trasera","dano":"Leve"}]');
  perform pg_temp.anticipo(o4);
  perform pg_temp.prog(o4, 'desarmado',   'A', AR, 3, '09:00');
  perform pg_temp.prog(o4, 'enderezado',  'A', E1, 3, '09:30');
  perform pg_temp.prog(o4, 'preparacion', 'C', PR, 3, '10:30');

  o5 := pg_temp.orden('Daniela Pineda', '5214770000005', 'WQE-318-F', 'Particular', pg_temp.t(4, '18:00'),
    '[{"nombre":"Salpicadera trasera derecha","dano":"Leve"}]');
  perform pg_temp.anticipo(o5);
  perform pg_temp.prog(o5, 'desarmado',   'E', AR, 3, '09:00');
  perform pg_temp.prog(o5, 'enderezado',  'B', E2, 3, '09:30');
  perform pg_temp.prog(o5, 'preparacion', 'D', PR, 3, '10:30');

  -- Mantenimiento y ausencia
  perform public.operar(gen_random_uuid(), 'programar_mantenimiento', jsonb_build_object(
    'area_id', (select id from public.area where nombre = AR),
    'inicio', pg_temp.t(5, '09:30'), 'fin', pg_temp.t(5, '11:00'), 'nota', 'Revisión del elevador'));
  perform public.operar(gen_random_uuid(), 'guardar_ausencia', jsonb_build_object(
    'tecnico_id', (select id from public.tecnico where nombre = 'Técnico C'),
    'inicio', pg_temp.t(4, '09:00'), 'fin', pg_temp.t(4, '14:00'), 'motivo', 'Trámite personal'));

  -- OT-0006 · Semana pasada, terminada y lista para entrega (alimenta panel y liquidación)
  o6 := pg_temp.orden('Marisol Treviño', '5214770000006', 'LMN-664-E', 'Particular', pg_temp.t(-6, '18:00'),
    '[{"nombre":"Puerta trasera derecha","dano":"Leve"}]');
  perform pg_temp.anticipo(o6);
  perform pg_temp.prog(o6, 'desarmado',     'A', AR, -7, '09:00');
  perform pg_temp.prog(o6, 'enderezado',    'B', E1, -7, '09:30');
  perform pg_temp.prog(o6, 'preparacion',   'C', PR, -7, '10:30');
  perform pg_temp.prog(o6, 'pintura',       'D', CB, -7, '12:00');
  perform pg_temp.prog(o6, 'pulido_armado', 'E', AR, -6, '09:00');
  -- Ejecución histórica: tiempos reales iguales a lo programado
  insert into public.registro_tiempo (etapa_id, tecnico_id, inicio, fin)
  select e.id, b.tecnico_id, b.inicio, b.fin_tecnico
    from public.etapa e join public.bloque b on b.etapa_id = e.id where e.orden_id = o6;
  update public.etapa e set estado = 'Terminada',
         iniciada_en = (select min(inicio) from public.bloque where etapa_id = e.id),
         terminada_en = (select max(fin_tecnico) from public.bloque where etapa_id = e.id)
   where e.orden_id = o6 and e.programable;
  update public.etapa set estado = 'Terminada', iniciada_en = pg_temp.t(-6, '10:30'), terminada_en = pg_temp.t(-6, '11:00')
   where orden_id = o6 and tipo = 'control_calidad';
  perform public._recalcular_estado(o6);
  update public.orden set lista_en = pg_temp.t(-6, '11:00') where id = o6;
  update public.pago set creado_en = pg_temp.t(-7, '08:45') where orden_id = o6;
end $$;
```

</details>
