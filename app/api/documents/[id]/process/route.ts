import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/db"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"

export const dynamic = "force-dynamic"

// Types for extracted data
interface ExtractedTaxData {
  documentType: string
  ocrText: string
  extractedData: any
  confidence: number
  processingMethod?: 'google_document_ai' | 'abacus_ai'
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  console.log("=== DOCUMENT PROCESSING START ===")
  console.log("Document ID:", params.id)
  
  try {
    // Step 1: Authentication
    console.log("1. Checking authentication...")
    const session = await getServerSession()
    
    if (!session?.user?.email) {
      console.log("❌ No session found")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    console.log("✅ Session found for:", session.user.email)

    // Step 2: Find user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      console.log("❌ User not found")
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    console.log("✅ User found:", user.id)

    // Step 3: Find document
    const document = await prisma.document.findFirst({
      where: { 
        id: params.id,
        taxReturn: {
          userId: user.id
        }
      }
    })

    if (!document) {
      console.log("❌ Document not found for user")
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }
    console.log("✅ Document found:", {
      id: document.id,
      filename: document.filename,
      documentType: document.documentType,
      filePath: document.filePath
    })

    // Step 4: Set up Google Cloud credentials securely
    console.log("4. Setting up Google Cloud credentials...")
    await setupGoogleCredentials()

    // Step 5: Check environment variables
    console.log("5. Checking environment variables...")
    const hasGoogleDocAI = !!(
      process.env.GOOGLE_CLOUD_PROJECT_ID && 
      process.env.GOOGLE_CLOUD_W2_PROCESSOR_ID &&
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    )
    const hasAbacusAI = !!process.env.ABACUSAI_API_KEY

    console.log("Environment check:", {
      hasGoogleDocAI,
      hasAbacusAI,
      googleProject: process.env.GOOGLE_CLOUD_PROJECT_ID
    })

    if (!hasGoogleDocAI && !hasAbacusAI) {
      console.log("❌ No AI service configured")
      return NextResponse.json(
        { error: "No document processing service configured" }, 
        { status: 500 }
      )
    }

    // Step 6: Update status to processing
    console.log("6. Updating status to PROCESSING...")
    await prisma.document.update({
      where: { id: params.id },
      data: { 
        processingStatus: 'PROCESSING',
        updatedAt: new Date()
      }
    })
    console.log("✅ Status updated")

    // Step 7: Process document
    console.log("7. Starting document processing...")
    let extractedTaxData: ExtractedTaxData

    if (hasGoogleDocAI) {
      console.log("7a. Trying Google Document AI first...")
      try {
        extractedTaxData = await processWithGoogleDocumentAI(document)
        console.log("✅ Google Document AI processing successful")
      } catch (googleError) {
        console.log("❌ Google Document AI failed:", googleError.message)
        
        if (hasAbacusAI) {
          console.log("7b. Falling back to Abacus AI...")
          extractedTaxData = await processWithAbacusAI(document)
          console.log("✅ Abacus AI fallback successful")
        } else {
          throw googleError
        }
      }
    } else {
      console.log("7b. Using Abacus AI directly...")
      extractedTaxData = await processWithAbacusAI(document)
      console.log("✅ Abacus AI processing successful")
    }

    // Step 8: Save results
    console.log("8. Saving results to database...")
    await prisma.document.update({
      where: { id: params.id },
      data: {
        ocrText: extractedTaxData.ocrText,
        extractedData: {
          documentType: extractedTaxData.documentType,
          ocrText: extractedTaxData.ocrText,
          extractedData: extractedTaxData.extractedData,
          confidence: extractedTaxData.confidence,
          processingMethod: extractedTaxData.processingMethod
        },
        processingStatus: 'COMPLETED',
        updatedAt: new Date()
      }
    })
    console.log("✅ Results saved")

    // Step 9: Return results
    return NextResponse.json({
      success: true,
      message: "Document processed successfully",
      processingMethod: extractedTaxData.processingMethod,
      documentType: extractedTaxData.documentType,
      confidence: extractedTaxData.confidence,
      extractedData: extractedTaxData.extractedData,
      ocrTextPreview: extractedTaxData.ocrText?.substring(0, 500) + "..."
    })

  } catch (error) {
    console.error("=== DOCUMENT PROCESSING ERROR ===")
    console.error("Error:", error.message)
    console.error("Stack:", error.stack?.substring(0, 1000))
    
    // Update status to failed
    try {
      await prisma.document.update({
        where: { id: params.id },
        data: { processingStatus: 'FAILED' }
      })
    } catch (updateError) {
      console.error("Failed to update status:", updateError.message)
    }

    return NextResponse.json(
      { 
        error: "Document processing failed",
        details: error.message
      },
      { status: 500 }
    )
  }
}

// Function to securely set up Google Cloud credentials at runtime
async function setupGoogleCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    console.log("No Google credentials JSON found in environment")
    return
  }

  try {
    // Create temp directory for credentials
    const credentialsDir = '/tmp/credentials'
    const credentialsPath = '/tmp/credentials/google-service-account.json'
    
    // Create directory if it doesn't exist
    mkdirSync(credentialsDir, { recursive: true })
    
    // Write the credentials JSON to a temporary file
    writeFileSync(credentialsPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    
    // Set the environment variable for Google Cloud SDK
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath
    
    console.log("✅ Google Cloud credentials set up at runtime")
  } catch (error) {
    console.error("❌ Failed to set up Google credentials:", error.message)
    throw new Error(`Failed to set up Google credentials: ${error.message}`)
  }
}

// Google Document AI processing
async function processWithGoogleDocumentAI(document: any): Promise<ExtractedTaxData> {
  console.log("processWithGoogleDocumentAI: Starting...")
  
  try {
    // Dynamic import to avoid issues if library is not installed
    const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai')
    
    // Initialize the client - it will use the credentials we set up
    const client = new DocumentProcessorServiceClient()
    
    console.log("processWithGoogleDocumentAI: Client initialized")
    
    // Read the document file
    const { readFile } = await import("fs/promises")
    const imageFile = await readFile(document.filePath)
    
    // Use the Form Parser processor we have
    const processorId = process.env.GOOGLE_CLOUD_W2_PROCESSOR_ID
    const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/locations/us/processors/${processorId}`
    
    console.log("processWithGoogleDocumentAI: Using processor:", name)
    
    // Configure the request
    const request = {
      name,
      rawDocument: {
        content: imageFile,
        mimeType: document.fileType || 'application/pdf',
      },
    }

    console.log("processWithGoogleDocumentAI: Sending request to Google...")
    
    // Process the document
    const [result] = await client.processDocument(request)
    const { document: docResult } = result
    
    console.log("processWithGoogleDocumentAI: Processing complete")
    
    // Extract text and entities
    const ocrText = docResult?.text || ''
    const entities = docResult?.entities || []
    
    // Convert entities to structured data
    const extractedData: any = {}
    entities.forEach((entity: any) => {
      if (entity.type && entity.normalizedValue?.text) {
        extractedData[entity.type] = entity.normalizedValue.text
      } else if (entity.type && entity.textAnchor?.content) {
        extractedData[entity.type] = entity.textAnchor.content
      }
    })
    
    return {
      documentType: document.documentType,
      ocrText,
      extractedData,
      confidence: docResult?.entities?.[0]?.confidence || 0.9,
      processingMethod: 'google_document_ai'
    }
    
  } catch (error) {
    console.error("processWithGoogleDocumentAI: Error:", error.message)
    throw new Error(`Google Document AI processing failed: ${error.message}`)
  }
}

// Abacus AI processing (your existing logic)
async function processWithAbacusAI(document: any): Promise<ExtractedTaxData> {
  console.log("processWithAbacusAI: Starting...")
  
  try {
    const { readFile } = await import("fs/promises")
    const fileBuffer = await readFile(document.filePath)
    const base64String = fileBuffer.toString('base64')
    
    const messages = [{
      role: "user" as const,
      content: [
        {
          type: "file",
          file: {
            filename: document.filename || document.fileName,
            file_data: `data:${document.fileType};base64,${base64String}`
          }
        },
        {
          type: "text",
          text: getExtractionPrompt(document.documentType)
        }
      ]
    }]

    console.log("processWithAbacusAI: Calling API...")
    
    const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: messages,
        stream: false,
        max_tokens: 3000,
        response_format: { type: "json_object" }
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Abacus AI API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content returned from Abacus AI API')
    }

    const parsedContent = JSON.parse(content)
    
    return {
      documentType: parsedContent.documentType || document.documentType,
      ocrText: parsedContent.ocrText || '',
      extractedData: parsedContent.extractedData || parsedContent,
      confidence: 0.85,
      processingMethod: 'abacus_ai'
    }
    
  } catch (error) {
    console.error("processWithAbacusAI: Error:", error.message)
    throw new Error(`Abacus AI processing failed: ${error.message}`)
  }
}

function getExtractionPrompt(documentType: string): string {
  return `Please extract all tax-related information from this document and return it in JSON format.

Please respond in JSON format with the following structure:
{
  "documentType": "${documentType}",
  "ocrText": "Full OCR text from the document",
  "extractedData": {
    // Document-specific fields based on document type
    "payerName": "Payer/employer name if applicable",
    "recipientName": "Recipient/employee name if applicable",
    "incomeAmount": "Any income amounts",
    "taxWithheld": "Any tax withheld amounts"
  }
}

Respond with raw JSON only. Do not include code blocks, markdown, or any other formatting.`
}
