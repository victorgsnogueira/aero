// Provisionamento do gateway: garante um usuário SUPERADMIN técnico cuja chave
// de API (X-API-Key) é a configurada em AERO_API_KEY. Executado no container do
// gateway, contra o banco do próprio gateway. Nada de regra comercial aqui.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const apiKey = process.env.AERO_API_KEY;
  if (!email || !password || !apiKey) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD e AERO_API_KEY são obrigatórios');
  if (apiKey.length < 32) throw new Error('AERO_API_KEY deve ter pelo menos 32 caracteres');
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    const hash = await bcrypt.hash(password, 12);
    if (existing) {
      await prisma.user.update({ where: { email }, data: { role: 'SUPERADMIN', apiKey, password: hash } });
      console.log('[aero] usuário técnico atualizado');
    } else {
      await prisma.user.create({ data: { email, name: 'aero', password: hash, role: 'SUPERADMIN', apiKey } });
      console.log('[aero] usuário técnico criado');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[aero] falha no provisionamento:', err.message);
  process.exit(1);
});
