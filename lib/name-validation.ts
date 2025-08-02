// Replace your lib/name-validation.ts with this fixed version

export interface NameValidationResult {
  isValid: boolean
  confidence: number
  matches: {
    primaryTaxpayer: boolean
    spouse: boolean
  }
  details: {
    documentNames: string[]
    profileNames: string[]
    reason: string
  }
}

export function extractNamesFromDocument(extractedData: any): string[] {
  // Add safety checks for extractedData
  if (!extractedData || typeof extractedData !== 'object') {
    console.warn('extractNamesFromDocument: Invalid extractedData provided:', extractedData)
    return []
  }

  const names: string[] = []
  
  // Safely extract employee name
  if (extractedData?.employeeName && typeof extractedData.employeeName === 'string') {
    names.push(extractedData.employeeName.trim())
  }
  
  // Safely extract recipient name
  if (extractedData?.recipientName && typeof extractedData.recipientName === 'string') {
    names.push(extractedData.recipientName.trim())
  }
  
  // Only include employer name if no employee name found
  if (extractedData?.employerName && 
      typeof extractedData.employerName === 'string' && 
      !extractedData?.employeeName) {
    names.push(extractedData.employerName.trim())
  }
  
  // Filter out empty or invalid names
  const validNames = names.filter(name => 
    name && 
    typeof name === 'string' && 
    name.trim().length > 0
  )
  
  console.log('Extracted names from document:', validNames)
  return validNames
}

export function validateNames(
  profileNames: {
    firstName?: string
    lastName?: string
    spouseFirstName?: string
    spouseLastName?: string
  },
  documentNames: string[]
): NameValidationResult {
  
  // Ensure documentNames is always an array
  const safeDocumentNames = Array.isArray(documentNames) ? documentNames : []
  
  // Ensure profileNames is an object with safe defaults
  const safeProfileNames = {
    firstName: profileNames?.firstName || '',
    lastName: profileNames?.lastName || '',
    spouseFirstName: profileNames?.spouseFirstName || '',
    spouseLastName: profileNames?.spouseLastName || ''
  }

  console.log('Name validation input:', {
    documentNames: safeDocumentNames,
    profileNames: safeProfileNames
  })
  
  // If no names to compare, validation fails
  if (!safeDocumentNames.length) {
    return {
      isValid: false,
      confidence: 0,
      matches: { primaryTaxpayer: false, spouse: false },
      details: {
        documentNames: safeDocumentNames,
        profileNames: buildProfileNamesList(safeProfileNames),
        reason: 'No names found in document'
      }
    }
  }

  // Build profile names list safely
  const profileNamesList = buildProfileNamesList(safeProfileNames)

  // If no profile names, validation fails
  if (!profileNamesList.length || profileNamesList.every(name => !name.trim())) {
    return {
      isValid: false,
      confidence: 0,
      matches: { primaryTaxpayer: false, spouse: false },
      details: {
        documentNames: safeDocumentNames,
        profileNames: profileNamesList,
        reason: 'No names in tax return profile'
      }
    }
  }

  // Check each document name against profile names
  let bestMatch = { score: 0, primaryMatch: false, spouseMatch: false, reason: '' }

  for (const docName of safeDocumentNames) {
    if (!docName || typeof docName !== 'string') continue
    
    for (let i = 0; i < profileNamesList.length; i++) {
      const profileName = profileNamesList[i]
      if (!profileName || typeof profileName !== 'string') continue
      
      const matchResult = compareNames(docName, profileName)
      
      if (matchResult.score > bestMatch.score) {
        bestMatch = {
          score: matchResult.score,
          primaryMatch: i === 0, // First name in list is primary taxpayer
          spouseMatch: i === 1,  // Second name in list is spouse
          reason: matchResult.reason
        }
      }
    }
  }

  // Determine if validation passes (require at least 70% confidence)
  const isValid = bestMatch.score >= 70

  const result = {
    isValid,
    confidence: bestMatch.score,
    matches: {
      primaryTaxpayer: bestMatch.primaryMatch,
      spouse: bestMatch.spouseMatch
    },
    details: {
      documentNames: safeDocumentNames,
      profileNames: profileNamesList,
      reason: bestMatch.reason
    }
  }

  console.log('Name validation result:', result)
  return result
}

// Helper function to safely build profile names list
function buildProfileNamesList(profileNames: {
  firstName: string
  lastName: string
  spouseFirstName: string
  spouseLastName: string
}): string[] {
  const profileNamesList: string[] = []
  
  // Build primary taxpayer name
  const primaryName = `${profileNames.firstName} ${profileNames.lastName}`.trim()
  if (primaryName.length > 0) {
    profileNamesList.push(primaryName)
  }
  
  // Build spouse name
  const spouseName = `${profileNames.spouseFirstName} ${profileNames.spouseLastName}`.trim()
  if (spouseName.length > 0) {
    profileNamesList.push(spouseName)
  }

  return profileNamesList
}

function compareNames(docName: string, profileName: string): { score: number; reason: string } {
  // Additional safety checks
  if (!docName || !profileName || 
      typeof docName !== 'string' || 
      typeof profileName !== 'string') {
    return { score: 0, reason: 'Invalid name types for comparison' }
  }

  const trimmedDocName = docName.trim()
  const trimmedProfileName = profileName.trim()
  
  if (!trimmedDocName || !trimmedProfileName) {
    return { score: 0, reason: 'Empty name comparison after trimming' }
  }

  // Normalize names (lowercase, remove special chars, extra spaces)
  const normalizeString = (str: string) => {
    try {
      return str.toLowerCase()
               .replace(/[^a-z\s]/g, '')
               .replace(/\s+/g, ' ')
               .trim()
    } catch (error) {
      console.error('Error normalizing string:', str, error)
      return ''
    }
  }

  const docNormalized = normalizeString(trimmedDocName)
  const profileNormalized = normalizeString(trimmedProfileName)

  if (!docNormalized || !profileNormalized) {
    return { score: 0, reason: 'Failed to normalize names' }
  }

  // Exact match
  if (docNormalized === profileNormalized) {
    return { score: 100, reason: 'Exact name match' }
  }

  // Split into name parts
  const docParts = docNormalized.split(' ').filter(part => part.length > 1)
  const profileParts = profileNormalized.split(' ').filter(part => part.length > 1)

  if (docParts.length === 0 || profileParts.length === 0) {
    return { score: 0, reason: 'No valid name parts found' }
  }

  // Check for first and last name matches
  const docFirst = docParts[0]
  const docLast = docParts[docParts.length - 1]
  const profileFirst = profileParts[0]
  const profileLast = profileParts[profileParts.length - 1]

  let matchingParts = 0
  let totalParts = Math.max(docParts.length, profileParts.length)

  // First name match
  if (docFirst === profileFirst) {
    matchingParts++
  }

  // Last name match (if both have last names)
  if (docParts.length > 1 && profileParts.length > 1 && docLast === profileLast) {
    matchingParts++
  }

  // Middle name matches
  for (let i = 1; i < docParts.length - 1; i++) {
    for (let j = 1; j < profileParts.length - 1; j++) {
      if (docParts[i] === profileParts[j]) {
        matchingParts += 0.5 // Middle names are worth less
      }
    }
  }

  // Calculate score based on matching parts
  let score = Math.round((matchingParts / Math.min(docParts.length, profileParts.length)) * 100)

  // Cap at 100
  score = Math.min(score, 100)

  let reason = `${matchingParts} of ${totalParts} name parts match`
  
  if (score >= 90) reason = 'Strong name match'
  else if (score >= 70) reason = 'Good name match'
  else if (score >= 50) reason = 'Partial name match'
  else if (score >= 30) reason = 'Weak name match'
  else reason = 'Names do not match'

  return { score, reason }
}
