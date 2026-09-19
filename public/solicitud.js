// ── LA PÁGINA DE SOLICITUD DE ALTA ────────────────────────────
// Ver solicitud.html y, para las reglas, solicitudes.js en el servidor.
// Script aparte y sin nada del panel: esta página la abre gente sin sesión.
(function () {
	'use strict';
	const $ = id => document.getElementById(id);
	const formulario = $('formulario');
	// Cuándo se abrió: el servidor descarta lo que se envía en menos de lo que
	// tarda una persona. Ver pareceRobot() en solicitudes.js.
	let abiertoEn = Date.now();
	let tokenCaptcha = null;

	// El nombre del comercial se recuerda en este teléfono: el equipo manda
	// varias al día y no tiene por qué escribirlo cada vez. Solo aquí, en el
	// navegador de quien la usa; puede fallar en modo privado y no pasa nada.
	const CLAVE_COMERCIAL = 'vmenusComercial';
	try { formulario.comercial.value = localStorage.getItem(CLAVE_COMERCIAL) || ''; } catch (e) {}

	function error(texto) { $('error').textContent = texto || ''; }

	// El captcha de Cloudflare, solo si el servidor tiene clave. Se carga
	// después de saberlo para no pedir nada a Cloudflare si no hace falta.
	fetch('/api/solicitudes/config').then(r => r.json()).then(config => {
		if (config.politica) {
			const texto = $('textoAutoriza');
			texto.append(' ');
			const enlace = document.createElement('a');
			enlace.href = config.politica;
			enlace.target = '_blank';
			enlace.rel = 'noopener';
			enlace.textContent = 'Política de privacidad';
			texto.append(enlace, '.');
		}
		if (!config.turnstile) return;
		window.alCargarTurnstile = function () {
			window.turnstile.render('#captcha', {
				sitekey: config.turnstile,
				language: 'es',
				callback: token => { tokenCaptcha = token; },
				'expired-callback': () => { tokenCaptcha = null; },
			});
		};
		const s = document.createElement('script');
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=alCargarTurnstile';
		s.async = true;
		document.head.appendChild(s);
	}).catch(() => {});

	formulario.addEventListener('submit', async ev => {
		ev.preventDefault();
		error('');
		const f = formulario;
		// Lo mínimo se avisa aquí, antes del viaje. El servidor lo vuelve a
		// comprobar todo: esto es solo para no hacer esperar.
		if (!f.negocio.value.trim()) return error('Escribe el nombre del negocio.');
		if (!f.contacto.value.trim()) return error('Escribe tu nombre.');
		if (f.whatsapp.value.replace(/\D/g, '').length < 8) return error('Escribe un número de WhatsApp válido.');
		if (!f.autoriza_datos.checked) return error('Para enviarla hace falta que autorices el tratamiento de tus datos.');

		const boton = $('enviar');
		boton.disabled = true;
		boton.textContent = 'Enviando…';
		try {
			const res = await fetch('/api/solicitudes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					negocio: f.negocio.value, contacto: f.contacto.value, whatsapp: f.whatsapp.value,
					ciudad: f.ciudad.value, tipo_negocio: f.tipo_negocio.value, notas: f.notas.value,
					comercial: f.comercial.value, sitio_web: f.sitio_web.value,
					autoriza_datos: f.autoriza_datos.checked, abierto_en: abiertoEn, turnstile: tokenCaptcha,
				}),
			});
			const cuerpo = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(cuerpo.error || 'No se pudo enviar. Inténtalo de nuevo.');
			try { localStorage.setItem(CLAVE_COMERCIAL, f.comercial.value.trim()); } catch (e) {}
			formulario.hidden = true;
			$('gracias').hidden = false;
		} catch (e) {
			error(e.message);
			// Un token de captcha solo vale una vez: tras un intento fallido
			// hay que pedir otro.
			if (window.turnstile) { window.turnstile.reset('#captcha'); tokenCaptcha = null; }
		} finally {
			boton.disabled = false;
			boton.textContent = 'Enviar solicitud';
		}
	});

	// Para el comercial que visita varios restaurantes seguidos: vuelve al
	// formulario limpio, conservando su nombre.
	$('otra').addEventListener('click', () => {
		const comercial = formulario.comercial.value;
		formulario.reset();
		formulario.comercial.value = comercial;
		abiertoEn = Date.now();
		if (window.turnstile) { window.turnstile.reset('#captcha'); tokenCaptcha = null; }
		$('gracias').hidden = true;
		formulario.hidden = false;
		formulario.negocio.focus();
	});
})();
