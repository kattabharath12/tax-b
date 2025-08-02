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
    // Parse and validate the JSON
    const credentialsJson = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    
    // Validate required fields
    if (!credentialsJson.type || !credentialsJson.project_id || !credentialsJson.private_key) {
      throw new Error("Invalid credentials JSON structure")
    }
    
    console.log("✅ Credentials JSON parsed successfully")
    console.log("Project ID:", credentialsJson.project_id)
    console.log("Client email:", credentialsJson.client_email)
    
    // Create temp directory for credentials
    const credentialsDir = '/tmp/credentials'
    const credentialsPath = '/tmp/credentials/google-service-account.json'
    
    // Create directory if it doesn't exist
    mkdirSync(credentialsDir, { recursive: true })
    
    // Fix the private key format - ensure proper line breaks
    const fixedCredentials = {
      ...credentialsJson,
      private_key: credentialsJson.private_key.replace(/\\n/g, '\n')
    }
    
    // Write the fixed credentials JSON to a temporary file
    writeFileSync(credentialsPath, JSON.stringify(fixedCredentials, null, 2))
    
    // Set the environment variable for Google Cloud SDK
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath
    
    console.log("✅ Google Cloud credentials set up at runtime with fixed formatting")
    
    // Verify the file was written correctly
    const { readFileSync } = await import("fs")
    const writtenContent = readFileSync(credentialsPath, 'utf8')
    const parsed = JSON.parse(writtenContent)
    console.log("✅ Credentials file verified - project:", parsed.project_id)
    
    // Test if the private key format is correct
    if (!parsed.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error("Private key format is incorrect")
    }
    console.log("✅ Private key format verified")
    
  } catch (error) {
    console.error("❌ Failed to set up Google credentials:", error.message)
    throw new Error(`Failed to set up Google credentials: ${error.message}`)
  }
}

// ✅ COMPLETE Google Document AI processing function
async function processWithGoogleDocumentAI(document: any): Promise<ExtractedTaxData> {
  console.log("processWithGoogleDocumentAI: Starting...")
  
  try {
    // Dynamic import to avoid issues if library is not installed
    const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai')
    
    // Initialize the client with explicit configuration
    const client = new DocumentProcessorServiceClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      // Add explicit API endpoint for US region
      apiEndpoint: 'us-documentai.googleapis.com',
    })
    
    console.log("processWithGoogleDocumentAI: Client initialized with explicit config")
    
    // Read the document file
    const { readFile } = await import("fs/promises")
    
    // Check if file exists first
    const { existsSync } = await import("fs")
    if (!existsSync(document.filePath)) {
      throw new Error(`File not found: ${document.filePath}`)
    }
    
    const imageFile = await readFile(document.filePath)
    console.log("processWithGoogleDocumentAI: File read successfully, size:", imageFile.length)
    
    // Use the Form Parser processor we have
    const processorId = process.env.GOOGLE_CLOUD_W2_PROCESSOR_ID
    const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/locations/us/processors/${processorId}`
    
    console.log("processWithGoogleDocumentAI: Using processor:", name)
    
    // Configure the request with proper MIME type detection
    let mimeType = document.fileType || 'application/pdf'
    if (document.filePath?.toLowerCase().endsWith('.png')) {
      mimeType = 'image/png'
    } else if (document.filePath?.toLowerCase().endsWith('.jpg') || document.filePath?.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg'
    }
    
    const request = {
      name,
      rawDocument: {
        content: imageFile,
        mimeType: mimeType,
      },
    }

    console.log("processWithGoogleDocumentAI: Sending request to Google with MIME type:", mimeType)
    
    // Process the document with timeout
    const [result] = await Promise.race([
      client.processDocument(request),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Google Document AI timeout')), 30000)
      )
    ]) as any
    
    const { document: docResult } = result
    
    console.log("processWithGoogleDocumentAI: Processing complete")
    
    // Extract text and entities
    const ocrText = docResult?.text || ''
    const entities = docResult?.entities || []
    
    console.log("processWithGoogleDocumentAI: Extracted text length:", ocrText.length)
    console.log("processWithGoogleDocumentAI: Found entities:", entities.length)
    
    // ✅ Initialize extractedData here
    const extractedData: any = {}
    
    // Process entities from Google Document AI
    entities.forEach((entity: any, index: number) => {
      console.log(`Entity ${index}:`, {
        type: entity.type,
        mentionText: entity.mentionText,
        confidence: entity.confidence,
        normalizedValue: entity.normalizedValue
      })
      
      if (entity.type && entity.mentionText) {
        // Map Google Document AI entity types to our field names
        const fieldMapping: Record<string, string> = {
          // W-2 specific mappings
          'employee_name': 'employeeName',
          'employee_address': 'employeeAddress', 
          'employee_ssn': 'employeeSSN',
          'employer_name': 'employerName',
          'employer_address': 'employerAddress',
          'employer_ein': 'employerEIN',
          'wages_tips_other_compensation': 'wages',
          'federal_income_tax_withheld': 'federalTaxWithheld',
          'social_security_wages': 'socialSecurityWages',
          'social_security_tax_withheld': 'socialSecurityTaxWithheld',
          'medicare_wages_and_tips': 'medicareWages',
          'medicare_tax_withheld': 'medicareTaxWithheld',
          'state_wages_tips_etc': 'stateWages',
          'state_income_tax': 'stateTaxWithheld',
          
          // Generic mappings
          'amount': 'amount',
          'date': 'date',
          'total': 'total'
        }
        
        const fieldName = fieldMapping[entity.type.toLowerCase()] || entity.type
        
        // Use normalized value if available, otherwise use mention text
        let value = entity.normalizedValue?.text || entity.mentionText
        
        // Clean up monetary values
        if (value && (fieldName.includes('wages') || fieldName.includes('Tax') || fieldName.includes('amount'))) {
          value = value.replace(/[,$]/g, '')
        }
        
        extractedData[fieldName] = value
      }
    })
    
    // If no entities found, try to extract data from OCR text using regex
    if (Object.keys(extractedData).length === 0 && ocrText) {
      console.log("processWithGoogleDocumentAI: No entities found, trying regex extraction from OCR text")
      
      // ===== DEBUGGING SECTION =====
      console.log('=== DEBUGGING EXTRACTED TEXT ===')
      console.log('📄 OCR Text Sample (first 2000 chars):')
      console.log(JSON.stringify(ocrText.substring(0, 2000)))
      
      console.log('📋 OCR Text Lines Analysis:')
      const lines = ocrText.split('\n')
      lines.slice(0, 50).forEach((line, index) => { // First 50 lines
        const trimmed = line.trim()
        if (trimmed.length > 2) {
          console.log(`Line ${index.toString().padStart(2, '0')}: "${trimmed}"`)
        }
      })
      
      // ===== ENHANCED EXTRACTION =====
      console.log('🎯 Starting enhanced extraction strategies...')
      
      // Strategy 1: Look for employee names (more comprehensive patterns)
      console.log('🔍 Strategy 1: Employee name patterns')
      const employeePatterns = [
        /Employee.*?name.*?\n([A-Z][A-Za-z\s,.-]+)/i,
        /^([A-Z][A-Z\s]{5,40})$/gm, // All caps line (common for names)
        /([A-Z][A-Z\s]+[A-Z])\s*\n/g, // All caps followed by newline
        /employee.*?([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)/gi,
        /^\s*([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)\s*$/gm // First Last format on its own line
      ]
      
      for (const pattern of employeePatterns) {
        const matches = [...ocrText.matchAll(pattern)]
        for (const match of matches) {
          const name = match[1]?.trim()
          if (name && name.length >= 3 && name.length <= 50) {
            // Validate it's actually a name
            if (!/\d/.test(name) && !/box|form|wage|tax|copy|void|2024|2023/i.test(name)) {
              extractedData.employeeName = name
              console.log('✅ Found employee name:', name)
              break
            }
          }
        }
        if (extractedData.employeeName) break
      }
      
      // Strategy 2: Look for employer name
      console.log('🔍 Strategy 2: Employer name patterns')
      const employerPatterns = [
        /Employer.*?name.*?\n([A-Za-z\s,.'&-]+)/i,
        /([A-Za-z\s,.'&-]+(?:LLC|Inc|Corp|Company|Co\.|and Sons))/gi,
        /employer.*?([A-Za-z\s,.'&-]{3,50})/gi
      ]
      
      for (const pattern of employerPatterns) {
        const match = ocrText.match(pattern)
        if (match && match[1]) {
          const name = match[1].trim()
          if (name.length >= 3 && name.length <= 80) {
            extractedData.employerName = name
            console.log('✅ Found employer name:', name)
            break
          }
        }
      }
      
      // Strategy 3: Look for specific amounts and identifiers
      console.log('🔍 Strategy 3: Specific data extraction')
      
      // Look for wages in Box 1
      const wagePatterns = [
        /1\s+Wages.*?([0-9,]+\.?[0-9]*)/i,
        /wages.*?([0-9,]+\.?[0-9]*)/gi,
        /\$([0-9,]+\.?[0-9]*)/g
      ]
      
      for (const pattern of wagePatterns) {
        const match = ocrText.match(pattern)
        if (match) {
          const amount = match[1] ? match[1].replace(/,/g, '') : match[0].replace(/[$,]/g, '')
          if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
            extractedData.wages = amount
            console.log('✅ Found wages:', amount)
            break
          }
        }
      }
      
      // Look for federal tax withheld
      const fedTaxPatterns = [
        /2\s+Federal.*?([0-9,]+\.?[0-9]*)/i,
        /federal.*?tax.*?([0-9,]+\.?[0-9]*)/gi
      ]
      
      for (const pattern of fedTaxPatterns) {
        const match = ocrText.match(pattern)
        if (match) {
          const amount = match[1] ? match[1].replace(/,/g, '') : match[0].replace(/[$,]/g, '')
          if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
            extractedData.federalTaxWithheld = amount
            console.log('✅ Found federal tax:', amount)
            break
          }
        }
      }
      
      // Look for EIN
      const einMatch = ocrText.match(/(\d{2}-\d{7})/g)
      if (einMatch) {
        extractedData.employerEIN = einMatch[0]
        console.log('✅ Found EIN:', einMatch[0])
      }
      
      // Look for SSN
      const ssnMatch = ocrText.match(/(\d{3}-\d{2}-\d{4})/g)
      if (ssnMatch) {
        extractedData.employeeSSN = ssnMatch[0]
        console.log('✅ Found SSN:', ssnMatch[0])
      }
      
      // Strategy 4: If still no employee name, try aggressive line-by-line search
      if (!extractedData.employeeName) {
        console.log('🔍 Strategy 4: Aggressive name search')
        
        for (let i = 0; i < Math.min(30, lines.length); i++) {
          const line = lines[i].trim()
          
          // Look for lines that are likely names
          if (line.length >= 5 && line.length <= 40) {
            // All caps or title case, letters and spaces only
            if (/^[A-Z][A-Z\s]+$/.test(line) || /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line)) {
              // Not a form field or number
              if (!/^(FORM|BOX|WAGE|TAX|COPY|VOID|2024|2023|\d|EMPLOYEE|EMPLOYER)/.test(line)) {
                extractedData.employeeName = line
                console.log('✅ Found employee name (aggressive):', line)
                break
              }
            }
          }
        }
      }
      
      // Log all found data patterns
      console.log('💰 Looking for all dollar amounts:')
      const moneyMatches = [...ocrText.matchAll(/\$?([0-9,]+\.?[0-9]*)/g)]
      console.log('Money matches found:', moneyMatches.slice(0, 10).map(m => m[1]))
      
      console.log('🔤 Looking for potential name patterns:')
      const nameMatches = [...ocrText.matchAll(/([A-Z][A-Z\s]{10,40})/g)]
      console.log('Name patterns found:', nameMatches.map(m => m[1]?.trim()).filter(Boolean))
    }
    
    console.log("processWithGoogleDocumentAI: Final extracted data:", extractedData)
    
    return {
      documentType: document.documentType,
      ocrText,
      extractedData,
      confidence: docResult?.entities?.[0]?.confidence || 0.9,
      processingMethod: 'google_document_ai'
    }
    
  } catch (error) {
    console.error("processWithGoogleDocumentAI: Error:", error.message)
    console.error("processWithGoogleDocumentAI: Error stack:", error.stack?.substring(0, 500))
    throw new Error(`Google Document AI processing failed: ${error.message}`)
  }
}

// Abacus AI processing with multiple endpoint/auth attempts
async function processWithAbacusAI(document: any): Promise<ExtractedTaxData> {
  console.log("processWithAbacusAI: Starting...")
  
  try {
    const { readFile } = await import("fs/promises")
    const fileBuffer = await readFile(document.filePath)
    const base64String = fileBuffer.toString('base64')
    
    console.log("processWithAbacusAI: File read and converted to base64")
    
    // Try different endpoint formats for Abacus AI
    const endpoints = [
      'https://cloud.abacus.ai/api/v1/chat/completions',
      'https://api.abacus.ai/v1/chat/completions', 
      'https://apps.abacus.ai/v1/chat/completions'
    ]
    
    const headers = {
      'Content-Type': 'application/json'
    }
    
    // Try different authentication formats
    const authHeaders = [
      { 'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}` },
      { 'X-API-Key': process.env.ABACUSAI_API_KEY },
      { 'API-Key': process.env.ABACUSAI_API_KEY },
      { 'Authorization': `Token ${process.env.ABACUSAI_API_KEY}` }
    ]
    
    const messages = [{
      role: "user" as const,
      content: [
        {
          type: "text",
          text: getExtractionPrompt(document.documentType)
        },
        {
          type: "image_url",
          image_url: {
            url: `data:${document.fileType || 'application/pdf'};base64,${base64String}`
          }
        }
      ]
    }]

    const requestBody = {
      model: 'gpt-4o-mini', // Try different model names
      messages: messages,
      max_tokens: 3000,
      response_format: { type: "json_object" }
    }

    console.log("processWithAbacusAI: Trying different endpoints and auth methods...")
    
    // Try each combination
    for (let i = 0; i < endpoints.length; i++) {
      for (let j = 0; j < authHeaders.length; j++) {
        try {
          console.log(`processWithAbacusAI: Trying endpoint ${i + 1}/${endpoints.length}, auth ${j + 1}/${authHeaders.length}`)
          
          const response = await fetch(endpoints[i], {
            method: 'POST',
            headers: {
              ...headers,
              ...authHeaders[j]
            },
            body: JSON.stringify(requestBody)
          })

          console.log(`processWithAbacusAI: Response status: ${response.status}`)
          
          if (response.ok) {
            const result = await response.json()
            console.log("processWithAbacusAI: Success with endpoint:", endpoints[i])
            console.log("processWithAbacusAI: Success with auth:", Object.keys(authHeaders[j])[0])
            
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
          } else {
            const errorText = await response.text()
            console.log(`processWithAbacusAI: Failed - ${response.status}: ${errorText}`)
          }
        } catch (fetchError) {
          console.log(`processWithAbacusAI: Fetch error:`, fetchError.message)
        }
      }
    }
    
    throw new Error('All Abacus AI endpoint combinations failed')
    
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
