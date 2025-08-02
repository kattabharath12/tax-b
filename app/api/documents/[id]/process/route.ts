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
      
      // ===== 100% DYNAMIC EXTRACTION (NO PREDEFINED VALUES) =====
      console.log('🎯 Starting truly dynamic extraction strategies...')
      
      // Strategy 1: Employee Name - Look for ANY two consecutive capitalized words
      console.log('🔍 Strategy 1: Employee name patterns')
      
      // Pattern 1: Find names in employee section (after "Employee's first name")
      const employeeSection = ocrText.match(/Employee's first name[\s\S]{0,300}/i)?.[0] || ''
      if (employeeSection) {
        // Look for two consecutive capitalized words that aren't form fields
        const namePattern = /\b([A-Z][a-z]{2,15})\s+([A-Z][a-z]{2,15})\b/g
        const nameMatches = [...employeeSection.matchAll(namePattern)]
        
        for (const match of nameMatches) {
          const firstName = match[1]
          const lastName = match[2]
          
          // Exclude common form field words
          const excludeWords = ['Employee', 'First', 'Last', 'Name', 'Social', 'Security', 'Number', 'Federal', 'Income', 'Tax', 'Control', 'Wages', 'Tips', 'Other', 'Compensation', 'Medicare', 'Nonqualified', 'Plans', 'Statutory', 'Retirement', 'Third', 'Party', 'Sick', 'Pay']
          
          if (!excludeWords.includes(firstName) && !excludeWords.includes(lastName)) {
            const fullName = `${firstName} ${lastName}`
            console.log('✅ Found employee name (section-based):', fullName)
            extractedData.employeeName = fullName
            break
          }
        }
      }
      
      // Pattern 2: Find names by position (lines that contain single proper names)
      if (!extractedData.employeeName) {
        for (let i = 0; i < lines.length - 1; i++) {
          const line1 = lines[i].trim()
          const line2 = lines[i + 1].trim()
          
          // Look for consecutive lines with single proper names
          if (/^[A-Z][a-z]{2,15}$/.test(line1) && /^[A-Z][a-z]{2,15}$/.test(line2)) {
            const excludeWords = ['Employee', 'Employer', 'Federal', 'Social', 'Security', 'Medicare', 'Control', 'Wages', 'Income', 'State', 'Local', 'Dependent', 'Benefits', 'Other', 'Compensation', 'Nonqualified', 'Plans', 'Statutory', 'Retirement', 'Third', 'Party', 'Sick', 'Pay']
            
            if (!excludeWords.includes(line1) && !excludeWords.includes(line2)) {
              const fullName = `${line1} ${line2}`
              console.log('✅ Found employee name (line-based):', fullName)
              extractedData.employeeName = fullName
              break
            }
          }
        }
      }
      
      // Strategy 2: Employer Name - Look for ANY company name with business indicators
      console.log('🔍 Strategy 2: Employer name patterns')
      
      // Pattern 1: Find company in employer section
      const employerSection = ocrText.match(/Employer's name[\s\S]{0,400}/i)?.[0] || ''
      if (employerSection) {
        // Look for company names with business indicators
        const companyPattern = /\b([A-Z][A-Za-z\s,.'&-]{8,60}(?:and\s+Sons|Company|Corp|Corporation|LLC|Inc|Group|Associates|Partners|Enterprises|Solutions|Services|Industries))\b/i
        const companyMatch = employerSection.match(companyPattern)
        
        if (companyMatch && companyMatch[1]) {
          const companyName = companyMatch[1].trim()
          console.log('✅ Found employer name (section-based):', companyName)
          extractedData.employerName = companyName
        }
      }
      
      // Pattern 2: Look for multi-word business names anywhere in text
      if (!extractedData.employerName) {
        const businessIndicators = ['and Sons', 'Company', 'Corp', 'Corporation', 'LLC', 'Inc', 'Group', 'Associates', 'Partners', 'Enterprises', 'Solutions', 'Services', 'Industries', 'Holdings', 'Consulting']
        
        for (const indicator of businessIndicators) {
          // Look for 2-5 words before the business indicator
          const pattern = new RegExp(`\\b([A-Z][A-Za-z\\s,.'&-]{5,40})\\s+${indicator}\\b`, 'i')
          const match = ocrText.match(pattern)
          
          if (match && match[1]) {
            const companyName = `${match[1].trim()} ${indicator}`
            
            // Make sure it's not a form field
            if (!/Employee|Employer|Federal|Social|Security|Medicare|Control|Wages|Income|State|Local|Dependent|Benefits|Other|Compensation|Nonqualified|Plans|Statutory|Retirement|Third|Party|Sick|Pay/i.test(companyName)) {
              console.log('✅ Found employer name (indicator-based):', companyName)
              extractedData.employerName = companyName
              break
            }
          }
        }
      }
      
      // Strategy 3: Wages - Find wages amount in context, not just largest number
      console.log('🔍 Strategy 3: Wage extraction')
      
      // Pattern 1: Find amount after "Wages, tips, other compensation"
      const wagePattern1 = /Wages,\s*tips,\s*other\s*compensation\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const wageMatch1 = ocrText.match(wagePattern1)
      if (wageMatch1 && wageMatch1[1]) {
        const amount = parseFloat(wageMatch1[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount >= 1000 && amount <= 1000000) { // Reasonable wage range
          console.log('✅ Found wages (context-based):', amount.toString())
          extractedData.wages = amount.toString()
        }
      }
      
      // Pattern 2: Find wages by position near "Wages, tips, other compensation"
      if (!extractedData.wages) {
        const wageLineIndex = lines.findIndex(line => /Wages.*tips.*compensation/i.test(line))
        if (wageLineIndex !== -1) {
          // Look in next 3 lines for reasonable wage amount
          for (let i = wageLineIndex + 1; i <= wageLineIndex + 3 && i < lines.length; i++) {
            const line = lines[i].trim()
            if (/^[0-9]+\.?[0-9]*$/.test(line)) {
              const amount = parseFloat(line.replace(/,/g, ''))
              if (!isNaN(amount) && amount >= 1000 && amount <= 1000000) {
                console.log('✅ Found wages (position-based):', amount.toString())
                extractedData.wages = amount.toString()
                break
              }
            }
          }
        }
      }
      
      // Pattern 3: Fallback - find reasonable wage amounts, excluding control numbers
      if (!extractedData.wages) {
        const amounts = ocrText.match(/\b\d{1,3}(?:,?\d{3})*\.?\d{0,2}\b/g) || []
        const numericAmounts = amounts
          .map(amt => parseFloat(amt.replace(/,/g, '')))
          .filter(amt => 
            !isNaN(amt) && 
            amt >= 1000 && 
            amt <= 500000 && // Lower upper limit to exclude control numbers
            amt.toString().length <= 8 && // Exclude very long numbers (like control numbers)
            !amt.toString().match(/^[0-9]{7,}$/) // Exclude 7+ digit numbers without decimals
          )
          .sort((a, b) => b - a) // Sort descending
        
        if (numericAmounts.length > 0) {
          const wageAmount = numericAmounts[0]
          console.log('✅ Found wages (filtered largest):', wageAmount.toString())
          extractedData.wages = wageAmount.toString()
        }
      }
      
      // Strategy 4: Federal Tax - Find tax amount in context
      console.log('🔍 Strategy 4: Federal tax extraction')
      
      // Pattern 1: Find amount after "Federal income tax withheld"
      const fedTaxPattern1 = /Federal\s*income\s*tax\s*withheld\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const fedMatch1 = ocrText.match(fedTaxPattern1)
      if (fedMatch1 && fedMatch1[1]) {
        const amount = parseFloat(fedMatch1[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount >= 0 && amount <= 100000) { // Reasonable tax range
          console.log('✅ Found federal tax (context-based):', amount.toString())
          extractedData.federalTaxWithheld = amount.toString()
        }
      }
      
      // Pattern 2: Find federal tax by position
      if (!extractedData.federalTaxWithheld) {
        const fedTaxLineIndex = lines.findIndex(line => /Federal.*income.*tax.*withheld/i.test(line))
        if (fedTaxLineIndex !== -1) {
          // Look in next 3 lines for reasonable tax amount
          for (let i = fedTaxLineIndex + 1; i <= fedTaxLineIndex + 3 && i < lines.length; i++) {
            const line = lines[i].trim()
            if (/^[0-9]+\.?[0-9]*$/.test(line)) {
              const amount = parseFloat(line.replace(/,/g, ''))
              if (!isNaN(amount) && amount >= 0 && amount <= 100000) {
                console.log('✅ Found federal tax (position-based):', amount.toString())
                extractedData.federalTaxWithheld = amount.toString()
                break
              }
            }
          }
        }
      }
      
      // Pattern 3: Find amounts smaller than wages but still substantial
      if (!extractedData.federalTaxWithheld && extractedData.wages) {
        const wageValue = parseFloat(extractedData.wages)
        const amounts = ocrText.match(/\b\d{1,3}(?:,?\d{3})*\.?\d{0,2}\b/g) || []
        const taxCandidates = amounts
          .map(amt => parseFloat(amt.replace(/,/g, '')))
          .filter(amt => 
            !isNaN(amt) && 
            amt > 0 && 
            amt < wageValue && 
            amt >= 100 && 
            amt <= wageValue * 0.5 &&
            amt.toString().length <= 8
          )
          .sort((a, b) => b - a)
        
        if (taxCandidates.length > 0) {
          const federalTax = taxCandidates[0]
          console.log('✅ Found federal tax (wage-relative):', federalTax.toString())
          extractedData.federalTaxWithheld = federalTax.toString()
        }
      }
      
      // Strategy 5: EIN - Look for XX-XXXXXXX pattern
      console.log('🔍 Strategy 5: EIN extraction')
      
      const einPattern = /\b(\d{2}-\d{7})\b/
      const einMatch = ocrText.match(einPattern)
      if (einMatch && einMatch[1]) {
        console.log('✅ Found EIN:', einMatch[1])
        extractedData.employerEIN = einMatch[1]
      }
      
      // Strategy 6: SSN - Look for XXX-XX-XXXX pattern
      console.log('🔍 Strategy 6: SSN extraction')
      
      const ssnPattern = /\b(\d{3}-\d{2}-\d{4})\b/
      const ssnMatch = ocrText.match(ssnPattern)
      if (ssnMatch && ssnMatch[1]) {
        console.log('✅ Found SSN:', ssnMatch[1])
        extractedData.employeeSSN = ssnMatch[1]
      }
      
      // Strategy 7: Additional fields - Find other W-2 amounts by context
      console.log('🔍 Strategy 7: Additional W-2 fields')
      
      // Social Security wages - find amount after "Social security wages"
      const ssWagesPattern = /Social\s*security\s*wages\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const ssWagesMatch = ocrText.match(ssWagesPattern)
      if (ssWagesMatch && ssWagesMatch[1]) {
        const amount = parseFloat(ssWagesMatch[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount > 0 && amount <= 1000000) {
          console.log('✅ Found Social Security wages (context):', amount.toString())
          extractedData.socialSecurityWages = amount.toString()
        }
      }
      
      // Medicare wages - find amount after "Medicare wages and tips"
      const medicareWagesPattern = /Medicare\s*wages\s*and\s*tips\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const medicareWagesMatch = ocrText.match(medicareWagesPattern)
      if (medicareWagesMatch && medicareWagesMatch[1]) {
        const amount = parseFloat(medicareWagesMatch[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount > 0 && amount <= 1000000) {
          console.log('✅ Found Medicare wages (context):', amount.toString())
          extractedData.medicareWages = amount.toString()
        }
      }
      
      // Social Security tax withheld
      const ssTaxPattern = /Social\s*security\s*tax\s*withheld\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const ssTaxMatch = ocrText.match(ssTaxPattern)
      if (ssTaxMatch && ssTaxMatch[1]) {
        const amount = parseFloat(ssTaxMatch[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount > 0 && amount <= 100000) {
          console.log('✅ Found Social Security tax:', amount.toString())
          extractedData.socialSecurityTaxWithheld = amount.toString()
        }
      }
      
      // Medicare tax withheld
      const medicareTaxPattern = /Medicare\s*tax\s*withheld\s*[^0-9]*([0-9]+\.?[0-9]*)/i
      const medicareTaxMatch = ocrText.match(medicareTaxPattern)
      if (medicareTaxMatch && medicareTaxMatch[1]) {
        const amount = parseFloat(medicareTaxMatch[1].replace(/,/g, ''))
        if (!isNaN(amount) && amount > 0 && amount <= 100000) {
          console.log('✅ Found Medicare tax:', amount.toString())
          extractedData.medicareTaxWithheld = amount.toString()
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
