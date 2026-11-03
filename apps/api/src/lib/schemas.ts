import { Type, type Static, type TEnum, type TObject, type TProperties, type TSchema } from '@fastify/type-provider-typebox';

export const Id = Type.Integer({ minimum: 1 });
export const IdParams = Type.Object({ id: Id });

export function StringEnum<const T extends readonly string[]>(values: T, opts: { description?: string } = {}) {
  return Type.Enum([...values], opts) as unknown as TEnum<[...T]>;
}

export function Merge<A extends TProperties, B extends TProperties>(a: TObject<A>, b: TObject<B>) {
  return Type.Object({ ...a.properties, ...b.properties } as A & B);
}

export const Nullable = <T extends TSchema>(schema: T) => {
  // A scalar anyOf can coerce JSON null into 0/'' before considering the null branch.
  // OpenAPI nullable keeps null in the accepted type set, so AJV never coerces it.
  const json = schema as TSchema & { type?: unknown; enum?: unknown; const?: unknown };
  if (typeof json.type === 'string' && json.enum === undefined && json.const === undefined) {
    return Type.Unsafe<Static<T> | null>({ ...schema, nullable: true });
  }
  return Type.Union([schema, Type.Null()]);
};

export const DateTimeStr = Type.String({ format: 'date-time' });
export const Cents = Type.Integer({ minimum: 0, maximum: 9_000_000_000_000, description: 'Valor em centavos' });
export const CurrencyCode = Type.String({ pattern: '^[A-Z]{3}$' });

export const Pagination = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

export const ErrorResponse = Type.Object({
  error: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Unknown()),
});

export function paged<T extends TSchema>(item: T) {
  return Type.Object({ items: Type.Array(item), total: Type.Integer(), page: Type.Integer(), pageSize: Type.Integer() });
}

export function pageArgs(q: { page?: number; pageSize?: number }) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
