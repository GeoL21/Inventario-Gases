# Inventario de material de gases medicinales — Notas para Claude

## Qué es
PWA para consultar, registrar y retirar material de gases medicinales (acoples, tomas, racores,
mangueras) en Clínica Reina Catalina, con el destino de cada movimiento.

## Dónde vive cada parte
- Código de la PWA: este repo, publicado en GitHub Pages.
- Datos: hoja de Google nueva, hecha para esta app (cuenta cilindrocrc@gmail.com).
  Existe otra hoja anterior, "Inventario - Gases medicinales"; se decidió NO usarla.
- Servidor: implementación de Apps Script de esa hoja. Su código NO está en este repo
  (el usuario lo pega aquí cuando hay que revisarlo).
  La URL del servidor está en `config.js`: la app la necesita y está protegida por el código de acceso.

## Reglas que no se cambian
- Un solo almacén: todo sale de Barranquilla. Baranoa es solo un destino.
- Foto de cada artículo tomada desde la app.
- Stock mínimo por artículo, definido por el usuario, con alertas.
- Un ticket puede llevar varios artículos.
- En los retiros, "Pendiente" significa material retirado que falta instalar.
- Con filtros y código de acceso.
- Funciona sin señal y sube los movimientos al volver la conexión.
- Todo en español, con el logo y los colores de la clínica. Letra: Plus Jakarta Sans.

## Cómo trabajar aquí
- Preguntar antes de cambiar algo y mostrar un bosquejo para aprobar.
- No romper la hoja ni los registros existentes.
- Al cambiar archivos, subir el número de `VERSION` en `sw.js`.
- Este repo es público: no escribir aquí códigos de acceso ni claves (la URL de `config.js` sí va).
- Datos del celular con prefijo propio (`ig_`) porque todas las apps de geol21.github.io comparten almacenamiento.
- Las miniaturas se piden solo si cambiaron (`fotosDesde` / `fotosParciales`) para no gastar datos.
- Diseño: encabezado blanco sin franja vino, logo en el menú lateral en PC, vino #6A1B3A (igual que Tanques).
