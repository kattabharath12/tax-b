// Create/Replace: lib/name-validation.ts

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
  const names: string[] = []
  
  if (extractedData?.employeeName) {
    names.push(extractedData.employeeName)
  }
  
  if (extractedData?.recipientName) {
    names.push(extractedData.recipientName)
  }
  
  if (extractedData?.employerName && !extractedData?.employeeName) {
    // Only include employer name if no employee name found
    names.push(extractedData.employerName)
  }
  
  return names.filter(name => name && name.trim().length > 0)
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
  
  // If no names to compare, validation fails
  if (!documentNames.length) {
    return {
      isValid: false,
      confidence: 0,
      matches: { primaryTaxpayer: false, spouse: false },
      details: {
        documentNames,
        profileNames: [
          `${profileNames.firstName || ''} ${profileNames.lastName || ''}`.trim(),
          `${profileNames.spouseFirstName || ''} ${profileNames.spouseLastName || ''}`.trim()
        ].filter(name => name.length > 0),
        reason: 'No names found in document'
      }
    }
  }

  // Build profile names list
  const profileNamesList: string[] = []
  
  if (profileNames.firstName || profileNames.lastName) {
    profileNamesList.push(`${profileNames.firstName || ''} ${profileNames.lastName || ''}`.trim())
  }
  
  if (profileNames.spouseFirstName || profileNames.spouseLastName) {
    profileNamesList.push(`${profileNames.spouseFirstName || ''} ${profileNames.spouseLastName || ''}`.trim())
  }

  // If no profile names, validation fails
  if (!profileNamesList.length || profileNamesList.every(name => !name.trim())) {
    return {
      isValid: false,
      confidence: 0,
      matches: { primaryTaxpayer: false, spouse: false },
      details: {
        documentNames,
        profileNames: profileNamesList,
        reason: 'No names in tax return profile'
      }
    }
  }

  // Check each document name against profile names
  let bestMatch = { score: 0, primaryMatch: false, spouseMatch: false, reason: '' }

  for (const docName of documentNames) {
    for (let i = 0; i < profileNamesList.length; i++) {
      const profileName = profileNamesList[i]
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

  return {
    isValid,
    confidence: bestMatch.score,
    matches: {
      primaryTaxpayer: bestMatch.primaryMatch,
      spouse: bestMatch.spouseMatch
    },
    details: {
      documentNames,
      profileNames: profileNamesList,
      reason: bestMatch.reason
    }
  }
}

function compareNames(docName: string, profileName: string): { score: number; reason: string } {
  if (!docName?.trim() || !profileName?.trim()) {
    return { score: 0, reason: 'Empty name comparison' }
  }

  // Normalize names (lowercase, remove special chars, extra spaces)
  const normalizeString = (str: string) => 
    str.toLowerCase()
       .replace(/[^a-z\s]/g, '')
       .replace(/\s+/g, ' ')
       .trim()

  const docNormalized = normalizeString(docName)
  const profileNormalized = normalizeString(profileName)

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
