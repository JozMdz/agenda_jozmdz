# AgendaApp

Agenda personal para escuela, trabajo y asuntos personales. Sincroniza entre iPad y
celular Android a través de Supabase, se instala como app (PWA) y funciona sin señal
para consulta.

Un solo archivo `index.html` autocontenido: sin build, sin framework, sin bundler.
La única dependencia es `@supabase/supabase-js@2` por CDN.

---

## Cómo levantarlo

1. **SQL**: corre los archivos de `/sql` en el SQL Editor de Supabase, en este orden.
   Todos son idempotentes, se pueden volver a correr.
2. **Usuario**: Authentication → Users → Add user, con **Auto Confirm User** activado.
3. **Credenciales**: `SUPABASE_URL` y `SUPABASE_ANON_KEY` están en las dos primeras
   líneas del `<script>` de `index.html`.
4. **Publicar**: los archivos van en la raíz del repo. Settings → Pages → Deploy from
   a branch → `main` / `(root)`.
5. **Instalar**: abre la URL en Chrome (Android) o Safari (iPad) → *Instalar app*.

> La **anon key es pública por diseño** y es segura mientras RLS esté activo: esa es la
> que va en el repositorio. La **`service_role` nunca** debe aparecer en el cliente.

---

## Base de datos

Proyecto Supabase `agenda_jozmdz`. Todas las tablas llevan prefijo `ag_` y filtran por
`user_id = auth.uid()` vía RLS.

| Tabla | Para qué |
|---|---|
| `ag_tareas` | El corazón. Título, área, fecha, hora, duración, prioridad, checklist, nota, estado. |
| `ag_proyectos` | Agrupa tareas. Nombre, área, detalle, fecha objetivo, archivado. |
| `ag_notas` | Bitácora por proyecto: texto con fecha y hora. |
| `ag_rutinas` | Días tipo reutilizables. Las tareas plantilla van en `items` (jsonb). |
| `ag_materias` | Horario de posgrado: clave, nombre, aula, profesor, periodo, `dias` (jsonb). |

### Columnas de `ag_tareas`

```
id uuid pk · user_id uuid (default auth.uid(), FK auth.users on delete cascade)
titulo text not null
area text not null check (area in ('escuela','trabajo','personal'))
proyecto_id uuid → ag_proyectos on delete set null
fecha date · hora time · duracion int (minutos, default 60)
alta boolean · checklist jsonb · nota text
hecha boolean · hecha_en timestamptz · creado_en timestamptz
```

---

## Reglas que el código da por hechas

**Estas no están en el esquema.** Si se rompen, la interfaz se comporta raro sin marcar
ningún error.

| Regla | Detalle |
|---|---|
| **Todo el día** | `hora IS NULL`. No hay bandera aparte. Esas tareas se dibujan en una franja arriba de la rejilla de horas, no dentro de ella. |
| **`duracion`** | En minutos. Solo sirve para calcular el alto del bloque en la agenda. Se ignora cuando `hora` es null. |
| **`checklist`** | `[{"t":"texto del paso","h":false}]` — `t` texto, `h` hecho. |
| **`ag_rutinas.items`** | `[{titulo, area, hora, duracion, alta, proyecto_id, checklist}]`. Sin `fecha`: se asigna al aplicar la rutina. |
| **`ag_materias.dias`** | `{"Lun":"11:00-12:00","Jue":"11:00-12:00"}`. **Las llaves llevan acento** (`Mié`, `Sáb`): la cuadrícula empata por texto exacto. |
| **Recurrencia** | **Materializada.** Una tarea con días × N semanas inserta N×días renglones independientes. Editar uno no afecta a los demás. No hay regla guardada. |
| **Áreas** | Fijas en un `check constraint`. Agregar una cuarta pide `ALTER` en `ag_tareas` y `ag_proyectos`, más actualizar el objeto `AREAS` del HTML. |
| **La semana empieza en lunes** | En KPIs, repaso, vista semanal y carril de 7 días. |
| **Borrar proyecto** | Sus tareas sobreviven con `proyecto_id = NULL`; su bitácora se borra en cascada. |

### Dos trampas ya pisadas

**`hecha_en` se guarda en UTC.** Hay que convertir a hora local antes de agrupar o
contar por día. Cortar el ISO con `.slice(0,10)` *parece* correcto y desfasa: en México
(UTC−6) todo lo que cierres después de las 18:00 cae al día siguiente. Usa el helper
`localISO(ts)`.

**`auth.uid()` devuelve NULL en el SQL Editor**, porque esas consultas corren como
administrador, no como tu usuario. Cualquier `insert` hecho desde ahí necesita el
`user_id` escrito a mano. Solo la app puede apoyarse en el default.

---

## Cómo está armado el cliente

Sin virtual DOM y sin diffing. El ciclo es:

```
cargar()   → trae las cinco tablas a S
render()   → reconstruye el innerHTML de la vista activa
enlazar()  → reasigna los onclick del HTML recién generado
```

Realtime abre un canal por tabla; cualquier cambio dispara `cargar()` + `render()`.
Todo el estado vive en un objeto global `S`.

```js
S = { user, proyectos, tareas, notas, rutinas, materias,
      tab, filtro, q, verHechas, masHist, agModo, agFecha, proy }
```

`render(scroll = true)` — pásale `false` para redibujar sin brincar al inicio (lo usa
el buscador, que si no pierde el foco en cada tecla).

### Vistas

| Pestaña | Función | Contenido |
|---|---|---|
| Inicio | `vHoy` | Tarjeta de calendario, clima, prioridad alta, siguiente pendiente. |
| Pendientes | `vPendientes` | KPIs, carril de la semana, buscador, filtros de área, lista agrupada (Arrastradas · Hoy · fechas · **Sin fecha**), toggle Hechas. |
| Agenda | `vAgenda` → `vMes` / `vRejilla` | Mes por defecto; semana y día con bloques en su hora real. |
| Proyectos | `vProyectos` / `vProyecto` | Tarjetas con avance y cuenta regresiva; detalle con tareas y bitácora. |
| Horario | `vHorario` | Cuadrícula de materias. **Días y bloques de hora se calculan desde los datos**, no hay lista fija. |
| Repaso | `vRepaso` | Avance semanal por área, racha, historial de cierres por día, qué se arrastra. |

### Modales y formularios

`hoja(html)` inyecta en `#modal`. Encima de eso: `formTarea`, `formProyecto`,
`formNota`, `formRutinas` / `aplicarRutina`, `formMateria`, `menuMateria`.
`cerrar()` cierra la hoja — **no confundir con `closeMenu()`**, que cierra el cajón
lateral.

`formTarea` abre en **modo corto** para tareas nuevas (título, área, fecha, hora) y
despliega el resto con "Más opciones". Al editar una tarea existente abre completo.
Ojo al tocarlo: todo enlace a un elemento que solo existe en modo extendido tiene que ir
protegido con `if($("f-alta"))`. Sin esa guarda, el error corta el enlace de **todos**
los botones siguientes, incluidos Guardar y Cancelar.

### Dictado por voz

`dictar()` usa `webkitSpeechRecognition` en `es-MX`; `parseVoz(texto)` devuelve
`{titulo, area, fechas[], hora, alta}`.

Entiende hoy / mañana / pasado mañana, días de la semana, "próximo X", "en N días",
"el 3 de septiembre", horas ("a las 9 de la mañana"), palabras clave de área y
"es urgente". Varias fechas en una sola frase generan varias tareas.

> *"Agenda: hacer PPT tránsito para hoy, mañana y el próximo miércoles"* → tres tareas.

Regla de desambiguación: **"el miércoles"** es el próximo que venga; **"el próximo
miércoles"** salta a la semana siguiente.

El parser trabaja sobre una versión *plegada* del texto (minúsculas y sin acentos) que
**conserva la longitud carácter por carácter**, para poder recortar los tramos de fecha
del texto original sin perder acentos ni mayúsculas en el título.

### Otros

- **Tema** claro/oscuro y **caché del clima** (30 min) viven en `localStorage`: son del
  dispositivo, no sincronizan. Correcto para lo que son.
- **Clima**: Open-Meteo con geolocalización del navegador.
- **Navegación por deslizamiento** entre pestañas, en el orden del arreglo `TABS`.
- **PWA**: `manifest.webmanifest` + `sw.js`. El service worker va **a red primero, caché
  de respaldo**, así siempre ves la versión nueva pero la app abre sin señal. Lo que
  captures sin conexión **no se guarda** (Supabase necesita red) y el punto del
  encabezado se pone rojo.

---

## Al actualizar

Sube el `index.html` nuevo y **cambia la versión del caché en `sw.js`**
(`agendaapp-v2` → `agendaapp-v3`), o los dispositivos seguirán sirviendo la copia vieja.

---

## Diseño

Los colores salen del ícono: baldosa `#201E1D`, tarjeta `#F3F2F2`, acento `#0088b0`.

| Rol | Color | Nota |
|---|---|---|
| Escuela | `#F0509A` | magenta de marca |
| Trabajo | `#0FA3CE` | azul de marca, aclarado |
| Personal | `#5FD39A` | |
| Prioridad alta | `#F2A93B` | |
| Vencida | `#F2564A` | |

El `#0088b0` original quedó en la variable `--marca`. No se usa para texto: sobre fondo
oscuro da 4.3:1 de contraste y las etiquetas van en 11 px. La versión aclarada llega a
6:1.

El fondo es un mosaico facetado (SVG en base64, dentro del CSS) con esa misma paleta.

---

## Pendientes conocidos

- **Sin notificaciones push.** La app solo sirve si la abres. Se resolvería con una Edge
  Function + Web Push, o con un puente por Telegram para dictarle a Google Assistant sin
  tocar el teléfono.
- **Sin repetición mensual.** La recurrencia es por días de la semana durante N semanas.
  Un pendiente mensual hay que recapturarlo.
- **Sin estado "en espera".** Solo abierto o cerrado. Lo que se delega sigue contando
  como propio y se va a "arrastradas".
- **Los proyectos tienen una sola fecha objetivo**, no hitos intermedios.
- **Sin enlaces a entregables.** El campo de nota es texto plano.

---

## Archivos

```
index.html                 la app completa
manifest.webmanifest       metadatos PWA
sw.js                      service worker
icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png
sql/  esquema · permisos · rutinas · materias
```
