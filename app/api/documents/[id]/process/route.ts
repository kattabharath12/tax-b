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
  processingMethod: 'google_document_ai'
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

    console.log("Environment check:", {
      hasGoogleDocAI,
      googleProject: process.env.GOOGLE_CLOUD_PROJECT_ID
    })

    if (!hasGoogleDocAI) {
      console.log("❌ Google Document AI not configured")
      return NextResponse.json(
        { error: "Google Document AI service not configured" }, 
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

    // Step 7: Process document with Google Document AI
    console.log("7. Starting Google Document AI processing...")
    const extractedTaxData = await processWithGoogleDocumentAI(document)
    console.log("✅ Google Document AI processing successful")

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

// Google Document AI processing function with FIXED regex patterns
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
    
    // Process the document with extended timeout and retry logic
    console.log("processWithGoogleDocumentAI: Sending request to Google Document AI...")
    
    let result
    let attempts = 0
    const maxAttempts = 3
    const timeoutMs = 60000 // 60 seconds
    
    while (attempts < maxAttempts) {
      attempts++
      console.log(`processWithGoogleDocumentAI: Attempt ${attempts}/${maxAttempts}`)
      
      try {
        const [apiResult] = await Promise.race([
          client.processDocument(request),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Google Document AI timeout after ${timeoutMs/1000} seconds`)), timeoutMs)
          )
        ]) as any
        
        result = apiResult
        console.log("processWithGoogleDocumentAI: Successfully processed document")
        break
        
      } catch (attemptError) {
        console.log(`processWithGoogleDocumentAI: Attempt ${attempts} failed:`, attemptError.message)
        
        if (attempts === maxAttempts) {
          throw attemptError
        }
        
        // Wait before retry
        console.log("processWithGoogleDocumentAI: Waiting 5 seconds before retry...")
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
    
    const { document: docResult } = result
    
    console.log("processWithGoogleDocumentAI: Processing complete")
    
    // Extract text and entities
    const ocrText = docResult?.text || ''
    const entities = docResult?.entities || []
    
    console.log("processWithGoogleDocumentAI: Extracted text length:", ocrText.length)
    console.log("processWithGoogleDocumentAI: Found entities:", entities.length)
    
    // Initialize extractedData
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
    
    // If no entities found, try to extract data from OCR text using FIXED regex
    if (Object.keys(extractedData).length === 0 && ocrText) {
      console.log("processWithGoogleDocumentAI: No entities found, trying DYNAMIC regex extraction from OCR text")
      
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
      
      // ===== DYNAMIC EXTRACTION (FIXED REGEX PATTERNS) =====
      console.log('🎯 Starting dynamic extraction strategies...')
      
      // Strategy 1: Look for employee names (FIXED - use match() for non-global patterns)
      console.log('🔍 Strategy 1: Employee name patterns')
      
      // Pattern 1: Look for "Employee's name, address, and ZIP code" followed by name
      const employeePattern1 = /Employee's name, address, and ZIP code\s*\n([A-Z][A-Za-z\s,.-]+)/i
      const match1 = ocrText.match(employeePattern1)
      if (match1 && match1[1]) {
        const name = match1[1].trim()
        console.log('🔍 Testing employee name (pattern 1):', name)
        if (name.length >= 5 && name.length <= 50) {
          extractedData.employeeName = name
          console.log('✅ Found employee name (pattern 1):', name)
        }
      }
      
      // Pattern 2: Look for all caps names followed by address patterns (use global flag for matchAll)
      if (!extractedData.employeeName) {
        const employeePattern2 = /\n([A-Z][A-Z\s]{5,40})\n\d+.*(?:APT|SUITE|DRIVE|ST|STREET|ROAD|AVE|AVENUE)/gi
        const matches2 = [...ocrText.matchAll(employeePattern2)]
        for (const match of matches2) {
          const name = match[1]?.trim()
          console.log('🔍 Testing employee name (pattern 2):', name)
          
          if (name && name.length >= 5 && name.length <= 50) {
            if (/^[A-Z][A-Z\s]+$/.test(name) && 
                !/BOX|FORM|WAGE|TAX|COPY|VOID|2024|2023|EMPLOYER|EMPLOYEE|UNIVERSITY|COLLEGE|CORP|LLC|INC|DRIVE|SUITE|STREET|ROAD|AVE|DENTON|TEXAS|CALIFORNIA|FLORIDA/i.test(name)) {
              
              const words = name.split(/\s+/)
              if (words.length >= 2 && words.every(word => word.length >= 2)) {
                extractedData.employeeName = name
                console.log('✅ Found employee name (pattern 2):', name)
                break
              }
            }
          }
        }
      }
      
      // Pattern 3: Look for simple all-caps names (use global flag for matchAll)
      if (!extractedData.employeeName) {
        const employeePattern3 = /^([A-Z][A-Z\s]{5,40})$/gm
        const matches3 = [...ocrText.matchAll(employeePattern3)]
        for (const match of matches3) {
          const name = match[1]?.trim()
          console.log('🔍 Testing employee name (pattern 3):', name)
          
          if (name && name.length >= 5 && name.length <= 50) {
            if (!/BOX|FORM|WAGE|TAX|COPY|VOID|2024|2023|EMPLOYER|EMPLOYEE|UNIVERSITY|COLLEGE|CORP|LLC|INC|DRIVE|SUITE|STREET|ROAD|AVE|DENTON|TEXAS|CALIFORNIA|FLORIDA|NEW YORK|CHICAGO|DALLAS|HOUSTON|ATLANTA/i.test(name)) {
              
              const words = name.split(/\s+/)
              if (words.length >= 2 && words.every(word => word.length >= 2)) {
                extractedData.employeeName = name
                console.log('✅ Found employee name (pattern 3):', name)
                break
              }
            }
          }
        }
      }
      
      // Strategy 2: Look for employer name (use match() for single results)
      console.log('🔍 Strategy 2: Employer name patterns')
      
      // Pattern 1: Look for "Employer's name, address, and ZIP code" followed by name
      const employerPattern1 = /Employer's name, address, and ZIP code\s*\n([A-Za-z\s,.'&-]+)/i
      const empMatch1 = ocrText.match(employerPattern1)
      if (empMatch1 && empMatch1[1]) {
        const name = empMatch1[1].trim()
        console.log('🔍 Testing employer name (pattern 1):', name)
        if (name.length >= 3 && name.length <= 100) {
          const cleanName = name.replace(/\n/g, ' ').trim()
          if (cleanName && !/BOX|FORM|WAGE|TAX|COPY|VOID|2024|2023|EMPLOYEE/i.test(cleanName)) {
            extractedData.employerName = cleanName
            console.log('✅ Found employer name (pattern 1):', cleanName)
          }
        }
      }
      
      // Pattern 2: Look for company indicators (use match() for single result)
      if (!extractedData.employerName) {
        const employerPattern2 = /\n([A-Z\s]+(?:UNIVERSITY|COLLEGE|COMPANY|CORPORATION|CORP|LLC|INC|GROUP|SYSTEMS|SERVICES|SOLUTIONS)[A-Z\s]*)/i
        const empMatch2 = ocrText.match(employerPattern2)
        if (empMatch2 && empMatch2[1]) {
          const name = empMatch2[1].trim()
          console.log('🔍 Testing employer name (pattern 2):', name)
          if (name.length >= 3 && name.length <= 100) {
            const cleanName = name.replace(/\n/g, ' ').trim()
            if (cleanName && !/BOX|FORM|WAGE|TAX|COPY|VOID|2024|2023|EMPLOYEE/i.test(cleanName)) {
              extractedData.employerName = cleanName
              console.log('✅ Found employer name (pattern 2):', cleanName)
            }
          }
        }
      }
      
      // Strategy 3: Look for wages (Box 1) - use match() for single results
      console.log('🔍 Strategy 3: Wage extraction')
      
      const wagePattern1 = /1\s+Wages,?\s*tips,?\s*other\s*comp\.?\s*\n?\s*([0-9,]+\.?[0-9]*)/i
      const wageMatch1 = ocrText.match(wagePattern1)
      if (wageMatch1 && wageMatch1[1]) {
        const amount = wageMatch1[1].replace(/,/g, '')
        console.log('🔍 Testing wage match (pattern 1):', amount)
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
          extractedData.wages = amount
          console.log('✅ Found wages (pattern 1):', amount)
        }
      }
      
      // Alternative wage pattern
      if (!extractedData.wages) {
        const wagePattern2 = /Wages,?\s*tips,?\s*other\s*comp\.?\s*\n?\s*([0-9,]+\.?[0-9]*)/i
        const wageMatch2 = ocrText.match(wagePattern2)
        if (wageMatch2 && wageMatch2[1]) {
          const amount = wageMatch2[1].replace(/,/g, '')
          console.log('🔍 Testing wage match (pattern 2):', amount)
          if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
            extractedData.wages = amount
            console.log('✅ Found wages (pattern 2):', amount)
          }
        }
      }
      
      // Strategy 4: Look for federal tax withheld (Box 2) - use match() for single results
      console.log('🔍 Strategy 4: Federal tax extraction')
      
      const fedTaxPattern1 = /2\s+Federal\s*income\s*tax\s*withheld\s*\n?\s*([0-9,]+\.?[0-9]*)/i
      const fedMatch1 = ocrText.match(fedTaxPattern1)
      if (fedMatch1 && fedMatch1[1]) {
        const amount = fedMatch1[1].replace(/,/g, '')
        console.log('🔍 Testing federal tax match (pattern 1):', amount)
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) >= 0) {
          extractedData.federalTaxWithheld = amount
          console.log('✅ Found federal tax withheld (pattern 1):', amount)
        }
      }
      
      // Alternative federal tax pattern
      if (!extractedData.federalTaxWithheld) {
        const fedTaxPattern2 = /Federal\s*income\s*tax\s*withheld\s*\n?\s*([0-9,]+\.?[0-9]*)/i
        const fedMatch2 = ocrText.match(fedTaxPattern2)
        if (fedMatch2 && fedMatch2[1]) {
          const amount = fedMatch2[1].replace(/,/g, '')
          console.log('🔍 Testing federal tax match (pattern 2):', amount)
          if (!isNaN(parseFloat(amount)) && parseFloat(amount) >= 0) {
            extractedData.federalTaxWithheld = amount
            console.log('✅ Found federal tax withheld (pattern 2):', amount)
          }
        }
      }
      
      // Strategy 5: Look for EIN (Employer Federal ID) - use match() for single results
      console.log('🔍 Strategy 5: EIN extraction')
      
      const einPattern1 = /Employer's FED ID number\s*\n?([0-9]{2}-[0-9]{7})/i
      const einMatch1 = ocrText.match(einPattern1)
      if (einMatch1 && einMatch1[1]) {
        const ein = einMatch1[1]
        console.log('🔍 Testing EIN match (pattern 1):', ein)
        if (/^[0-9]{2}-[0-9]{7}$/.test(ein)) {
          extractedData.employerEIN = ein
          console.log('✅ Found EIN (pattern 1):', ein)
        }
      }
      
      // Generic EIN pattern
      if (!extractedData.employerEIN) {
        const einPattern2 = /\b([0-9]{2}-[0-9]{7})\b/
        const einMatch2 = ocrText.match(einPattern2)
        if (einMatch2 && einMatch2[1]) {
          const ein = einMatch2[1]
          console.log('🔍 Testing EIN match (pattern 2):', ein)
          if (/^[0-9]{2}-[0-9]{7}$/.test(ein)) {
            extractedData.employerEIN = ein
            console.log('✅ Found EIN (pattern 2):', ein)
          }
        }
      }
      
      // Strategy 6: Look for SSN (Employee Social Security Number) - use match() for single results
      console.log('🔍 Strategy 6: SSN extraction')
      
      const ssnPattern1 = /Employee's SSA number\s*\n?(XXX-XX-[0-9]{4})/i
      const ssnMatch1 = ocrText.match(ssnPattern1)
      if (ssnMatch1 && ssnMatch1[1]) {
        const ssn = ssnMatch1[1]
        console.log('🔍 Testing SSN match (pattern 1):', ssn)
        if (/^XXX-XX-[0-9]{4}$/.test(ssn)) {
          extractedData.employeeSSN = ssn
          console.log('✅ Found SSN (pattern 1):', ssn)
        }
      }
      
      // Generic masked SSN pattern
      if (!extractedData.employeeSSN) {
        const ssnPattern2 = /\b(XXX-XX-[0-9]{4})\b/
        const ssnMatch2 = ocrText.match(ssnPattern2)
        if (ssnMatch2 && ssnMatch2[1]) {
          const ssn = ssnMatch2[1]
          console.log('🔍 Testing SSN match (pattern 2):', ssn)
          if (/^XXX-XX-[0-9]{4}$/.test(ssn)) {
            extractedData.employeeSSN = ssn
            console.log('✅ Found SSN (pattern 2):', ssn)
          }
        }
      }
      
      // Log summary of what we found
      console.log('📊 Final Extraction Summary:')
      console.log('  Employee Name:', extractedData.employeeName || 'NOT FOUND')
      console.log('  Employer Name:', extractedData.employerName || 'NOT FOUND')  
      console.log('  Wages:', extractedData.wages || 'NOT FOUND')
      console.log('  Federal Tax:', extractedData.federalTaxWithheld || 'NOT FOUND')
      console.log('  EIN:', extractedData.employerEIN || 'NOT FOUND')
      console.log('  SSN:', extractedData.employeeSSN || 'NOT FOUND')
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
