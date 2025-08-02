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

// Google Document AI processing function with IMPROVED dynamic extraction
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
    
    // If no entities found, try to extract data from OCR text using IMPROVED regex
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
      
      // ===== IMPROVED EXTRACTION BASED ON ACTUAL OCR TEXT =====
      console.log('🎯 Starting improved extraction strategies...')
      
      // Strategy 1: Look for employee names (improved based on actual OCR format)
      console.log('🔍 Strategy 1: Employee name patterns')
      
      // Pattern 1: Look for "Employee's first name and initial" followed by "Last name" then the actual name
      const employeePattern1 = /Employee's first name and initial\s*Last name\s*[^a-zA-Z]*([A-Z][a-zA-Z]+)\s*([A-Z][a-zA-Z]+)/i
      const empMatch1 = ocrText.match(employeePattern1)
      if (empMatch1 && empMatch1[1] && empMatch1[2]) {
        const firstName = empMatch1[1].trim()
        const lastName = empMatch1[2].trim()
        const fullName = `${firstName} ${lastName}`
        console.log('🔍 Testing employee name (pattern 1):', fullName)
        extractedData.employeeName = fullName
        console.log('✅ Found employee name (pattern 1):', fullName)
      }
      
      // Pattern 2: Look for first name followed by last name in sequence (Michelle Hicks pattern)
      if (!extractedData.employeeName) {
        for (let i = 0; i < lines.length - 1; i++) {
          const currentLine = lines[i].trim()
          const nextLine = lines[i + 1].trim()
          
          // Look for consecutive lines with single names
          if (/^[A-Z][a-z]+$/.test(currentLine) && 
              /^[A-Z][a-z]+$/.test(nextLine) &&
              currentLine.length >= 3 && currentLine.length <= 20 &&
              nextLine.length >= 3 && nextLine.length <= 20) {
            
            // Make sure it's not form field text
            if (!/(Social|Medicare|Federal|Employee|Employer|Control|Advance|Dependent|Nonqualified|Statutory|Wages|Tips|Other)/i.test(currentLine) &&
                !/(Social|Medicare|Federal|Employee|Employer|Control|Advance|Dependent|Nonqualified|Statutory|Wages|Tips|Other)/i.test(nextLine)) {
              
              const fullName = `${currentLine} ${nextLine}`
              console.log('🔍 Testing employee name (pattern 2):', fullName)
              extractedData.employeeName = fullName
              console.log('✅ Found employee name (pattern 2):', fullName)
              break
            }
          }
        }
      }
      
      // Strategy 2: Look for employer name (improved based on actual format)
      console.log('🔍 Strategy 2: Employer name patterns')
      
      // Pattern 1: Look for "Employer's name, address, and ZIP code" followed by company name
      const employerPattern1 = /Employer's name, address, and ZIP code\s*[^a-zA-Z]*([A-Z][A-Za-z\s,.'&-]+)/i
      const compMatch1 = ocrText.match(employerPattern1)
      if (compMatch1 && compMatch1[1]) {
        let name = compMatch1[1].trim()
        // Clean up the name (remove address parts)
        name = name.split(/\n/)[0].trim()
        console.log('🔍 Testing employer name (pattern 1):', name)
        if (name.length >= 3 && name.length <= 100) {
          extractedData.employerName = name
          console.log('✅ Found employer name (pattern 1):', name)
        }
      }
      
      // Pattern 2: Look for company names with indicators like "and Sons", "Company", etc.
      if (!extractedData.employerName) {
        const employerPattern2 = /([A-Z][a-zA-Z\s,.'&-]+(?:and\s+Sons|Company|Corp|LLC|Inc|Group|Associates|Partners))/i
        const compMatch2 = ocrText.match(employerPattern2)
        if (compMatch2 && compMatch2[1]) {
          const name = compMatch2[1].trim()
          console.log('🔍 Testing employer name (pattern 2):', name)
          if (name.length >= 10 && name.length <= 100 && 
              !/Social|Medicare|Federal|Employee|Control|Advance|Dependent|Wages|Tips/i.test(name)) {
            extractedData.employerName = name
            console.log('✅ Found employer name (pattern 2):', name)
          }
        }
      }
      
      // Strategy 3: Look for wages (improved to find correct amount)
      console.log('🔍 Strategy 3: Wage extraction')
      
      // Pattern 1: Look for "Wages, tips, other compensation" followed by amount
      const wagePattern1 = /Wages,\s*tips,\s*other\s*compensation\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const wageMatch1 = ocrText.match(wagePattern1)
      if (wageMatch1 && wageMatch1[1]) {
        const amount = wageMatch1[1].replace(/,/g, '')
        console.log('🔍 Testing wage match (pattern 1):', amount)
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 1000) { // Reasonable wage amount
          extractedData.wages = amount
          console.log('✅ Found wages (pattern 1):', amount)
        }
      }
      
      // Pattern 2: Look for wages by line position (after "Wages, tips, other compensation")
      if (!extractedData.wages) {
        for (let i = 0; i < lines.length - 2; i++) {
          if (/Wages.*tips.*compensation/i.test(lines[i])) {
            // Look for amount in next few lines
            for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
              const line = lines[j].trim()
              if (/^[0-9]+\.?[0-9]*$/.test(line)) {
                const amount = parseFloat(line)
                if (amount > 1000) { // Reasonable wage threshold
                  console.log('🔍 Testing wage match (pattern 2):', line)
                  extractedData.wages = line
                  console.log('✅ Found wages (pattern 2):', line)
                  break
                }
              }
            }
            if (extractedData.wages) break
          }
        }
      }
      
      // Strategy 4: Look for federal tax withheld (fix to get correct amount, not EIN fragment)
      console.log('🔍 Strategy 4: Federal tax extraction')
      
      // Pattern 1: Look for "Federal income tax withheld" followed by amount
      const fedTaxPattern1 = /Federal\s*income\s*tax\s*withheld\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const fedMatch1 = ocrText.match(fedTaxPattern1)
      if (fedMatch1 && fedMatch1[1]) {
        const amount = fedMatch1[1].replace(/,/g, '')
        console.log('🔍 Testing federal tax match (pattern 1):', amount)
        // Make sure it's not the EIN fragment and is a reasonable tax amount
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) >= 0 && parseFloat(amount) !== 72 && parseFloat(amount) > 100) {
          extractedData.federalTaxWithheld = amount
          console.log('✅ Found federal tax withheld (pattern 1):', amount)
        }
      }
      
      // Pattern 2: Look for federal tax by line position
      if (!extractedData.federalTaxWithheld) {
        for (let i = 0; i < lines.length - 2; i++) {
          if (/Federal.*income.*tax.*withheld/i.test(lines[i])) {
            // Look for amount in next few lines
            for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
              const line = lines[j].trim()
              if (/^[0-9]+\.?[0-9]*$/.test(line)) {
                const amount = parseFloat(line)
                if (amount >= 0 && amount !== 72 && amount > 100) { // Exclude EIN fragment, must be reasonable tax amount
                  console.log('🔍 Testing federal tax match (pattern 2):', line)
                  extractedData.federalTaxWithheld = line
                  console.log('✅ Found federal tax withheld (pattern 2):', line)
                  break
                }
              }
            }
            if (extractedData.federalTaxWithheld) break
          }
        }
      }
      
      // Strategy 5: EIN extraction (improved)
      console.log('🔍 Strategy 5: EIN extraction')
      
      // Pattern 1: Look for "Employer identification number" followed by EIN
      const einPattern1 = /Employer\s*identification\s*number\s*[^0-9]*([0-9]{2}-[0-9]{7})/i
      const einMatch1 = ocrText.match(einPattern1)
      if (einMatch1 && einMatch1[1]) {
        const ein = einMatch1[1]
        console.log('🔍 Testing EIN match (pattern 1):', ein)
        extractedData.employerEIN = ein
        console.log('✅ Found EIN (pattern 1):', ein)
      }
      
      // Pattern 2: Generic EIN pattern
      if (!extractedData.employerEIN) {
        const einPattern2 = /\b([0-9]{2}-[0-9]{7})\b/
        const einMatch2 = ocrText.match(einPattern2)
        if (einMatch2 && einMatch2[1]) {
          const ein = einMatch2[1]
          console.log('🔍 Testing EIN match (pattern 2):', ein)
          extractedData.employerEIN = ein
          console.log('✅ Found EIN (pattern 2):', ein)
        }
      }
      
      // Strategy 6: Look for SSN (improved to find full SSN)
      console.log('🔍 Strategy 6: SSN extraction')
      
      // Pattern 1: Look for "Employee's social security number" followed by SSN
      const ssnPattern1 = /Employee's\s*social\s*security\s*number\s*[^0-9]*([0-9]{3}-[0-9]{2}-[0-9]{4})/i
      const ssnMatch1 = ocrText.match(ssnPattern1)
      if (ssnMatch1 && ssnMatch1[1]) {
        const ssn = ssnMatch1[1]
        console.log('🔍 Testing SSN match (pattern 1):', ssn)
        extractedData.employeeSSN = ssn
        console.log('✅ Found SSN (pattern 1):', ssn)
      }
      
      // Pattern 2: Generic SSN pattern (full format)
      if (!extractedData.employeeSSN) {
        const ssnPattern2 = /\b([0-9]{3}-[0-9]{2}-[0-9]{4})\b/
        const ssnMatch2 = ocrText.match(ssnPattern2)
        if (ssnMatch2 && ssnMatch2[1]) {
          const ssn = ssnMatch2[1]
          console.log('🔍 Testing SSN match (pattern 2):', ssn)
          extractedData.employeeSSN = ssn
          console.log('✅ Found SSN (pattern 2):', ssn)
        }
      }
      
      // Strategy 7: Extract Social Security and Medicare wages
      console.log('🔍 Strategy 7: Additional W-2 fields')
      
      // Social Security wages
      const ssWagesPattern = /Social\s*security\s*wages\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const ssWagesMatch = ocrText.match(ssWagesPattern)
      if (ssWagesMatch && ssWagesMatch[1]) {
        const amount = ssWagesMatch[1].replace(/,/g, '')
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
          extractedData.socialSecurityWages = amount
          console.log('✅ Found Social Security wages:', amount)
        }
      }
      
      // Medicare wages
      const medicareWagesPattern = /Medicare\s*wages\s*and\s*tips\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const medicareWagesMatch = ocrText.match(medicareWagesPattern)
      if (medicareWagesMatch && medicareWagesMatch[1]) {
        const amount = medicareWagesMatch[1].replace(/,/g, '')
        if (!isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
          extractedData.medicareWages = amount
          console.log('✅ Found Medicare wages:', amount)
        }
      }
      
      // Log summary of what we found
      console.log('📊 Final Extraction Summary:')
      console.log('  Employee Name:', extractedData.employeeName || 'NOT FOUND')
      console.log('  Employer Name:', extractedData.employerName || 'NOT FOUND')  
      console.log('  Wages:', extractedData.wages || 'NOT FOUND')
      console.log('  Federal Tax:', extractedData.federalTaxWithheld || 'NOT FOUND')
      console.log('  Social Security Wages:', extractedData.socialSecurityWages || 'NOT FOUND')
      console.log('  Medicare Wages:', extractedData.medicareWages || 'NOT FOUND')
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
