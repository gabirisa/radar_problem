# Fastidios

Landing en Angular para recoger problemas de trabajo y panel admin con Supabase.

## Desarrollo

```bash
npm install
npm start
```

La app queda en `http://localhost:4200`.

## Supabase

1. Crea un proyecto en Supabase.
2. Copia `Project URL` y `publishable key` en `src/environments/environment.ts`.
3. Ejecuta `supabase/schema.sql` en el SQL editor de Supabase.
4. Crea tu usuario admin en Authentication.
5. Marca ese usuario como admin:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'tu-email@dominio.com';
```

6. Despliega la Edge Function:

```bash
supabase functions deploy submit-problem
supabase secrets set IP_HASH_SALT="pon-un-secreto-largo"
supabase secrets set RATE_LIMIT_MAX="3"
supabase secrets set RATE_LIMIT_WINDOW_MINUTES="10"
supabase secrets set DUPLICATE_THRESHOLD="0.85"
supabase secrets set DUPLICATE_WINDOW_DAYS="90"
```

La tabla `submissions` no acepta inserts anonimos. El formulario llama a la Edge Function usando la publishable key, y la funcion valida honeypot, calcula `ip_hash`, aplica rate limiting y usa `pg_trgm` para marcar posibles duplicados.
`IP_HASH_SALT` es recomendable. Si no existe, la funcion usa `SUPABASE_SERVICE_ROLE_KEY` como sal privada de respaldo.

El contador publico no escucha `submissions`. Lee y se suscribe a `landing_stats`, una tabla agregada con solo `problem_count` y `profession_count`. Cuentan los estados `pending` y `approved`; `spam` y `duplicate` no suman.

Estados de envio:

- `pending`: recibido y valido para revisar.
- `approved`: aprobado por admin.
- `spam`: marcado automaticamente por rate limit o por admin.
- `duplicate`: parecido a un envio anterior segun `pg_trgm` o marcado por admin.

## Rutas

- `/`: landing publica con formulario y contador.
- `/admin/login`: login con Supabase Auth.
- `/admin`: ruta protegida por guard, consulta de envios, filtros, cambios de estado y vista tecnica opcional.
