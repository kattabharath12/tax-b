import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  console.log("=== TEST ROUTE START ===")
  
  try {
    // Step 1: Test basic response
    console.log("Step 1: Basic route works")
    
    // Step 2: Test Prisma import
    console.log("Step 2: Importing Prisma...")
    const { prisma } = await import('@/lib/db')
    console.log("Step 3: Prisma imported successfully")
    
    // Step 3: Test Prisma connection
    console.log("Step 4: Testing Prisma connection...")
    await prisma.$connect()
    console.log("Step 5: Prisma connected successfully")
    
    // Step 4: Test simple query
    console.log("Step 6: Testing simple query...")
    const userCount = await prisma.user.count()
    console.log("Step 7: Query successful, user count:", userCount)
    
    return NextResponse.json({ 
      message: "All tests passed!",
      userCount,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error("=== TEST ERROR ===")
    console.error("Error name:", error.name)
    console.error("Error message:", error.message)
    console.error("Error stack:", error.stack?.substring(0, 500))
    
    return NextResponse.json({ 
      error: error.message,
      step: "Failed during test execution"
    }, { status: 500 })
  }
}
