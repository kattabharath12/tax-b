// Create this file: app/api/check-status/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const document = await prisma.document.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        filename: true,
        documentType: true,
        status: true,
        processingStatus: true,
        createdAt: true,
        updatedAt: true,
        ocrText: true,
        extractedData: true
      }
    })
    
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }
    
    return NextResponse.json({
      success: true,
      document,
      hasOcrText: !!document.ocrText,
      hasExtractedData: !!document.extractedData,
      extractedDataKeys: document.extractedData ? Object.keys(document.extractedData) : []
    })
    
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
