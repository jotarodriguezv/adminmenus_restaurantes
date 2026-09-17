// La pestaña Inicio no guarda nada: junta señales que ya existen para que el
// restaurante no tenga que recorrer cada pestaña para descubrirlas.

function productoGratis(producto) {
  return producto?.atributos?.precio_gratis === true;
}

function abrirDesdeInicio(tab) {
  const botones = {
    productos: 'tabBtnProductos', categorias: 'tabBtnCategorias',
    promo: 'tabBtnPromo', tv: 'tabBtnTv', ajustes: 'tabBtnAjustes',
  };
  const boton = document.getElementById(botones[tab]);
  if (boton) switchTab(tab, boton);
}

function filaInicio({ titulo, nota, estado, tipo = '', tab }) {
  const fila = document.createElement('div');
  fila.className = 'inicio-fila';
  const texto = document.createElement('div');
  texto.className = 'inicio-fila-texto';
  const h = document.createElement('div'); h.className = 'inicio-fila-titulo'; h.textContent = titulo;
  const p = document.createElement('div'); p.className = 'inicio-fila-nota'; p.textContent = nota;
  texto.append(h, p);
  const lado = document.createElement('div');
  const e = document.createElement('div'); e.className = `inicio-estado ${tipo}`; e.textContent = estado;
  lado.appendChild(e);
  if (tab) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-sm'; b.textContent = 'Ver';
    b.style.marginTop = '7px'; b.onclick = () => abrirDesdeInicio(tab);
    lado.appendChild(b);
  }
  fila.append(texto, lado);
  return fila;
}

function renderInicio() {
  const resumen = document.getElementById('inicioResumen');
  const pendientes = document.getElementById('inicioPendientes');
  const funciones = document.getElementById('inicioFunciones');
  if (!resumen || !pendientes || !funciones || !state.restaurante) return;

  const productos = state.productos || [];
  const categorias = state.categorias || [];
  const sinFoto = productos.filter(p => !p.imagen_url).length;
  // Un cero anterior no se interpreta: solo el interruptor explícito dice
  // «Gratis». Así nadie publica una cortesía por accidente al actualizar.
  const precioPendiente = productos.filter(p => Number(p.precio_numerico) === 0 && !productoGratis(p)).length;
  const gratis = productos.filter(productoGratis).length;
  const categoriasVacias = categorias.filter(c => !productos.some(p => p.categoria_id === c.id)).length;
  const noDisponibles = productos.filter(p => !p.disponible).length;

  resumen.replaceChildren();
  [[productos.length, productos.length === 1 ? 'producto' : 'productos'], [categorias.length, categorias.length === 1 ? 'categoría' : 'categorías'], [productos.filter(p => p.imagen_url).length, 'con foto']]
    .forEach(([numero, etiqueta]) => {
      const m = document.createElement('div'); m.className = 'inicio-metrica';
      const n = document.createElement('div'); n.className = 'inicio-metrica-numero'; n.textContent = numero;
      const e = document.createElement('div'); e.className = 'inicio-metrica-etiqueta'; e.textContent = etiqueta;
      m.append(n, e); resumen.appendChild(m);
    });

  pendientes.replaceChildren();
  [
    { titulo: 'Productos sin foto', nota: sinFoto ? 'Una imagen ayuda a que se antojen más.' : 'Todos tus productos tienen imagen.', estado: sinFoto ? `${sinFoto} por completar` : 'Listo', tipo: sinFoto ? 'atencion' : 'activo', tab: 'productos' },
    { titulo: 'Precio pendiente', nota: precioPendiente ? 'Marca “Gratis” solo cuando realmente no tenga costo.' : 'No hay precios en cero sin definir.', estado: precioPendiente ? `${precioPendiente} por revisar` : 'Listo', tipo: precioPendiente ? 'atencion' : 'activo', tab: 'productos' },
    { titulo: 'Categorías vacías', nota: categoriasVacias ? 'Añade productos o elimina las que ya no uses.' : 'Todas tienen al menos un producto.', estado: categoriasVacias ? `${categoriasVacias} vacías` : 'Listo', tipo: categoriasVacias ? 'atencion' : 'activo', tab: 'categorias' },
  ].forEach(item => pendientes.appendChild(filaInicio(item)));
  if (gratis || noDisponibles) {
    const nota = `${gratis ? `${gratis} gratuito${gratis === 1 ? '' : 's'}` : 'Sin productos gratuitos'}${gratis && noDisponibles ? ' · ' : ''}${noDisponibles ? `${noDisponibles} no disponible${noDisponibles === 1 ? '' : 's'}` : ''}.`;
    pendientes.appendChild(filaInicio({ titulo: 'Otros estados', nota, estado: 'Información', tab: 'productos' }));
  }

  funciones.replaceChildren();
  const promos = state.promociones || [];
  const destacadosActivos = promos.filter(p => p.activa && p.en_popup).length;
  const tvActiva = !!state.restaurante?.atributos?.tv?.activa;
  funciones.appendChild(filaInicio({ titulo: 'Destacados', nota: destacadosActivos ? 'Hay destacados activos en tu carta.' : 'No hay destacados activos en la carta.', estado: destacadosActivos ? `${destacadosActivos} en uso` : 'Sin activar', tipo: destacadosActivos ? 'activo' : '', tab: 'promo' }));
  funciones.appendChild(filaInicio({ titulo: 'Pantalla de televisión', nota: tvActiva ? 'Tu cartelera está encendida.' : 'La cartelera no está encendida.', estado: tvActiva ? 'Activa' : 'Apagada', tipo: tvActiva ? 'activo' : '', tab: 'tv' }));
  const carrito = cartaTieneCarrito(state.restaurante.atributos, planActual());
  funciones.appendChild(filaInicio({ titulo: 'Carrito de compras', nota: carrito ? 'Tu carta permite armar pedidos.' : 'Tu carta funciona como catálogo.', estado: carrito ? 'Activo' : 'No activo', tipo: carrito ? 'activo' : '', tab: 'ajustes' }));
}
