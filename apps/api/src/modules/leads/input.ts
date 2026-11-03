import { Type, type Static } from '@fastify/type-provider-typebox';
import { Nullable } from '../../lib/schemas.ts';

export const CompanyFields = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, pattern: '\\S' }),
  category: Nullable(Type.String({ maxLength: 191 })), address: Nullable(Type.String({ maxLength: 512 })),
  neighborhood: Nullable(Type.String({ maxLength: 160 })), city: Nullable(Type.String({ maxLength: 160 })),
  state: Nullable(Type.String({ maxLength: 120 })), postalCode: Nullable(Type.String({ maxLength: 32 })),
  countryCode: Nullable(Type.String({ pattern: '^[A-Z]{2}$' })), website: Nullable(Type.String({ maxLength: 512 })),
  mapsUrl: Nullable(Type.String({ maxLength: 1024 })), latitude: Nullable(Type.Number({ minimum: -90, maximum: 90 })),
  longitude: Nullable(Type.Number({ minimum: -180, maximum: 180 })), rating: Nullable(Type.Number({ minimum: 0, maximum: 5 })),
  reviewCount: Nullable(Type.Integer({ minimum: 0 })), timezone: Nullable(Type.String({ maxLength: 64 })),
  notes: Nullable(Type.String({ maxLength: 10000 })),
});
export const CompanyCreate = Type.Object({
  ...Type.Partial(CompanyFields).properties, name: CompanyFields.properties.name,
  phones: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }), { maxItems: 20 })),
  clientKey: Type.String({ pattern: '^[A-Za-z0-9-]{8,64}$' }),
});
export const CompanyPatch = Type.Partial(CompanyFields);
export type CompanyInput = Static<typeof CompanyCreate>;
export type CompanyUpdate = Static<typeof CompanyPatch>;
