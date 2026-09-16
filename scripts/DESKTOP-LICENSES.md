# Licencias administradas desde AeroLex

El portal almacena nombre, correo, vencimiento, estado y credenciales de dispositivo
en forma de hash. No recibe contraseñas locales, expedientes, fuentes jurídicas
ni claves de proveedores IA. La clave ADMIN_KEY nunca se incluye en la app.

## Activación del servicio

1. Aplicar scripts/desktop-licenses.sql en la base Supabase del portal.
   Crea tres tablas independientes y tres funciones RPC. No altera cases.
   RLS activado, sin acceso anon/authenticated; solo service_role puede operarlas.
2. Desplegar api/licenses.js y desktop-licenses-admin.js y la modificación de
   admin.html que incorpora el botón «Licencias de escritorio» y el script.
3. Reutiliza SUPABASE_URL, SUPABASE_SERVICE_KEY y ADMIN_KEY del portal. ADMIN_KEY
   debe tener más de 15 caracteres. No poner secretos en Git ni en el instalador.
4. Comprobar con una licencia ficticia crear, activar, ampliar, suspender,
   reactivar, revocar y reemitir código antes de entregar la app.

## Uso

- El administrador crea licencia para el correo que la abogada registró localmente.
- Entrega el código mediante un canal privado. Es de un solo uso y vence en 7 días.
- Ella entra en «Licencia y suscripción», pega el código y activa.
- Si el primer intento consumió el código pero no recibió respuesta, el
  administrador emite otro. La contraseña local no se transmite ni se recupera
  desde este panel. El código acredita la autorización del administrador, no
  verifica por sí solo que se tenga acceso al buzón de correo.
- Añadir días usa el mayor valor entre ahora y vencimiento actual. Una licencia
  suspendida sigue suspendida tras ampliarla; hay que reactivarla expresamente.
- Revocar dispositivos invalida sus credenciales; cada reinstalación o dispositivo
  nuevo requiere código nuevo. No se borran archivos del computador.

## Alcance y límites

Verificación cada 15 segundos con app abierta, más latencia de red. La suspensión
recibida online se aplica inmediatamente al control de acceso; no cancela procesos
CLI que ya estén trabajando. Sin conexión, última autorización válida hasta 24 h,
sin superar vencimiento. No equivale a notificación push ni a control remoto del PC.
El contador se basa en reloj del sistema y caché local. No hay resistencia certificada
a manipulación por alguien con control completo del computador. Cuentas no vinculadas
conservan la prueba local previa; vincular licencia no permite volver a ella por UI.

Las operaciones administrativas usan identificadores para evitar ampliaciones
duplicadas durante reintentos y quedan en desktop_license_audit. No hay acceso
desde este módulo a la contraseña, documentos ni pantalla del dispositivo.
Si se cambia ADMIN_KEY, reemitir códigos pendientes: los reintentos de emisión
dependen de esa clave. El navegador no guarda los códigos de activación.

Pruebas locales del endpoint usan servidor y base simulados. Ejecutar la migración
SQL y validar la integración real en un entorno de prueba sigue siendo obligatorio
antes de anunciar el servicio desplegado. No distribuir una app prometiendo
administración online mientras estas piezas no estén activadas.
