import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  console.log("=== TESTING ABACUS AI API ===")
  
  try {
    const apiKey = process.env.ABACUSAI_API_KEY
    console.log("API Key format:", apiKey?.substring(0, 10) + "...")
    
    // Test endpoints
    const endpoints = [
      'https://cloud.abacus.ai/api/v1/models',
      'https://api.abacus.ai/v1/models',
      'https://apps.abacus.ai/v1/models',
      'https://cloud.abacus.ai/api/v1/chat/completions',
      'https://api.abacus.ai/v1/chat/completions',
      'https://apps.abacus.ai/v1/chat/completions'
    ]
    
    const authMethods = [
      { 'Authorization': `Bearer ${apiKey}` },
      { 'X-API-Key': apiKey },
      { 'API-Key': apiKey },
      { 'Authorization': `Token ${apiKey}` }
    ]
    
    const results = []
    
    // Test each combination
    for (const endpoint of endpoints) {
      for (const auth of authMethods) {
        try {
          console.log(`Testing ${endpoint} with ${Object.keys(auth)[0]}`)
          
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...auth
            }
          })
          
          const authMethod = Object.keys(auth)[0]
          const result = {
            endpoint,
            authMethod,
            status: response.status,
            statusText: response.statusText,
            success: response.ok
          }
          
          if (response.ok) {
            try {
              const data = await response.json()
              result.data = data
            } catch (e) {
              const text = await response.text()
              result.data = text.substring(0, 200)
            }
          } else {
            try {
              const errorData = await response.json()
              result.error = errorData
            } catch (e) {
              const errorText = await response.text()
              result.error = errorText.substring(0, 200)
            }
          }
          
          results.push(result)
          console.log(`Result: ${response.status} ${response.statusText}`)
          
        } catch (error) {
          results.push({
            endpoint,
            authMethod: Object.keys(auth)[0],
            error: error.message,
            success: false
          })
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      apiKeyFormat: apiKey?.substring(0, 10) + "...",
      results,
      successfulEndpoints: results.filter(r => r.success),
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error("Test error:", error)
    return NextResponse.json({
      error: error.message,
      stack: error.stack?.substring(0, 500)
    }, { status: 500 })
  }
}
