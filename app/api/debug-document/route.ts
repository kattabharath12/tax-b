// Create this file: app/api/debug-document/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { existsSync, readdirSync } from "fs"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  console.log("=== DEBUG DOCUMENT START ===")
  
  try {
    // Step 1: Check database connection
    console.log("1. Testing database connection...")
    await prisma.$connect()
    console.log("✅ Database connected")
    
    // Step 2: Get document count
    console.log("2. Getting document count...")
    const documentCount = await prisma.document.count()
    console.log("Document count:", documentCount)
    
    // Step 3: Get the specific document
    const testDocId = "cmdtbglhj0004mm0x7jgoqjgf"
    console.log("3. Looking for test document:", testDocId)
    
    const document = await prisma.document.findUnique({
      where: { id: testDocId }
    })
    
    // Step 4: Check file system
    console.log("4. Checking file system...")
    let filesystemInfo = {
      appExists: false,
      documentsExists: false,
      documentsContents: [],
      testFileExists: false
    }
    
    try {
      // Check if /app directory exists
      filesystemInfo.appExists = existsSync('/app')
      console.log("/app exists:", filesystemInfo.appExists)
      
      // Check if /app/documents directory exists
      filesystemInfo.documentsExists = existsSync('/app/documents')
      console.log("/app/documents exists:", filesystemInfo.documentsExists)
      
      // List contents of documents directory if it exists
      if (filesystemInfo.documentsExists) {
        filesystemInfo.documentsContents = readdirSync('/app/documents')
        console.log("Documents directory contents:", filesystemInfo.documentsContents)
      }
      
      // Check if the specific test file exists
      if (document?.filePath) {
        filesystemInfo.testFileExists = existsSync(document.filePath)
        console.log("Test file exists at", document.filePath, ":", filesystemInfo.testFileExists)
      }
      
    } catch (fsError) {
      console.log("File system error:", fsError.message)
    }
    
    // Step 5: Environment variables check
    console.log("5. Checking environment variables...")
    const envCheck = {
      hasGoogleCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
      hasGoogleProject: !!process.env.GOOGLE_CLOUD_PROJECT_ID,
      hasGoogleProcessor: !!process.env.GOOGLE_CLOUD_W2_PROCESSOR_ID,
      hasAbacusAI: !!process.env.ABACUSAI_API_KEY,
      hasDatabase: !!process.env.DATABASE_URL,
      hasNextAuth: !!process.env.NEXTAUTH_SECRET
    }
    
    console.log("Environment variables:", envCheck)
    
    return NextResponse.json({
      success: true,
      documentCount,
      testDocument: document ? {
        id: document.id,
        filename: document.filename,
        filePath: document.filePath,
        fileType: document.fileType,
        documentType: document.documentType,
        processingStatus: document.processingStatus
      } : null,
      filesystem: filesystemInfo,
      environment: envCheck,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error("=== DEBUG ERROR ===")
    console.error("Error:", error)
    
    return NextResponse.json({
      error: error.message,
      type: error.constructor.name,
      stack: error.stack?.substring(0, 500)
    }, { status: 500 })
  }
}
