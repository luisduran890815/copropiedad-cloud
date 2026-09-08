# Mantenimiento de copropiedad en la nube
Incluye autenticación, roles, base de datos, fotos privadas en Supabase Storage, PDF de cierre, envío por correo mediante Netlify Function + Resend, Excel y eliminación exclusiva para administradores.

## Archivos que debes editar
- `config.js`: URL y clave pública/anon de Supabase.
- En Netlify configura secretos; nunca pongas `SERVICE_ROLE` ni `RESEND_API_KEY` en GitHub.

## Instalación resumida
1. Supabase: crea proyecto, ejecuta `setup.sql`, crea usuario y conviértelo en admin con la sentencia final.
2. GitHub: sube todos los archivos conservando `netlify/functions/send-report.js`.
3. Netlify: importa repositorio y añade variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. Resend: crea la clave API. Para producción verifica un dominio remitente y úsalo en `EMAIL_FROM`.

## Seguridad
El bucket es privado. Supabase RLS limita escritura a admin/operador y borrado a admin. La función de correo valida la sesión y el rol. La service role vive únicamente en variables de Netlify.
