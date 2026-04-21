const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.user.deleteMany().then(console.log).finally(() => process.exit(0));
