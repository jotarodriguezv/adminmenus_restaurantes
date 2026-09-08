// Convenciones del esquema, comprobadas sobre los archivos de sql/.
//
// Estas pruebas no tocan la base de datos: leen las migraciones. Existen
// porque el Supabase simulado de las otras pruebas NO ejecuta triggers ni
// restricciones, así que toda una familia de fallos —los que solo aparecen
// cuando PostgreSQL de verdad ejecuta la sentencia— pasa por delante de la
// suite entera sin que salte nada.
//
// El caso que las trajo, el 07/09/2026: sql/21 creó 'importaciones_carta' con
// la columna 'actualizada_en', en femenino, y le colgó el trigger compartido
// 'tocar_actualizado_en()', que escribe en 'actualizado_en'. Esa columna no
// existía, así que CADA update sobre la tabla levantaba
// 'record "new" has no field "actualizado_en"'. Por esa tabla pasa todo lo que
// hace la importación de cartas: la funcionalidad no podía funcionar, y las
// 772 pruebas estaban en verde.
//
// ── SE MIRA EL CONJUNTO, NO CADA ARCHIVO ──────────────────────
// Una migración no se edita después de aplicarla: lo que estaba mal se arregla
// en la siguiente. Así que la regla no puede ser "este archivo está bien" sino
// "sumando todos, el esquema queda bien". El primer intento de estas pruebas
// se escribió por archivo y dio cuatro falsos positivos —sql/19 revoca lo que
// crea sql/18, y sql/22 arregla lo de sql/21—, que es justo el error que
// describe este párrafo.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = path.join(__dirname, '..', 'sql');
const archivos = fs.readdirSync(SQL).filter((f) => f.endsWith('.sql'))
	.map((f) => ({ nombre: f, texto: fs.readFileSync(path.join(SQL, f), 'utf8') }));

// Los comentarios hablan de lo que se hizo y de lo que no; solo cuentan las
// sentencias.
const codigo = archivos.map((a) => ({ ...a, texto: a.texto.replace(/^\s*--.*$/gm, '') }));
const todo = codigo.map((a) => a.texto).join('\n');

describe('la marca de tiempo que escribe el trigger compartido', () => {
	test('hay migraciones que leer', () => {
		assert.ok(archivos.length > 20, 'si esto falla, la ruta de sql/ cambió y el resto no prueba nada');
	});

	test('cada tabla con el trigger define la columna que el trigger escribe', () => {
		// El trigger hace 'new.actualizado_en := now()'. Si la tabla la llamó de
		// otra forma no falla al crearla: falla en el primer update, ya en
		// producción, con un mensaje que ni siquiera nombra la tabla.
		const conTrigger = [...todo.matchAll(
			/create trigger\s+\w+\s+before update on public\.(\w+)[\s\S]{0,120}?tocar_actualizado_en/g)].map((m) => m[1]);

		assert.ok(conTrigger.length >= 2, 'se esperaban varias tablas con esta marca');

		for (const tabla of conTrigger) {
			// La columna puede llegar al crear la tabla o por un rename posterior.
			const creada = new RegExp(`create table[^;]*?public\\.${tabla}\\b[^;]*?\\bactualizado_en\\b`, 's').test(todo);
			const renombrada = new RegExp(`alter table public\\.${tabla}[\\s\\S]{0,120}?rename column \\w+ to actualizado_en`).test(todo);
			assert.ok(creada || renombrada,
				`${tabla} tiene el trigger y ninguna migración le deja una columna 'actualizado_en'`);
		}
	});

	test("lo que se llamó 'actualizada_en' acabó renombrado", () => {
		// El femenino concuerda con "importación", y es exactamente por eso que
		// se coló. La concordancia no vale una función de trigger aparte.
		if (!/\bactualizada_en\b/.test(todo)) return;
		assert.match(todo, /rename column actualizada_en to actualizado_en/,
			"alguna migración define 'actualizada_en' y ninguna lo renombra");
	});
});

describe('las tablas nuevas nacen cerradas', () => {
	// Una tabla nueva en 'public' llega con privilegios para 'anon' y
	// 'authenticated' por los privilegios por defecto de Supabase. Hacen falta
	// los DOS revoke y RLS encendido. La lección está en sql/16 y volvió en
	// sql/20.
	const creadas = [...todo.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

	test('hay tablas creadas por migración', () => {
		assert.ok(creadas.length >= 3, `solo se encontraron ${creadas.length}`);
	});

	for (const tabla of [...new Set(creadas)]) {
		test(`${tabla} · se le revoca y se le enciende RLS`, () => {
			// En cualquier migración, no necesariamente en la que la creó: sql/19
			// cerró lo que abrió sql/18.
			assert.match(todo, new RegExp(`revoke[^;]*?on public\\.${tabla}\\b`, 's'),
				`nadie revoca privilegios sobre ${tabla}`);
			assert.match(todo, new RegExp(`alter table public\\.${tabla}\\s+enable row level security`),
				`${tabla} se queda sin RLS`);
		});
	}
});
