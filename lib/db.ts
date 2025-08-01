import { PrismaClient } from '@prisma/client'

declare global {
  var prisma: PrismaClient | undefined
}

let prisma: PrismaClient

if (process.env.NODE_ENV === 'production') {
  // In production, always create a new instance and connect immediately
  prisma = new PrismaClient({
    log: ['error'],
  })
  
  // Force immediate connection
  prisma.$connect().then(() => {
    console.log('✅ Prisma connected successfully')
  }).catch((error) => {
    console.error('❌ Prisma connection failed:', error)
  })
} else {
  // In development, use global instance
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    })
  }
  prisma = global.prisma
}

export { prisma }
