# Ajustes de backend: stock de todos los almacenes visible para todos + teléfono — viguetas-api

## Regla de negocio

- **Todos los roles** (`superadmin`, `admin`, `store`) ven el stock de **todos** los almacenes. Es necesario para saber a quién pedirle un traslado.
- El stock **no se filtra por almacén del usuario** en `GET /api/stock`. (Se había sugerido filtrar para `store`; se descarta.)
- Cada fila de stock incluye el **teléfono del almacén**, para llamar desde la pantalla de Stock.
- Solo se restringe **escribir**: ajustar stock, vender y trasladar siguen atados al almacén del usuario (`resolveWarehouse`).

Flujo que esto habilita: una tienda ve que otro almacén tiene lo que necesita, lo llama, y **quien tiene el stock registra el traslado** desde su propio almacén hacia el solicitante. Esto es coherente con la regla de que cada usuario solo traslada desde el suyo. No hace falta un sistema de "solicitudes de traslado" en la v1.

---

## 1. `listStock`: agregar teléfono y datos del producto

Archivo: `src/controllers/stock.controller.ts`

```ts
const resultado = await db
  .select({
    warehouseId: stock.warehouseId,
    warehouseName: warehouses.name,
    warehouseType: warehouses.type,
    warehousePhone: warehouses.phone,
    warehouseAddress: warehouses.address,
    productId: stock.productId,
    productName: products.name,
    productType: products.productType,
    measurement: products.measurement,
    quantity: stock.quantity,
  })
  .from(stock)
  .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
  .innerJoin(products, eq(stock.productId, products.id))
  .where(condiciones.length ? and(...condiciones) : undefined);
```

Si tu respuesta actual ya incluye `productType` y `measurement` (la pantalla ya muestra "Tipo" y la medida), solo agrega `warehousePhone` y `warehouseAddress`.

Mantener la ruta como está, sin filtro por rol:

```ts
router.get('/', requireAuth, requireRole('admin', 'store'), listStock); // superadmin pasa solo
```

No agregar ninguna condición del tipo `if (userRol === 'store') filtrar por su almacén`.

---

## 2. Corrección importante: permisos de LECTURA de almacenes y productos

En la guía de roles anterior, las rutas de Almacenes quedaron como `requireRole('superadmin')` para **todos** los métodos, y Productos solo para `admin`. Eso bloquea también las lecturas, y los formularios de Ventas, Traslados y Stock necesitan **listar** almacenes y productos con cualquier rol. Con esa configuración, un usuario `store` recibiría `403` al abrir esos formularios.

Separar lectura de escritura:

```ts
// warehouses.routes.ts
router.get('/', requireAuth, requireRole('admin', 'store'), listWarehouses);          // lectura: todos
router.post('/', requireAuth, requireRole('superadmin'), createWarehouse);            // escritura: superadmin
router.patch('/:id', requireAuth, requireRole('superadmin'), updateWarehouse);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteWarehouse);

// products.routes.ts
router.get('/', requireAuth, requireRole('admin', 'store'), listProducts);            // lectura: todos
router.post('/', requireAuth, requireRole('admin'), createProduct);                   // escritura: admin (+ superadmin automático)
router.patch('/:id', requireAuth, requireRole('admin'), updateProduct);
router.delete('/:id', requireAuth, requireRole('admin'), deleteProduct);
```

`superadmin` pasa siempre por el middleware, así que `requireRole('admin', 'store')` ya cubre a los tres roles.

`GET /api/clients` ya estaba abierto a `admin` y `store`; no cambia.

`listWarehouses` debe devolver `phone` y `address` además de `id`, `name` y `type`.

---

## 3. Teléfono al crear y editar almacenes

El campo `phone` ya existe en la tabla `warehouses` (nullable). Asegurar que `createWarehouse` y `updateWarehouse` lo reciban y lo guarden, con una validación mínima:

```ts
const telefono = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

if (telefono && !/^[0-9+\s()-]{6,20}$/.test(telefono)) {
  return res.status(400).json({ error: 'El teléfono solo puede contener números, espacios, +, - y paréntesis' });
}

// al guardar:
phone: telefono || null,
```

No se exige el teléfono (puede quedar vacío), pero el frontend lo marcará como recomendado.

---

## 4. Checklist

- [ ] Agregar `warehousePhone` y `warehouseAddress` (y confirmar `productType` y `measurement`) en `listStock`
- [ ] Confirmar que `GET /api/stock` **no** filtra por almacén según el rol
- [ ] Separar lectura y escritura en `warehouses.routes.ts` y `products.routes.ts` según el punto 2
- [ ] Confirmar que `listWarehouses` devuelve `phone` y `address`
- [ ] Validar y guardar `phone` en crear y editar almacén
- [ ] Probar con un usuario `store`: puede ver el stock de todos los almacenes, listar almacenes y productos, y recibe `403` al intentar crear un almacén o un producto
- [ ] Probar que `POST /api/stock` (ajuste) sigue sin estar disponible para `store`
