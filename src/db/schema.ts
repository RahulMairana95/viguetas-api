import {
  pgTable, uuid, varchar, integer, decimal, timestamp, pgEnum, uniqueIndex, text,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'promoter', 'superadmin']);
export const warehouseTypeEnum = pgEnum('warehouse_type', ['factory', 'store']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'completed', 'cancelled']);
export const productionStatusEnum = pgEnum('production_status', ['pending', 'completed']);
export const productTypeEnum = pgEnum('product_type', ['vigueta', 'plastoformo']);

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
  role: roleEnum('role').notNull().default('promoter'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

export const transfers = pgTable('transfers', {
  id: uuid('id').defaultRandom().primaryKey(),
  originId: uuid('origin_id').references(() => warehouses.id).notNull(),
  destinationId: uuid('destination_id').references(() => warehouses.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transferItems = pgTable('transfer_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  transferId: uuid('transfer_id').references(() => transfers.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
});

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sales = pgTable('sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id).notNull(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  userId: uuid('user_id').references(() => users.id).notNull(),
  date: timestamp('date').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const saleItems = pgTable('sale_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  saleId: uuid('sale_id').references(() => sales.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id).notNull(),
  deliveryPlace: varchar('delivery_place', { length: 500 }).notNull(),
  deliveryDate: timestamp('delivery_date').notNull(),
  status: orderStatusEnum('status').notNull().default('pending'),
  userId: uuid('user_id').references(() => users.id).notNull(),
  // Adelanto pagado por el cliente al registrar el pedido
  advance: decimal('advance', { precision: 10, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
  // Precio unitario capturado en el pedido (editable, se toma del producto)
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
});

export const productions = pgTable('productions', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
  status: productionStatusEnum('status').notNull().default('pending'),
  orderId: uuid('order_id').references(() => orders.id),
  date: timestamp('date').defaultNow(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  notes: varchar('notes', { length: 500 }),
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
