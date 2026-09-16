import {
  pgTable, uuid, varchar, integer, decimal, timestamp, pgEnum, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'store']);
export const warehouseTypeEnum = pgEnum('warehouse_type', ['factory', 'store']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'completed', 'cancelled']);
export const productionStatusEnum = pgEnum('production_status', ['pending', 'completed']);

export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: warehouseTypeEnum('type').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: roleEnum('role').notNull().default('store'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  material: varchar('material', { length: 100 }).notNull(),
  measurement: varchar('measurement', { length: 50 }).notNull(),
});

export const stock = pgTable('stock', {
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull().default(0),
}, (table) => ({
  warehouseProductUnique: uniqueIndex('stock_warehouse_product_unique').on(table.warehouseId, table.productId),
}));

export const transfers = pgTable('transfers', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  originId: uuid('origin_id').references(() => warehouses.id).notNull(),
  destinationId: uuid('destination_id').references(() => warehouses.id).notNull(),
  quantity: integer('quantity').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
});

export const sales = pgTable('sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
  date: timestamp('date').defaultNow(),
  userId: uuid('user_id').references(() => users.id).notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id).notNull(),
  deliveryPlace: varchar('delivery_place', { length: 500 }).notNull(),
  deliveryDate: timestamp('delivery_date').notNull(),
  status: orderStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
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
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: varchar('token', { length: 500 }).notNull().unique(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
