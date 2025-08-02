"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, CheckCircle, User, Users, Info } from "lucide-react"
import { NameValidationResult } from "@/lib/name-validation"

interface NameValidationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (proceedWithMismatches: boolean) => void
  validationResult: NameValidationResult | null
  documentType: string
}

export function NameValidationDialog({
  isOpen,
  onClose,
  onConfirm,
  validationResult,
  documentType
}: NameValidationDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async (proceedWithMismatches: boolean) => {
    setLoading(true)
    try {
      await onConfirm(proceedWithMismatches)
    } finally {
      setLoading(false)
    }
  }

  // Add null check for validationResult
  if (!validationResult) {
    return null
  }

  // Safely extract data with fallbacks
  const {
    isValid = false,
    confidence = 0,
    matches = { primaryTaxpayer: false, spouse: false },
    details = { documentNames: [], profileNames: [], reason: 'Unknown' }
  } = validationResult

  // Ensure arrays are always arrays
  const documentNames = Array.isArray(details.documentNames) ? details.documentNames : []
  const profileNames = Array.isArray(details.profileNames) ? details.profileNames : []

  if (isValid) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span>Name Validation Successful</span>
            </DialogTitle>
            <DialogDescription>
              The names in your {documentType} document match your profile information.
            </DialogDescription>
          </DialogHeader>
          
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Document processing will continue automatically. The extracted data will be added to your tax return.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button 
              onClick={() => handleConfirm(false)} 
              disabled={loading}
              className="w-full"
            >
              {loading ? "Processing..." : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <span>Name Validation Required</span>
          </DialogTitle>
          <DialogDescription>
            We found some differences between the names in your {documentType} document and your profile information. Please review and decide how to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Confidence Score */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Validation Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Match Confidence</span>
                <Badge variant={confidence > 70 ? "default" : "destructive"}>
                  {Math.round(confidence)}%
                </Badge>
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {details.reason}
              </div>
            </CardContent>
          </Card>

          {/* Name Comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center space-x-2">
                <User className="h-4 w-4" />
                <span>Name Comparison</span>
              </CardTitle>
              <CardDescription>
                Compare names between your profile and document
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Document Names */}
              <div>
                <h4 className="font-medium text-sm text-gray-700 mb-2">
                  Names Found in Document:
                </h4>
                <div className="space-y-1">
                  {documentNames.length > 0 ? (
                    documentNames.map((name, index) => (
                      <div 
                        key={`doc-${index}`} 
                        className="bg-red-50 border border-red-200 p-2 rounded text-sm"
                      >
                        {name || 'Empty name'}
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500 italic text-sm bg-gray-50 p-2 rounded">
                      No names found in document
                    </div>
                  )}
                </div>
              </div>

              {/* Profile Names */}
              <div>
                <h4 className="font-medium text-sm text-gray-700 mb-2">
                  Names in Your Profile:
                </h4>
                <div className="space-y-1">
                  {profileNames.length > 0 ? (
                    profileNames.map((name, index) => (
                      <div 
                        key={`profile-${index}`} 
                        className="bg-blue-50 border border-blue-200 p-2 rounded text-sm"
                      >
                        {name || 'Empty name'}
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500 italic text-sm bg-gray-50 p-2 rounded">
                      No profile names set
                    </div>
                  )}
                </div>
              </div>

              {/* Match Status */}
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Primary Taxpayer Match:</span>
                    <Badge variant={matches.primaryTaxpayer ? "default" : "destructive"} className="text-xs">
                      {matches.primaryTaxpayer ? "✓ Match" : "✗ No Match"}
                    </Badge>
                  </div>
                  {profileNames.length > 1 && (
                    <div className="flex justify-between">
                      <span>Spouse Match:</span>
                      <Badge variant={matches.spouse ? "default" : "destructive"} className="text-xs">
                        {matches.spouse ? "✓ Match" : "✗ No Match"}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Suggestions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center space-x-2">
                <Info className="h-4 w-4" />
                <span>Suggestions</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-1">•</span>
                  <span>Make sure the document belongs to you or your spouse</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-1">•</span>
                  <span>Update your profile information if your name has changed</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-1">•</span>
                  <span>Check for typos or different name formats (nicknames, middle names)</span>
                </li>
                {confidence < 30 && (
                  <li className="flex items-start space-x-2">
                    <span className="text-red-500 mt-1">•</span>
                    <span className="text-red-600 font-medium">Consider uploading a different document if this doesn't belong to you</span>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          {/* Warning for low confidence */}
          {confidence < 50 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> We found significant name differences (confidence: {confidence}%). 
                Please ensure the document belongs to you or update your profile information before continuing.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleConfirm(false)}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            Update Profile First
          </Button>
          <Button
            onClick={() => handleConfirm(true)}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading ? "Processing..." : "Continue Anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
