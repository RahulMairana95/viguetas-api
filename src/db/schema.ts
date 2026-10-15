import {
  pgTable, uuid, varchar, integer, decimal, timestamp, date, pgEnum, uniqueIndex, text, boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// El enum de la base conserva 'superadmin' (Postgres no permite quitar un valor
// con un ALTER simple), pero el código NO lo usa. El rol efectivo es Rol = 'admin' | 'store'.
export const roleEnum = pgEnum('role', ['superadmin', 'admin', 'store']);
export const warehouseTypeEnum = pgEnum('warehouse_type', ['factory', 'store']);
export const saleStatusEnum = pgEnum('sale_status', ['scheduled', 'completed', 'cancelled']);
export const productionStatusEnum = pgEnum('production_status', ['pending', 'completed']);
export const productTypeEnum = pgEnum('product_type', ['vigueta', 'plastoformo']);
export const puntalMaterialEnum = pgEnum('puntal_material', ['madera', 'metal', 'solera']);
export const puntalStatusEnum = pgEnum('puntal_status', ['en_obra', 'en_almacen']);

export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: warehouseTypeEnum('type').notNull(),
  address: varchar('address', { length: 500 }),
  phone: varchar('phone', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }),
  role: roleEnum('role').notNull().default('store'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  // Un usuario desactivado no puede iniciar sesión ni renovar su token.
  isActive: boolean('is_active').notNull().default(true),
  // Un usuario protegido no se puede desactivar ni cambiar de rol desde la app.
  // Se pone en true SOLO desde la base de datos o el script, nunca por la API.
  isProtected: boolean('is_protected').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Rol = 'admin' | 'store';

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  productType: productTypeEnum('product_type').notNull(),
  measurement: varchar('measurement', { length: 50 }).notNull(), // e.g. 1m, 2m, 4.6m, 0.12x0.44x100
  price: decimal('price', { precision: 10, scale: 2 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const stock = pgTable('stock', {
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  warehouseProductUnique: uniqueIndex('stock_warehouse_product_unique').on(table.warehouseId, table.productId),
}));

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Una venta nace 'completed' (inmediata: descuenta stock en el acto) o
// 'scheduled' (programada: NO toca stock hasta que el admin la entrega).
export const sales = pgTable('sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id).notNull(),
  status: saleStatusEnum('status').notNull().default('completed'),
  // 'YYYY-MM-DD'; obligatorio si es programada. Tipo date (no timestamp) para
  // que no haya corrimiento de día por zona horaria (Bolivia = UTC-4).
  deliveryDate: date('delivery_date', { mode: 'string' }),
  deliveryPlace: varchar('delivery_place', { length: 500 }), // obligatorio si es programada
  deliveredAt: timestamp('delivered_at'),
  userId: uuid('user_id').references(() => users.id).notNull(), // quién la registró
  // Pagos del pedido: el adelanto lo digita el usuario y el saldo se deriva
  // siempre como total − adelanto (nunca se guarda).
  adelanto: decimal('adelanto', { precision: 10, scale: 2 }).default('0'),
  // Fecha de registro del pedido (editable, por defecto hoy); tipo date para
  // que no haya corrimiento de día por zona horaria.
  registeredDate: date('registered_date', { mode: 'string' }).notNull().default(sql`CURRENT_DATE`),
  date: timestamp('date').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const saleItems = pgTable('sale_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  saleId: uuid('sale_id').references(() => sales.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  // Origen de la línea: de qué almacén sale el producto (el "dónde recoger").
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
  // Longitud de la línea (ej. viguetas de 5 m); texto libre "5 m", "4.5 m".
  longitud: varchar('longitud', { length: 50 }),
});

export const productions = pgTable('productions', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
  status: productionStatusEnum('status').notNull().default('pending'),
  // Opcional: producción destinada a una venta programada.
  saleId: uuid('sale_id').references(() => sales.id),
  date: timestamp('date').defaultNow(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  notes: varchar('notes', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Préstamo de puntales/soleras a un cliente. Registro 100% independiente:
// NO tiene foreign keys (el cliente se guarda como texto, no se relaciona
// con `clients` ni con ninguna otra tabla).
export const puntales = pgTable('puntales', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Cliente en texto libre (sin relación con la tabla clients)
  clientName: varchar('client_name', { length: 255 }).notNull(),
  loanDate: timestamp('loan_date').notNull(),
  pickupDate: timestamp('pickup_date').notNull(),
  material: puntalMaterialEnum('material').notNull(),
  quantity: integer('quantity').notNull(),
  place: varchar('place', { length: 500 }).notNull(),
  description: text('description'),
  status: puntalStatusEnum('status').notNull().default('en_obra'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: varchar('token', { length: 500 }).notNull().unique(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
