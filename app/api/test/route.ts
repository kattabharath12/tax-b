import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  console.log("=== TEST ROUTE CALLED ===")
  return NextResponse.json({ message: "Test route works!" })
}

export async function POST() {
  console.log("=== TEST POST ROUTE CALLED ===")
  
  try {
    console.log("Step 1: Route called")
    
    // Test bcrypt
    const bcrypt = await import('bcryptjs')
    console.log("Step 2: bcrypt imported")
    
    // Test prisma
    const { prisma } = await import('@/lib/db')
    console.log("Step 3: prisma imported")
    
    return NextResponse.json({ message: "All imports work!" })
    
  } catch (error) {
    console.error("=== TEST ERROR ===", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
